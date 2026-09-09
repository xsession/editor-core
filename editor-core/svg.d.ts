import { type DrawingElement } from './drawing.js';
import type { SnapGuide } from './snapping.js';
import type { ComponentGeometry, EditorDocument, EditorTheme, LabelPlacement, Point, Rect, RenderOptions, SelectionState, WireEndpoint } from './types.js';
export declare const DEFAULT_EDITOR_THEME: EditorTheme;
export interface SvgConnectionPreview {
    source: WireEndpoint;
    target?: WireEndpoint;
    point: Point;
    valid: boolean;
    reason?: string;
}
export interface SvgInteractionOverlay {
    snapGuides?: readonly SnapGuide[];
    marquee?: {
        bounds: Rect;
        mode: 'window' | 'crossing';
    };
    connection?: SvgConnectionPreview;
    statusText?: string;
}
export interface SvgRenderContext {
    geometries: Record<string, ComponentGeometry>;
    labelPlacements: LabelPlacement[];
    selection?: SelectionState;
    theme?: EditorTheme;
    options?: Partial<RenderOptions>;
    overlay?: SvgInteractionOverlay;
    drawingElements?: readonly DrawingElement[];
}
export declare function renderEditorSvg(document: EditorDocument, context: SvgRenderContext): string;
export declare function renderSvgFragment(document: EditorDocument, context: SvgRenderContext): string;
export declare function contentBoundsFromSvgContext(document: EditorDocument, context: SvgRenderContext): Rect;
//# sourceMappingURL=svg.d.ts.map