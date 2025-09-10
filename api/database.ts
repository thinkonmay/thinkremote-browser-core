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
        'https://play.2.thinkmay.net:445',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzU0OTMxNjAwLCJleHAiOjE5MTI2OTgwMDB9.m7qcf4j3u1oPoqIsCqU3JHqYEO0DV2PmoPXGcdUAdR8'
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
