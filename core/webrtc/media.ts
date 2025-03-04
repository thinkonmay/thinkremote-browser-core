import { Log, LogLevel } from '../utils/log';
import { getBrowser } from '../utils/platform';

export enum MessageType {
    Pointer,
    Bitrate,
    Framerate,
    Idr,
    Hdr,
    Stop,
    EventMax
}

export type RTCMetric =
    | {
          codecId: string;
          mediaType: string;
          id: string;
          remoteId: string;
          kind: 'video';
          mid: string;
          trackIdentifier: string;
          transportId: string;
          type: string;

          bytesReceived: number;
          firCount: number;
          frameHeight: number;
          frameWidth: number;
          framesAssembledFromMultiplePackets: number;
          framesDecoded: number;
          framesDropped: number;
          framesPerSecond: number;
          framesReceived: number;
          freezeCount: number;
          headerBytesReceived: number;
          jitter: number;
          jitterBufferDelay: number;
          jitterBufferEmittedCount: number;
          jitterBufferMinimumDelay: number;
          jitterBufferTargetDelay: number;
          keyFramesDecoded: number;
          lastPacketReceivedTimestamp: number;
          nackCount: number;
          packetsLost: number;
          packetsReceived: number;
          pauseCount: number;
          pliCount: number;
          ssrc: number;
          timestamp: number;
          totalAssemblyTime: number;
          totalDecodeTime: number;
          totalFreezesDuration: number;
          totalInterFrameDelay: number;
          totalPausesDuration: number;
          totalProcessingDelay: number;
          totalSquaredInterFrameDelay: number;
      }
    | {
          kind: 'audio';

          totalSamplesReceived: number;
      };

export class MediaRTC {
    public connected: boolean;
    public closed: boolean;

    private ws: WebSocket;
    private Conn: RTCPeerConnection;
    private watch_loop?: any;
    private host: string;
    private pending_ices: RTCIceCandidateInit[];
    private has_rsdp: boolean;

    private rtrackHandler: (a: RTCTrackEvent) => any;
    private metricHandler: (val: RTCMetric) => void;
    private closeHandler: () => void;
    private sendHandler: (data: { event: string; data: any }) => void;

    constructor(
        url: string,
        TrackHandler: (a: RTCTrackEvent) => Promise<void>,
        MetricsHandler: (val: RTCMetric) => void,
        CloseHandler: () => void
    ) {
        this.closed = false;
        this.connected = false;
        this.pending_ices = [];
        this.has_rsdp = false;
        this.metricHandler = MetricsHandler;
        this.closeHandler = CloseHandler;
        this.rtrackHandler = TrackHandler;
        this.sendHandler = () => {};

        this.host = new URL(url).hostname;
        try {
            this.ws = new WebSocket(url);
        } catch (err) {
            this.Close();
        }
        this.ws.onerror = this.Close.bind(this);
        this.ws.onclose = this.Close.bind(this);
        this.ws.onopen = () => {
            this.sendHandler = (data) => this.ws.send(JSON.stringify(data));
            this.ws.onmessage = (ev) =>
                this.handleIncomingPacket
                    .bind(this)(ev)
                    .catch(() => {});
        };
    }

    public Send(type: MessageType, ...arr: number[]) {
        this.ws?.send(new Uint8Array([type, ...arr]).buffer);
    }

    public Close() {
        this.metricHandler = () => {};
        this.rtrackHandler = () => {};
        this.ws?.close();
        this.ws = undefined;
        this.connected = false;
        this.closed = true;
        this.Conn?.close();
        if (this.watch_loop != undefined) clearInterval(this.watch_loop);
        const close = this.closeHandler;
        this.closeHandler = () => {};
        close();
    }

    private async handleIncomingPacket(ev: MessageEvent) {
        const txt = await (ev.data as Blob).text()
        const { event, data } = JSON.parse(txt) as {
            event: string;
            data: any;
        };

        try {
            switch (event) {
                case 'sdp':
                    const ans = await this.onIncomingSDP(data);
                    this.sendHandler({ event: 'sdp', data: ans });
                    this.has_rsdp = true;
                    this.pending_ices.forEach((x) => this.onIncomingICE(x));
                    break;
                case 'ice':
                    if (!this.has_rsdp) this.pending_ices.push(data);
                    else await this.onIncomingICE(data);
                    break;
                case 'open':
                    const { username, password } = data;
                    await this.setupConnection({
                        iceServers: [
                            {
                                urls: [`turn:${this.host}:3478`],
                                credential: password,
                                username
                            },
                            {
                                urls: [`stun:${this.host}:3478`]
                            }
                        ]
                    });
                    break;
                case 'close':
                    this.Close();
                    break;
                default:
                    break;
            }
        } catch (err) {
            Log(LogLevel.Error, err);
        }
    }

    private async setupConnection(config: RTCConfiguration) {
        this.Conn = new RTCPeerConnection({
            ...config,
            // bundlePolicy: 'max-bundle',
            iceTransportPolicy: 'all',
            // rtcpMuxPolicy: 'negotiate',
            encodedInsertableStreams: getBrowser() != 'Safari'
        } as any);

        this.Conn.ontrack = this.rtrackHandler;
        this.Conn.onicecandidate = this.onICECandidates.bind(this);
        this.Conn.onconnectionstatechange =
            this.onConnectionStateChange.bind(this);
        this.watch_loop = setInterval(
            () =>
                this.Conn?.getStats().then((stats) =>
                    stats.forEach((val) =>
                        val.type == 'inbound-rtp'
                            ? this.metricHandler(val)
                            : () => {}
                    )
                ),
            2000
        );
    }

    private onConnectionStateChange(eve: Event) {
        switch (
            (eve.target as RTCPeerConnection)
                .connectionState as RTCPeerConnectionState
        ) {
            case 'connected':
                this.connected = true;
                break;
            case 'new':
            case 'connecting':
                break;
            case 'closed':
            case 'failed':
            case 'disconnected':
                this.Close();
                break;
            default:
                break;
        }
    }

    public async onIncomingICE(ice: RTCIceCandidateInit) {
        const candidate = new RTCIceCandidate(ice);
        await this.Conn.addIceCandidate(candidate);
    }

    public async onIncomingSDP(
        sdp: RTCSessionDescriptionInit
    ): Promise<RTCSessionDescriptionInit> {
        if (sdp.type != 'offer') return;
        await this.Conn.setRemoteDescription(sdp);
        const ans = await this.Conn.createAnswer();
        await this.Conn.setLocalDescription(ans);
        if (!this.Conn.localDescription) return;
        const init = this.Conn.localDescription;
        return init.toJSON();
    }

    private onICECandidates(event: RTCPeerConnectionIceEvent) {
        if (event.candidate == null) return;
        this.sendHandler({
            event: 'ice',
            data: event.candidate.toJSON()
        });
    }
}
