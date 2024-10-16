import { Body, getClient, ResponseType } from '@tauri-apps/api/http';
import { v4 as uuidv4 } from 'uuid';
import { Log, LogLevel } from '../utils/log';
import { SignalingMessage } from './msg';

export class SignalingClientTR {
    private run: boolean;
    private url: string;

    private outcoming: SignalingMessage[] = [];
    private last_msg: SignalingMessage[] = [];

    constructor(
        url: string,
        PacketHandler: (Data: SignalingMessage) => Promise<void>
    ) {
        const u = new URL(url);
        u.searchParams.append('uniqueid', uuidv4());

        this.url = u.toString();
        this.run = true;

        (async () => {
            const client = await getClient();
            while (
                this.run ||
                this.outcoming.length > 0 ||
                this.last_msg.length > 0
            ) {
                await new Promise((r) => setTimeout(r, 1000));
                const copy = this.outcoming;
                this.outcoming = [];

                try {
                    const { ok, data } = await client.post<SignalingMessage[]>(
                        this.url,
                        Body.json(copy),
                        {
                            responseType: ResponseType.JSON
                        }
                    );
                    if (!ok) {
                        Log(LogLevel.Error, JSON.stringify(data));
                        continue;
                    }

                    this.last_msg = data;
                    for (let index = 0; index < data.length; index++)
                        await PacketHandler(data[index]);
                } catch {}
            }
        })();
    }

    public Close() {
        this.run = false;
    }

    /**
     * send messsage to signalling server
     */
    public SignallingSend(msg: SignalingMessage) {
        this.outcoming.push(msg);
    }
}
