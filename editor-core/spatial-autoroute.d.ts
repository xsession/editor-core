import type { SpatialCablePath, SpatialPoint } from './spatial-harness.js';
/**
 * 3D keep-out volume and bundle-aware autorouter for spatial harness cables.
 *
 * Staged per the 3D cable routing study:
 *   1. Voxelize the product mesh into a uniform keep-out grid (obstacle
 *      triangles inflated by the clearance margin).
 *   2. Bend-aware A*: during neighbor expansion a three-point circumradius
 *      test rejects turns tighter than the cable's minimum bend radius.
 *   3. Theta* line-of-sight reduction with a visible-parent jump chain, then
 *      centripetal Catmull-Rom smoothing that rejects samples violating
 *      clearance or curvature (falling back to the raw polyline).
 *   4. Shared-edge bundle discount: voxels already used by earlier cables
 *      reduce the travel cost, and a deterministic re-route pass pulls later
 *      cables onto shared trunks (branch points) when it does not cost
 *      significant extra length.
 *
 * Everything here is pure geometry over plain points and triangles so the
 * same code runs in Node tests and in the browser without three.js.
 */
export interface SpatialTriangle {
    a: SpatialPoint;
    b: SpatialPoint;
    c: SpatialPoint;
}
export interface SpatialKeepOutOptions {
    /** Grid cell size in mm. Default 4. */
    cellSizeMm?: number;
    /** Clearance margin around obstacles in mm. Default 0. */
    clearanceMm?: number;
    /** Hard cap on grid extent per axis (cells). Default 160. */
    maxCellsPerAxis?: number;
    /** Hard cap on the triangle count (beyond this the mesh is too dense). Default 12000. */
    maxTriangles?: number;
}
export interface SpatialKeepOutVolume {
    origin: SpatialPoint;
    cellSizeMm: number;
    nx: number;
    ny: number;
    nz: number;
    blocked: Uint8Array;
}
export interface SpatialRoutingOptions {
    /** Maximum A* node expansions. Default 250_000. */
    maxExpansions?: number;
    /** Bundle discount per shared-voxel level, 0..1. Default 0.25. */
    sharedEdgeDiscount?: number;
    /** Per-voxel cost multiplier (bundle discount is applied through this). */
    costModifier?: (voxelIndex: number) => number;
}
export interface SpatialRouteResult {
    success: boolean;
    controlPoints: SpatialPoint[];
    expansions: number;
    /** Voxel indices (into the volume) occupied by the accepted path. */
    pathVoxels: number[];
    /** True when the accepted polyline satisfies the minimum bend radius. */
    bendValid: boolean;
    reason?: 'start-blocked' | 'goal-blocked' | 'search-limit';
}
export interface SpatialBundleResult {
    cableId: string;
    success: boolean;
    controlPoints: SpatialPoint[];
    lengthMm: number;
    /** Number of path voxels shared with earlier cables in the bundle. */
    sharedVoxelCount: number;
    pathVoxels: number[];
}
/**
 * Closest point on a triangle plus barycentric edge coordinates (u, v) such
 * that point = a + u * (b - a) + v * (c - a).
 */
export declare function closestPointOnTriangle(p: SpatialPoint, a: SpatialPoint, b: SpatialPoint, c: SpatialPoint): {
    point: SpatialPoint;
    barycentric: [number, number];
};
/**
 * Point-in-solid test for a closed triangle soup. Casts a ray from the
 * point along +x and counts forward triangle crossings (Möller–Trumbore);
 * an odd count means the point is inside. Winding-orientation independent,
 * with a deterministic micro-offset to avoid degenerate exact-face hits.
 */
export declare function isPointInsideSolid(p: SpatialPoint, triangles: SpatialTriangle[]): boolean;
/**
 * Builds a uniform-grid keep-out volume from product triangles. A voxel is
 * blocked when its center is inside the solid or within `clearanceMm` of the
 * surface. Returns null when the mesh is empty or too large for the grid cap.
 */
export declare function buildSpatialKeepOutVolume(triangles: SpatialTriangle[], options?: SpatialKeepOutOptions): SpatialKeepOutVolume | null;
export declare function volumeVoxelIndex(volume: SpatialKeepOutVolume, point: SpatialPoint): number;
export declare function volumeIsFree(volume: SpatialKeepOutVolume | null, point: SpatialPoint): boolean;
/** Line-of-sight test between two world points through the volume. */
export declare function volumeLineOfSight(volume: SpatialKeepOutVolume | null, from: SpatialPoint, to: SpatialPoint): boolean;
/**
 * Routes a single cable between its locked endpoints through the keep-out
 * volume using bend-aware A* with Theta* line-of-sight reduction.
 *
 * The three-point circumradius test runs during neighbor expansion: a
 * candidate turn whose fitted radius is below the cable's minimum bend
 * radius is rejected. Returns the route as a world-space polyline; the
 * caller replaces the cable's intermediate control points with it.
 */
export declare function routeSpatialCable(cable: SpatialCablePath, volume: SpatialKeepOutVolume | null, options?: SpatialRoutingOptions): SpatialRouteResult;
/**
 * Replaces every corner whose three-point circumradius is below the minimum
 * bend radius with a tangent-arc fillet (tangent points + arc midpoint).
 * This is the standard two-tangent fillet: for a turn of angle θ the tangent
 * distance is t = R * tan(θ/2); the fillet circle of radius R has its center
 * on the turn bisector at B + w * R / sin(θ/2), and the arc midpoint is the
 * point of the circle nearest to B. When the available leg length is too
 * short for the full radius, the fillet radius is scaled down (the corner
 * then remains reported as a violation by the analysis).
 */
export declare function filletSpatialCorners(points: SpatialPoint[], minimumBendRadiusMm: number): SpatialPoint[];
/**
 * Catmull-Rom evaluation for an open point list. Each segment between the
 * interior control points is the uniform Catmull-Rom cubic
 *
 *   C(t) = 0.5 * [ 2p1
 *                + (p2 - p0) t
 *                + (2p0 - 5p1 + 4p2 - p3) t^2
 *                + (p3 - 3p2 + 3p1 - p0) t^3 ],  t in [0, 1]
 *
 * which interpolates p1 at t=0 and p2 at t=1, so every control point lies
 * on the curve. Endpoints are duplicated so the first/last segment has a
 * natural tangent. (Centripetal chord-length parameterization can be
 * substituted for the knot spacing if a specific spline family is required;
 * uniform spacing is sufficient for smoothing an already bend-validated
 * A* polyline.)
 */
export declare function sampleCatmullRom(points: SpatialPoint[], samplesPerSegment: number): SpatialPoint[];
/**
 * Smooths a route polyline with centripetal Catmull-Rom sampling and rejects
 * the smoothed result when any sample violates clearance or the minimum bend
 * radius, falling back to the input polyline (already A*-valid). Progressively
 * coarser sampling keeps the fallback close to the raw path.
 */
export declare function smoothSpatialPath(points: SpatialPoint[], minimumBendRadiusMm: number, volume: SpatialKeepOutVolume | null, options?: {
    samplesPerSegment?: number;
}): {
    points: SpatialPoint[];
    smoothed: boolean;
};
/**
 * Routes a bundle of cables with shared-edge discounts (harness-routing
 * heuristic). Cables are routed longest-first so the trunk is established
 * early; every route gets a cost modifier that discounts voxels already
 * occupied by earlier cables. A final deterministic re-route pass lets later
 * cables join existing shared trunks (creating branch points) whenever the
 * accepted route does not add more than `acceptLengthOverhead` (default 8%)
 * to their length.
 */
export declare function routeSpatialBundle(cables: SpatialCablePath[], volume: SpatialKeepOutVolume | null, options?: SpatialRoutingOptions & {
    acceptLengthOverhead?: number;
}): SpatialBundleResult[];
//# sourceMappingURL=spatial-autoroute.d.ts.map