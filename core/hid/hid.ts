import { Thinkmay } from '..';
import { EventCode, HIDMsg } from '../models/keys.model';
import { convertJSKey } from '../utils/convert';
const MOUSE_SPEED = 1.07;

export class HID {
    public scancode: boolean;
    private prev_buttons: Map<number, boolean>;
    private prev_sliders: Map<number, number>;
    private prev_axis: Map<number, number>;

    private relativeMouse: boolean;
    private last_interact: number;
    private SendFunc: (...data: HIDMsg[]) => Promise<void>;
    private disable: boolean;
    private closed: boolean;
    private intervals: any[];
    private video: HTMLVideoElement;
    private pressing_mbuttons: number[];
    private pressing_keys: number[];
    private gid: number;

    private onwheel = this.mouseWheel.bind(this);
    private onmousemove = this.mouseButtonMovement.bind(this);
    private onkeydown = this.keydown.bind(this);
    private onkeyup = this.keyup.bind(this);
    private onmousedown = this.MouseButtonDown.bind(this);
    private onmouseup = this.MouseButtonUp.bind(this);
    private onmouseup2 = ({ button }: MouseEvent) =>
        (this.pressing_mbuttons = this.pressing_mbuttons.filter(
            (x) => x != button
        ));
    private onmousedown2 = ({ button }) => this.pressing_mbuttons.push(button);

    private onmousemove2 = async (ev: MouseEvent) => {
        if (ev.target != this.video) {
            for (const val of this.pressing_mbuttons)
                await this.MouseButtonUp({ button: val });
            for (const val of this.pressing_keys) await this.keyupInternal(val);
        }
    };

    constructor(
        Sendfunc: (...data: HIDMsg[]) => Promise<void>,
        video: HTMLVideoElement,
        gid: number
    ) {
        this.disable = false;
        this.closed = false;
        this.SendFunc = async (...data: HIDMsg[]) =>
            !this.disable ? await Sendfunc(...data) : null;
        this.video = video;
        this.gid = gid;

        this.prev_buttons = new Map<number, boolean>();
        this.prev_sliders = new Map<number, number>();
        this.prev_axis = new Map<number, number>();

        this.scancode = false;
        this.last_interact = Thinkmay.NowInSec();

        this.pressing_mbuttons = [];
        this.intervals = [];
        this.pressing_keys = [];

        this.disableKeyWhileFullscreen();

        /**
         * video event
         */
        this.video.addEventListener('mousedown', this.onmousedown);
        this.video.addEventListener('mouseup', this.onmouseup);
        this.video.addEventListener('mousedown', this.onmousedown2);
        this.video.addEventListener('mouseup', this.onmouseup2);
        this.video.addEventListener('mousemove', this.onmousemove);

        /**
         * document event
         */
        document.addEventListener('wheel', this.onwheel);
        document.addEventListener('mousemove', this.onmousemove2);
        document.addEventListener('keydown', this.onkeydown);
        document.addEventListener('keyup', this.onkeyup);

        /**
         * gamepad stuff
         */
        Array.from(Array(16).keys()).forEach((x) => {
            this.prev_buttons.set(x, false);
            this.prev_sliders.set(x, 0);
            this.prev_axis.set(x, 0);
        });

        this.runGamepad();
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
        this.video.removeEventListener('mousedown', this.onmousedown);
        this.video.removeEventListener('mouseup', this.onmouseup);
        this.video.removeEventListener('mousedown', this.onmousedown2);
        this.video.removeEventListener('mouseup', this.onmouseup2);
        this.video.removeEventListener('mousemove', this.onmousemove);
        document.removeEventListener('mousemove', this.onmousemove2);
        document.removeEventListener('wheel', this.onwheel);
        document.removeEventListener('keydown', this.onkeydown);
        document.removeEventListener('keyup', this.onkeyup);
    }

    public last_active = () => Thinkmay.SinceSec(this.last_interact);

    public async handleIncomingData(data: ArrayBuffer) {
        const buff = new Uint8Array(data);
        switch (buff[0]) {
            case EventCode.grum:
                const weakMagnitude = buff[2] / 255;
                const strongMagnitude = buff[3] / 255;
                const duration = 1000;

                if (
                    (strongMagnitude > 0 || weakMagnitude > 0) &&
                    navigator.getGamepads().length == 0
                )
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
                const str = new TextDecoder('utf-8').decode(data.slice(1));
                const ctrlNotFound = 'controller not found ';
                if (str.includes(ctrlNotFound))
                    this.SendFunc(
                        new HIDMsg(EventCode.gconn, {
                            gid: Number.parseInt(
                                str.replaceAll(ctrlNotFound, '')
                            )
                        })
                    );

                console.log(str);
                break;
            case EventCode.ping:
                break;
        }
    }

    private async runGamepad() {
        const timestampMap = {};
        while (!this.closed) {
            const gamepads = navigator.getGamepads().filter((x) => x != null);
            try {
                const msg: HIDMsg[] = [];
                for (
                    let gamepad_id = 0;
                    gamepad_id < gamepads.length;
                    gamepad_id++
                ) {
                    const { buttons, axes, timestamp, index } =
                        gamepads[gamepad_id];
                    const gid = this.gid;

                    if (timestampMap[index] == timestamp) continue;
                    timestampMap[index] = timestamp;

                    for (let index = 0; index < buttons.length; index++) {
                        const { pressed, value } = buttons[index];
                        if (index == 6 || index == 7)
                            msg.push(
                                new HIDMsg(EventCode.gs, {
                                    gid: gid,
                                    index: index,
                                    val: value
                                })
                            );
                        else
                            msg.push(
                                new HIDMsg(EventCode.gb, {
                                    gid: gid,
                                    index: index,
                                    val: pressed ? 1 : 0
                                })
                            );
                    }

                    for (let index = 0; index < axes.length; index++)
                        msg.push(
                            new HIDMsg(EventCode.ga, {
                                gid: gid,
                                index: index,
                                val: axes[index]
                            })
                        );
                }

                if (msg.length > 0) await this.SendFunc(...msg);
            } catch {}
            await new Promise((r) =>
                setTimeout(r, gamepads.length > 0 ? 10 : 1000)
            );
        }
    }

    public async ResetKeyStuck() {
        for (const val of this.pressing_mbuttons)
            await this.MouseButtonUp({ button: val });
        for (const val of this.pressing_keys) await this.keyupInternal(val);
        this.SendFunc(new HIDMsg(EventCode.kr, {}));
    }

    private async keydown(event: KeyboardEvent) {
        event.preventDefault();
        const key = convertJSKey(event.key, event.location);
        if (key == undefined) return;
        let code = EventCode.kd;
        if (this.scancode) code += 2;
        await this.SendFunc(new HIDMsg(code, { key }));
        if (!this.pressing_keys.includes(key)) this.pressing_keys.push(key);
        this.last_interact = Thinkmay.NowInSec();
    }
    private async keyup(event: KeyboardEvent) {
        event.preventDefault();
        const key = convertJSKey(event.key, event.location);
        if (key == undefined) return;
        await this.keyupInternal(key);
    }
    private async keyupInternal(key: number) {
        let code = EventCode.ku;
        if (this.scancode) code += 2;
        await this.SendFunc(new HIDMsg(code, { key }));
        this.pressing_keys = this.pressing_keys.filter((x) => x != key);
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
        await this.SendFunc(
            this.relativeMouse
                ? new HIDMsg(EventCode.mmr, {
                      dX: event.movementX * MOUSE_SPEED,
                      dY: event.movementY * MOUSE_SPEED
                  })
                : new HIDMsg(EventCode.mma, {
                      dX: this.clientToServerX(event.clientX),
                      dY: this.clientToServerY(event.clientY)
                  })
        );
        this.last_interact = Thinkmay.NowInSec();
    }

    public async MouseButtonDown({ button }: { button: number }) {
        return this.SendFunc(
            new HIDMsg(EventCode.md, {
                button: button
            })
        );
    }
    public async MouseButtonUp({ button }: { button: number }) {
        return this.SendFunc(
            new HIDMsg(EventCode.mu, {
                button: button
            })
        );
    }

    private clientToServerY(clientY: number): number {
        const value = clientY / document.documentElement.clientHeight;
        return value > 0 ? (value < 1 ? value : 0.999) : 0.001;
    }

    private clientToServerX(clientX: number): number {
        const value = clientX / document.documentElement.clientWidth;
        return value > 0 ? (value < 1 ? value : 0.999) : 0.001;
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
