import type { EditorDocument, MutationImpact } from './types.js';
export interface CommandResult {
    document: EditorDocument;
    impact?: MutationImpact;
}
export interface DocumentCommand {
    id: string;
    label: string;
    mergeKey?: string;
    execute(document: EditorDocument): CommandResult;
}
export declare class FunctionalCommand implements DocumentCommand {
    readonly id: string;
    readonly label: string;
    private readonly operation;
    readonly mergeKey?: string | undefined;
    constructor(id: string, label: string, operation: (document: EditorDocument) => CommandResult, mergeKey?: string | undefined);
    execute(document: EditorDocument): CommandResult;
}
/**
 * Snapshot-backed command manager. The document is plain JSON-compatible data,
 * so snapshot history is deterministic and safe. Production hosts can replace
 * this with structural sharing without changing the command interface.
 */
export declare class CommandHistory {
    private document;
    private readonly maximumEntries;
    private readonly mergeWindowMs;
    private undoEntries;
    private redoEntries;
    private transaction?;
    constructor(document: EditorDocument, maximumEntries?: number, mergeWindowMs?: number);
    current(): EditorDocument;
    replace(document: EditorDocument, clearHistory?: boolean): void;
    execute(command: DocumentCommand, timestamp?: number): CommandResult;
    beginTransaction(id: string, label: string): void;
    commitTransaction(timestamp?: number): CommandResult;
    rollbackTransaction(): EditorDocument;
    undo(): CommandResult | undefined;
    redo(): CommandResult | undefined;
    canUndo(): boolean;
    canRedo(): boolean;
    undoLabel(): string | undefined;
    redoLabel(): string | undefined;
    activeTransaction(): {
        id: string;
        label: string;
        commandCount: number;
    } | undefined;
}
//# sourceMappingURL=history.d.ts.map