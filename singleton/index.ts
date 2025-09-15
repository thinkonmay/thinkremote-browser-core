import { EventCode, LogCb, Thinkmay } from '../core';

let HQ = false;
export const MAX_FRAMERATE = 120; //240
export const MIN_FRAMERATE = 40;
let CLIENT: Thinkmay | undefined = undefined;
const cbs: LogCb[] = [];

export const set_hq = (val: boolean) => (HQ = val);
export const MAX_BITRATE = () =>
    Math.round(
        ((HQ ? 30000 : 15000) / (1920 * 1080)) *
            (CLIENT ? CLIENT.Size() : 1920 * 1080)
    );
export const MIN_BITRATE = () =>
    Math.round((500 / (1920 * 1080)) * (CLIENT ? CLIENT.Size() : 1920 * 1080));

export const Assign = (client: Thinkmay) => {
    if (CLIENT) CLIENT.Close();
    CLIENT = client;
    cbs.forEach(CLIENT.AddLogCb);
};

export const LogCallback = (cb: LogCb) => {
    CLIENT?.AddLogCb(cb);
    cbs.push(cb);
};

export const ready = async (): Promise<Error | void> => {
    const start = Thinkmay.NowInSec();
    while (NotReady()) {
        await new Promise((r) => setTimeout(r, 1000));
        if (Thinkmay.SinceSec(start) > 10 * 60)
            return new Error('connect timeout');
        else if (CLIENT.AuthFailed())
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
                (CLIENT?.GetScancode() ? 2 : 0),
            jsKey: val
        }))
    );

export const Size = () => CLIENT?.Size();
export const ClientAvailable = () => CLIENT != undefined;
export const Connected = () => CLIENT?.Ready() ?? false;
export const NotReady = () => CLIENT == undefined || !CLIENT?.Ready();
export const CloseStreaming = () => CLIENT?.Close();
export const AuthFailed = () => CLIENT?.AuthFailed();
export const ResetKeyStuck = () => CLIENT?.ResetKeyStuck();
export const GetAudioMetric = () => CLIENT?.Metrics.audio;
export const GetVideoMetric = () => CLIENT?.Metrics.video;
export const ChangeBitrate = (b: number) => CLIENT?.ChangeBitrate(b);
export const ChangeFramerate = (b: number) => CLIENT?.ChangeFramerate(b);
export const SetClipboard = (val: string) => CLIENT?.SetClipboard(val);
export const SetScancode = (val: boolean) => CLIENT?.SetScancode(val);
export const PointerVisible = (val: boolean) => CLIENT?.PointerVisible(val);
export const BackupVM = () => CLIENT?.BackupGame();
