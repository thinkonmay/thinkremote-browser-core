import { DataChannel } from './datachannel/datachannel';
import { HID } from './hid/hid';
import { TouchHandler } from './hid/touch';
import { AxisType } from './models/hid.model';
import { EventCode, HIDMsg } from './models/keys.model';
import { AudioWrapper } from './pipeline/sink/audio/wrapper';
import { VideoWrapper } from './pipeline/sink/video/wrapper';
import { SignalingConfig } from './signaling/config';
import { convertJSKey, useShift } from './utils/convert';
import { AddNotifier, ConnectionEvent, Log, LogLevel } from './utils/log';
import { getBrowser, isMobile } from './utils/platform';
import { RTCMetric, WebRTC } from './webrtc/webrtc';

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
    audio: {
        status: 'close' | 'connecting' | 'connected';

        sample: {
            received: number;
        };
    };
};
const initialMetric: Metric = {
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

type channelName = 'hid' | 'manual';
class RemoteDesktopClient {
    public hid: HID;
    public touch: TouchHandler;
    public video: VideoWrapper;
    public audio: AudioWrapper;
    public Metrics: Metric;

    private static Now = () => new Date().getTime();
    private missing_frame: any;
    private countThread: any;
    private waitForNewFrame() {
        if (this.missing_frame != undefined) clearTimeout(this.missing_frame);
        this.missing_frame = setTimeout(this.ResetVideo.bind(this), 1000);
    }

    private videoConn: WebRTC;
    private audioConn: WebRTC;
    private datachannels: Map<channelName, DataChannel>;

    public ready(): boolean {
        return this.Metrics.video.status == 'connected';
    }

    private closed: boolean;
    constructor(
        vid: VideoWrapper,
        audio: AudioWrapper,
        signalingConfig: SignalingConfig,
        WebRTCConfig: RTCConfiguration,
        {
            scancode
        }: {
            scancode?: boolean;
        }
    ) {
        this.closed = false;
        this.video = vid;
        this.audio = audio;
        this.Metrics = structuredClone(initialMetric);

        const handleHID = (data: string) =>
            !this.closed ? this.hid?.handleIncomingData(data) : null;
        this.datachannels = new Map<channelName, DataChannel>();
        this.datachannels.set('manual', new DataChannel());
        this.datachannels.set('hid', new DataChannel(handleHID.bind(this)));

        const send = async (...val: HIDMsg[]) => await this.SendRawHID(...val);
        this.hid = new HID(send.bind(this), scancode, vid.video);
        this.touch = new TouchHandler(vid.video, send.bind(this));

        const handle_metrics = (val: RTCMetric) => {
            const now = new Date();
            switch (val.kind) {
                case 'video':
                    this.Metrics.video.frame.persecond = Math.round(
                        (val.framesDecoded -
                            this.Metrics.video.frame.totalframes) /
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
                        (((val.bytesReceived -
                            this.Metrics.video.bitrate.total) /
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
                    this.Metrics.audio.sample.received =
                        val.totalSamplesReceived;
                    break;
                default:
                    break;
            }
        };

        const audioEstablishmentLoop = async () => {
            if (this.closed) return;

            this.audioConn = new WebRTC(
                'audio',
                signalingConfig.audioUrl,
                WebRTCConfig,
                async () => null,
                this.handleIncomingAudio.bind(this),
                this.handleIncomingDataChannel.bind(this),
                handle_metrics.bind(this),
                audioEstablishmentLoop
            );

            const start = RemoteDesktopClient.Now();
            this.Metrics.audio = structuredClone(initialMetric.audio);
            this.Metrics.audio.status = 'connecting';
            while (!this.audioConn.connected) {
                if (RemoteDesktopClient.Now() - start > 30 * 1000)
                    return this.audioConn.Close();
                else if (this.audioConn.closed) return;
                else await new Promise((r) => setTimeout(r, 1000));
            }

            this.Metrics.audio.status = 'connected';
            setTimeout(this.audioConn.DoneHandshake.bind(this.audioConn), 5000);
        };

        const videoEstablishmentLoop = async () => {
            if (this.closed) return;

            this.videoConn = new WebRTC(
                'video',
                signalingConfig.videoUrl,
                WebRTCConfig,
                async () => null,
                this.handleIncomingVideo.bind(this),
                async () => null,
                handle_metrics.bind(this),
                videoEstablishmentLoop
            );

            this.Metrics.video = structuredClone(initialMetric.video);
            this.Metrics.video.status = 'connecting';

            let start = RemoteDesktopClient.Now();
            while (!this.videoConn.connected) {
                if (RemoteDesktopClient.Now() - start > 30 * 1000)
                    return this.videoConn.Close();
                else if (this.videoConn.closed) return;
                else await new Promise((r) => setTimeout(r, 100));
            }

            start = RemoteDesktopClient.Now();
            while (this.Metrics.video.frame.totalframes == 0) {
                if (RemoteDesktopClient.Now() - start > 5 * 1000)
                    return this.videoConn.Close();
                else if (this.videoConn.closed) return;
                await this.ResetVideo();
                await new Promise((r) => setTimeout(r, 300));
            }

            this.Metrics.video.status = 'connected';
            this.videoConn.DoneHandshake();
            await this.video.play();
        };

        Log(LogLevel.Infor, `Started remote desktop connection`);
        audioEstablishmentLoop();
        videoEstablishmentLoop();
    }

    private async handleIncomingDataChannel(
        a: RTCDataChannelEvent
    ): Promise<void> {
        if (this.closed) return;
        this.datachannels
            .get(a.channel.label as channelName)
            .SetSender(a.channel);
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

                this.waitForNewFrame();
            } catch {}
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
            } catch {}
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
        await this.datachannels.get('manual').sendMessage(
            JSON.stringify({
                type: 'framerate',
                value: framerate
            })
        );

        Log(LogLevel.Infor, `changing framerate to ${framerate}`);
    }
    public async ChangeBitrate(bitrate: number) {
        if (this.closed) return;
        await this.datachannels.get('manual').sendMessage(
            JSON.stringify({
                type: 'bitrate',
                value: bitrate
            })
        );

        Log(LogLevel.Infor, `changing bitrate to ${bitrate}`);
    }

    public async PointerVisible(enable: boolean) {
        if (this.closed) return;
        await this.datachannels.get('manual').sendMessage(
            JSON.stringify({
                type: 'pointer',
                value: enable ? 1 : 0
            })
        );
    }

    public async ResetVideo() {
        if (this.closed) return;
        await this.datachannels.get('manual').sendMessage(
            JSON.stringify({
                type: 'reset',
                value: 1
            })
        );

        Log(LogLevel.Debug, `gen I frame`);
    }

    public async HardReset() {
        if (this.closed) return;
        this.videoConn?.Close();
        this.audioConn?.Close();
        this.Metrics.audio.status = 'close';
        this.Metrics.video.status = 'close';
    }

    async SendRawHID(...data: HIDMsg[]) {
        if (this.closed) return;

        const hid = this.datachannels.get('hid');
        for (let index = 0; index < data.length; index++)
            await hid.sendMessage(data[index].ToString());
    }
    public async SetClipboard(val: string) {
        if (this.closed) return;
        await this.SendRawHID(
            new HIDMsg(EventCode.ClipboardSet, {
                val: btoa(val)
            })
        );
    }

    public async VirtualGamepadButton(isDown: boolean, index: number) {
        const is_slider = index == 6 || index == 7;
        await this.SendRawHID(
            new HIDMsg(
                is_slider
                    ? EventCode.GamepadSlide
                    : !isDown
                      ? EventCode.GamepadButtonDown
                      : EventCode.GamepadButtonUp,
                is_slider
                    ? {
                          gamepad_id: 0,
                          index: index,
                          val: !isDown ? 0 : 1
                      }
                    : {
                          gamepad_id: 0,
                          index: index
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
            new HIDMsg(EventCode.GamepadAxis, {
                gamepad_id: 0,
                index: axisx,
                val: x
            }),
            new HIDMsg(EventCode.GamepadAxis, {
                gamepad_id: 0,
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

    public async MouseButtonDown(event: { button: number }) {
        const code = EventCode.MouseDown;
        await this.SendRawHID(
            new HIDMsg(code, {
                button: event.button
            })
        );
    }
    public async MouseButtonUp(event: { button: number }) {
        const code = EventCode.MouseUp;
        await this.SendRawHID(
            new HIDMsg(code, {
                button: event.button
            })
        );
    }
    public async MouseWheel(event: { deltaY: number }) {
        const code = EventCode.MouseWheel;
        await this.SendRawHID(
            new HIDMsg(code, {
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
        this.video.video.srcObject = null;
        this.audio.internal().srcObject = null;
        this.datachannels = new Map<channelName, DataChannel>();
        Log(LogLevel.Infor, `Closed remote desktop connection`);
    }
}

export {
    AddNotifier,
    AudioWrapper,
    ConnectionEvent,
    EventCode,
    isMobile,
    RemoteDesktopClient,
    useShift,
    VideoWrapper
};
