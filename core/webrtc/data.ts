import { EventCode } from '..';
import { HIDMsg } from '../models/keys.model';

export class DataRTC {
    public connected: boolean;
    public closed: boolean;
    public authFailure: boolean;

    private ws: WebSocket;
    private Conn: RTCPeerConnection;
    private dc?: RTCDataChannel;
    private host: string;
    private pending_ices: RTCIceCandidateInit[];
    private has_rsdp: boolean;

    private closeHandler: () => void;
    private sendHandler: (data: { event: string; data: any }) => void;
    private recvHandler: (data: ArrayBuffer) => Promise<void>;

    constructor(
        url: string,
        CloseHandler: () => void,
        msgHandler: (data: ArrayBuffer) => Promise<void>
    ) {
        this.closed = false;
        this.connected = false;
        this.authFailure = false;
        this.pending_ices = [];
        this.has_rsdp = false;
        this.closeHandler = CloseHandler;
        this.sendHandler = () => {};
        this.recvHandler = msgHandler;

        this.host = new URL(url).hostname;
        const ws = new WebSocket(url);
        ws.onopen = () => {
            this.ws = ws;
            this.ws.onerror = this.Close.bind(this);
            this.ws.onclose = this.Close.bind(this);
            this.sendHandler = (data) =>
                this.ws.send(
                    new Blob([JSON.stringify(data)], { type: 'text/plain' })
                );
            this.ws.onmessage = (ev) =>
                this.handleIncomingPacket.bind(this)(ev).catch(console.log);
        };
    }

    public Close() {
        this.sendHandler = () => {};
        this.ws?.close();
        this.ws = undefined;
        this.connected = false;
        this.closed = true;
        this.Conn?.close();
        const close = this.closeHandler;
        this.closeHandler = () => {};
        close();
    }

    private async handleIncomingPacket(ev: MessageEvent) {
        const result = JSON.parse(await (ev.data as Blob).text()) as
            | {
                  type: 'application error';
                  code: number;
                  message: string;
                  event: undefined;
                  data: undefined;
              }
            | {
                  type: undefined;
                  code: undefined;
                  event: string;
                  data: any;
              };

        if (result.type == 'application error') {
            this.authFailure = true;
        } else {
            const { event, data } = result;
            switch (event) {
                case 'sdp':
                    this.has_rsdp = true;
                    await this.onIncomingSDP(data);
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
        }
    }

    private async AddLocalDataChannel(): Promise<
        RTCSessionDescriptionInit | undefined
    > {
        const dc = this.Conn.createDataChannel('data', {});
        dc.onopen = () => {
            this.dc = dc;
            dc.onmessage = (ev: MessageEvent) => this.recvHandler(ev.data);
        };
        const offer = await this.Conn.createOffer();
        await this.Conn.setLocalDescription(offer);
        if (!this.Conn.localDescription) return;
        return this.Conn.localDescription?.toJSON();
    }

    private async setupConnection(config: RTCConfiguration) {
        this.Conn = new RTCPeerConnection({
            ...config,
            iceTransportPolicy: 'all'
        } as any);

        const offer = await this.AddLocalDataChannel();
        this.sendHandler({
            event: 'sdp',
            data: offer
        });

        this.Conn.onicecandidate = this.onICECandidates.bind(this);
        this.Conn.onconnectionstatechange =
            this.onConnectionStateChange.bind(this);
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

    private async onIncomingICE(ice: RTCIceCandidateInit) {
        const candidate = new RTCIceCandidate(ice);
        await this.Conn.addIceCandidate(candidate);
    }

    private async onIncomingSDP(sdp: RTCSessionDescriptionInit): Promise<void> {
        if (sdp.type != 'answer') return;
        await this.Conn.setRemoteDescription(sdp);
    }

    private onICECandidates(event: RTCPeerConnectionIceEvent) {
        if (event.candidate == null) return;
        this.sendHandler({
            event: 'ice',
            data: event.candidate.toJSON()
        });
    }

    private internalSend = async (buff: ArrayBuffer) => {
        this.dc?.send(buff);
    };

    public Send(...msgs: HIDMsg[]) {
        if (this.closed) return;
        const buff = [];
        for (const msg of msgs) buff.push(msg.convertType(), ...msg.buffer());
        return this.internalSend(new Uint32Array(buff).buffer);
    }
    public SendClipboard(val: string) {
        if (this.closed) return;
        const data = this.concatTypedArrays(
            new Uint8Array([EventCode.cs, 0, 0, 0]),
            new TextEncoder().encode(val)
        );

        return this.internalSend(data);
    }

    private concatTypedArrays(a: Uint8Array, b: Uint8Array): ArrayBuffer {
        var c = new Uint8Array(a.length + b.length);
        c.set(a, 0);
        c.set(b, a.length);
        return c.buffer;
    }
}
