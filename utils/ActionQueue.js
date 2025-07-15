class ActionQueue {
    constructor() {
        this.queue = [];
        this.running = false;
    }

    enqueue(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await fn();
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            });
            this.runNext();
        });
    }

    async runNext() {
        if (this.running || this.queue.length === 0) return;
        this.running = true;
        const task = this.queue.shift();
        await task();
        this.running = false;
        this.runNext();
    }
}

// Store queues per thread_ts
const threadQueues = new Map();

function getThreadQueue(threadTs) {
    if (!threadQueues.has(threadTs)) {
        threadQueues.set(threadTs, new ActionQueue());
    }
    return threadQueues.get(threadTs);
}

setInterval(() => {
    for (const [threadTs, queue] of threadQueues.entries()) {
        if (queue.queue.length === 0 && !queue.running) {
            threadQueues.delete(threadTs);
        }
    }
}, 5 * 60 * 1000); // Clear empty queues every 5 minutes

module.exports = {
    getThreadQueue,
    _threadQueues: threadQueues, // only use for testing
};