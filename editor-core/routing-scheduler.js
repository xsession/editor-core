function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

class MaxPriorityQueue {
    heap = [];

    push(value) {
        this.heap.push(value);
        let index = this.heap.length - 1;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            const parentValue = this.heap[parent];
            if (parentValue.priority > value.priority ||
                (parentValue.priority === value.priority && parentValue.sequence < value.sequence))
                break;
            this.heap[index] = parentValue;
            index = parent;
        }
        this.heap[index] = value;
    }

    pop() {
        if (this.heap.length === 0)
            return undefined;
        const first = this.heap[0];
        const last = this.heap.pop();
        if (this.heap.length === 0)
            return first;
        let index = 0;
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            if (left >= this.heap.length)
                break;
            let child = left;
            if (right < this.heap.length) {
                const l = this.heap[left];
                const r = this.heap[right];
                if (r.priority > l.priority || (r.priority === l.priority && r.sequence < l.sequence))
                    child = right;
            }
            const childValue = this.heap[child];
            if (childValue.priority < last.priority ||
                (childValue.priority === last.priority && childValue.sequence > last.sequence))
                break;
            this.heap[index] = childValue;
            index = child;
        }
        this.heap[index] = last;
        return first;
    }

    get size() {
        return this.heap.length;
    }
}

/** Small LRU used for deterministic routing requests and expensive layout jobs. */
export class RouteResultCache {
    capacity;
    entries = new Map();

    constructor(capacity = 2048) {
        this.capacity = Math.max(1, capacity);
    }

    get(key) {
        const value = this.entries.get(key);
        if (value === undefined)
            return undefined;
        this.entries.delete(key);
        this.entries.set(key, value);
        return value;
    }

    set(key, value) {
        if (this.entries.has(key))
            this.entries.delete(key);
        this.entries.set(key, value);
        while (this.entries.size > this.capacity)
            this.entries.delete(this.entries.keys().next().value);
        return value;
    }

    delete(key) {
        return this.entries.delete(key);
    }

    clear() {
        this.entries.clear();
    }

    get size() {
        return this.entries.size;
    }
}

/**
 * Cooperative, priority-aware routing queue. Tasks for the same key coalesce:
 * a later gesture replaces queued stale work before it consumes route time.
 */
export class RoutingTaskScheduler {
    queue = new MaxPriorityQueue();
    latestByKey = new Map();
    sequence = 0;
    metrics = {
        scheduled: 0,
        executed: 0,
        coalesced: 0,
        stale: 0,
        cacheHits: 0,
        failures: 0,
        lastDrainMs: 0,
    };

    constructor(options = {}) {
        this.options = {
            frameBudgetMs: options.frameBudgetMs ?? 6,
            maxTasksPerDrain: options.maxTasksPerDrain ?? 32,
            route: options.route,
            cache: options.cache,
            cacheKey: options.cacheKey,
        };
    }

    schedule(task) {
        if (!task?.key)
            throw new Error('RoutingTaskScheduler task requires a stable key.');
        const sequence = ++this.sequence;
        const previous = this.latestByKey.get(task.key);
        if (previous)
            this.metrics.coalesced += 1;
        const queued = {
            ...task,
            priority: task.priority ?? 0,
            sequence,
        };
        this.latestByKey.set(task.key, queued);
        this.queue.push(queued);
        this.metrics.scheduled += 1;
        return sequence;
    }

    cancel(key) {
        return this.latestByKey.delete(key);
    }

    clear() {
        this.latestByKey.clear();
        this.queue = new MaxPriorityQueue();
    }

    async execute(task) {
        const route = task.route ?? this.options.route;
        if (typeof route !== 'function')
            throw new Error('RoutingTaskScheduler requires task.route or options.route.');
        const cache = task.cache ?? this.options.cache;
        const keyFactory = task.cacheKey ?? this.options.cacheKey;
        const cacheKey = typeof keyFactory === 'function' ? keyFactory(task) : task.cacheKeyValue;
        if (cache && cacheKey !== undefined) {
            const cached = cache.get(cacheKey);
            if (cached !== undefined) {
                this.metrics.cacheHits += 1;
                return cached;
            }
        }
        const result = await route(task.request, task);
        if (cache && cacheKey !== undefined)
            cache.set(cacheKey, result);
        return result;
    }

    async drain(options = {}) {
        const started = now();
        const budget = options.frameBudgetMs ?? this.options.frameBudgetMs;
        const maxTasks = options.maxTasks ?? this.options.maxTasksPerDrain;
        const results = [];
        let attempted = 0;
        while (this.queue.size > 0 && attempted < maxTasks && now() - started < budget) {
            const task = this.queue.pop();
            attempted += 1;
            const latest = this.latestByKey.get(task.key);
            if (!latest || latest.sequence !== task.sequence) {
                this.metrics.stale += 1;
                continue;
            }
            this.latestByKey.delete(task.key);
            try {
                const result = await this.execute(task);
                this.metrics.executed += 1;
                const record = { key: task.key, sequence: task.sequence, revision: task.revision, result, stale: false };
                results.push(record);
                task.onResult?.(record);
            }
            catch (error) {
                this.metrics.failures += 1;
                const record = { key: task.key, sequence: task.sequence, revision: task.revision, error, stale: false };
                results.push(record);
                task.onError?.(record);
            }
        }
        this.metrics.lastDrainMs = now() - started;
        return {
            results,
            pending: this.latestByKey.size,
            queueEntries: this.queue.size,
            elapsedMs: this.metrics.lastDrainMs,
        };
    }

    get pending() {
        return this.latestByKey.size;
    }
}

/**
 * Stable cache key helper. Callers pass an obstacle/route-environment revision
 * rather than serializing every obstacle on every pointer move.
 */
export function routeCacheKey(task) {
    const request = task.request ?? {};
    const source = request.source ?? request.wire?.source;
    const target = request.target ?? request.wire?.target;
    const endpoint = (value) => {
        if (!value)
            return '-';
        if (value.kind === 'port')
            return `p:${value.componentId}:${value.portId}`;
        const point = value.point ?? value;
        return `${value.kind ?? 'xy'}:${Math.round((point.x ?? 0) * 1000)}:${Math.round((point.y ?? 0) * 1000)}`;
    };
    return [
        task.key,
        task.environmentRevision ?? task.revision ?? 0,
        endpoint(source),
        endpoint(target),
        request.pattern ?? request.wire?.routing?.pattern ?? 'orthogonal',
    ].join('|');
}
