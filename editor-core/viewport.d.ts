import type { Point, Rect, ViewportState } from './types.js';
export interface ViewportLimits {
    minimumZoom: number;
    maximumZoom: number;
    overscroll?: number;
}
export declare const DEFAULT_VIEWPORT_LIMITS: ViewportLimits;
export declare function worldToScreen(point: Point, viewport: ViewportState): Point;
export declare function screenToWorld(point: Point, viewport: ViewportState): Point;
export declare function panViewport(viewport: ViewportState, screenDelta: Point): ViewportState;
/** Zooms around a screen-space focal point without moving the world point under the pointer. */
export declare function zoomViewportAt(viewport: ViewportState, screenPoint: Point, factor: number, limits?: ViewportLimits): ViewportState;
export declare function viewportWorldRect(viewport: ViewportState): Rect;
export interface FitViewportOptions {
    paddingPx?: number;
    minimumZoom?: number;
    maximumZoom?: number;
}
export declare function fitViewportToBounds(bounds: Rect, screenSize: {
    width: number;
    height: number;
}, options?: FitViewportOptions): ViewportState;
export declare class ViewportController {
    private readonly limits;
    private stateValue;
    constructor(initial: ViewportState, limits?: ViewportLimits);
    get state(): Readonly<ViewportState>;
    resize(width: number, height: number): ViewportState;
    pan(screenDelta: Point): ViewportState;
    zoomAt(screenPoint: Point, factor: number): ViewportState;
    fit(bounds: Rect, paddingPx?: number): ViewportState;
    worldToScreen(point: Point): Point;
    screenToWorld(point: Point): Point;
    private snapshot;
}
//# sourceMappingURL=viewport.d.ts.map