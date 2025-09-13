import { EventCode } from '..';

export class DataRTC {
    private closed: boolean;
    private index: number = 0;
    private closeHandler: () => void;
    private ws: WebSocket;
    private lastSent: number;

    constructor(
        url: string,
        closeHandler: () => void,
        messageHandler: (data: Blob) => void
    ) {
        this.closed = false;
        this.closeHandler = closeHandler;

        const ws = new WebSocket(url);
        ws.onopen = () => {
            this.ws = ws;
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

    private internalSend = async (buff: ArrayBuffer) => {
        while (new Date().getTime() - this.lastSent < 5)
            await new Promise((r) => setTimeout(r, 1));

        this.ws?.send(buff);
        this.lastSent = new Date().getTime();
        this.index++;
    };

    public Send(type: EventCode, ...arr: number[]) {
        if (this.closed) return;
        const data = new Uint32Array([this.index, type, ...arr]).buffer;
        return this.internalSend(data);
    }
    public SendClipboard(val: string) {
        if (this.closed) return;
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
        const data = this.concatTypedArrays(
            first,
            new TextEncoder().encode(btoa(val))
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
