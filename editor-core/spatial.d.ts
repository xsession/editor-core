import type { EntityId, Point, Rect } from './types.js';
export interface SpatialItem<T = unknown> {
    id: EntityId;
    bounds: Rect;
    value: T;
    zIndex?: number;
}
/**
 * Deterministic uniform-grid index for canvas hit testing and local collision
 * queries. It is deliberately simple, serializable, and dependency-free.
 */
export declare class UniformGridIndex<T = unknown> {
    readonly cellSize: number;
    private readonly buckets;
    private readonly items;
    constructor(cellSize?: number);
    private cell;
    private key;
    private keysFor;
    insert(item: SpatialItem<T>): void;
    remove(id: EntityId): boolean;
    update(item: SpatialItem<T>): void;
    clear(): void;
    get(id: EntityId): SpatialItem<T> | undefined;
    queryRect(bounds: Rect): SpatialItem<T>[];
    queryPoint(point: Point, tolerance?: number): SpatialItem<T>[];
    all(): SpatialItem<T>[];
    get size(): number;
}
import type { ComponentGeometry, EditorDocument, HitResult, LabelPlacement, SelectionRef } from './types.js';
export interface DocumentHitTestContext {
    componentGeometries: Record<EntityId, ComponentGeometry>;
    labelPlacements: readonly LabelPlacement[];
    zoom: number;
    hitTolerancePx: number;
    includeRouteHandles?: boolean;
    includeHidden?: boolean;
}
export interface DocumentMarqueeContext {
    componentGeometries: Record<EntityId, ComponentGeometry>;
    labelPlacements: readonly LabelPlacement[];
    includeHidden?: boolean;
}
/**
 * Framework-neutral hit testing ordered for direct manipulation: explicit
 * handles and ports win over labels, labels win over component bodies, and a
 * wire's editable segment wins over its broad selection stroke.
 */
export declare function hitTestDocument(document: EditorDocument, point: Point, context: DocumentHitTestContext): HitResult[];
/** Selects components, wires and labels using CAD-style window/crossing rules. */
export declare function marqueeSelect(document: EditorDocument, bounds: Rect, mode: 'window' | 'crossing', context: DocumentMarqueeContext): SelectionRef[];
//# sourceMappingURL=spatial.d.ts.map