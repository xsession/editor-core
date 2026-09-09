const ROUTE = 'editor-core:route';
const RESULT = 'editor-core:route-result';
const ERROR = 'editor-core:route-error';
const CANCEL = 'editor-core:route-cancel';

function serializeError(error) {
    return {
        name: error?.name ?? 'Error',
        message: error?.message ?? String(error),
        stack: error?.stack,
    };
}

function deserializeError(value) {
    const error = new Error(value?.message ?? 'Worker routing failed.');
    error.name = value?.name ?? 'Error';
    if (value?.stack)
        error.stack = value.stack;
    return error;
}

/**
 * Revision-aware routing client for a browser Worker or worker_threads-like
 * transport. Payloads remain backend-neutral and structured-cloneable.
 */
export class RoutingWorkerClient {
    worker;
    pending = new Map();
    latestByKey = new Map();
    sequence = 0;

    constructor(worker) {
        if (!worker || typeof worker.postMessage !== 'function')
            throw new Error('RoutingWorkerClient requires a Worker-like object.');
        this.worker = worker;
        const listener = (event) => this.handleMessage(event?.data ?? event);
        if (typeof worker.addEventListener === 'function')
            worker.addEventListener('message', listener);
        else if (typeof worker.on === 'function')
            worker.on('message', listener);
        else
            worker.onmessage = listener;
        this.listener = listener;
    }

    route(payload, options = {}) {
        const id = `route-${++this.sequence}`;
        const key = options.key ?? payload?.wireId ?? id;
        const revision = options.revision ?? payload?.revision ?? 0;
        const previousId = this.latestByKey.get(key);
        if (previousId)
            this.cancel(previousId, 'superseded');
        this.latestByKey.set(key, id);

        return new Promise((resolve, reject) => {
            const entry = { id, key, revision, resolve, reject, signal: options.signal };
            this.pending.set(id, entry);
            if (options.signal) {
                const abort = () => this.cancel(id, 'aborted');
                entry.abort = abort;
                if (options.signal.aborted) {
                    this.cancel(id, 'aborted');
                    return;
                }
                options.signal.addEventListener?.('abort', abort, { once: true });
            }
            this.worker.postMessage({ type: ROUTE, id, key, revision, payload });
        });
    }

    handleMessage(message) {
        if (!message || (message.type !== RESULT && message.type !== ERROR))
            return false;
        const entry = this.pending.get(message.id);
        if (!entry)
            return false;
        this.pending.delete(message.id);
        entry.signal?.removeEventListener?.('abort', entry.abort);
        if (this.latestByKey.get(entry.key) === message.id)
            this.latestByKey.delete(entry.key);
        if (message.type === ERROR) {
            entry.reject(deserializeError(message.error));
            return true;
        }
        const stale = message.revision !== entry.revision ||
            (this.latestByKey.has(entry.key) && this.latestByKey.get(entry.key) !== message.id);
        entry.resolve({
            stale,
            id: message.id,
            key: entry.key,
            revision: message.revision,
            result: message.result,
        });
        return true;
    }

    cancel(id, reason = 'cancelled') {
        const entry = this.pending.get(id);
        if (!entry)
            return false;
        this.pending.delete(id);
        entry.signal?.removeEventListener?.('abort', entry.abort);
        if (this.latestByKey.get(entry.key) === id)
            this.latestByKey.delete(entry.key);
        this.worker.postMessage({ type: CANCEL, id, reason });
        const error = new Error(`Routing request ${reason}.`);
        error.name = 'AbortError';
        entry.reject(error);
        return true;
    }

    cancelKey(key, reason = 'cancelled') {
        const id = this.latestByKey.get(key);
        return id ? this.cancel(id, reason) : false;
    }

    cancelAll(reason = 'cancelled') {
        for (const id of [...this.pending.keys()])
            this.cancel(id, reason);
    }

    destroy() {
        this.cancelAll('worker-client-destroyed');
        if (typeof this.worker.removeEventListener === 'function')
            this.worker.removeEventListener('message', this.listener);
        else if (typeof this.worker.off === 'function')
            this.worker.off('message', this.listener);
    }

    get pendingCount() {
        return this.pending.size;
    }
}

/**
 * Installs the matching protocol in a Worker global scope. `router` may call
 * the built-in router, ELK, libavoid/WASM, or any asynchronous backend.
 */
export function installRoutingWorkerHandler(scope, router) {
    if (!scope || typeof scope.postMessage !== 'function')
        throw new Error('installRoutingWorkerHandler requires a worker-like global scope.');
    if (typeof router !== 'function')
        throw new Error('installRoutingWorkerHandler requires router(payload, metadata).');
    const cancelled = new Set();
    const handler = async (event) => {
        const message = event?.data ?? event;
        if (!message)
            return;
        if (message.type === CANCEL) {
            cancelled.add(message.id);
            return;
        }
        if (message.type !== ROUTE)
            return;
        try {
            const result = await router(message.payload, {
                id: message.id,
                key: message.key,
                revision: message.revision,
                isCancelled: () => cancelled.has(message.id),
            });
            if (cancelled.delete(message.id))
                return;
            scope.postMessage({ type: RESULT, id: message.id, key: message.key, revision: message.revision, result });
        }
        catch (error) {
            if (cancelled.delete(message.id))
                return;
            scope.postMessage({ type: ERROR, id: message.id, key: message.key, revision: message.revision, error: serializeError(error) });
        }
    };
    if (typeof scope.addEventListener === 'function')
        scope.addEventListener('message', handler);
    else if (typeof scope.on === 'function')
        scope.on('message', handler);
    else
        scope.onmessage = handler;
    return () => {
        if (typeof scope.removeEventListener === 'function')
            scope.removeEventListener('message', handler);
        else if (typeof scope.off === 'function')
            scope.off('message', handler);
    };
}

/** Simple round-robin pool for independent routing jobs. */
export class RoutingWorkerPool {
    clients;
    cursor = 0;

    constructor(workers) {
        if (!workers?.length)
            throw new Error('RoutingWorkerPool requires at least one worker.');
        this.clients = workers.map((worker) => worker instanceof RoutingWorkerClient ? worker : new RoutingWorkerClient(worker));
    }

    route(payload, options = {}) {
        const client = this.clients[this.cursor++ % this.clients.length];
        return client.route(payload, options);
    }

    cancelKey(key, reason) {
        let cancelled = false;
        for (const client of this.clients)
            cancelled = client.cancelKey(key, reason) || cancelled;
        return cancelled;
    }

    destroy() {
        for (const client of this.clients)
            client.destroy();
    }

    get pendingCount() {
        return this.clients.reduce((sum, client) => sum + client.pendingCount, 0);
    }
}

export const ROUTING_WORKER_PROTOCOL = Object.freeze({ ROUTE, RESULT, ERROR, CANCEL });
