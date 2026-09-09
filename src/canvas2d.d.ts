import type { EditorTheme } from './types.js';
import type { VisualRenderPlan, VisualRendererBackend } from './advanced-visual.js';

export interface Canvas2DRenderOptions {
    devicePixelRatio?: number;
    scale?: number;
    translateX?: number;
    translateY?: number;
    width?: number;
    height?: number;
    resizeToDisplaySize?: boolean;
    clear?: boolean;
    background?: string;
    theme?: Partial<EditorTheme>;
    showGrid?: boolean;
    gridSpacing?: number;
    gridMajorEvery?: number;
    minimumGridPixels?: number;
    cachePaths?: boolean;
    dirtyRegions?: import('./types.js').Rect[];
    maxPathCacheEntries?: number;
}
export declare class Canvas2DRenderer {
    readonly pathCache: Map<string, unknown>;
    lastRevision: number;
    metrics: {
        frames: number;
        components: number;
        wires: number;
        labels: number;
        lastFrameMs: number;
        pathCacheHits: number;
        pathCacheMisses: number;
        dirtyRegions: number;
    };
    clearCaches(): void;
    pathForWire(wire: any, maximumEntries?: number): Path2D | undefined;
    render(plan: VisualRenderPlan, target: CanvasRenderingContext2D | HTMLCanvasElement | OffscreenCanvas, options?: Canvas2DRenderOptions): typeof this.metrics;
}
export declare function createCanvas2DBackend(options?: Canvas2DRenderOptions): VisualRendererBackend & {
    renderer: Canvas2DRenderer;
};
