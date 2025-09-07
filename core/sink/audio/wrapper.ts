import { Log, LogLevel } from '../../utils/log';

export class AudioWrapper {
    private audio: HTMLAudioElement;
    public url: string;

    constructor(vid: HTMLAudioElement, url?: string) {
        this.audio = vid;
        this.url = url;
    }

    // Play audio function
    async play() {
        this.audio.play().catch((e) => {
            Log(LogLevel.Error, `error playing audio ${e.message}`);
            setTimeout(() => this.play(), 1000);
        });
    }

    async assign(provider: MediaProvider) {
        this.audio.srcObject = null;
        this.audio.srcObject = provider;
    }

    internal(): HTMLAudioElement {
        return this.audio;
    }
}
