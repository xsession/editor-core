import type { Point, Rect, RouteSegment } from '../types.js';
export declare function removeDuplicatePoints(points: Point[]): Point[];
export declare function simplifyOrthogonal(points: Point[]): Point[];
export declare function polylineLength(points: Point[]): number;
export declare function segmentsFromPoints(points: Point[]): RouteSegment[];
export declare function pointAtFraction(points: Point[], fraction: number): {
    point: Point;
    tangent: Point;
    segmentIndex: number;
};
export declare function distanceToPolyline(value: Point, points: Point[]): number;
export declare function polylineBounds(points: Point[]): Rect;
export interface RoundedPathCorner {
    index: number;
    vertex: Point;
    entry: Point;
    exit: Point;
    requestedRadius: number;
    effectiveRadius: number;
    clamped: boolean;
}
export interface RoundedPath {
    d: string;
    corners: RoundedPathCorner[];
}
export declare function roundedPath(points: Point[], requestedRadius: number): RoundedPath;
export declare function allSegmentsAxisAligned(points: Point[]): boolean;
export declare function segmentIntersectsRect(start: Point, end: Point, value: Rect): boolean;
//# sourceMappingURL=polyline.d.ts.map