import { HID } from './hid/hid';
import { TouchHandler } from './hid/touch';
import { AxisType } from './models/hid.model';
import { EventCode, HIDMsg } from './models/keys.model';
import { AudioWrapper } from './pipeline/sink/audio/wrapper';
import { VideoWrapper } from './pipeline/sink/video/wrapper';
import { convertJSKey, useShift } from './utils/convert';
import { AddNotifier, ConnectionEvent, Log, LogLevel } from './utils/log';
import { getBrowser, isMobile } from './utils/platform';
import { DataRTC } from './webrtc/data';
import { MediaRTC, MessageType, RTCMetric } from './webrtc/media';

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
    public video: VideoWrapper;
    public audio: AudioWrapper;
    public Metrics: Metric;
    public dataUrl: string;
    public ready(): boolean {
        return this.Metrics.video.status == 'connected';
    }

    constructor(vid: VideoWrapper, audio: AudioWrapper, dataUrl: string) {
        this.closed = false;
        this.video = vid;
        this.audio = audio;
        this.dataUrl = dataUrl;
        this.Metrics = structuredClone(initialMetric);

        this.hid = new HID(this.send.bind(this), vid.internal());
        this.touch = new TouchHandler(vid.internal(), this.send.bind(this));

        Log(LogLevel.Infor, `Started remote desktop connection`);
        this.audioEstablishmentLoop();
        this.videoEstablishmentLoop();
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
    private dataConn: DataRTC;
    private closed: boolean;

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
        if (this.closed) return;
        Log(LogLevel.Infor, `Incoming ${evt.track.kind} stream`);
        if (evt.track.kind != 'video') return;

        const stream = evt.streams.find(
            (val) => val.getVideoTracks().length > 0
        );

        if (Number.isNaN(parseInt(stream.id))) return;

        if (getBrowser() == 'Safari') {
        } else {
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
            } catch { }
        }
        await this.video.assign(stream);
    }

    private async handleIncomingAudio(evt: RTCTrackEvent): Promise<void> {
        if (this.closed) return;
        Log(LogLevel.Infor, `Incoming ${evt.track.kind} stream`);
        if (evt.track.kind != 'audio') return;

        const stream = evt.streams.find(
            (val) => val.getAudioTracks().length > 0
        );

        if (getBrowser() == 'Safari') {
        } else {
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
            } catch { }
        }
        await this.audio.assign(stream);
        await this.audio.play();
    }

    private async AcquireMicrophone() {
        // Handles being called several times to update labels. Preserve values.
        let localStream: MediaStream = null;
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                // audio: true
            });
        } catch {
            return null;
        }

        const audioTracks = localStream.getAudioTracks();

        return localStream;
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
        this.Metrics.audio.status = 'close';
        this.Metrics.video.status = 'close';
    }

    async SendRawHID(...data: HIDMsg[]) {
        if (this.closed) return;
        for (const element of data) {
            this.dataConn.Send(element.convertType(), ...element.buffer());
        }
    }
    public async SetClipboard(val: string) {
        if (this.closed) return;
        await this.SendRawHID(
            new HIDMsg(EventCode.cs, {
                val: btoa(val)
            })
        );
    }

    public async VirtualGamepadButton(isDown: boolean, index: number) {
        const is_slider = index == 6 || index == 7;
        await this.SendRawHID(
            new HIDMsg(
                is_slider ? EventCode.gs : EventCode.gb,
                is_slider
                    ? {
                        index: index,
                        val: !isDown ? 0 : 1
                    }
                    : {
                        index: index,
                        val: !isDown ? 0 : 1
                    }
            )
        );
    }

    public async VirtualGamepadAxis(x: number, y: number, type: AxisType) {
        let axisx, axisy: number;
        switch (type) {
            case 'left':
                axisx = 0;
                axisy = 1;
                break;
            case 'right':
                axisx = 2;
                axisy = 3;
                break;
        }

        await this.SendRawHID(
            new HIDMsg(EventCode.ga, {
                index: axisx,
                val: x
            }),
            new HIDMsg(EventCode.ga, {
                index: axisy,
                val: y
            })
        );
    }

    public async VirtualKeyboard(
        ...keys: { code: EventCode; jsKey: string }[]
    ) {
        for (let index = 0; index < keys.length; index++) {
            let { jsKey, code } = keys[index];
            const key = convertJSKey(jsKey, 0);
            if (key == undefined) return;
            if (this?.hid?.scancode) code += 2;
            await this.SendRawHID(new HIDMsg(code, { key }));
        }
    }

    private send = async (...val: HIDMsg[]) => await this.SendRawHID(...val);

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
        await this.video.play();
    };

    private dataEstablishmentLoop = async () => {
        if (this.closed) return;

        this.dataConn = new DataRTC(this.dataUrl, () =>
            setTimeout(this.dataEstablishmentLoop.bind(this), 1000)
        );
    };

    public async MouseButtonDown(event: { button: number }) {
        const code = EventCode.md;
        await this.SendRawHID(
            new HIDMsg(code, {
                button: event.button
            })
        );
    }
    public async MouseButtonUp(event: { button: number }) {
        await this.SendRawHID(
            new HIDMsg(EventCode.mu, {
                button: event.button
            })
        );
    }
    public async MouseWheel(event: { deltaY: number }) {
        await this.SendRawHID(
            new HIDMsg(EventCode.mw, {
                deltaY: -Math.round(event.deltaY)
            })
        );
    }
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
