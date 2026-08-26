export function deepClone(value) {
    if (typeof globalThis.structuredClone === 'function')
        return globalThis.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}
export class CommandHistory {
    limit;
    undoStack = [];
    redoStack = [];
    constructor(limit = 200) {
        this.limit = limit;
    }
    get canUndo() {
        return this.undoStack.length > 0;
    }
    get canRedo() {
        return this.redoStack.length > 0;
    }
    get undoLabel() {
        return this.undoStack[this.undoStack.length - 1]?.label;
    }
    get redoLabel() {
        return this.redoStack[this.redoStack.length - 1]?.label;
    }
    execute(label, current, mutate, options = {}) {
        const before = deepClone(current);
        const after = deepClone(current);
        mutate(after);
        const timestamp = options.timestamp ?? Date.now();
        const previous = this.undoStack[this.undoStack.length - 1];
        if (options.mergeKey && previous?.mergeKey === options.mergeKey && timestamp - previous.timestamp < 750) {
            previous.after = deepClone(after);
            previous.timestamp = timestamp;
            previous.label = label;
            this.redoStack.length = 0;
            return { state: after, entry: previous };
        }
        const entry = { label, before, after: deepClone(after), timestamp, mergeKey: options.mergeKey };
        this.undoStack.push(entry);
        if (this.undoStack.length > this.limit)
            this.undoStack.shift();
        this.redoStack.length = 0;
        return { state: after, entry };
    }
    record(label, before, after, options = {}) {
        const entry = {
            label,
            before: deepClone(before),
            after: deepClone(after),
            timestamp: options.timestamp ?? Date.now(),
            mergeKey: options.mergeKey,
        };
        this.undoStack.push(entry);
        if (this.undoStack.length > this.limit)
            this.undoStack.shift();
        this.redoStack.length = 0;
        return entry;
    }
    undo(current) {
        const entry = this.undoStack.pop();
        if (!entry)
            return { state: current };
        this.redoStack.push(entry);
        return { state: deepClone(entry.before), entry };
    }
    redo(current) {
        const entry = this.redoStack.pop();
        if (!entry)
            return { state: current };
        this.undoStack.push(entry);
        return { state: deepClone(entry.after), entry };
    }
    clear() {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }
}
//# sourceMappingURL=commands.js.map