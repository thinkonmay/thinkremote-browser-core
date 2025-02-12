import { Body, Client, getClient, ResponseType } from '@tauri-apps/api/http';
import { Child, Command } from '@tauri-apps/api/shell';
import { v4 as uuidv4 } from 'uuid';
import {
    CAUSE,
    getDomain,
    getDomainURL,
    GLOBAL,
    LOCAL,
    PingSession,
    POCKETBASE,
    UserEvents,
    UserSession
} from './database';
import { fromComputer, NodeType, RenderNode } from './tree';

const WS_PORT = 60000;
const TurnCredential = () => {
    return {
        username: uuidv4(),
        password: uuidv4()
    };
};

let client: Client | null = null;
const http_available = () =>
    client != null || new URL(window.location.href).protocol == 'http:';
export function ValidateIPaddress(ipaddress: string) {
    return ipaddress != undefined
        ? /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
              ipaddress
          )
        : false;
}
const userHttp = (addr: string): boolean =>
    http_available() && ValidateIPaddress(addr);

getClient()
    .then((x) => (client = x))
    .catch((r) =>
        console.log(
            'You are not using on webbrowser, tauri API will be limited'
        )
    );
async function internalFetch<T>(
    address: string,
    command: string,
    body?: any
): Promise<T | Error> {
    const token = POCKETBASE.authStore.token;
    const user = POCKETBASE.authStore.model?.id;
    const url = userHttp(address)
        ? `http://${address}:${WS_PORT}/${command}`
        : `https://${address}/${command}`;

    if (client != null) {
        if (command == 'info') {
            const { data, ok } = await client.get<T>(url, {
                timeout: { secs: 3, nanos: 0 },
                headers: { Authorization: token, User: user },
                responseType: ResponseType.JSON
            });

            if (!ok) return new Error('fail to request');

            return data;
        } else {
            const { data, ok } = await client.post<T>(url, Body.json(body), {
                timeout: { secs: 60 * 60 * 24, nanos: 0 },
                headers: { Authorization: token, User: user },
                responseType: ResponseType.JSON
            });

            if (!ok)
                return new Error(`${JSON.stringify(data)}. Send it to admin!`);

            return data;
        }
    } else {
        if (command == 'info') {
            const resp = await fetch(url, {
                method: 'GET',
                headers: { Authorization: token, User: user }
            });
            if (!resp.ok)
                return new Error(
                    `${JSON.stringify(await resp.text())}. Send it to admin! `
                );

            return await resp.json();
        } else {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { Authorization: token, User: user },
                body: JSON.stringify(body)
            });

            if (!resp.ok) {
                const msg = JSON.stringify(await resp.text());
                return new Error(`${msg}. Send it to admin!`);
            }
            const clonedResponse = resp.clone();

            try {
                return await clonedResponse.json();
            } catch (error) {
                return new Error(await resp.text());
            }
        }
    }
}

type Computer = {
    address?: string; // private
    available?: 'not_ready' | 'ready' | 'started'; // private
    steam?: boolean; // private
    storage?: boolean; // private

    Hostname?: string;
    CPU?: string;
    RAM?: string;
    BIOS?: string;
    PublicIP?: string;
    PrivateIP?: string;
    MacAddr?: string;

    GPUs: string[];
    Sessions?: StartRequest[];
    Volumes?: string[];
};

export async function GetInfo(ip: string): Promise<Computer | Error> {
    return await internalFetch<Computer>(ip, 'info');
}

export type StartRequest = {
    id: string;
    target?: string;
    sunshine?: {
        username: string;
        password: string;
        port: string;
    };
    thinkmay?: {
        stunAddress: string;
        turnAddress: string;
        username: string;
        password: string;
        audioToken?: string;
        videoToken?: string;
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
    vm?: Computer;
};

type callback = () => Promise<number>;
export function KeepaliveVolume(
    computer: Computer,
    volume_id: string,
    total_time_callback?: (time_in_second: number) => Promise<void>
): callback {
    const { address } = computer;
    if (address == undefined) throw new Error('address is not defined');

    const now = () => new Date().getTime() / 1000;
    const start = now();
    let last_ping = now();

    return async (): Promise<number> => {
        total_time_callback ? total_time_callback(now() - start) : null;
        if (
            !(
                (await internalFetch<{}>(address, '_use', volume_id)) instanceof
                Error
            )
        )
            last_ping = now();

        return now() - last_ping;
    };
}

export async function StartVirtdaemon(
    computer: Computer,
    volume_id?: string,
    ram?: string,
    vcpu?: string,
    hidevm?: boolean,
    showStatus?: (status: string) => Promise<void>
): Promise<Error | StartRequest> {
    const { address } = computer;
    if (address == undefined) return new Error('address is not defined');

    const turn = TurnCredential();
    const thinkmay = {
        stunAddress: `stun:${address}:3478`,
        turnAddress: `turn:${address}:3478`,
        username: turn.username,
        password: turn.password,
        displayRequired: true
    };

    const id = uuidv4();
    const req = {
        id,
        thinkmay,
        vm: {
            GPUs: ['GA104 [GeForce RTX 3060 Ti Lite Hash Rate]'],
            Volumes: volume_id != undefined ? [volume_id] : [],
            CPU: vcpu ?? '12',
            RAM: ram ?? '16',
            HideVM: hidevm ?? true
        }
    };

    type deployment_status = { status: string };

    let running = true;
    (async (_req: StartRequest) => {
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

    let resp: Error | StartRequest = new Error('unable to request');
    try {
        resp = await internalFetch<StartRequest>(address, 'new', req);
    } catch (err) {
        running = false;
        return new Error(JSON.stringify(err));
    }
    running = false;
    return resp;
}

export type Session = {
    audioUrl: string;
    videoUrl: string;
    logUrl?: string;
    rtc_config: RTCConfiguration;
};

export async function StartThinkmayOnVM(
    computer: Computer,
    target: string
): Promise<Session | Error> {
    const { address } = computer;
    if (address == undefined) return new Error('address is not defined');

    const turn = TurnCredential();
    const thinkmay = {
        stunAddress: `stun:${address}:3478`,
        turnAddress: `turn:${address}:3478`,
        username: turn.username,
        password: turn.password,
        displayRequired: true
    };

    const id = uuidv4();
    const req: StartRequest = {
        id,
        target,
        thinkmay
    };

    const resp = await internalFetch<StartRequest>(address, 'new', req);
    if (resp instanceof Error) throw resp;
    else if (resp.thinkmay == undefined)
        return new Error('address is not defined');

    return {
        logUrl: !userHttp(address)
            ? `https://${address}/log?target=${target}`
            : `http://${address}:${WS_PORT}/log?target=${target}`,
        audioUrl: !userHttp(address)
            ? `https://${address}/handshake/client?token=${resp.thinkmay.audioToken}&target=${target}`
            : `http://${address}:${WS_PORT}/handshake/client?token=${resp.thinkmay.audioToken}&target=${target}`,
        videoUrl: !userHttp(address)
            ? `https://${address}/handshake/client?token=${resp.thinkmay.videoToken}&target=${target}`
            : `http://${address}:${WS_PORT}/handshake/client?token=${resp.thinkmay.videoToken}&target=${target}`,
        rtc_config: {
            iceServers: [
                {
                    urls: `stun:${address}:3478`
                },
                {
                    urls: `turn:${address}:3478`,
                    username: turn.username,
                    credential: turn.password
                }
            ]
        }
    };
}
export async function LoginSteamOnVM(
    computer: Computer,
    target: string,
    username: string,
    password: string
): Promise<StartRequest | Error> {
    const { address } = computer;
    if (address == undefined) return new Error('address is not defined');

    const id = uuidv4();
    const req: StartRequest = {
        id,
        target,
        app: {
            Type: 'steam',
            Username: username,
            Credential: password
        }
    };

    const resp = await internalFetch<StartRequest>(address, 'new', req);
    if (resp instanceof Error) throw resp;
    return req;
}
export async function LogoutSteamOnVM(
    computer: Computer,
    req: StartRequest
): Promise<'SUCCESS' | Error> {
    const { address } = computer;
    if (address == undefined) return new Error('address is not defined');
    const resp = await internalFetch<StartRequest>(address, 'closed', req);
    return resp instanceof Error ? resp : 'SUCCESS';
}

export async function MountOnVM(
    computer: Computer,
    target: string,
    bucket_name: string
): Promise<StartRequest | Error> {
    const { address } = computer;
    if (address == undefined) return new Error('address is not defined');

    const id = uuidv4();
    const req: StartRequest = {
        id,
        target,
        s3bucket: {
            bucket: bucket_name,
            mountPath: `C:/${uuidv4()}`
        }
    };

    const resp = await internalFetch<StartRequest>(address, 'new', req);
    if (resp instanceof Error) throw resp;
    return req;
}
export async function UnmountOnVM(
    computer: Computer,
    req: StartRequest
): Promise<'SUCCESS' | Error> {
    const { address } = computer;
    if (address == undefined) return new Error('address is not defined');
    const resp = await internalFetch<StartRequest>(address, 'closed', req);
    return resp instanceof Error ? resp : 'SUCCESS';
}

export async function StartThinkmayOnPeer(
    computer: Computer,
    target: string
): Promise<Session | Error> {
    const { address } = computer;
    if (address == undefined) return new Error('address is not defined');

    const turn = TurnCredential();
    const thinkmay = {
        stunAddress: `stun:${address}:3478`,
        turnAddress: `turn:${address}:3478`,
        username: turn.username,
        password: turn.password,
        displayRequired: true
    };

    const id = uuidv4();
    const req: StartRequest = {
        id,
        target,
        thinkmay
    };

    const resp = await internalFetch<StartRequest>(address, 'new', req);
    if (resp instanceof Error) throw resp;
    else if (resp.thinkmay == undefined)
        return new Error('address is not defined');

    return {
        logUrl: !userHttp(address)
            ? `https://${address}/log?target=${target}`
            : `http://${address}:${WS_PORT}/log?target=${target}`,
        audioUrl: !userHttp(address)
            ? `https://${address}/handshake/client?token=${resp.thinkmay.audioToken}&target=${target}`
            : `http://${address}:${WS_PORT}/handshake/client?token=${resp.thinkmay.audioToken}&target=${target}`,
        videoUrl: !userHttp(address)
            ? `https://${address}/handshake/client?token=${resp.thinkmay.videoToken}&target=${target}`
            : `http://${address}:${WS_PORT}/handshake/client?token=${resp.thinkmay.videoToken}&target=${target}`,
        rtc_config: {
            iceServers: [
                {
                    urls: `stun:${address}:3478`
                },
                {
                    urls: `turn:${address}:3478`,
                    username: turn.username,
                    credential: turn.password
                }
            ]
        }
    };
}
export async function StartThinkmay(
    computer: Computer
): Promise<Session | Error> {
    const { address } = computer;
    if (address == undefined) return new Error('address is not defined');

    const turn = TurnCredential();
    const thinkmay = {
        stunAddress: `stun:${address}:3478`,
        turnAddress: `turn:${address}:3478`,
        username: turn.username,
        password: turn.password,
        displayRequired: true
    };

    const id = uuidv4();
    const req: StartRequest = {
        id,
        thinkmay
    };

    const resp = await internalFetch<StartRequest>(address, 'new', req);
    if (resp instanceof Error) throw resp;
    else if (resp.thinkmay == undefined)
        return new Error(`thinkmay is not defined`);

    return {
        audioUrl: !userHttp(address)
            ? `https://${address}/handshake/client?token=${resp.thinkmay.audioToken}`
            : `http://${address}:${WS_PORT}/handshake/client?token=${resp.thinkmay.audioToken}`,
        videoUrl: !userHttp(address)
            ? `https://${address}/handshake/client?token=${resp.thinkmay.videoToken}`
            : `http://${address}:${WS_PORT}/handshake/client?token=${resp.thinkmay.videoToken}`,
        rtc_config: {
            iceServers: [
                {
                    urls: `stun:${address}:3478`
                },
                {
                    urls: `turn:${address}:3478`,
                    username: turn.username,
                    credential: turn.password
                }
            ]
        }
    };
}
export function ParseRequest(
    computer: Computer,
    session: StartRequest
): Session | Error {
    const { address } = computer;
    const { thinkmay } = session;
    if (address == undefined) throw new Error('address is not defined');
    else if (thinkmay == undefined) throw new Error('thinkmay is not defined');

    return {
        audioUrl: !userHttp(address)
            ? `https://${address}/handshake/client?token=${thinkmay.audioToken}`
            : `http://${address}:${WS_PORT}/handshake/client?token=${thinkmay.audioToken}`,
        videoUrl: !userHttp(address)
            ? `https://${address}/handshake/client?token=${thinkmay.videoToken}`
            : `http://${address}:${WS_PORT}/handshake/client?token=${thinkmay.videoToken}`,
        rtc_config: {
            iceServers: [
                {
                    urls: `stun:${address}:3478`
                },
                {
                    urls: `turn:${address}:3478`,
                    username: thinkmay.username,
                    credential: thinkmay.password
                }
            ]
        }
    };
}

export function ParseVMRequest(
    computer: Computer,
    session: StartRequest
): Session {
    const { address } = computer;
    const { thinkmay, target } = session;
    if (address == undefined) throw new Error('address is not defined');
    else if (thinkmay == undefined) throw new Error('thinkmay is not defined');

    return {
        logUrl: !userHttp(address)
            ? `https://${address}/log?target=${target}`
            : `http://${address}:${WS_PORT}/log?target=${target}`,
        audioUrl: !userHttp(address)
            ? `https://${address}/handshake/client?token=${thinkmay.audioToken}&target=${target}`
            : `http://${address}:${WS_PORT}/handshake/client?token=${thinkmay.audioToken}&target=${target}`,
        videoUrl: !userHttp(address)
            ? `https://${address}/handshake/client?token=${thinkmay.videoToken}&target=${target}`
            : `http://${address}:${WS_PORT}/handshake/client?token=${thinkmay.videoToken}&target=${target}`,
        rtc_config: {
            iceServers: [
                {
                    urls: `stun:${address}:3478`
                },
                {
                    urls: `turn:${address}:3478`,
                    username: thinkmay.username,
                    credential: thinkmay.password
                }
            ]
        }
    };
}

type MoonlightStreamConfig = {
    bitrate?: number;
    width?: number;
    height?: number;
};
export async function StartMoonlight(
    computer: Computer,
    options?: MoonlightStreamConfig,
    callback?: (type: 'stdout' | 'stderr', log: string) => void
): Promise<Child> {
    const { address } = computer;
    if (address == undefined) throw new Error('address is not defined');

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

    const resp = await internalFetch<StartRequest>(address, 'new', req);
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
    console.log(`starting moonlight with ${cmds}`);
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
    computer: Computer,
    req: StartRequest
): Promise<Error | 'SUCCESS'> {
    const { address } = computer;
    if (address == undefined) throw new Error('address is not defined');
    const resp = await internalFetch(address, 'closed', req);
    return resp instanceof Error ? resp : 'SUCCESS';
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

export {
    CAUSE,
    fromComputer,
    getDomain,
    getDomainURL,
    GLOBAL,
    LOCAL,
    PingSession,
    POCKETBASE,
    RenderNode,
    UserEvents,
    UserSession
};
export type { Computer, NodeType };
