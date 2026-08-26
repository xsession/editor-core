import type { OrthogonalRotation, Point, Rect, Side, Size } from '../types.js';
export declare function rotatePointAround(value: Point, center: Point, rotation: OrthogonalRotation): Point;
export declare function inverseRotation(rotation: OrthogonalRotation): OrthogonalRotation;
export declare function rotateRectAround(value: Rect, center: Point, rotation: OrthogonalRotation): Rect;
export declare function rotateSide(side: Side, rotation: OrthogonalRotation): Side;
export declare function localToWorld(local: Point, origin: Point, size: Size, rotation: OrthogonalRotation): Point;
export declare function worldToLocal(world: Point, origin: Point, size: Size, rotation: OrthogonalRotation): Point;
export declare function sideNormal(side: Side): Point;
export declare function sideTangent(side: Side): Point;
//# sourceMappingURL=transform.d.ts.map