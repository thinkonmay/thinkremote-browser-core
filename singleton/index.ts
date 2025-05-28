import { EventCode, RemoteDesktopClient } from '../core';

export const SIZE = () =>
    CLIENT
        ? CLIENT.video.internal().videoHeight *
          CLIENT.video.internal().videoWidth
        : 1920 * 1080;
let HQ = false;
export const set_hq = (val: boolean) => (HQ = val);
export const MAX_BITRATE = () =>
    Math.round(((HQ ? 30000 : 15000) / (1920 * 1080)) * SIZE());
export const MIN_BITRATE = () => Math.round((500 / (1920 * 1080)) * SIZE());
export const MAX_FRAMERATE = 120; //240
export const MIN_FRAMERATE = 40;

export let CLIENT: RemoteDesktopClient | undefined = undefined;
export const Assign = (client: RemoteDesktopClient) => {
    if (CLIENT) CLIENT.Close();
    CLIENT = client;
};

export const ready = async (): Promise<Error | void> => {
    const now = () => new Date().getTime() / 1000;
    const start = now();
    while (CLIENT == undefined || !CLIENT.ready()) {
        await new Promise((r) => setTimeout(r, 1000));
        if (now() - start > 10 * 60) return new Error('connect timeout');
        else if (CLIENT == null) return new Error('null client');
        else if (CLIENT.authFailed())
            return new Error('streaming auth failure');
    }

    return;
};

export function gamepadButton(index: number, isDown?: boolean) {
    return async (e: Event) => {
        e.preventDefault();
        await CLIENT?.VirtualGamepadButton(isDown, index);
        if ('vibrate' in navigator && isDown) navigator.vibrate([40, 30, 0]);
    };
}

export const virtMouseWheel = (deltaY: number) =>
    CLIENT?.MouseWheel({ deltaY });

export const virtMouse = (button: number, isDown?: boolean) =>
    (isDown
        ? CLIENT?.MouseButtonDown.bind(CLIENT)
        : CLIENT?.MouseButtonUp.bind(CLIENT))({ button });

export const gamepadAxis = (x: number, y: number, isRight?: boolean) =>
    CLIENT?.VirtualGamepadAxis(x, y, isRight);

export const keyboard = (...vals: { val: string; isDown?: boolean }[]) =>
    CLIENT?.VirtualKeyboard(
        ...vals.map(({ isDown, val }) => ({
            code:
                (!isDown ? EventCode.ku : EventCode.kd) +
                (CLIENT?.hid.scancode ? 2 : 0),
            jsKey: val
        }))
    );
