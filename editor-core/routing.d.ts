import type { ComponentGeometry, EntityId, Point, Rect, RouteConstraint, RouteCrossing, RoutePattern, RouteResult, RoutingOptions, Side, WireEdge, WireEndpoint } from './types.js';
export interface RoutingObstacle {
    id: EntityId;
    rect: Rect;
    kind?: 'component' | 'label' | 'keepout' | 'group';
    soft?: boolean;
}
export interface ResolvedEndpoint {
    point: Point;
    normal: Point;
    side?: Side;
    componentId?: EntityId;
    portId?: EntityId;
}
export interface RoutingContext {
    componentGeometries: Record<EntityId, ComponentGeometry>;
    obstacles: RoutingObstacle[];
    existingRoutes?: Array<{
        wireId: EntityId;
        points: Point[];
        zIndex?: number;
    }>;
    revision?: number;
}
export declare const DEFAULT_ROUTING_OPTIONS: RoutingOptions;
export declare function resolveEndpoint(endpoint: WireEndpoint, componentGeometries: Record<EntityId, ComponentGeometry>): ResolvedEndpoint | undefined;
export declare function routeWire(wire: WireEdge, context: RoutingContext): RouteResult;
export declare function findWireCrossings(wires: WireEdge[]): RouteCrossing[];
export interface FanoutPair {
    id: EntityId;
    source: Point;
    target: Point;
}
export interface FanoutOptions {
    orientation: 'horizontal' | 'vertical';
    sourceLaneStart?: number;
    targetLaneStart?: number;
    laneSpacing: number;
    centerCoordinate?: number;
    reverseOrder?: boolean;
}
/**
 * Creates deterministic, non-overlapping lane routes for two ordered pin banks.
 * The caller can feed the result into wire constraints or use it as a preview.
 */
export declare function routePinBankFanout(pairs: FanoutPair[], options: FanoutOptions): Map<EntityId, Point[]>;
export declare function moveOrthogonalSegment(points: Point[], segmentIndex: number, delta: Point): Point[];
export declare function createWaypointConstraint(id: EntityId, point: Point, locked?: boolean): RouteConstraint;
export declare function nearestCardinalSide(vector: Point): Side;
export declare function suggestRoutePattern(source: ResolvedEndpoint, target: ResolvedEndpoint): RoutePattern;
export declare function validateRouteClearance(points: Point[], obstacles: RoutingObstacle[], clearance: number): EntityId[];
//# sourceMappingURL=routing.d.ts.map