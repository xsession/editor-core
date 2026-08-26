import { cloneDocument } from './document.js';
export class FunctionalCommand {
    id;
    label;
    operation;
    mergeKey;
    constructor(id, label, operation, mergeKey) {
        this.id = id;
        this.label = label;
        this.operation = operation;
        this.mergeKey = mergeKey;
    }
    execute(document) {
        return this.operation(document);
    }
}
function mergeImpacts(impacts) {
    if (impacts.length === 0)
        return undefined;
    const unique = (values) => [...new Set(values)];
    return {
        changedComponents: unique(impacts.flatMap((impact) => impact.changedComponents)),
        changedPorts: unique(impacts.flatMap((impact) => impact.changedPorts)),
        reroutedWires: unique(impacts.flatMap((impact) => impact.reroutedWires)),
        invalidatedWires: unique(impacts.flatMap((impact) => impact.invalidatedWires)),
        detachedWires: unique(impacts.flatMap((impact) => impact.detachedWires)),
        movedLabels: unique(impacts.flatMap((impact) => impact.movedLabels)),
        overlappingLabels: unique(impacts.flatMap((impact) => impact.overlappingLabels)),
        warnings: unique(impacts.flatMap((impact) => impact.warnings)),
    };
}
/**
 * Snapshot-backed command manager. The document is plain JSON-compatible data,
 * so snapshot history is deterministic and safe. Production hosts can replace
 * this with structural sharing without changing the command interface.
 */
export class CommandHistory {
    document;
    maximumEntries;
    mergeWindowMs;
    undoEntries = [];
    redoEntries = [];
    transaction;
    constructor(document, maximumEntries = 250, mergeWindowMs = 350) {
        this.document = document;
        this.maximumEntries = maximumEntries;
        this.mergeWindowMs = mergeWindowMs;
        this.document = cloneDocument(document);
    }
    current() {
        return this.document;
    }
    replace(document, clearHistory = true) {
        this.document = cloneDocument(document);
        if (clearHistory) {
            this.undoEntries = [];
            this.redoEntries = [];
            this.transaction = undefined;
        }
    }
    execute(command, timestamp = Date.now()) {
        const before = cloneDocument(this.document);
        const result = command.execute(cloneDocument(this.document));
        this.document = cloneDocument(result.document);
        if (this.transaction) {
            this.transaction.latest = cloneDocument(this.document);
            this.transaction.commands.push(command.label);
            if (result.impact)
                this.transaction.impacts.push(result.impact);
            return { document: this.document, impact: result.impact };
        }
        const previous = this.undoEntries[this.undoEntries.length - 1];
        const canMerge = Boolean(command.mergeKey &&
            previous?.mergeKey === command.mergeKey &&
            timestamp - previous.timestamp <= this.mergeWindowMs);
        if (canMerge && previous) {
            previous.after = cloneDocument(this.document);
            previous.label = command.label;
            previous.timestamp = timestamp;
            previous.impact = mergeImpacts([previous.impact, result.impact].filter(Boolean));
        }
        else {
            this.undoEntries.push({
                id: command.id,
                label: command.label,
                before,
                after: cloneDocument(this.document),
                impact: result.impact,
                mergeKey: command.mergeKey,
                timestamp,
            });
            if (this.undoEntries.length > this.maximumEntries)
                this.undoEntries.shift();
        }
        this.redoEntries = [];
        return { document: this.document, impact: result.impact };
    }
    beginTransaction(id, label) {
        if (this.transaction)
            throw new Error('A command transaction is already active.');
        this.transaction = {
            id,
            label,
            before: cloneDocument(this.document),
            latest: cloneDocument(this.document),
            impacts: [],
            commands: [],
        };
    }
    commitTransaction(timestamp = Date.now()) {
        const transaction = this.transaction;
        if (!transaction)
            throw new Error('No command transaction is active.');
        this.transaction = undefined;
        const impact = mergeImpacts(transaction.impacts);
        if (JSON.stringify(transaction.before) !== JSON.stringify(transaction.latest)) {
            this.undoEntries.push({
                id: transaction.id,
                label: transaction.label,
                before: transaction.before,
                after: cloneDocument(transaction.latest),
                impact,
                timestamp,
            });
            if (this.undoEntries.length > this.maximumEntries)
                this.undoEntries.shift();
            this.redoEntries = [];
        }
        return { document: this.document, impact };
    }
    rollbackTransaction() {
        if (!this.transaction)
            throw new Error('No command transaction is active.');
        this.document = cloneDocument(this.transaction.before);
        this.transaction = undefined;
        return this.document;
    }
    undo() {
        if (this.transaction)
            throw new Error('Cannot undo during an active transaction.');
        const entry = this.undoEntries.pop();
        if (!entry)
            return undefined;
        this.redoEntries.push(entry);
        this.document = cloneDocument(entry.before);
        return { document: this.document, impact: entry.impact };
    }
    redo() {
        if (this.transaction)
            throw new Error('Cannot redo during an active transaction.');
        const entry = this.redoEntries.pop();
        if (!entry)
            return undefined;
        this.undoEntries.push(entry);
        this.document = cloneDocument(entry.after);
        return { document: this.document, impact: entry.impact };
    }
    canUndo() {
        return this.undoEntries.length > 0;
    }
    canRedo() {
        return this.redoEntries.length > 0;
    }
    undoLabel() {
        return this.undoEntries[this.undoEntries.length - 1]?.label;
    }
    redoLabel() {
        return this.redoEntries[this.redoEntries.length - 1]?.label;
    }
    activeTransaction() {
        return this.transaction
            ? { id: this.transaction.id, label: this.transaction.label, commandCount: this.transaction.commands.length }
            : undefined;
    }
}
//# sourceMappingURL=history.js.map