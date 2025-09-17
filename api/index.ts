import { ClientResponseError } from 'pocketbase';
import { v4 as uuidv4 } from 'uuid';
import { CAUSE, GLOBAL, POCKETBASE } from './database';

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
    const methodMap = {
        new: 'POST',
        reallocate: 'POST',
        close: 'DELETE',
        info: 'GET',
        storage: 'GET',
        steam: 'GET',
        resource: 'DELETE',
        log: 'GET',
        analytics: 'GET'
    };

    try {
        return await POCKETBASE().send<T>(command, {
            method: methodMap[command] ?? 'POST',
            body: body
        });
    } catch (e) {
        const cre = e as ClientResponseError;
        return new APIError(cre.message ?? 'Unknown error', cre.status ?? 500);
    }
}

async function internalSSE<T>(
    command: string,
    body?: any,
    feedback?: (data: T) => Promise<void>,
    callback?: (data: EventSource) => void
): Promise<T | APIError> {
    const pb = POCKETBASE();

    const id = await internalFetch<string>(command, body);
    if (id instanceof APIError) return id;

    const evtSource = new EventSource(`${pb.baseURL}/${command}/sse?id=${id}`);
    if (callback) callback(evtSource);

    let result: T = null;
    if (feedback != undefined)
        evtSource.onopen = () =>
            (evtSource.onmessage = (ev) => {
                const data = JSON.parse(ev.data);
                result = data;
                feedback(data);
            });

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
    pool: 'user_data' | 'app_data' | 'unified_data' | string;
};

type Computer = {
    Hostname?: string;
    CPU?: string;
    RAM?: string;
    BIOS?: string;
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

type Listener = {
    id: string;
    content: string;
    codec: string;
    proto: string;
};

type RemoteReqeust = {
    requestedCodec: string;
    requestedProtocol: string;
    listener: Listener[];
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
type Backup = {
    type: 'backup' | 'restore';
    createdAt?: string;
};

type Session = {
    id: string;
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
    logUrl?: string;
    hidUrl: string;
};

const GetInfo = () => internalFetch<Computer>('info');
const ClaimStorage = () => internalFetch<string>('storage');
const ClaimSteam = () => internalFetch<string>('steam');
const UnclaimResource = () => internalFetch<void>('resource');
const CloseSession = (req: Session) => internalFetch<Computer>('close', req);
const ChangeTemplate = async (template: string, volume_id: string) =>
    internalSSE<void>('reallocate', {
        source: `${template}.template`,
        id: volume_id
    });

let deploymentES: EventSource | undefined = undefined;
const CancelDeployment = () => deploymentES?.close();
async function StartThinkmay(
    preferred_codec: 'h264' | 'h265',
    preferred_proto: 'quic' | 'udp',
    showStatus: (status: string, code?: number) => Promise<void>
): Promise<Computer | APIError> {
    const req = {
        id: uuidv4(),
        vm: {},
        thinkmay: {
            requestedCodec: preferred_codec,
            requestedProtocol: preferred_proto
        }
    } as Session;

    type newRes = {
        status: string;
        code: number;
        info?: Computer;
    };

    const res = await internalSSE<newRes>(
        'new',
        req,
        (res) => showStatus(res.status, res.code),
        (es) => (deploymentES = es)
    );
    deploymentES = undefined;
    if (res instanceof APIError) return res;

    return res.info;
}

function ParseRequest(
    vmid: string,
    session: Session,
    option?: {
        high_mtu?: boolean;
    }
): RemoteCredential {
    const address = new URL(POCKETBASE().baseURL).host;

    const {
        thinkmay: { requestedCodec, listener }
    } = session;
    const { high_mtu } = option ?? {
        high_mtu: false
    };
    const opt = `&vmid=${vmid}&mtu=${high_mtu ? 1400 : 1200}`;

    const result: RemoteCredential = {
        videoUrl: '',
        audioUrl: '',
        hidUrl: ''
    };

    listener.forEach(({ id, content }) => {
        switch (content) {
            case 'video':
                result.videoUrl = `wss://${address}:444/broadcasters/webrtc/recvonly?&token=${id}${opt}&codec=${requestedCodec}`;
                break;
            case 'audio':
                result.audioUrl = `wss://${address}:444/broadcasters/webrtc/recvonly?token=${id}${opt}&codec=opus`;
                break;
            case 'hid':
                result.hidUrl = `wss://${address}:444/broadcasters/websocket?token=${id}${opt}`;
                break;
            case 'log':
                result.logUrl = `wss://${address}:444/broadcasters/websocket?token=${id}${opt}`;
                break;
            case 'microphone':
                result.microUrl = `wss://${address}:444/broadcasters/webrtc/sendonly?token=${id}${opt}`;
                break;
            default:
                break;
        }
    });

    return result;
}

function getVmSession(computer: Computer): Session | undefined {
    if (computer.Sessions == undefined) return undefined;
    for (const session of computer.Sessions)
        if (session.vm != undefined) return session;

    return undefined;
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
    CancelDeployment,
    CAUSE,
    ChangeTemplate,
    ClaimSteam,
    ClaimStorage,
    CloseSession,
    GetInfo,
    getRemoteSession,
    getVmSession,
    GLOBAL,
    ParseRequest,
    POCKETBASE,
    StartThinkmay,
    UnclaimResource
};
export type { Computer, RemoteCredential, S3Credential, Session, Steam };
