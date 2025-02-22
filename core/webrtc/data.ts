import { EventCode } from '..';

export class DataRTC {
    public connected: boolean;
    public closed: boolean;

    private closeHandler: () => void;
    private ws: WebSocket;

    constructor(
        url: string,
        closeHandler: () => void,
        messageHandler: (data: any) => void
    ) {
        this.closed = false;
        this.closeHandler = closeHandler;

        try {
            this.ws = new WebSocket(url);
        } catch {}
        this.ws.onopen = async () => {
            this.ws.onerror = this.Close.bind(this);
            this.ws.onclose = this.Close.bind(this);
            this.ws.onmessage = (e) => messageHandler(e.data);
        };
    }

    public Close() {
        this.closed = true;

        const close = this.closeHandler;
        this.closeHandler = () => {};
        close();
    }

    public Send(type: EventCode, ...arr: number[]) {
        if (this.closed) return;

        this.ws.send(new Uint32Array([type, ...arr]).buffer);
    }
    public SendClipboard(val: string) {
        if (this.closed) return;

        const buff = new TextEncoder().encode(btoa(val));
        const first = new Uint8Array([EventCode.cs, 0, 0, 0]);
        this.ws.send(this.concatTypedArrays(first, buff).buffer);
    }

    private concatTypedArrays(a: Uint8Array, b: Uint8Array): Uint8Array {
        // a, b TypedArray of same type
        var c = new Uint8Array(a.length + b.length);
        c.set(a, 0);
        c.set(b, a.length);
        return c;
    }
}
