import type { ComponentGeometry, EditorDocument, EntityId, LabelPlacement, MutationImpact, Rect } from './types.js';
import type { OptimizedEditorScene, SceneSpatialIndex, VisualRenderPlan, VisualRenderPlanOptions } from './advanced-visual.js';

export declare class IncrementalSceneSpatialIndex extends SceneSpatialIndex {
    readonly ownerItems: Map<string, Set<string>>;
    readonly ownerCounts: Map<string, Record<string, number>>;
    constructor(cellSizeOrOptions?: number | (import('./adaptive-spatial.js').AdaptiveSpatialOptions & { adaptive?: boolean }));
    rebuild(document: EditorDocument, componentGeometries: Record<EntityId, ComponentGeometry>, labelPlacements?: readonly LabelPlacement[]): this;
    removeOwner(ownerKey: string): void;
    upsertComponent(document: EditorDocument, componentId: EntityId, geometry?: ComponentGeometry, orderIndex?: number): void;
    upsertWire(wire: EditorDocument['wires'][EntityId]): void;
    upsertLabel(document: EditorDocument, placement: LabelPlacement): void;
}

export interface IncrementalSceneRuntimeOptions {
    spatialCellSize?: number;
    spatialCellSizes?: number[];
    adaptiveSpatial?: boolean;
    routingCellSize?: number;
    dirtyPadding?: number;
    labelFullReflowRatio?: number;
    validate?: boolean;
    findCrossings?: boolean;
    contentPadding?: number;
    textMeasurer?: unknown;
    extraRoutingObstacles?: unknown[];
    fixedLabelObstacles?: unknown[];
    acceleratedRouting?: Record<string, unknown>;
}
export declare class IncrementalSceneRuntime {
    readonly options: IncrementalSceneRuntimeOptions;
    scene?: OptimizedEditorScene;
    spatialIndex?: IncrementalSceneSpatialIndex;
    connectivityIndex?: import('./connectivity-index.js').MutableConnectivityIndex;
    readonly metrics: {
        fullRebuilds: number;
        incrementalUpdates: number;
        lastUpdateMs: number;
        lastChangedComponents: number;
        lastReroutedWires: number;
        lastReflowedLabels: number;
    };
    constructor(options?: IncrementalSceneRuntimeOptions);
    reset(source: EditorDocument): OptimizedEditorScene;
    requiresFullRebuild(source: EditorDocument, impact?: Partial<MutationImpact>): boolean;
    update(source: EditorDocument, impact?: Partial<MutationImpact>): OptimizedEditorScene;
    renderPlan(options?: VisualRenderPlanOptions): VisualRenderPlan;
}
