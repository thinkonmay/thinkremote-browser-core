import { HID } from './hid/hid';
import { TouchHandler } from './hid/touch';
import { EventCode, HIDMsg } from './models/keys.model';
import { Metric, initialMetric } from './models/metrics.model';
import { AudioWrapper } from './sink/audio/wrapper';
import { VideoWrapper } from './sink/video/wrapper';
import { convertJSKey, useShift } from './utils/convert';
import { getBrowser, getOS, isMobile } from './utils/platform';
import { DataRTC } from './webrtc/data';
import { MediaRTC, MessageType, RTCMetric } from './webrtc/media';
import { MicrophoneRTC } from './webrtc/microphone';

const ssgid = 0;

class Thinkmay {
    public Metrics: Metric;
    public static NowInSec = () => new Date().getTime() / 1000;
    public static SinceSec = (time: number) => this.NowInSec() - time;

    private touch: TouchHandler;
    private hid: HID;
    private video: VideoWrapper;
    private audio: AudioWrapper;
    private hidUrl: string;
    private micUrl: string;

    private logConn?: WebSocket;
    private vmLogCb: LogCb[];
    private videoConn: MediaRTC;
    private audioConn: MediaRTC;
    private microConn: MicrophoneRTC;
    private dataConn: DataRTC;
    private closed: boolean;
    private gid = ssgid;

    constructor(
        vid: VideoWrapper,
        audio: AudioWrapper,
        hidUrl: string,
        micUrl?: string,
        logUrl?: string
    ) {
        this.closed = false;
        this.vmLogCb = [];
        this.video = vid;
        this.audio = audio;
        this.hidUrl = hidUrl;
        this.micUrl = micUrl;
        this.Metrics = structuredClone(initialMetric);

        this.hid = new HID(this.SendRawHID.bind(this), vid.internal(), this.gid);
        this.touch = new TouchHandler(vid.internal(), this.SendRawHID.bind(this));

        this.audioEstablishmentLoop();
        this.videoEstablishmentLoop();
        this.dataEstablishmentLoop();
        if (this.micUrl) this.microphoneEstablishmentLoop();
        if (logUrl) this.handleLog(logUrl);
    }

    private missing_frame: any;
    private countThread: any;
    private waitForNewFrame() {
        if (this.missing_frame != undefined) clearTimeout(this.missing_frame);
        this.missing_frame = setTimeout(this.ResetVideo.bind(this), 1000);
    }

    private handleLog(url: string) {
        this.logConn = new WebSocket(url);
        this.logConn.onopen = () => {
            this.logConn.onmessage = async (ev) => {
                const txt = await ev.data.text();
                this.vmLogCb.forEach((fun) => fun(txt));
            };
        };
    }
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

        await this.audio.assign(stream);
        await this.audio.play();
    }

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

        const start = Thinkmay.NowInSec();
        this.Metrics.audio = structuredClone(initialMetric.audio);
        this.Metrics.audio.status = 'connecting';
        while (!this.audioConn.connected) {
            if (Thinkmay.SinceSec(start) > 30) return this.audioConn.Close();
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

        let start = Thinkmay.NowInSec();
        while (!this.videoConn.connected) {
            if (Thinkmay.SinceSec(start) > 30) return this.videoConn.Close();
            else if (this.videoConn.closed) return;
            else await new Promise((r) => setTimeout(r, 100));
        }

        start = Thinkmay.NowInSec();
        await this.ResetVideo();
        while (this.Metrics.video.frame.totalframes == 0) {
            if (Thinkmay.SinceSec(start) > 5) return this.videoConn.Close();
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
            this.hidUrl,
            () => setTimeout(this.dataEstablishmentLoop.bind(this), 1000),
            this.hid.handleIncomingData.bind(this.hid)
        );
    };

    public Ready = () => this.Metrics.video.status == 'connected';
    public AuthFailed = () =>
        this.videoConn.authFailure || this.audioConn.authFailure;
    public Size = () =>
        this.video.internal().videoHeight * this.video.internal().videoWidth;

    public SetClipboard = (val: string) => this.dataConn?.SendClipboard(val);

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
    public ResetKeyStuck = () => this.hid.ResetKeyStuck();
    public SetScancode = (val: boolean) => (this.hid.scancode = val);
    public GetScancode = () => this.hid.scancode;

    public async ChangeFramerate(framerate: number) {
        if (this.closed) return;
        else if (!this.videoConn.connected)
            setTimeout(() => this.ChangeFramerate(framerate), 1000);
        this.videoConn.Send(MessageType.Framerate, framerate);
    }
    public async ChangeBitrate(bitrate: number) {
        if (this.closed) return;
        else if (!this.videoConn.connected)
            setTimeout(() => this.ChangeBitrate(bitrate), 1000);
        this.videoConn.Send(MessageType.Bitrate, Math.round(bitrate / 1000));
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

    public AddLogCb = (cb: LogCb) => this.vmLogCb.push(cb);

    SendRawHID(...data: HIDMsg[]) {
        if (this.closed) return;
        const first = data.shift();
        data.forEach((follow, index) =>
            setTimeout(
                () =>
                    this.dataConn?.Send(
                        follow.convertType(),
                        ...follow.buffer()
                    ),
                (index + 1) * 5
            )
        );

        return this.dataConn?.Send(first.convertType(), ...first.buffer());
    }

    public Close() {
        this.closed = true;
        this.logConn?.close();
        clearTimeout(this.missing_frame);
        clearInterval(this.countThread);
        this.hid?.Close();
        this.touch?.Close();
        this.videoConn?.Close();
        this.audioConn?.Close();
        this.video.internal().srcObject = null;
        this.audio.internal().srcObject = null;
    }
}

export type LogCb = (log: string) => void;

export {
    AudioWrapper,
    EventCode,
    Thinkmay,
    VideoWrapper,
    getBrowser,
    getOS,
    isMobile,
    useShift
};
