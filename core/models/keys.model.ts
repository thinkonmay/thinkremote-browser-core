export enum EventCode {
    mma = 1,
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
    gdis,
    gs,
    ga,
    gb,
    grum,

    cs,
    noti,
    ping
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
                    Math.round(this.data.dX * 2 ** 32) - 1,
                    Math.round(this.data.dY * 2 ** 32) - 1
                ];
            case EventCode.mw:
                return [this.data.deltaY + 2048];

            case EventCode.gconn:
                return [this.data.gid];
            case EventCode.gdis:
                return [this.data.gid];
            case EventCode.gb:
                return [this.data.gid, this.data.index, this.data.val];
            case EventCode.ga:
                return [
                    this.data.gid,
                    this.data.index,
                    Math.round(
                        ((this.data.val >= 1
                            ? 0.999
                            : this.data.val <= -1
                              ? -0.999
                              : this.data.val) +
                            1) *
                            2 ** 31
                    ) - 1
                ];
            case EventCode.gs:
                return [
                    this.data.gid,
                    this.data.index,
                    Math.round(
                        ((this.data.val >= 1
                            ? 0.999
                            : this.data.val <= -1
                              ? -0.999
                              : this.data.val) +
                            1) *
                            2 ** 31
                    ) - 1
                ];
            default:
                return [];
        }
    }
}
