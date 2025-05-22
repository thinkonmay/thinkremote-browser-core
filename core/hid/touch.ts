import { TouchData } from '../models/hid.model';
import { EventCode, HIDMsg } from '../models/keys.model';

const RADIUS = 50;
const BOTTOM_THRESHOLD_PERCENT = 100;
const MOUSE_SPEED = 3.5;

enum Event {
    short_left,
    short_right
}
export class TouchHandler {
    private onGoingTouchs: Map<number, TouchData>;

    private last_interact: Date;
    public last_active(): number {
        return (new Date().getTime() - this.last_interact.getTime()) / 1000;
    }

    private running: any;
    private SendFunc: (...data: HIDMsg[]) => Promise<void>;
    private video: HTMLVideoElement;
    constructor(
        video: HTMLVideoElement,
        Sendfunc: (...data: HIDMsg[]) => Promise<void>
    ) {
        this.onGoingTouchs = new Map<number, TouchData>();
        this.SendFunc = Sendfunc;

        this.video = video;
        this.last_interact = new Date();

        this.video.ontouchend = this.handleEnd.bind(this);
        this.video.ontouchstart = this.handleStart.bind(this);
        this.video.ontouchmove = this.handleMove.bind(this);
    }

    public Close() {
        this.video.ontouchstart = null;
        this.video.ontouchend = null;
        this.video.ontouchmove = null;
        clearInterval(this.running);
    }

    private async ListenEvents(events: Event) {
        switch (events) {
            case Event.short_right:
                await this.SendFunc(
                    new HIDMsg(EventCode.md, {
                        button: 2
                    }),
                    new HIDMsg(EventCode.mu, {
                        button: 2
                    })
                );
                break;
            case Event.short_left:
                await this.SendFunc(
                    new HIDMsg(EventCode.md, {
                        button: 0
                    }),
                    new HIDMsg(EventCode.mu, {
                        button: 0
                    })
                );
                break;
            default:
                break;
        }
    }

    private handleStart = (evt: TouchEvent) => {
        evt.preventDefault();
        this.last_interact = new Date();

        const touches = evt.changedTouches;
        for (let i = 0; i < touches.length; i++)
            this.onGoingTouchs.set(
                touches[i].identifier,
                new TouchData(touches[i])
            );
    };
    private handleEnd = async (evt: TouchEvent) => {
        evt.preventDefault();
        const touches = evt.changedTouches;

        for (let i = 0; i < touches.length; i++) {
            const key = touches[i].identifier;
            const touch = this.onGoingTouchs.get(key);

            const validtouch = () => {
                return (
                    Math.sqrt(
                        (touch.clientX - touch.touchStart.clientX) ** 2 +
                            (touch.clientY - touch.touchStart.clientY) ** 2
                    ) < 10
                );
            };

            if (touch == undefined) continue;
            if (validtouch())
                await this.ListenEvents(
                    this.isTouchRight(touch)
                        ? Event.short_right
                        : Event.short_left
                );

            this.onGoingTouchs.delete(key);
        }
    };

    private handleMove = async (evt: TouchEvent) => {
        evt.preventDefault();
        const touches = evt.touches;

        for (let i = 0; i < touches.length; i++) {
            const curr_touch = touches[i];
            const prev_touch = this.onGoingTouchs.get(curr_touch.identifier);

            if (prev_touch == undefined) continue;
            await this.SendFunc(
                new HIDMsg(EventCode.mmr, {
                    dX:
                        MOUSE_SPEED *
                        Math.round(curr_touch.clientX - prev_touch.clientX),
                    dY:
                        MOUSE_SPEED *
                        Math.round(curr_touch.clientY - prev_touch.clientY)
                })
            );

            prev_touch.copyFromTouch(curr_touch);
        }
    };

    private isTouchRight(touch: Touch): boolean {
        return touch.clientX >= document.documentElement.clientWidth / 2;
    }
}
