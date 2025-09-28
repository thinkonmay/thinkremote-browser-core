export class MicrophoneRTC {
    public connected: boolean;
    public closed: boolean;
    public authFailure: boolean;

    private ws: WebSocket;
    private Conn: RTCPeerConnection;
    private host: string;
    private pending_ices: RTCIceCandidateInit[];
    private has_rsdp: boolean;

    private closeHandler: () => void;
    private sendHandler: (data: { event: string; data: any }) => void;

    constructor(url: string, CloseHandler: () => void) {
        this.closed = false;
        this.connected = false;
        this.authFailure = false;
        this.pending_ices = [];
        this.has_rsdp = false;
        this.closeHandler = CloseHandler;
        this.sendHandler = () => {};

        this.host = new URL(url).hostname;
        this.connect(url).catch(this.Close);
    }

    private async connect(url: string) {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
            if (ws.readyState != ws.OPEN) {
                ws.close();
                this.Close();
            }
        }, 3000);
        ws.onopen = () => {
            clearTimeout(timeout);
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

    private async AddLocalTrack(): Promise<
        RTCSessionDescriptionInit | undefined
    > {
        // Handles being called several times to update labels. Preserve values.
        let stream: MediaStream | null = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: true
            });
        } catch {
            return;
        }

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length == 0) return;

        const [track] = audioTracks;
        const tracks = stream.getTracks();
        for (const track of tracks) this.Conn.addTrack(track, stream);

        const transceiver = this.Conn.getTransceivers().find(
            (t) => t?.sender?.track === track
        );

        if (transceiver == undefined) return;

        const codec = {
            clockRate: 48000,
            channels: 2,
            mimeType: 'audio/opus'
        };

        const { codecs } = RTCRtpSender.getCapabilities('audio') ?? {
            codecs: []
        };
        const selected = codecs.find((x) => x.mimeType == codec.mimeType);
        if (selected == undefined) return;
        transceiver.setCodecPreferences([selected]);

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

        const offer = await this.AddLocalTrack();
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
}
