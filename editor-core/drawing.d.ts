import type { EditorTheme } from './types.js';
export type DrawingElementKind = 'dimension' | 'leader-note' | 'title-block' | 'bom-table' | 'wire-schedule';
export interface DrawingElement {
    id: string;
    kind: DrawingElementKind;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    locked?: boolean;
    content?: {
        title?: string;
        text?: string;
        value?: string;
        columns?: string[];
        rows?: Array<Array<string | number>>;
        leaderX?: number;
        leaderY?: number;
        [key: string]: unknown;
    };
    style?: {
        stroke?: string;
        fill?: string;
        text?: string;
        fontSize?: number;
        [key: string]: unknown;
    };
    query?: Record<string, unknown>;
}
export declare function renderDrawingElements(elements: readonly DrawingElement[] | undefined, theme: EditorTheme): string;
//# sourceMappingURL=drawing.d.ts.map