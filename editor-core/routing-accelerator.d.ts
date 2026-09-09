import type { ComponentGeometry, EntityId, Point, Rect, RouteCrossing, RouteResult, WireEdge } from './types.js';
import type { RoutingContext, RoutingObstacle } from './routing.js';

export interface IndexedExistingRoute {
    wireId: EntityId;
    points: Point[];
    zIndex?: number;
}

export declare class RoutingSpatialAccelerator {
    readonly obstacleIndex: import('./spatial.js').UniformGridIndex<RoutingObstacle>;
    readonly routeSegmentIndex: import('./spatial.js').UniformGridIndex<{ wireId: EntityId; segmentIndex: number }>;
    readonly obstacles: Map<EntityId, RoutingObstacle>;
    readonly routes: Map<EntityId, IndexedExistingRoute>;
    readonly routeSegmentIds: Map<EntityId, string[]>;
    revision: number;
    constructor(cellSize?: number);
    clear(): void;
    rebuild(obstacles?: RoutingObstacle[], existingRoutes?: IndexedExistingRoute[], revision?: number): this;
    upsertObstacle(obstacle: RoutingObstacle): this;
    removeObstacle(id: EntityId): boolean;
    upsertRoute(route: IndexedExistingRoute): this;
    removeRoute(wireId: EntityId): boolean;
    obstaclesIn(bounds: Rect, padding?: number): RoutingObstacle[];
    routesIn(bounds: Rect, excludeWireId?: EntityId): IndexedExistingRoute[];
    routeObstacleViolations(points: Point[], sourceComponentId?: EntityId, targetComponentId?: EntityId, clearance?: number): EntityId[];
    readonly stats: { obstacles: number; routes: number; routeSegments: number };
}

export interface AcceleratedRouteOptions {
    initialMargin?: number;
    attempts?: number;
    growth?: number;
    annotateFallback?: boolean;
}
export declare function routeWireAccelerated(wire: WireEdge, context: RoutingContext, accelerator: RoutingSpatialAccelerator, options?: AcceleratedRouteOptions): RouteResult;
export declare function findWireCrossingsIndexed(wires: WireEdge[], options?: { cellSize?: number; dedupePrecision?: number }): RouteCrossing[];

export interface AsyncRouteResult<T = unknown> {
    stale: boolean;
    wireId: EntityId;
    revision: number;
    token: number;
    result: T;
}
export declare class AsyncRoutingCoordinator {
    route<T = unknown>(wireId: EntityId, revision: number, backend: { route(request: unknown, options?: unknown): T | Promise<T> }, request: unknown, options?: unknown): Promise<AsyncRouteResult<T>>;
    invalidate(wireId: EntityId): void;
    clear(): void;
}
export declare function routesIntersectingRegion(accelerator: RoutingSpatialAccelerator, bounds: Rect): EntityId[];
