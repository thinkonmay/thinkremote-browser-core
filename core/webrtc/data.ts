import { EventCode } from '..';

export class DataRTC {
    public connected: boolean;
    public closed: boolean;

    private closeHandler: () => void;
    private ws: WebSocket;
    private recv: string[];

    constructor(url: string, CloseHandler: () => void) {
        this.closed = false;
        this.connected = false;
        this.closeHandler = CloseHandler;
        this.recv = [];

        try {
            this.ws = new WebSocket(url);
        } catch {}
        this.ws.onopen = () => {
            this.ws.onerror = this.Close.bind(this);
            this.ws.onclose = this.Close.bind(this);
            this.ws.onmessage = this.onMessage.bind(this);
        };
    }

    private onMessage(data: MessageEvent) {
        this.recv.push(data.data);
    }

    public Close() {
        this.connected = false;
        this.closed = true;

        const close = this.closeHandler;
        this.closeHandler = () => {};
        close();
    }

    public Send(type: EventCode, ...arr: number[]) {
        this.ws?.send(new Uint32Array([type, ...arr]).buffer);
    }

    public async Recv(): Promise<string | Error> {
        while (this.recv.length == 0) {
            if (this.closed) {
                return new Error('closed');
            }

            await new Promise((r) => setTimeout(r, 10));
        }

        return this.recv.pop() ?? '';
    }
}
