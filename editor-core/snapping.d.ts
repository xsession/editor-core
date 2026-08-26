import type { ComponentGeometry, EntityId, Point } from './types.js';
export type SnapGuideKind = 'grid' | 'edge' | 'center' | 'port';
export interface SnapGuide {
    axis: 'x' | 'y';
    coordinate: number;
    from: number;
    to: number;
    kind: SnapGuideKind;
    sourceId?: EntityId;
    targetId?: EntityId;
    label?: string;
}
export interface ComponentDragSnapOptions {
    zoom: number;
    tolerancePx?: number;
    gridSpacing?: number;
    enableGrid?: boolean;
    enableAlignment?: boolean;
    enablePortAlignment?: boolean;
    primaryComponentId?: EntityId;
}
export interface ComponentDragSnapResult {
    delta: Point;
    correction: Point;
    guides: SnapGuide[];
    snappedX: boolean;
    snappedY: boolean;
}
/**
 * Computes CAD-style grid, edge, centerline, and port alignment snapping for a
 * component group. The returned delta is absolute from the gesture start, so
 * it works with snapshot-based preview transactions and never accumulates
 * rounding drift.
 */
export declare function snapComponentDrag(geometries: Record<EntityId, ComponentGeometry>, movingComponentIds: readonly EntityId[], proposedDelta: Point, options: ComponentDragSnapOptions): ComponentDragSnapResult;
//# sourceMappingURL=snapping.d.ts.map