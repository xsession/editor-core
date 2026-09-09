import type { Rect } from './types.js';
import type { VisualRenderPlan } from './advanced-visual.js';

export interface DirtyRegionOptions {
    mergeGap?: number;
    maxRegions?: number;
    collapseAreaRatio?: number;
    padding?: number;
    fullRedrawAreaRatio?: number;
    ownerHints?: { components?: Iterable<string>; wires?: Iterable<string>; labels?: Iterable<string> };
}
export declare class DirtyRegionTracker {
    regions: Rect[];
    constructor(options?: DirtyRegionOptions);
    add(rect: Rect): this;
    addMany(rects: Iterable<Rect>): this;
    collapse(): this;
    optimize(viewport?: Rect): this;
    clear(): void;
    snapshot(): Rect[];
    readonly bounds?: Rect;
}
export interface RenderPlanDiff {
    fullRedraw: boolean;
    changedOwners: Set<string>;
    dirtyRegions: Rect[];
    reason: string;
}
export declare class RenderPlanDiffer {
    diff(previous: VisualRenderPlan | undefined, next: VisualRenderPlan, options?: DirtyRegionOptions): RenderPlanDiff;
}
export declare class RetainedRenderState {
    plan?: VisualRenderPlan;
    readonly differ: RenderPlanDiffer;
    constructor(options?: DirtyRegionOptions);
    update(nextPlan: VisualRenderPlan, options?: DirtyRegionOptions): RenderPlanDiff;
    reset(): void;
}
