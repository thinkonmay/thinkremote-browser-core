import { ClientResponseError } from 'pocketbase';
import { v4 as uuidv4 } from 'uuid';
import { CAUSE, getFrontendURL, GLOBAL, POCKETBASE } from './database';

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
    command: string,
    body?: any
): Promise<T | APIError> {
    const pb = POCKETBASE();
    if (command == 'info') {
        try {
            return await pb.send<T>(command, {
                method: 'GET'
            });
        } catch (e) {
            const cre = e as ClientResponseError;
            return new APIError(
                cre.message ?? 'Unknown error',
                cre.status ?? 500
            );
        }
    } else {
        try {
            return await pb.send<T>(command, {
                method: 'POST',
                body: body ?? {}
            });
        } catch (e) {
            const cre = e as ClientResponseError;
            return new APIError(
                cre.message ?? 'Unknown error',
                cre.status ?? 500
            );
        }
    }
}

async function internalSSE<T>(
    command: string,
    body?: any,
    feedback?: (data: T) => Promise<void>
): Promise<T | APIError> {
    const pb = POCKETBASE();

    const id = await internalFetch<string>(command, body);
    if (id instanceof APIError) return id;

    const evtSource = new EventSource(`${pb.baseURL}/${command}/sse?id=${id}`);

    let result: T = null;
    if (feedback != undefined)
        evtSource.onopen = () =>
            (evtSource.onmessage = (ev) => feedback(JSON.parse(ev.data)));

    while (evtSource.readyState != evtSource.CLOSED)
        await new Promise((r) => setTimeout(r, 100));

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

    Ndisks?: NDisk[];
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

type NDisk = {
    address: string;
    volume: Volume;
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
    ndisk?: NDisk;
};

type RemoteCredential = {
    audioUrl: string;
    videoUrl: string;
    microUrl?: string;
    dataUrl: string;
};


const GetInfo = () => internalFetch<Computer>('info');
const ClaimStorage = () => internalFetch<string>('addon/storage/claim');
const ClaimSteam = () => internalFetch<string>('addon/steam/claim');
const UnclaimStorage = () => internalFetch<void>('addon/storage/unclaim');
const UnclaimSteam = () => internalFetch<void>('addon/steam/unclaim');
const CloseSession = (req: Session) => internalFetch<Computer>('closed', req);
const GetVmLog = (session: string) =>
    internalFetch<string>(`log?target=${session}`);
const CreateSession = async (session: Session) =>
    internalFetch<Computer>('new', session);
const ChangeTemplate = async (template: string, volume_id: string) =>
    internalSSE<void>('reallocate', {
        source: `${template}.template`,
        id: volume_id
    });

async function StartThinkmay(
    vm_request: Computer,
    preferred_codec: 'h264' | 'h265',
    preferred_proto: 'quic' | 'udp',
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
            requestedProtocol: preferred_proto
        }
    } as Session;

    type newRes = {
        status: string;
        code: number;
        info?: Computer;
    };

    const res = await internalSSE<newRes>('new', req, (res) =>
        showStatus(res.status, res.code)
    );
    if (res instanceof APIError) return res;

    return res.info;
}

function ParseRequest(
    session: Session,
    option?: {
        high_queue?: boolean;
        high_mtu?: boolean;
    }
): RemoteCredential {
    const address = new URL(POCKETBASE().baseURL).host;

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
        dataUrl: `wss://${address}:444/broadcasters/websocket?token=${data.token}`,
        microUrl: microphone
            ? `wss://${address}:444/broadcasters/microphone?token=${microphone.token}`
            : undefined
    };
}

function getRemoteSession(computer: Computer): Session | undefined {
    if (computer.Sessions == undefined) return undefined;
    for (const session of computer.Sessions) {
        if (session.ndisk != undefined) continue;
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
    ChangeTemplate,
    ClaimSteam,
    ClaimStorage,
    CloseSession,
    CreateSession,
    getFrontendURL,
    GetInfo,
    getRemoteSession,
    GetVmLog,
    GLOBAL,
    ParseRequest,
    POCKETBASE,
    StartThinkmay,
    UnclaimSteam,
    UnclaimStorage
};
export type { Computer, RemoteCredential, S3Credential, Session, Steam };
