import type { EditorDocument } from './types.js';
export declare function serializeDocument(document: EditorDocument, pretty?: boolean): string;
export declare function parseDocument(serialized: string): EditorDocument;
export declare function cloneDocument(document: EditorDocument): EditorDocument;
//# sourceMappingURL=serialization.d.ts.map