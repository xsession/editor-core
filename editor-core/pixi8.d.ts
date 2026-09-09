import type { VisualRenderPlan, VisualRendererBackend } from './advanced-visual.js';
export declare class Pixi8Renderer {
    readonly PIXI: any;
    readonly root: any;
    readonly wireLayer: any;
    readonly componentLayer: any;
    readonly labelLayer: any;
    readonly wires: Map<string, unknown>;
    readonly components: Map<string, unknown>;
    readonly labels: Map<string, unknown>;
    readonly metrics: { frames: number; created: number; updated: number; removed: number; visible: number };
    constructor(PIXI: any);
    mount(target: any): this;
    render(plan: VisualRenderPlan, target: any, options?: { scale?: number; theme?: any }): typeof this.metrics;
    destroy(): void;
}
export declare function createPixi8Backend(PIXI: any, options?: Record<string, unknown>): VisualRendererBackend & { renderer: Pixi8Renderer };
