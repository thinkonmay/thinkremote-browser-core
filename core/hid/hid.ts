import {
    EventCode,
    HIDMsg,
    KeyCode,
    Shortcut,
    ShortcutCode
} from '../models/keys.model';
import { convertJSKey } from '../utils/convert';
import { Log, LogLevel } from '../utils/log';
import { requestFullscreen } from '../utils/screen';

const MOUSE_SPEED = 1.07;

export class HID {
    private prev_buttons: Map<number, boolean>;
    private prev_sliders: Map<number, number>;
    private prev_axis: Map<number, number>;

    private pressing_keys: number[];

    private shortcuts: Array<Shortcut>;

    private relativeMouse: boolean;
    public scancode: boolean;

    last_interact: Date;
    public last_active(): number {
        return (new Date().getTime() - this.last_interact.getTime()) / 1000;
    }

    private SendFunc: (...data: HIDMsg[]) => Promise<void>;
    public disable: boolean;
    private closed: boolean;

    private intervals: any[];

    private video: HTMLVideoElement;
    constructor(
        Sendfunc: (...data: HIDMsg[]) => Promise<void>,
        video?: HTMLVideoElement
    ) {
        this.disable = false;
        this.closed = false;
        this.SendFunc = async (...data: HIDMsg[]) =>
            !this.disable ? await Sendfunc(...data) : null;
        this.video = video;

        this.prev_buttons = new Map<number, boolean>();
        this.prev_sliders = new Map<number, number>();
        this.prev_axis = new Map<number, number>();

        this.scancode = false;
        this.last_interact = new Date();

        this.intervals = [];
        this.pressing_keys = [];

        this.disableKeyWhileFullscreen();

        /**
         * video event
         */
        this.video.onmousedown = this.mouseButtonDown.bind(this);
        this.video.onmouseup = this.mouseButtonUp.bind(this);

        /**
         * document event
         */
        document.onwheel = this.mouseWheel.bind(this);
        document.onmousemove = this.mouseButtonMovement.bind(this);
        document.onkeydown = this.keydown.bind(this);
        document.onkeyup = this.keyup.bind(this);

        /**
         * shortcuts stuff
         */
        this.shortcuts = new Array<Shortcut>();
        this.shortcuts.push(
            new Shortcut(
                ShortcutCode.Fullscreen,
                [KeyCode.Ctrl, KeyCode.Shift, KeyCode.F],
                requestFullscreen
            ),
            new Shortcut(
                ShortcutCode.Fullscreen,
                [KeyCode.F11],
                requestFullscreen
            )
        );

        /**
         * gamepad stuff
         */
        Array.from(Array(16).keys()).forEach((x) => {
            this.prev_buttons.set(x, false);
            this.prev_sliders.set(x, 0);
            this.prev_axis.set(x, 0);
        });

        (async () => {
            while (!this.closed) {
                let wait_period = 10;
                try {
                    wait_period = await this.runGamepad();
                } catch {}
                if (wait_period > 0)
                    await new Promise((r) => setTimeout(r, wait_period));
            }
        })();
        this.intervals.push(
            setInterval(
                () =>
                    (this.relativeMouse =
                        document.pointerLockElement != null ||
                        (document as any).mozPointerLockElement != null ||
                        (document as any).webkitPointerLockElement != null),
                100
            )
        );
    }

    public Close() {
        this.intervals.forEach((x) => clearInterval(x));
        this.disable = true;
        this.closed = true;
        document.onwheel = null;
        document.onmousemove = null;
        document.onmousedown = null;
        document.onmouseup = null;
        document.onkeydown = null;
        this.shortcuts = new Array<Shortcut>();
    }

    public async handleIncomingData(blob: Blob) {
        const data = await blob.text();
        const buff = new TextEncoder().encode(data);
        switch (buff.at(0)) {
            case EventCode.grum:
                const weakMagnitude = buff[2] / 255;
                const strongMagnitude = buff[3] / 255;
                const duration = 1000;

                if (strongMagnitude > 0 || weakMagnitude > 0)
                    navigator.vibrate?.(duration);
                navigator.getGamepads().forEach((gamepad: Gamepad | null) => {
                    gamepad?.vibrationActuator?.playEffect('dual-rumble', {
                        duration,
                        weakMagnitude,
                        strongMagnitude
                    });
                });
                break;
            case EventCode.noti:
                Log(LogLevel.Warning, data.slice(1));
                break;
            case EventCode.ping:
                break;
        }
    }

    private async runGamepad(): Promise<number> {
        const gamepads = navigator.getGamepads().filter((x) => x != null);
        for (let gamepad_id = 0; gamepad_id < gamepads.length; gamepad_id++) {
            const { buttons, axes } = gamepads[gamepad_id];

            for (let index = 0; index < buttons.length; index++) {
                const { pressed, value } = buttons[index];
                if (index == 6 || index == 7) {
                    if (this.prev_sliders.get(index) == value) continue;
                    await this.SendFunc(
                        new HIDMsg(EventCode.gs, {
                            index: index,
                            val: value
                        })
                    );

                    this.prev_sliders.set(index, value);
                    this.last_interact = new Date();
                } else {
                    if (this.prev_buttons.get(index) == pressed) continue;
                    await this.SendFunc(
                        new HIDMsg(EventCode.gb, {
                            index: index,
                            val: pressed ? 1 : 0
                        })
                    );

                    this.prev_buttons.set(index, pressed);
                    this.last_interact = new Date();
                }
            }

            for (let index = 0; index < axes.length; index++)
                await this.SendFunc(
                    new HIDMsg(EventCode.ga, {
                        index: index,
                        val: axes[index]
                    })
                );
        }

        return gamepads.length == 0 ? 1000 : 30;
    }

    public async ResetKeyStuck() {
        await this.SendFunc(new HIDMsg(EventCode.kr, {}));
    }

    private async keydown(event: KeyboardEvent) {
        this.last_interact = new Date();
        event.preventDefault();
        let disable_send = false;
        this.shortcuts.forEach((element: Shortcut) => {
            const triggered = element.HandleShortcut(event);

            if (triggered) disable_send = true;
        });

        if (disable_send) return;

        if (event.key == 'Meta') return;

        const key = convertJSKey(event.key, event.location);
        if (key == undefined) return;

        let code = EventCode.kd;
        if (this.scancode) code += 2;
        await this.SendFunc(new HIDMsg(code, { key }));
        this.pressing_keys.push(key);
    }
    private async keyup(event: KeyboardEvent) {
        event.preventDefault();

        if (event.key == 'Meta') return;

        const key = convertJSKey(event.key, event.location);
        if (key == undefined) return;

        let code = EventCode.ku;
        if (this.scancode) code += 2;
        await this.SendFunc(new HIDMsg(code, { key }));
        this.pressing_keys.splice(
            this.pressing_keys.findIndex((x) => x == key)
        );
    }
    private async mouseWheel(event: WheelEvent) {
        await this.SendFunc(
            new HIDMsg(EventCode.mw, {
                deltaY: -Math.round(event.deltaY)
            })
        );
    }
    public async mouseMoveRel(event: { movementX: number; movementY: number }) {
        await this.SendFunc(
            new HIDMsg(EventCode.mmr, {
                dX: event.movementX,
                dY: event.movementY
            })
        );
    }
    private async mouseButtonMovement(event: MouseEvent) {
        this.last_interact = new Date();
        if (event.target != this.video) return;

        if (!this.relativeMouse) {
            await this.SendFunc(
                new HIDMsg(EventCode.mma, {
                    dX: this.clientToServerX(event.clientX),
                    dY: this.clientToServerY(event.clientY)
                })
            );
        } else {
            await this.SendFunc(
                new HIDMsg(EventCode.mmr, {
                    dX: event.movementX * MOUSE_SPEED,
                    dY: event.movementY * MOUSE_SPEED
                })
            );
        }
    }
    private mouseButtonDown(event: MouseEvent) {
        this.MouseButtonDown(event);
    }
    private mouseButtonUp(event: MouseEvent) {
        this.MouseButtonUp(event);
    }

    public async MouseButtonDown(event: { button: number }) {
        const code = EventCode.md;
        await this.SendFunc(
            new HIDMsg(code, {
                button: event.button
            })
        );
    }
    public async MouseButtonUp(event: { button: number }) {
        const code = EventCode.mu;
        await this.SendFunc(
            new HIDMsg(code, {
                button: event.button
            })
        );
    }

    private clientToServerY(clientY: number): number {
        return clientY / document.documentElement.clientHeight;
    }

    private clientToServerX(clientX: number): number {
        return clientX / document.documentElement.clientWidth;
    }

    private disableKeyWhileFullscreen() {
        const block = async () => {
            if (document.fullscreenElement)
                //@ts-ignore
                navigator.keyboard.lock(['Escape', 'F11']);
            //@ts-ignore
            else navigator.keyboard.unlock();
        };

        try {
            //@ts-ignore
            if ('keyboard' in navigator && 'lock' in navigator.keyboard)
                document.onfullscreenchange = block;
            else document.onfullscreenchange = null;
        } catch {}
    }
}
