import { DataChannel } from "./datachannel/datachannel";
import { HID } from "./hid/hid"
import { ConnectionEvent, Log, LogConnectionEvent, LogLevel } from "./utils/log";
import { WebRTC } from "./webrtc/webrtc";
import { Pipeline } from "./pipeline/pipeline";
import { getPlatform } from "./utils/platform";
import { AudioMetrics, NetworkMetrics, VideoMetrics } from "./qos/models";
import { SignalingConfig } from "./signaling/config";

type ChannelName = 'hid' | 'adaptive' | 'manual'

export class RemoteDesktopClient  {
    private readonly platform : 'desktop' | 'mobile'

    public  hid                 : HID 
    private video               : HTMLVideoElement
    private audio               : HTMLAudioElement
    private pipelines           : Map<string,Pipeline>
    private datachannels        : Map<ChannelName,DataChannel>;

    private dataConn   : WebRTC
    private videoConn  : WebRTC
    private audioConn  : WebRTC

    constructor(signalingConfig : SignalingConfig,
                webrtcConfig    : RTCConfiguration,
                vid : HTMLVideoElement,
                audio: HTMLAudioElement,
                platform?: 'mobile' | 'desktop') {

        this.video = vid;
        this.audio = audio;
        this.pipelines = new Map<string,Pipeline>();
        this.platform = platform != null ? platform : getPlatform()
        
        this.hid = null;
        this.datachannels = new Map<ChannelName,DataChannel>();
        this.datachannels.set('manual',   new DataChannel())
        this.datachannels.set('adaptive', new DataChannel())
        this.datachannels.set('hid',      new DataChannel(async (data : string) => {
            this.hid.handleIncomingData(data);
        }))

        this.hid = new HID( this.platform, this.video, (data: string) => {
            this.datachannels.get("hid")?.sendMessage(data);
        });

        const audioEstablishmentLoop = () => {
            this.audioConn       = null
            this.audioConn       = new WebRTC(signalingConfig.audioURL,webrtcConfig,
                                    this.handleIncomingTrack.bind(this),
                                    this.handleIncomingDataChannel.bind(this),
                                    audioEstablishmentLoop,{
                                        audioMetricCallback:    this.handleAudioMetric.bind(this),
                                        videoMetricCallback:    async () => {},
                                        networkMetricCallback:  async () => {}
                                    });
        }

        const videoEstablishmentLoop = () => {
            this.videoConn       = null
            this.videoConn       = new WebRTC(signalingConfig.videoURL,webrtcConfig,
                                    this.handleIncomingTrack.bind(this),
                                    this.handleIncomingDataChannel.bind(this),
                                    videoEstablishmentLoop, {
                                        audioMetricCallback:    async () => {},
                                        videoMetricCallback:    this.handleVideoMetric.bind(this),
                                        networkMetricCallback:  async () => {},
                                    });

        }
        const dataEstablishmentLoop = () => {
            this.dataConn        = null
            this.dataConn        = new WebRTC(signalingConfig.dataURL,webrtcConfig,
                                    this.handleIncomingTrack.bind(this),
                                    this.handleIncomingDataChannel.bind(this), 
                                    dataEstablishmentLoop,{
                                        audioMetricCallback:    async () => {},
                                        videoMetricCallback:    async () => {},
                                        networkMetricCallback:  async () => {}
                                    });
        }

        audioEstablishmentLoop()
        videoEstablishmentLoop()
        dataEstablishmentLoop()
    }

    private async handleIncomingDataChannel(a: RTCDataChannelEvent): Promise<void> {
        LogConnectionEvent(ConnectionEvent.ReceivedDatachannel, a.channel.label)
        Log(LogLevel.Infor,`incoming data channel: ${a.channel.label}`)

        this.datachannels.get( a.channel.label as ChannelName).SetSender(a.channel);
    }

    private async handleIncomingTrack(evt: RTCTrackEvent) : Promise<void>
    {
        Log(LogLevel.Infor,`Incoming ${evt.track.kind} stream`);
        await LogConnectionEvent(evt.track.kind == 'video' 
            ? ConnectionEvent.ReceivedVideoStream 
            : ConnectionEvent.ReceivedAudioStream, 
            JSON.stringify(evt.streams.map(x => 
                x.getTracks().map(x => `${x.label} ${x.id}`
            ))));

        if (evt.track.kind == "video") {
            this.video.srcObject = null
            this.video.srcObject = evt.streams.find(val => val.getVideoTracks().length > 0)
        } else if (evt.track.kind == "audio") {
            this.audio.srcObject = null
            this.audio.srcObject = evt.streams.find(val => val.getAudioTracks().length > 0)
        }

        if (evt.track.kind == "video")  {
            this.ResetVideo() 
            // let pipeline = new Pipeline('h264'); // TODO
            // pipeline.updateSource(evt.streams[0])
            // pipeline.updateTransform(new WebGLTransform());
            // pipeline.updateSink(new VideoSink(this.video.current as HTMLVideoElement))
            // this.pipelines.set(evt.track.id,pipeline);
        }

        // user must interact with the document first, by then, video can start to play. so we wait for use to interact
        if (evt.track.kind == "audio") 
            await this.audio.play()
        else if (evt.track.kind == "video") 
            await this.video.play()

    }

    private async handleAudioMetric(a: AudioMetrics): Promise<void> {
        while (this.datachannels.get('adaptive') == undefined) { // don't discard packet if channel is not established yet
		    await new Promise(r => setTimeout(r, 300));
        }

        this.datachannels.get('adaptive').sendMessage(JSON.stringify(a));
        Log(LogLevel.Debug,`sending ${a.type} metric`)
    }
    private async handleVideoMetric(a: VideoMetrics): Promise<void> {
        while (this.datachannels.get('adaptive') == undefined) {
		    await new Promise(r => setTimeout(r, 300));
        }

        this.datachannels.get('adaptive').sendMessage(JSON.stringify(a));
        Log(LogLevel.Debug,`sending ${a.type} metric`)
    }
    private async handleNetworkMetric(a: NetworkMetrics): Promise<void> {
        while (this.datachannels.get('adaptive') == undefined) {
		    await new Promise(r => setTimeout(r, 300));
        }
        
        this.datachannels.get('adaptive').sendMessage(JSON.stringify(a));
        Log(LogLevel.Debug,`sending ${a.type} metric`)
    }




    public async ChangeFramerate (framerate : number) {
        while (this.datachannels.get('manual') == undefined) { // don't discard packet
		    await new Promise(r => setTimeout(r, 300));
        }

        this.datachannels.get('manual').sendMessage(JSON.stringify({
            type: "framerate",
            value: framerate
        }))

        Log(LogLevel.Debug,`changing framerate to ${framerate}`)
    }
    public async ChangeBitrate (bitrate: number) {
        while (this.datachannels.get('manual') == undefined) { // don't discard packet
		    await new Promise(r => setTimeout(r, 300));
        }

        this.datachannels.get('manual').sendMessage(JSON.stringify({
            type: "bitrate",
            value: bitrate
        }))

        Log(LogLevel.Debug,`changing bitrate to ${bitrate}`)
    }

    public async ResetVideo () {
        while (this.datachannels.get('manual') == undefined) { // don't discard packet
		    await new Promise(r => setTimeout(r, 300));
        }

        this.datachannels.get('manual').sendMessage(JSON.stringify({
            type: "reset",
        }))

        Log(LogLevel.Debug,`gen I frame`)
    }

    public async ResetAudio () {
        while (this.datachannels.get('manual') == undefined) { // don't discard packet
		    await new Promise(r => setTimeout(r, 300));
        }

        this.datachannels.get('manual').sendMessage(JSON.stringify({
            type: "audio-reset",
        }))

        Log(LogLevel.Debug,`reset audio pipeline`)
    }
}