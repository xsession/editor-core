export interface PerformanceMetricSnapshot {
    count: number;
    average: number;
    min: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
}
export declare class EditorPerformanceMonitor {
    constructor(capacity?: number);
    begin(name: string): void;
    end(name: string): number | undefined;
    measure<T>(name: string, fn: () => T): T;
    measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T>;
    record(name: string, milliseconds: number): void;
    increment(name: string, amount?: number): void;
    snapshot(): { metrics: Record<string, PerformanceMetricSnapshot>; counters: Record<string, number> };
    budgetReport(frameBudgetMs?: number): { metrics: Record<string, PerformanceMetricSnapshot>; counters: Record<string, number>; frameBudgetMs: number; healthy60Fps?: boolean; p95HeadroomMs?: number };
    clear(): void;
}
export declare class FrameBudgetController {
    constructor(budgetMs?: number, reserveMs?: number);
    beginFrame(): void;
    elapsed(): number;
    remaining(): number;
    canRun(estimatedCostMs?: number): boolean;
}
