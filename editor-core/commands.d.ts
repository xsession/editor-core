export declare function deepClone<T>(value: T): T;
export interface HistoryEntry<T> {
    label: string;
    before: T;
    after: T;
    timestamp: number;
    mergeKey?: string;
}
export interface HistoryState<T> {
    state: T;
    entry?: HistoryEntry<T>;
}
export declare class CommandHistory<T> {
    readonly limit: number;
    private readonly undoStack;
    private readonly redoStack;
    constructor(limit?: number);
    get canUndo(): boolean;
    get canRedo(): boolean;
    get undoLabel(): string | undefined;
    get redoLabel(): string | undefined;
    execute(label: string, current: T, mutate: (draft: T) => void, options?: {
        mergeKey?: string;
        timestamp?: number;
    }): HistoryState<T>;
    record(label: string, before: T, after: T, options?: {
        mergeKey?: string;
        timestamp?: number;
    }): HistoryEntry<T>;
    undo(current: T): HistoryState<T>;
    redo(current: T): HistoryState<T>;
    clear(): void;
}
//# sourceMappingURL=commands.d.ts.map