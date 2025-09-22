import { createClient } from '@supabase/supabase-js';
import PocketBase from 'pocketbase';

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

function getFrontendURL(): string {
    const address = localStorage.getItem('thinkmay_domain');
    if (address == null) return 'https://saigon2.thinkmay.net';
    else return `https://${address}`;
}
export const POCKETBASE = () => new PocketBase(getFrontendURL());
export const GLOBAL = () =>
    createClient(
        'https://saigon2.thinkmay.net:945',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE'
    );

const validateIP = (ipaddress: string) =>
    ipaddress != undefined
        ? /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
                ipaddress
            )
        : false;

export const DevEnv =
    window.location.href.includes('localhost') ||
    validateIP(window.location.host.split(':')[0]);
