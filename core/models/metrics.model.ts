export type Metric = {
    video: {
        status: 'close' | 'connecting' | 'connected';
        timestamp: Date;
        idrcount: {
            last: number;
            current: number;
        };
        packetloss: {
            last: number;
            current: number;
        };
        bitrate: {
            total: number;
            persecond: number;
        };
        frame: {
            totalframes: number;
            totalframedelay: number;
            totaldecodetime: number;

            persecond: number;
            decodetime: number;
            delay: number;
        };
    };
    data: {
        status: 'close' | 'connecting' | 'connected';
    };
    audio: {
        status: 'close' | 'connecting' | 'connected';

        sample: {
            received: number;
        };
    };
};

export const initialMetric: Metric = {
    data: {
        status: 'close' as 'close' | 'connecting' | 'connected'
    },
    audio: {
        status: 'close' as 'close' | 'connecting' | 'connected',

        sample: {
            received: 0
        }
    },
    video: {
        status: 'close' as 'close' | 'connecting' | 'connected',
        timestamp: new Date(),
        idrcount: {
            current: 0,
            last: 0
        },
        bitrate: {
            persecond: 0,
            total: 0
        },
        frame: {
            totaldecodetime: 0,
            totalframes: 0,
            totalframedelay: 0,
            persecond: 0,
            delay: 0,
            decodetime: 0
        },
        packetloss: {
            current: 0,
            last: 0
        }
    }
};
