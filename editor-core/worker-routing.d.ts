export interface RoutingWorkerResult<T = unknown> {
    stale: boolean;
    id: string;
    key: string;
    revision: number;
    result: T;
}
export declare class RoutingWorkerClient {
    readonly worker: any;
    readonly pending: Map<string, unknown>;
    readonly latestByKey: Map<string, string>;
    constructor(worker: any);
    route<T = unknown>(payload: unknown, options?: { key?: string; revision?: number; signal?: AbortSignal }): Promise<RoutingWorkerResult<T>>;
    handleMessage(message: unknown): boolean;
    cancel(id: string, reason?: string): boolean;
    cancelKey(key: string, reason?: string): boolean;
    cancelAll(reason?: string): void;
    destroy(): void;
    readonly pendingCount: number;
}
export declare function installRoutingWorkerHandler(scope: any, router: (payload: unknown, metadata: { id: string; key: string; revision: number; isCancelled(): boolean }) => unknown | Promise<unknown>): () => void;
export declare class RoutingWorkerPool {
    readonly clients: RoutingWorkerClient[];
    constructor(workers: any[]);
    route<T = unknown>(payload: unknown, options?: { key?: string; revision?: number; signal?: AbortSignal }): Promise<RoutingWorkerResult<T>>;
    cancelKey(key: string, reason?: string): boolean;
    destroy(): void;
    readonly pendingCount: number;
}
export declare const ROUTING_WORKER_PROTOCOL: Readonly<{ ROUTE: string; RESULT: string; ERROR: string; CANCEL: string }>;
