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

async function internalFetch<T>(
    address: string,
    command: string,
    body?: any
): Promise<T | Error> {
    try {
        const token = POCKETBASE.authStore.token;
        const user = POCKETBASE.authStore.model?.id;
        const url = `https://${address}/${command}`;

        if (command == 'info') {
            const resp = await fetch(url, {
                method: 'GET',
                headers: { Authorization: token, User: user }
            });
            if (!resp.ok)
                return new Error(
                    `${(await resp.text()).replaceAll(
                        `"`,
                        ''
                    )}. Send it to admin! `
                );
            else return await resp.json();
        } else {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { Authorization: token, User: user },
                body: JSON.stringify(body)
            });

            if (!resp.ok)
                return new Error(
                    `${(await resp.text()).replaceAll(
                        `"`,
                        ''
                    )}. Send it to admin!`
                );
            else return await resp.json();
        }
    } catch (err) {
        return new Error(err);
    }
}

async function GetInfo(ip: string): Promise<Computer | Error> {
    const result = await internalFetch<Computer>(ip, 'info');
    if (result instanceof Error)
        return await internalFetch<Computer>(ip, 'info');
    else return result;
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
    data: ProxyChain;
};

type Session = {
    id: string;
    target?: string;

    sunshine?: {
        username: string;
        password: string;
        port: string;
    };
    app?: {
        Type: string;
        Username: string;
        Credential: string;
    };
    s3bucket?: {
        bucket: string;
        mountPath: string;
    };

    thinkmay?: RemoteReqeust;
    vm?: Computer;
};

type RemoteCredential = {
    audioUrl: string;
    videoUrl: string;
    dataUrl: string;
};

export async function StartThinkmay(
    address: string,
    vm_request?: Computer,
    showStatus?: (status: string) => Promise<void>
): Promise<Computer | Error> {
    const req = {
        id: uuidv4(),
        thinkmay: {
            displayRequired: true,
            requestedCodec: 'h264',
            requestedProtocol: 'webrtc'
        },
        vm: vm_request
    } as Session;

    let running = true;
    type deployment_status = { status: string };
    if (vm_request != undefined)
        (async (_req: Session) => {
            await new Promise((r) => setTimeout(r, 3000));
            while (running) {
                const request_new = await internalFetch<deployment_status>(
                    address,
                    '_new',
                    _req
                );
                if (!(request_new instanceof Error)) {
                    showStatus(request_new.status);
                    await new Promise((r) => setTimeout(r, 1000));
                }
            }
        })(req);

    let resp: Error | Computer = new Error('unable to request');
    try {
        resp = await internalFetch<Computer>(address, 'new', req);
    } catch (err) {
        running = false;
        return new Error(err);
    }
    running = false;
    return resp;
}

export async function LoginSteamOnVM(
    address: string,
    target: string,
    username: string,
    password: string
): Promise<Computer | Error> {
    const id = uuidv4();
    const req: Session = {
        id,
        target,
        app: {
            Type: 'steam',
            Username: username,
            Credential: password
        }
    };

    return await internalFetch<Computer>(address, 'new', req);
}
export async function LogoutSteamOnVM(
    address: string,
    req: Session
): Promise<'SUCCESS' | Error> {
    const resp = await internalFetch<Session>(address, 'closed', req);
    return resp instanceof Error ? resp : 'SUCCESS';
}

export async function ChangeTemplate(
    address: string,
    template: string,
    volume_id: string
): Promise<Error | 'success'> {
    return await internalFetch<'success'>(address, 'reallocate', {
        source: `${template}.template`,
        id: volume_id
    });
}
export async function MountOnVM(
    address: string,
    target: string,
    bucket_name: string
): Promise<Computer | Error> {
    const id = uuidv4();
    const req: Session = {
        id,
        target,
        s3bucket: {
            bucket: bucket_name,
            mountPath: `C:/${uuidv4()}`
        }
    };

    return await internalFetch<Computer>(address, 'new', req);
}
export async function UnmountOnVM(
    address: string,
    req: Session
): Promise<'SUCCESS' | Error> {
    if (address == undefined) return new Error('address is not defined');
    const resp = await internalFetch<Session>(address, 'closed', req);
    return resp instanceof Error ? resp : 'SUCCESS';
}

export function ParseRequest(
    address: string,
    session: Session
): RemoteCredential | Error {
    const {
        thinkmay: { audio, video, data }
    } = session;
    return {
        videoUrl: `wss://${address}/broadcasters/webrtc?token=${video.token}`,
        audioUrl: `wss://${address}/broadcasters/webrtc?token=${audio.token}`,
        dataUrl: `wss://${address}/broadcasters/websocket?token=${data.token}`
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
    if (resp instanceof Error) throw resp;

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
): Promise<Error | Computer> {
    return internalFetch<Computer>(address, 'closed', req);
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
    getFrontendURL,
    GetInfo,
    getRemoteSession,
    GLOBAL,
    POCKETBASE,
    UserEvents,
    UserSession
};
export type { Computer, RemoteCredential, Session };
