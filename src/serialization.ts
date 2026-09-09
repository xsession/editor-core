import { deepClone } from './commands.js';
import type { EditorDocument } from './types.js';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function serializeDocument(document: EditorDocument, pretty = true): string {
  return JSON.stringify(sortValue(document), null, pretty ? 2 : undefined);
}

export function parseDocument(serialized: string): EditorDocument {
  const parsed = JSON.parse(serialized) as Partial<EditorDocument>;
  if (parsed.schemaVersion !== 1) throw new Error(`Unsupported editor schema version: ${String(parsed.schemaVersion)}`);
  if (!parsed.id || typeof parsed.id !== 'string') throw new Error('Editor document is missing its id.');
  if (!parsed.settings || !parsed.components || !parsed.wires || !parsed.labels) throw new Error('Editor document is missing required collections.');
  return deepClone(parsed as EditorDocument);
}

export function cloneDocument(document: EditorDocument): EditorDocument {
  return deepClone(document);
}
