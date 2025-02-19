import { EventCode } from '..';

export class DataRTC {
    public connected: boolean;
    public closed: boolean;

    private closeHandler: () => void;
    private ws: WebSocket;
    private send: Uint32Array[];

    constructor(url: string, 
        closeHandler: () => void, 
        messageHandler: (data: any) => void
    ) {
        this.closed = false;
        this.closeHandler = closeHandler;
        this.send = [];

        try {
            this.ws = new WebSocket(url);
        } catch {}
        this.ws.onopen = async () => {
            this.ws.onerror = this.Close.bind(this);
            this.ws.onclose = this.Close.bind(this);
            this.ws.onmessage = e => messageHandler(e.data)
            while(!this.closed) {
                while (this.send.length == 0) 
                    await new Promise(r => setTimeout(r,10))

                this.ws.send(this.send.pop().buffer)
            }
        };
    }

    public Close() {
        this.closed = true;

        const close = this.closeHandler;
        this.closeHandler = () => {};
        close();
    }

    public Send(type: EventCode, ...arr: number[]) {
        this.send.push(new Uint32Array([type, ...arr]))
    }
}
