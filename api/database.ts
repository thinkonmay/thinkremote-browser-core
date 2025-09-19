import { createClient } from '@supabase/supabase-js';
import PocketBase from 'pocketbase';
import { ValidateIPaddress } from '.';
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

export function getDefaultDomain(): string {
    const address = localStorage.getItem('thinkmay_domain');
    if (address == null) return 'https://saigon2.thinkmay.net';
    else return address;
}
export function getFrontendURL(): string {
    const address = localStorage.getItem('thinkmay_domain');
    if (address == null) return 'https://saigon2.thinkmay.net';
    else return `https://${address}`;
}
export const POCKETBASE = () => new PocketBase(getFrontendURL());
export const GLOBAL = () =>
    createClient(
        'https://saigon2.thinkmay.net:445',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzU0OTMxNjAwLCJleHAiOjE5MTI2OTgwMDB9.m7qcf4j3u1oPoqIsCqU3JHqYEO0DV2PmoPXGcdUAdR8'
    );

export const DevEnv =
    window.location.href.includes('localhost') ||
    ValidateIPaddress(window.location.host.split(':')[0]);
