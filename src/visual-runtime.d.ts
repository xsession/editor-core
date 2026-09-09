import type { EditorDocument, MutationImpact, Point, Rect, SelectionRef, WireEndpoint } from './types.js';
import type { VisualBackendRegistry, VisualRenderPlan, VisualRendererBackend } from './advanced-visual.js';
import type { IncrementalSceneRuntime } from './incremental-runtime.js';
import type { RetainedRenderState, RenderPlanDiff } from './render-runtime.js';
import type { EditorPerformanceMonitor } from './performance.js';

export declare class HighPerformanceVisualRuntime {
    readonly options: Record<string, any>;
    readonly sceneRuntime: IncrementalSceneRuntime;
    readonly retainedRender: RetainedRenderState;
    readonly backends: VisualBackendRegistry;
    readonly performance: EditorPerformanceMonitor;
    lastPlan?: VisualRenderPlan;
    lastDiff?: RenderPlanDiff;
    constructor(options?: Record<string, any>);
    reset(document: EditorDocument): unknown;
    update(document: EditorDocument, impact?: Partial<MutationImpact>): unknown;
    plan(options?: Record<string, any>): { plan: VisualRenderPlan; diff: RenderPlanDiff };
    render(target: unknown, options?: Record<string, any>): { plan: VisualRenderPlan; diff: RenderPlanDiff; result: unknown };
    hitTest(point: Point, options?: { zoom?: number; hitTolerancePx?: number; includeRouteHandles?: boolean; includeHidden?: boolean }): unknown[];
    marquee(bounds: Rect, mode?: 'window' | 'crossing', options?: { includeHidden?: boolean }): SelectionRef[];
    beginConnection(sourceEndpoint: WireEndpoint, options?: Record<string, any>): unknown;
    updateConnection(pointer: Point, options?: { zoom?: number }): unknown;
    connectionCandidates(sourceEndpoint: WireEndpoint, pointer: Point, options?: Record<string, any>): unknown[];
    endConnection(): void;
    registerRenderer(name: string, backend: VisualRendererBackend): this;
    registerRouter(name: string, backend: { route(request: unknown, options?: unknown): unknown | Promise<unknown> }): this;
    metrics(): Record<string, unknown>;
}
