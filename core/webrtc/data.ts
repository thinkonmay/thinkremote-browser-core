import { EventCode } from '..';

export class DataRTC {
    public connected: boolean;
    public closed: boolean;
    public index: number = 0;

    private closeHandler: () => void;
    private ws: WebSocket;

    constructor(
        url: string,
        closeHandler: () => void,
        messageHandler: (data: Blob) => void
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

    public Close(ev?: Event) {
        this.closed = true;

        const close = this.closeHandler;
        this.closeHandler = () => {};
        close();
    }

    public Send(type: EventCode, ...arr: number[]) {
        if (this.closed) return;

        this.ws.send(new Uint32Array([this.index, type, ...arr]).buffer);
        this.index++;
    }
    public SendClipboard(val: string) {
        if (this.closed) return;

        const buff = new TextEncoder().encode(btoa(val));
        const first = new Uint8Array([
            this.index,
            0,
            0,
            0,
            EventCode.cs,
            0,
            0,
            0
        ]);
        this.ws.send(this.concatTypedArrays(first, buff).buffer);
        this.index++;
    }

    private concatTypedArrays(a: Uint8Array, b: Uint8Array): Uint8Array {
        var c = new Uint8Array(a.length + b.length);
        c.set(a, 0);
        c.set(b, a.length);
        return c;
    }
}
