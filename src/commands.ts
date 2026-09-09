export function deepClone<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

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

export class CommandHistory<T> {
  private readonly undoStack: HistoryEntry<T>[] = [];
  private readonly redoStack: HistoryEntry<T>[] = [];

  public constructor(public readonly limit = 200) {}

  public get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }

  public get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  public execute(
    label: string,
    current: T,
    mutate: (draft: T) => void,
    options: { mergeKey?: string; timestamp?: number } = {},
  ): HistoryState<T> {
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
    const entry: HistoryEntry<T> = { label, before, after: deepClone(after), timestamp, mergeKey: options.mergeKey };
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    return { state: after, entry };
  }

  public record(label: string, before: T, after: T, options: { mergeKey?: string; timestamp?: number } = {}): HistoryEntry<T> {
    const entry: HistoryEntry<T> = {
      label,
      before: deepClone(before),
      after: deepClone(after),
      timestamp: options.timestamp ?? Date.now(),
      mergeKey: options.mergeKey,
    };
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    return entry;
  }

  public undo(current: T): HistoryState<T> {
    const entry = this.undoStack.pop();
    if (!entry) return { state: current };
    this.redoStack.push(entry);
    return { state: deepClone(entry.before), entry };
  }

  public redo(current: T): HistoryState<T> {
    const entry = this.redoStack.pop();
    if (!entry) return { state: current };
    this.undoStack.push(entry);
    return { state: deepClone(entry.after), entry };
  }

  public clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
