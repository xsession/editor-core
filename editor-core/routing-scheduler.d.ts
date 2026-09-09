export declare class RouteResultCache<T = unknown> {
    readonly capacity: number;
    readonly entries: Map<string, T>;
    constructor(capacity?: number);
    get(key: string): T | undefined;
    set(key: string, value: T): T;
    delete(key: string): boolean;
    clear(): void;
    readonly size: number;
}

export interface RoutingTask<TRequest = unknown> {
    key: string;
    request: TRequest;
    revision?: number;
    environmentRevision?: number;
    priority?: number;
    route?: (request: TRequest, task: RoutingTask<TRequest>) => unknown | Promise<unknown>;
    cache?: RouteResultCache<unknown>;
    cacheKey?: (task: RoutingTask<TRequest>) => string;
    cacheKeyValue?: string;
    onResult?: (result: unknown) => void;
    onError?: (result: unknown) => void;
}
export declare class RoutingTaskScheduler {
    readonly options: Record<string, unknown>;
    readonly latestByKey: Map<string, RoutingTask>;
    readonly metrics: {
        scheduled: number;
        executed: number;
        coalesced: number;
        stale: number;
        cacheHits: number;
        failures: number;
        lastDrainMs: number;
    };
    constructor(options?: { frameBudgetMs?: number; maxTasksPerDrain?: number; route?: Function; cache?: RouteResultCache; cacheKey?: Function });
    schedule(task: RoutingTask): number;
    cancel(key: string): boolean;
    clear(): void;
    drain(options?: { frameBudgetMs?: number; maxTasks?: number }): Promise<{ results: unknown[]; pending: number; queueEntries: number; elapsedMs: number }>;
    readonly pending: number;
}
export declare function routeCacheKey(task: RoutingTask): string;
