import type {
    ComponentGeometry,
    EditorDocument,
    EntityId,
    HitResult,
    LabelPlacement,
    Point,
    Rect,
    SelectionRef,
    SelectionState,
} from './types.js';
import type { EditorScene } from './scene.js';
import type { SpatialItem } from './spatial.js';

export interface ConnectivityIndex {
    componentPorts: Map<EntityId, Set<EntityId>>;
    componentWires: Map<EntityId, Set<EntityId>>;
    portWires: Map<string, Set<EntityId>>;
    wireEndpoints: Map<EntityId, Array<{ componentId: EntityId; portId: EntityId; portKey: string }>>;
    connectedPortIds(componentId: EntityId): ReadonlySet<EntityId>;
    wiresForComponent(componentId: EntityId): ReadonlySet<EntityId>;
    wiresForPort(componentId: EntityId, portId: EntityId): ReadonlySet<EntityId>;
}
export declare function buildConnectivityIndex(document: EditorDocument): ConnectivityIndex;

export type SceneSpatialKind = 'component' | 'port' | 'label' | 'wire' | 'route-segment' | 'route-waypoint';
export interface SceneSpatialValue {
    kind: SceneSpatialKind;
    id: EntityId;
    subId?: EntityId | number;
}
export interface SpatialIndexLike<T = unknown> {
    insert(item: SpatialItem<T>): void;
    update(item: SpatialItem<T>): void;
    remove(id: EntityId): boolean;
    clear(): void;
    get(id: EntityId): SpatialItem<T> | undefined;
    queryRect(bounds: Rect): SpatialItem<T>[];
    queryPoint(point: Point, tolerance?: number): SpatialItem<T>[];
    all(): SpatialItem<T>[];
    readonly size: number;
}
export declare class SceneSpatialIndex {
    index: SpatialIndexLike<SceneSpatialValue>;
    revision: number;
    stats: {
        components: number;
        ports: number;
        labels: number;
        wires: number;
        segments: number;
        waypoints: number;
    };
    constructor(cellSize?: number);
    rebuild(document: EditorDocument, componentGeometries: Record<EntityId, ComponentGeometry>, labelPlacements?: readonly LabelPlacement[]): this;
    queryPoint(point: Point, tolerance?: number): SpatialItem<SceneSpatialValue>[];
    queryRect(bounds: Rect): SpatialItem<SceneSpatialValue>[];
    queryVisible(viewport: Rect, overscan?: number): SpatialItem<SceneSpatialValue>[];
    get size(): number;
}

export interface IndexedHitTestContext {
    componentGeometries: Record<EntityId, ComponentGeometry>;
    labelPlacements: readonly LabelPlacement[];
    zoom: number;
    hitTolerancePx: number;
    includeRouteHandles?: boolean;
    includeHidden?: boolean;
    labelPlacementMap?: Map<EntityId, LabelPlacement>;
}
export declare function hitTestDocumentIndexed(document: EditorDocument, point: Point, context: IndexedHitTestContext, spatialIndex: SceneSpatialIndex): HitResult[];
export declare function marqueeSelectIndexed(document: EditorDocument, bounds: Rect, mode: 'window' | 'crossing', context: Omit<IndexedHitTestContext, 'zoom' | 'hitTolerancePx' | 'includeRouteHandles'>, spatialIndex: SceneSpatialIndex): SelectionRef[];

export type VisualLevelOfDetail = 'low' | 'medium' | 'full';
export interface LodThresholds {
    medium?: number;
    full?: number;
}
export declare function chooseLevelOfDetail(zoom: number, thresholds?: LodThresholds): VisualLevelOfDetail;
export declare function queryVisibleScene(spatialIndex: SceneSpatialIndex, viewport: Rect, options?: {
    overscan?: number;
    pinnedIds?: readonly SelectionRef[];
}): {
    componentIds: Set<EntityId>;
    wireIds: Set<EntityId>;
    labelIds: Set<EntityId>;
};

export interface VisualRenderPlanOptions {
    zoom?: number;
    lod?: VisualLevelOfDetail;
    lodThresholds?: LodThresholds;
    viewport?: Rect;
    spatialIndex?: SceneSpatialIndex;
    overscan?: number;
    selection?: SelectionState;
    cameraMoving?: boolean;
}
export interface VisualRenderPlan {
    revision: number;
    lod: VisualLevelOfDetail;
    zoom: number;
    viewport?: Rect;
    components: any[];
    wires: any[];
    labels: any[];
    counts: { components: number; wires: number; labels: number };
}
export declare function buildVisualRenderPlan(scene: EditorScene, options?: VisualRenderPlanOptions): VisualRenderPlan;

export interface OptimizedEditorSceneOptions extends import('./scene.js').EditorSceneOptions {
    buildSpatialIndex?: boolean;
    spatialCellSize?: number;
    findCrossings?: boolean;
    crossingCellSize?: number;
    spatialIndex?: SceneSpatialIndex;
}
export type OptimizedEditorScene = EditorScene & {
    connectivityIndex: ConnectivityIndex;
    labelPlacementMap?: Map<EntityId, LabelPlacement>;
    incrementalImpact?: { full: boolean; changedComponents: EntityId[]; affectedWires: EntityId[]; affectedLabels: EntityId[] };
    spatialIndex?: SceneSpatialIndex;
};
export declare function deriveEditorSceneOptimized(source: EditorDocument, options?: OptimizedEditorSceneOptions): OptimizedEditorScene;

export interface VisualRendererBackend {
    render(plan: VisualRenderPlan, target: unknown, options?: unknown): unknown;
    capabilities?: Record<string, unknown>;
}
export interface VisualRouterBackend {
    route(request: unknown, options?: unknown): unknown | Promise<unknown>;
    capabilities?: Record<string, unknown>;
}
export declare class VisualBackendRegistry {
    readonly renderers: Map<string, VisualRendererBackend>;
    readonly routers: Map<string, VisualRouterBackend>;
    registerRenderer(name: string, backend: VisualRendererBackend): this;
    registerRouter(name: string, backend: VisualRouterBackend): this;
    renderer(name: string): VisualRendererBackend | undefined;
    router(name: string): VisualRouterBackend | undefined;
    capabilities(): {
        renderers: Array<Record<string, unknown> & { name: string }>;
        routers: Array<Record<string, unknown> & { name: string }>;
    };
}

export interface ElkGraphOptions {
    id?: string;
    algorithm?: string;
    direction?: 'RIGHT' | 'LEFT' | 'UP' | 'DOWN';
    edgeRouting?: 'ORTHOGONAL' | 'POLYLINE' | 'SPLINES';
    nodeSpacing?: number;
    layerSpacing?: number;
    layoutOptions?: Record<string, string>;
}
export declare function createElkGraph(scene: EditorScene, options?: ElkGraphOptions): any;
export declare function routesFromElkResult(result: any): Map<EntityId, Point[]>;
export declare function createLibavoidRequest(scene: EditorScene, options?: {
    clearance?: number;
    orthogonal?: boolean;
    nudgeSharedPaths?: boolean;
    transaction?: boolean;
}): any;
