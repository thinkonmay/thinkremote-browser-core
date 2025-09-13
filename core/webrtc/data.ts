import { EventCode } from '..';

export class DataRTC {
    private closed: boolean;
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

    private internalSend = async (buff: ArrayBuffer, skip: boolean) => {
        if (!skip)
            while (new Date().getTime() - this.lastSent < 5)
                await new Promise((r) => setTimeout(r, 1));

        this.ws?.send(buff);
        this.lastSent = new Date().getTime();
    };

    public Send(type: EventCode, ...arr: number[]) {
        if (this.closed) return;
        const data = new Uint32Array([type, ...arr]).buffer;
        return this.internalSend(
            data,
            [EventCode.ga, EventCode.gs].includes(type)
        );
    }
    public SendClipboard(val: string) {
        if (this.closed) return;
        const first = new Uint8Array([EventCode.cs, 0, 0, 0]);
        const data = this.concatTypedArrays(
            first,
            new TextEncoder().encode(val)
        );

        return this.internalSend(data, false);
    }

    private concatTypedArrays(a: Uint8Array, b: Uint8Array): ArrayBuffer {
        var c = new Uint8Array(a.length + b.length);
        c.set(a, 0);
        c.set(b, a.length);
        return c.buffer;
    }
}
