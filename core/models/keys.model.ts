import { Log, LogLevel } from '../utils/log';

export enum EventCode {
    mma,
    mmr,
    mw,
    mu,
    md,
    ku,
    kd,
    kus,
    kds,
    kr,

    gconn,
    gs,
    ga,
    gb,
    grum,

    cs,
    noti
}

export enum ShortcutCode {
    Fullscreen
}
export enum KeyCode {
    Shift = 0,
    Alt,
    Ctrl,

    F = 'KeyF',
    P = 'KeyP',
    F1 = 'F1',
    F11 = 'F11',
    Esc = 'Escape'
}

export class Shortcut {
    code: ShortcutCode;
    keys: Array<KeyCode>;
    Handler: (a: void) => void;

    constructor(
        code: ShortcutCode,
        keys: Array<KeyCode>,
        Handler: (a: void) => void
    ) {
        this.code = code;
        this.keys = keys;
        this.Handler = Handler;
    }

    public ManualTrigger(): void {
        this.Handler();
    }

    public HandleShortcut(event: KeyboardEvent): Boolean {
        const shift = this.keys.includes(KeyCode.Shift) === event.shiftKey;
        const alt = this.keys.includes(KeyCode.Alt) === event.altKey;
        const ctrl = this.keys.includes(KeyCode.Ctrl) === event.ctrlKey;

        let key = false;
        this.keys.forEach((element) => {
            if (element === event.code) {
                key = true;
            }
        });

        if (shift && alt && ctrl && key) {
            event.preventDefault();
            Log(LogLevel.Infor, `shortcut fired with code ${this.code}`);
            this.Handler();
            return true;
        }
        return false;
    }
}

export class HIDMsg {
    code: EventCode;
    data: any;
    constructor(code: EventCode, data: any) {
        this.code = code;
        this.data = data;
    }

    public convertType(): EventCode {
        return this.code;
    }

    public buffer(): number[] {
        switch (this.code) {
            case EventCode.ku:
                return [this.data.key];
            case EventCode.kd:
                return [this.data.key];
            case EventCode.kus:
                return [this.data.key];
            case EventCode.kds:
                return [this.data.key];
            case EventCode.kr:
                return [];

            case EventCode.mu:
                return [this.data.button];
            case EventCode.md:
                return [this.data.button];

            case EventCode.mmr:
                return [
                    Math.round(this.data.dX) + 16 * 1024,
                    Math.round(this.data.dY) + 16 * 1024
                ];
            case EventCode.mma:
                return [
                    Math.round(this.data.dX * 2 ** 32),
                    Math.round(this.data.dY * 2 ** 32)
                ];
            case EventCode.mw:
                return [this.data.deltaY + 2048];

            case EventCode.gconn:
                return [this.data.gid];
            case EventCode.gb:
                return [this.data.gid, this.data.index, this.data.val];
            case EventCode.ga:
                return [this.data.gid, this.data.index, this.data.val];
            case EventCode.gs:
                return [this.data.gid, this.data.index, this.data.val];
            default:
                return [];
        }
    }
}
