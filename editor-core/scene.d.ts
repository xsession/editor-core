import { type RoutingObstacle } from './routing.js';
import type { ComponentGeometry, EditorDocument, EntityId, LabelPlacement, Rect, RouteCrossing, RouteResult, TextMeasurer, ValidationIssue } from './types.js';
export interface EditorSceneOptions {
    autoRoute?: boolean;
    validate?: boolean;
    textMeasurer?: TextMeasurer;
    previousLabelPlacements?: Record<EntityId, LabelPlacement>;
    fixedLabelObstacles?: Array<{
        id: EntityId;
        rect: Rect;
        weight?: number;
    }>;
    extraRoutingObstacles?: RoutingObstacle[];
    contentPadding?: number;
}
export interface EditorScene {
    /** A detached document snapshot whose wires contain current derived routes. */
    document: EditorDocument;
    componentGeometries: Record<EntityId, ComponentGeometry>;
    routes: Record<EntityId, RouteResult>;
    labelPlacements: Record<EntityId, LabelPlacement>;
    labelPlacementList: LabelPlacement[];
    crossings: RouteCrossing[];
    validationIssues: ValidationIssue[];
    contentBounds: Rect;
}
/**
 * Pure scene derivation pipeline. Hosts can use this without the stateful
 * engine when rendering a saved snapshot, generating a PDF/SVG, or running
 * deterministic validation in a worker.
 */
export declare function deriveEditorScene(source: EditorDocument, options?: EditorSceneOptions): EditorScene;
//# sourceMappingURL=scene.d.ts.map