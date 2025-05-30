import { Child, Command } from '@tauri-apps/api/shell';
import { v4 as uuidv4 } from 'uuid';
import {
    CAUSE,
    getFrontendURL,
    GLOBAL,
    POCKETBASE,
    UserEvents,
    UserSession
} from './database';

export function ValidateIPaddress(ipaddress: string) {
    return ipaddress != undefined
        ? /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
              ipaddress
          )
        : false;
}

export class APIError {
    code: number;
    message: string;

    constructor(message?: string, code?: number) {
        this.message = message ?? 'Unknown error';
        this.code = code ?? 500;
    }
}

async function internalFetch<T>(
    address: string,
    command: string,
    body?: any
): Promise<T | APIError> {
    try {
        const token = POCKETBASE().authStore.token;
        const user = POCKETBASE().authStore.model?.id;
        const url = `https://${address}/${command}`;
        let respbody = undefined;

        if (command == 'info') {
            const resp = await fetch(url, {
                method: 'GET',
                headers: { Authorization: token, User: user }
            });
            try {
                respbody = await resp.json();
            } catch {
                return new APIError(await resp.text(), 0);
            }
            if (!resp.ok) {
                return new APIError(
                    respbody.message ?? 'Unknown error',
                    respbody.code ?? 500
                );
            } else return respbody as T;
        } else if (command.includes('log')) {
            const resp = await fetch(url, {
                method: 'GET',
                headers: { Authorization: token, User: user }
            });
            return (await resp.text()) as T;
        } else {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { Authorization: token, User: user },
                body: JSON.stringify(body)
            });

            try {
                respbody = await resp.json();
            } catch {
                return new APIError(await resp.text(), 0);
            }
            if (!resp.ok)
                return new APIError(
                    respbody.message ?? 'Unknown error',
                    respbody.code ?? 500
                );
            else return respbody as T;
        }
    } catch (err) {
        return new APIError('Unable to call request to server', 500);
    }
}

async function GetInfo(ip: string): Promise<Computer | APIError> {
    const result = await internalFetch<Computer>(ip, 'info');
    if (result instanceof APIError)
        return await internalFetch<Computer>(ip, 'info');
    else return result;
}

async function ClaimStorage(ip: string): Promise<string | APIError> {
    const result = await internalFetch<string>(ip, 'addon/storage/claim');
    return result;
}
async function ClaimSteam(ip: string): Promise<string | APIError> {
    const result = await internalFetch<string>(ip, 'addon/steam/claim');
    return result;
}
async function UnclaimStorage(
    ip: string,
    text: string
): Promise<'success' | APIError> {
    const result = await internalFetch<'success'>(ip, 'addon/storage/unclaim');
    return result;
}
async function UnclaimSteam(
    ip: string,
    text: string
): Promise<'success' | APIError> {
    const result = await internalFetch<'success'>(ip, 'addon/steam/unclaim');
    return result;
}

type Volume = {
    backing: 'os' | string;
    node: string;
    size?: number;
    name: string;
    inuse?: boolean;
    pool: 'user_data' | 'app_data' | string;
};

type Computer = {
    Hostname?: string;
    CPU?: string;
    RAM?: string;
    BIOS?: string;
    HideVM?: boolean;
    remoteReady?: boolean;
    virtReady?: boolean;

    Volumes?: Volume[];
    Sessions?: Session[];
    Interfaces?: {
        publicIp?: string;
        privateIp?: string;
        name: string;
    }[];
    GPUs?: {
        Inuse: boolean;
        Tained: boolean;
        Type: string;
        Id: string;
    }[];
};

type ProxyChain = {
    child?: ProxyChain;
    token?: string;
    sendaddress?: string;
    recvaddress: string;
};

type RemoteReqeust = {
    requestedCodec: string;
    requestedProtocol: string;
    displayRequired: boolean;

    audio: ProxyChain;
    video: ProxyChain;
    microphone?: ProxyChain;
    data: ProxyChain;
};

type Steam = {
    appid: string;
    type: 'steam';
    username: string;
    credential: string;
};

type S3Credential = {
    bucket: string;
    accessId: string;
    accessKey: string;
    endpoint: string;
    token: string;
    configured: boolean;
};
type Backup = {};

type Session = {
    id: string;

    sunshine?: {
        username: string;
        password: string;
        port: string;
    };
    app?: Steam;
    s3bucket?: S3Credential;
    thinkmay?: RemoteReqeust;
    backup?: Backup;
    vm?: Computer;
};

type RemoteCredential = {
    audioUrl: string;
    videoUrl: string;
    microUrl?: string;
    dataUrl: string;
};

export async function StartThinkmay(
    address: string,
    vm_request: Computer,
    preferred_codec: 'h264' | 'h265',
    showStatus: (status: string, code?: number) => Promise<void>
): Promise<Computer | APIError> {
    const req = {
        id: uuidv4(),
        vm: vm_request,
        app: {},
        s3bucket: {},
        thinkmay: {
            displayRequired: true,
            requestedCodec: preferred_codec,
            requestedProtocol: 'quic'
        }
    } as Session;

    let running = true;
    type deployment_status = { status: string; code: number };
    if (vm_request != undefined)
        (async (_req: Session) => {
            await new Promise((r) => setTimeout(r, 3000));
            while (running) {
                const request_new = await internalFetch<deployment_status>(
                    address,
                    '_new',
                    _req
                );
                if (!(request_new instanceof APIError)) {
                    showStatus(request_new.status, request_new.code);
                    await new Promise((r) => setTimeout(r, 1000));
                }
            }
        })(req);

    let resp: APIError | Computer = new APIError('unable to request', 500);
    try {
        resp = await internalFetch<Computer>(address, 'new', req);
    } catch (err) {
        running = false;
        return resp;
    }
    running = false;
    return resp;
}

export async function CreateSession(
    address: string,
    session: Session
): Promise<Computer | APIError> {
    return await internalFetch<Computer>(address, `new`, session);
}

export async function ChangeNode(
    address: string,
    node: string,
    id: string
): Promise<'success' | APIError> {
    return await internalFetch<'success'>(address, 'transport', { id, node });
}
export async function ChangeTemplate(
    address: string,
    template: string,
    volume_id: string
): Promise<'success' | APIError> {
    return await internalFetch<'success'>(address, 'reallocate', {
        source: `${template}.template`,
        id: volume_id
    });
}
export function ParseRequest(
    address: string,
    session: Session,
    option?: {
        high_queue?: boolean;
        high_mtu?: boolean;
    }
): RemoteCredential {
    const {
        thinkmay: { audio, video, data, microphone }
    } = session;
    const { high_queue, high_mtu } = option ?? {
        high_mtu: false,
        high_queue: true
    };
    const opt = `&queue_size=${high_queue ? 64 : 16}&mtu=${
        high_mtu ? 1400 : 1200
    }`;
    return {
        videoUrl: `wss://${address}:444/broadcasters/webrtc?token=${video.token}${opt}`,
        audioUrl: `wss://${address}:444/broadcasters/webrtc?token=${audio.token}`,
        microUrl: microphone
            ? `wss://${address}:444/broadcasters/microphone?token=${microphone.token}`
            : undefined,
        dataUrl: `wss://${address}:444/broadcasters/websocket?token=${data.token}`
    };
}

type MoonlightStreamConfig = {
    bitrate?: number;
    width?: number;
    height?: number;
};
export async function StartMoonlight(
    address: string,
    options?: MoonlightStreamConfig,
    callback?: (type: 'stdout' | 'stderr', log: string) => void
): Promise<Child> {
    const PORT = getRandomInt(60000, 65530);
    const sunshine = {
        username: getRandomInt(0, 9999).toString(),
        password: getRandomInt(0, 9999).toString(),
        port: PORT.toString()
    };

    const id = uuidv4();
    const req = {
        id,
        sunshine
    };

    const resp = await internalFetch<Session>(address, 'new', req);
    if (resp instanceof APIError) throw resp;

    const { username, password } = sunshine;
    const cmds = [
        '--address',
        address,
        '--port',
        `${PORT}`,
        '--width',
        `${options?.width ?? 1920}`,
        '--height',
        `${options?.height ?? 1080}`,
        '--bitrate',
        `${options?.bitrate ?? 6000}`,
        '--username',
        username,
        '--password',
        password
    ];

    const command = new Command('Moonlight', cmds);
    command.stderr.addListener('data', (data) =>
        callback != undefined ? callback('stderr', data) : console.log(data)
    );
    command.stdout.addListener('data', (data) =>
        callback != undefined ? callback('stdout', data) : console.log(data)
    );

    return await command.spawn();
}

export async function CloseSession(
    address: string,
    req: Session
): Promise<Computer | APIError> {
    return internalFetch<Computer>(address, 'closed', req);
}

export async function GetVmLog(
    address: string,
    computer: Computer
): Promise<string | APIError> {
    const session = computer.Sessions.find((x) => x.vm != undefined)?.id;
    if (!session) return new APIError('no session available');
    return internalFetch<string>(address, `log?target=${session}`);
}

function getRandomInt(min: number, max: number) {
    const minCeiled = Math.ceil(min);
    const maxFloored = Math.floor(max);
    return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled);
}
async function JoinZeroTier(network_id: string): Promise<string> {
    const command = await new Command('ZeroTier', [
        'leave',
        network_id
    ]).execute();
    return command.stdout + '\n' + command.stderr;
}
async function LeaveZeroTier(network_id: string): Promise<string> {
    const command = await new Command('ZeroTier', [
        'join',
        network_id
    ]).execute();
    return command.stdout + '\n' + command.stderr;
}
async function DiscordRichPresence(app_id: string): Promise<string> {
    const command = await new Command('Daemon', ['discord', app_id]).execute();
    return command.stdout + '\n' + command.stderr;
}

function getRemoteSession(computer: Computer): Session | undefined {
    if (computer.Sessions == undefined) return undefined;
    for (const session of computer.Sessions) {
        if (session.vm != undefined) {
            const subsession = getRemoteSession(session.vm);
            if (subsession != undefined) return subsession;
        }

        if (session.thinkmay != undefined) return session;
    }

    return undefined;
}

export {
    CAUSE,
    ClaimSteam,
    ClaimStorage,
    getFrontendURL,
    GetInfo,
    getRemoteSession,
    GLOBAL,
    POCKETBASE,
    UnclaimSteam,
    UnclaimStorage,
    UserEvents,
    UserSession
};
export type { Computer, RemoteCredential, S3Credential, Session, Steam };
