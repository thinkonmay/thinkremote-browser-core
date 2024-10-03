import { createClient } from '@supabase/supabase-js';
import PocketBase from 'pocketbase';
import { getBrowser, getOS, getResolution } from '../core/utils/platform';

export enum CAUSE {
    UNKNOWN,
    OUT_OF_HARDWARE,
    MAXIMUM_DEPLOYMENT_REACHED,
    INVALID_AUTH_HEADER,
    API_CALL,
    LOCKED_RESOURCE,
    VM_BOOTING_UP,
    PERMISSION_REQUIRED,
    NEED_WAIT,
    INVALID_REQUEST,
    REMOTE_TIMEOUT,
    INVALID_REF
}

export const POCKETBASE = new PocketBase(getDomainURL());
export const LOCAL = () => createClient(
    getDomainURL(),
    import.meta.env.VITE_SUPABASE_LOCAL_KEY
);
export const GLOBAL = () => createClient(
    import.meta.env.VITE_SUPABASE_GLOBAL_URL,
    import.meta.env.VITE_SUPABASE_GLOBAL_KEY
);

export function getDomainURL(): string {
    return window.location.host.includes('localhost') ||
        window.location.host.includes('tauri.localhost')
        ? 'https://play.thinkmay.net'
        : window.location.origin;
}
export function getDomain(): string {
    return window.location.host.includes('localhost') ||
        window.location.host.includes('tauri.localhost')
        ? 'play.thinkmay.net'
        : window.location.hostname;
}


const stack: { content: any; timestamp: string }[] = [];
let current_stack_length = 0;
export function UserEvents(content: { type: string; payload: any }) {
    stack.push({
        content,
        timestamp: new Date().toISOString()
    });
}

export const PingSession = async (total: number) => {
    UserEvents({
        type: 'remote/session',
        payload: {
            timestamp: new Date(),
            total
        }
    });
};

export async function UserSession(email: string) {
    if (window.location.href.includes('localhost')) return;

    let ip = '';

    try {
        ip =
            (await (await fetch('https://icanhazip.com/')).text())
                .split('\n')
                .at(0) ?? '';
    } catch {}

    const value = {
        ip,
        stack,
        os: getOS(),
        browser: getBrowser(),
        resolution: getResolution(),
        url: window.location.href
    };

    // TODO
    const { data, error } = await LOCAL()
        .from('generic_events')
        .insert({
            value,
            name: email ?? 'unknown',
            type: 'ANALYTICS'
        })
        .select('id');
    if (error || data?.length == 0) return;

    const session = data.at(0).id;
    const analytics_report = async () => {
        if (stack.length == current_stack_length) return;

        value.stack = stack;
        await LOCAL()
            .from('generic_events')
            .update({ value })
            .eq('id', session);

        current_stack_length = stack.length;
    };

    setTimeout(analytics_report, 5 * 1000);
    setTimeout(analytics_report, 10 * 1000);
    setTimeout(analytics_report, 20 * 1000);
    setTimeout(analytics_report, 30 * 1000);
    setTimeout(analytics_report, 45 * 1000);
    setInterval(analytics_report, 60 * 1000);
}