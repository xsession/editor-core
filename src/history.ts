import { cloneDocument } from './document.js';
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

export class FunctionalCommand implements DocumentCommand {
  public constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly operation: (document: EditorDocument) => CommandResult,
    public readonly mergeKey?: string,
  ) {}

  public execute(document: EditorDocument): CommandResult {
    return this.operation(document);
  }
}

interface HistoryEntry {
  id: string;
  label: string;
  before: EditorDocument;
  after: EditorDocument;
  impact?: MutationImpact;
  mergeKey?: string;
  timestamp: number;
}

interface Transaction {
  id: string;
  label: string;
  before: EditorDocument;
  latest: EditorDocument;
  impacts: MutationImpact[];
  commands: string[];
}

function mergeImpacts(impacts: MutationImpact[]): MutationImpact | undefined {
  if (impacts.length === 0) return undefined;
  const unique = (values: string[]) => [...new Set(values)];
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
  private undoEntries: HistoryEntry[] = [];
  private redoEntries: HistoryEntry[] = [];
  private transaction?: Transaction;

  public constructor(
    private document: EditorDocument,
    private readonly maximumEntries = 250,
    private readonly mergeWindowMs = 350,
  ) {
    this.document = cloneDocument(document);
  }

  public current(): EditorDocument {
    return this.document;
  }

  public replace(document: EditorDocument, clearHistory = true): void {
    this.document = cloneDocument(document);
    if (clearHistory) {
      this.undoEntries = [];
      this.redoEntries = [];
      this.transaction = undefined;
    }
  }

  public execute(command: DocumentCommand, timestamp = Date.now()): CommandResult {
    const before = cloneDocument(this.document);
    const result = command.execute(cloneDocument(this.document));
    this.document = cloneDocument(result.document);
    if (this.transaction) {
      this.transaction.latest = cloneDocument(this.document);
      this.transaction.commands.push(command.label);
      if (result.impact) this.transaction.impacts.push(result.impact);
      return { document: this.document, impact: result.impact };
    }

    const previous = this.undoEntries[this.undoEntries.length - 1];
    const canMerge = Boolean(
      command.mergeKey &&
      previous?.mergeKey === command.mergeKey &&
      timestamp - previous.timestamp <= this.mergeWindowMs,
    );
    if (canMerge && previous) {
      previous.after = cloneDocument(this.document);
      previous.label = command.label;
      previous.timestamp = timestamp;
      previous.impact = mergeImpacts([previous.impact, result.impact].filter(Boolean) as MutationImpact[]);
    } else {
      this.undoEntries.push({
        id: command.id,
        label: command.label,
        before,
        after: cloneDocument(this.document),
        impact: result.impact,
        mergeKey: command.mergeKey,
        timestamp,
      });
      if (this.undoEntries.length > this.maximumEntries) this.undoEntries.shift();
    }
    this.redoEntries = [];
    return { document: this.document, impact: result.impact };
  }

  public beginTransaction(id: string, label: string): void {
    if (this.transaction) throw new Error('A command transaction is already active.');
    this.transaction = {
      id,
      label,
      before: cloneDocument(this.document),
      latest: cloneDocument(this.document),
      impacts: [],
      commands: [],
    };
  }

  public commitTransaction(timestamp = Date.now()): CommandResult {
    const transaction = this.transaction;
    if (!transaction) throw new Error('No command transaction is active.');
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
      if (this.undoEntries.length > this.maximumEntries) this.undoEntries.shift();
      this.redoEntries = [];
    }
    return { document: this.document, impact };
  }

  public rollbackTransaction(): EditorDocument {
    if (!this.transaction) throw new Error('No command transaction is active.');
    this.document = cloneDocument(this.transaction.before);
    this.transaction = undefined;
    return this.document;
  }

  public undo(): CommandResult | undefined {
    if (this.transaction) throw new Error('Cannot undo during an active transaction.');
    const entry = this.undoEntries.pop();
    if (!entry) return undefined;
    this.redoEntries.push(entry);
    this.document = cloneDocument(entry.before);
    return { document: this.document, impact: entry.impact };
  }

  public redo(): CommandResult | undefined {
    if (this.transaction) throw new Error('Cannot redo during an active transaction.');
    const entry = this.redoEntries.pop();
    if (!entry) return undefined;
    this.undoEntries.push(entry);
    this.document = cloneDocument(entry.after);
    return { document: this.document, impact: entry.impact };
  }

  public canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  public canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  public undoLabel(): string | undefined {
    return this.undoEntries[this.undoEntries.length - 1]?.label;
  }

  public redoLabel(): string | undefined {
    return this.redoEntries[this.redoEntries.length - 1]?.label;
  }

  public activeTransaction(): { id: string; label: string; commandCount: number } | undefined {
    return this.transaction
      ? { id: this.transaction.id, label: this.transaction.label, commandCount: this.transaction.commands.length }
      : undefined;
  }
}
