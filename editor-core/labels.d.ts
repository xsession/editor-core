import type { ComponentGeometry, EntityId, LabelNode, LabelPlacement, Point, Rect, RouteResult, TextMeasurer } from './types.js';
export interface LabelPlacementContext {
    components: Record<EntityId, ComponentGeometry>;
    routes: Record<EntityId, RouteResult>;
    componentObstacles?: Array<{
        id: EntityId;
        rect: Rect;
    }>;
    fixedObstacles?: Array<{
        id: EntityId;
        rect: Rect;
        weight?: number;
    }>;
    previousPlacements?: Record<EntityId, LabelPlacement>;
    worldBounds?: Rect;
    labelGap: number;
    wireClearance?: number;
}
export declare function placeLabel(label: LabelNode, measurer: TextMeasurer, context: LabelPlacementContext, alreadyPlaced?: Record<EntityId, LabelPlacement>): LabelPlacement;
export declare function placeLabels(labels: LabelNode[], measurer: TextMeasurer, context: LabelPlacementContext): Record<EntityId, LabelPlacement>;
export declare function labelPlacementBounds(placements: Record<EntityId, LabelPlacement>): Rect;
/**
 * Converts a label to an explicit world-space placement. This operation is
 * intentionally data-only so a host can use it during a drag preview without
 * coupling the label subsystem to a UI framework.
 */
export declare function pinLabelToWorld(label: LabelNode, worldPosition: Point): LabelNode;
/** Restores automatic candidate placement while preserving label content. */
export declare function resetLabelToAutomatic(label: LabelNode): LabelNode;
//# sourceMappingURL=labels.d.ts.map