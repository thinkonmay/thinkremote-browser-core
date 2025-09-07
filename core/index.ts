import { HID } from './hid/hid';
import { TouchHandler } from './hid/touch';
import { EventCode, HIDMsg } from './models/keys.model';
import { AudioWrapper } from './pipeline/sink/audio/wrapper';
import { VideoWrapper } from './pipeline/sink/video/wrapper';
import { convertJSKey, useShift } from './utils/convert';
import { AddNotifier, ConnectionEvent, Log, LogLevel } from './utils/log';
import { getBrowser, isMobile } from './utils/platform';
import { DataRTC } from './webrtc/data';
import { MediaRTC, MessageType, RTCMetric } from './webrtc/media';
import { MicrophoneRTC } from './webrtc/microphone';

type Metric = {
    video: {
        status: 'close' | 'connecting' | 'connected';
        timestamp: Date;
        idrcount: {
            last: number;
            current: number;
        };
        packetloss: {
            last: number;
            current: number;
        };
        bitrate: {
            total: number;
            persecond: number;
        };
        frame: {
            totalframes: number;
            totalframedelay: number;
            totaldecodetime: number;

            persecond: number;
            decodetime: number;
            delay: number;
        };
    };
    data: {
        status: 'close' | 'connecting' | 'connected';
    };
    audio: {
        status: 'close' | 'connecting' | 'connected';

        sample: {
            received: number;
        };
    };
};
const initialMetric: Metric = {
    data: {
        status: 'close' as 'close' | 'connecting' | 'connected'
    },
    audio: {
        status: 'close' as 'close' | 'connecting' | 'connected',

        sample: {
            received: 0
        }
    },
    video: {
        status: 'close' as 'close' | 'connecting' | 'connected',
        timestamp: new Date(),
        idrcount: {
            current: 0,
            last: 0
        },
        bitrate: {
            persecond: 0,
            total: 0
        },
        frame: {
            totaldecodetime: 0,
            totalframes: 0,
            totalframedelay: 0,
            persecond: 0,
            delay: 0,
            decodetime: 0
        },
        packetloss: {
            current: 0,
            last: 0
        }
    }
};

class Thinkmay {
    public hid: HID;
    public touch: TouchHandler;
    public Metrics: Metric;
    public ready(): boolean {
        return this.Metrics.video.status == 'connected';
    }
    public authFailed(): boolean {
        return this.videoConn.authFailure || this.audioConn.authFailure;
    }

    video: VideoWrapper;
    audio: AudioWrapper;
    dataUrl: string;
    micUrl: string;

    constructor(
        vid: VideoWrapper,
        audio: AudioWrapper,
        dataUrl: string,
        micUrl?: string
    ) {
        this.closed = false;
        this.video = vid;
        this.audio = audio;
        this.dataUrl = dataUrl;
        this.micUrl = micUrl;
        this.Metrics = structuredClone(initialMetric);

        this.hid = new HID(this.send.bind(this), vid.internal());
        this.touch = new TouchHandler(vid.internal(), this.send.bind(this));

        Log(LogLevel.Infor, `Started remote desktop connection`);
        this.audioEstablishmentLoop();
        this.videoEstablishmentLoop();
        if (this.micUrl) this.microphoneEstablishmentLoop();
        this.dataEstablishmentLoop();
    }

    private static Now = () => new Date().getTime();
    private missing_frame: any;
    private countThread: any;
    private waitForNewFrame() {
        if (this.missing_frame != undefined) clearTimeout(this.missing_frame);
        this.missing_frame = setTimeout(this.ResetVideo.bind(this), 1000);
    }

    private videoConn: MediaRTC;
    private audioConn: MediaRTC;
    private microConn: MicrophoneRTC;
    private dataConn: DataRTC;
    private closed: boolean;
    private gid = 0;

    private async audioTransform(
        encodedFrame: RTCEncodedAudioFrame,
        controller: TransformStreamDefaultController<RTCEncodedAudioFrame>
    ) {
        controller.enqueue(encodedFrame);
    }
    private async videoTransform(
        encodedFrame: RTCEncodedVideoFrame,
        controller: TransformStreamDefaultController<RTCEncodedVideoFrame>
    ) {
        controller.enqueue(encodedFrame);
        this.waitForNewFrame();
    }

    private async handleIncomingVideo(evt: RTCTrackEvent): Promise<void> {
        const stream = evt.streams.find(
            (val) => val.getVideoTracks().length > 0
        );

        if (this.closed) return;
        else if (evt.track.kind != 'video') return;
        else if (getBrowser() != 'Safari')
            try {
                const frameStreams = (
                    evt.receiver as any
                ).createEncodedStreams();
                frameStreams.readable
                    .pipeThrough(
                        new TransformStream({
                            transform: this.videoTransform.bind(this)
                        })
                    )
                    .pipeTo(frameStreams.writable);
            } catch {}

        Log(LogLevel.Warning, `Incoming ${evt.track.kind} stream ${stream.id}`);
        await this.video.assign(stream);
        await this.video.play();
    }

    private async handleIncomingAudio(evt: RTCTrackEvent): Promise<void> {
        const stream = evt.streams.find(
            (val) => val.getAudioTracks().length > 0
        );

        if (this.closed) return;
        else if (evt.track.kind != 'audio') return;
        else if (getBrowser() != 'Safari')
            try {
                const frameStreams = (
                    evt.receiver as any
                ).createEncodedStreams();
                frameStreams.readable
                    .pipeThrough(
                        new TransformStream({
                            transform: this.audioTransform.bind(this)
                        })
                    )
                    .pipeTo(frameStreams.writable);
            } catch {}

        Log(LogLevel.Infor, `Incoming ${evt.track.kind} stream`);
        await this.audio.assign(stream);
        await this.audio.play();
    }

    public async ChangeFramerate(framerate: number) {
        if (this.closed) return;
        else if (!this.videoConn.connected)
            setTimeout(() => this.ChangeFramerate(framerate), 1000);
        this.videoConn.Send(MessageType.Framerate, framerate);
        Log(LogLevel.Infor, `changing framerate to ${framerate}`);
    }
    public async ChangeBitrate(bitrate: number) {
        if (this.closed) return;
        else if (!this.videoConn.connected)
            setTimeout(() => this.ChangeBitrate(bitrate), 1000);
        this.videoConn.Send(MessageType.Bitrate, Math.round(bitrate / 1000));
        Log(LogLevel.Infor, `changing bitrate to ${bitrate}`);
    }

    public async PointerVisible(enable: boolean) {
        if (this.closed) return;
        else if (!this.videoConn.connected)
            setTimeout(() => this.PointerVisible(enable), 1000);
        this.videoConn.Send(MessageType.Pointer, enable ? 1 : 0);
    }

    public async ResetVideo() {
        if (this.closed) return;
        else if (!this.videoConn.connected) return;
        this.videoConn.Send(MessageType.Idr, 1);
    }

    public async HardReset() {
        if (this.closed) return;
        this.videoConn?.Close();
        this.audioConn?.Close();
        this.dataConn?.Close();
        this.microConn?.Close();
        this.Metrics.audio.status = 'close';
        this.Metrics.video.status = 'close';
    }

    async SendRawHID(...data: HIDMsg[]) {
        if (this.closed) return;
        for (const element of data) {
            if (element.convertType() == EventCode.cs)
                this.dataConn.SendClipboard(element.data.val);
            else this.dataConn.Send(element.convertType(), ...element.buffer());
        }
    }
    public async SetClipboard(val: string) {
        if (this.closed) return;
        await this.SendRawHID(new HIDMsg(EventCode.cs, { val }));
    }

    private send = (...val: HIDMsg[]) => this.SendRawHID(...val);

    private handle_metrics = (val: RTCMetric) => {
        const now = new Date();
        switch (val.kind) {
            case 'video':
                this.Metrics.video.frame.persecond = Math.round(
                    (val.framesDecoded - this.Metrics.video.frame.totalframes) /
                        ((now.getTime() -
                            this.Metrics.video.timestamp.getTime()) /
                            1000)
                );
                this.Metrics.video.frame.decodetime =
                    ((val.totalDecodeTime +
                        val.totalAssemblyTime -
                        this.Metrics.video.frame.totaldecodetime) /
                        (val.framesDecoded -
                            this.Metrics.video.frame.totalframes)) *
                    1000;
                this.Metrics.video.frame.delay =
                    ((val.totalInterFrameDelay -
                        this.Metrics.video.frame.totalframedelay) /
                        (val.framesDecoded -
                            this.Metrics.video.frame.totalframes)) *
                    1000;

                this.Metrics.video.frame.totalframes = val.framesDecoded;
                this.Metrics.video.frame.totalframedelay =
                    val.totalInterFrameDelay;
                this.Metrics.video.frame.totaldecodetime =
                    val.totalDecodeTime + val.totalAssemblyTime;

                this.Metrics.video.bitrate.persecond = Math.round(
                    (((val.bytesReceived - this.Metrics.video.bitrate.total) /
                        ((now.getTime() -
                            this.Metrics.video.timestamp.getTime()) /
                            1000)) *
                        8) /
                        1024
                );
                this.Metrics.video.bitrate.total = val.bytesReceived;

                this.Metrics.video.packetloss.current =
                    val.packetsLost - this.Metrics.video.packetloss.last;
                this.Metrics.video.packetloss.last = val.packetsLost;

                this.Metrics.video.idrcount.current =
                    val.keyFramesDecoded - this.Metrics.video.idrcount.last;
                this.Metrics.video.idrcount.last = val.keyFramesDecoded;

                this.Metrics.video.timestamp = now;
                break;
            case 'audio':
                this.Metrics.audio.sample.received = val.totalSamplesReceived;
                break;
            default:
                break;
        }
    };

    private audioEstablishmentLoop = async () => {
        if (this.closed) return;

        this.audioConn = new MediaRTC(
            this.audio.url,
            this.handleIncomingAudio.bind(this),
            this.handle_metrics.bind(this),
            () => setTimeout(this.audioEstablishmentLoop.bind(this), 1000)
        );

        const start = Thinkmay.Now();
        this.Metrics.audio = structuredClone(initialMetric.audio);
        this.Metrics.audio.status = 'connecting';
        while (!this.audioConn.connected) {
            if (Thinkmay.Now() - start > 30 * 1000)
                return this.audioConn.Close();
            else if (this.audioConn.closed) return;
            else await new Promise((r) => setTimeout(r, 1000));
        }

        this.Metrics.audio.status = 'connected';
    };

    private videoEstablishmentLoop = async () => {
        if (this.closed) return;

        this.videoConn = new MediaRTC(
            this.video.url,
            this.handleIncomingVideo.bind(this),
            this.handle_metrics.bind(this),
            () => setTimeout(this.videoEstablishmentLoop.bind(this), 1000)
        );

        this.Metrics.video = structuredClone(initialMetric.video);
        this.Metrics.video.status = 'connecting';

        let start = Thinkmay.Now();
        while (!this.videoConn.connected) {
            if (Thinkmay.Now() - start > 30 * 1000)
                return this.videoConn.Close();
            else if (this.videoConn.closed) return;
            else await new Promise((r) => setTimeout(r, 100));
        }

        start = Thinkmay.Now();
        await this.ResetVideo();
        while (this.Metrics.video.frame.totalframes == 0) {
            if (Thinkmay.Now() - start > 5 * 1000)
                return this.videoConn.Close();
            else if (this.videoConn.closed) return;
            else await new Promise((r) => setTimeout(r, 300));
        }

        this.Metrics.video.status = 'connected';
    };

    private microphoneEstablishmentLoop = async () => {
        if (this.closed) return;

        this.microConn = new MicrophoneRTC(this.micUrl, () =>
            setTimeout(this.microphoneEstablishmentLoop.bind(this), 1000)
        );
    };

    private dataEstablishmentLoop = async () => {
        if (this.closed) return;

        this.dataConn = new DataRTC(
            this.dataUrl,
            () => setTimeout(this.dataEstablishmentLoop.bind(this), 1000),
            this.hid.handleIncomingData.bind(this.hid)
        );
    };

    public MouseButtonDown = (event: { button: number }) =>
        this.SendRawHID(
            new HIDMsg(EventCode.md, {
                button: event.button
            })
        );
    public MouseButtonUp = (event: { button: number }) =>
        this.SendRawHID(
            new HIDMsg(EventCode.mu, {
                button: event.button
            })
        );
    public MouseWheel = (event: { deltaY: number }) =>
        this.SendRawHID(
            new HIDMsg(EventCode.mw, {
                deltaY: -Math.round(event.deltaY)
            })
        );
    public VirtualGamepadAxis = (x: number, y: number, isRight?: boolean) =>
        this.SendRawHID(
            new HIDMsg(EventCode.ga, {
                gid: this.gid,
                index: isRight ? 2 : 0,
                val: x
            }),
            new HIDMsg(EventCode.ga, {
                gid: this.gid,
                index: isRight ? 3 : 1,
                val: y
            })
        );
    public VirtualKeyboard = (...keys: { code: EventCode; jsKey: string }[]) =>
        this.SendRawHID(
            ...keys.map(
                (x) => new HIDMsg(x.code, { key: convertJSKey(x.jsKey, 0) })
            )
        );
    public VirtualGamepadButton = (isDown: boolean, index: number) =>
        this.SendRawHID(
            new HIDMsg(
                index == 6 || index == 7 ? EventCode.gs : EventCode.gb,
                index == 6 || index == 7
                    ? {
                          gid: this.gid,
                          index: index,
                          val: !isDown ? 0 : 1
                      }
                    : {
                          gid: this.gid,
                          index: index,
                          val: !isDown ? 0 : 1
                      }
            )
        );

    public Close() {
        this.closed = true;
        clearTimeout(this.missing_frame);
        clearInterval(this.countThread);
        this.hid?.Close();
        this.touch?.Close();
        this.videoConn?.Close();
        this.audioConn?.Close();
        this.video.internal().srcObject = null;
        this.audio.internal().srcObject = null;
        Log(LogLevel.Infor, `Closed remote desktop connection`);
    }
}

export {
    AddNotifier,
    AudioWrapper,
    ConnectionEvent,
    EventCode,
    isMobile,
    Thinkmay as RemoteDesktopClient,
    useShift,
    VideoWrapper
};
