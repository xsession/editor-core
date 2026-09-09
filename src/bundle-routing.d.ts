import type { EntityId, Point, RouteConstraint } from './types.js';
export interface BundleMember { id: EntityId; source: Point; target: Point }
export interface BundleRouteOptions {
    orientation?: 'horizontal' | 'vertical' | 'auto';
    laneSpacing?: number;
    centerCoordinate?: number;
    previousLanes?: Map<EntityId, number>;
}
export interface BundleRouteResult {
    routes: Map<EntityId, Point[]>;
    lanes: Map<EntityId, number>;
    orientation: 'horizontal' | 'vertical';
}
export declare function routeWireBundle(members: BundleMember[], options?: BundleRouteOptions): BundleRouteResult;
export declare function bundleLaneConstraints(bundleResult: BundleRouteResult, options?: { strength?: 'hard' | 'strong' | 'soft' }): Map<EntityId, RouteConstraint[]>;
