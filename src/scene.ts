import { ApproximateTextMeasurer, buildComponentGeometry } from './component.js';
import { cloneDocument } from './serialization.js';
import { inflateRect, routeBounds, unionRects } from './geometry.js';
import { placeLabels } from './labels.js';
import { findWireCrossings, routeWire, type RoutingObstacle } from './routing.js';
import { validateDocument } from './validation.js';
import type {
  ComponentGeometry,
  EditorDocument,
  EntityId,
  LabelPlacement,
  Rect,
  RouteCrossing,
  RouteResult,
  TextMeasurer,
  ValidationIssue,
  WireEdge,
} from './types.js';

export interface EditorSceneOptions {
  autoRoute?: boolean;
  validate?: boolean;
  textMeasurer?: TextMeasurer;
  previousLabelPlacements?: Record<EntityId, LabelPlacement>;
  fixedLabelObstacles?: Array<{ id: EntityId; rect: Rect; weight?: number }>;
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

function connectedPortIds(document: EditorDocument, componentId: EntityId): Set<EntityId> {
  const ids = new Set<EntityId>();
  for (const wire of Object.values(document.wires)) {
    for (const endpoint of [wire.source, wire.target]) {
      if (endpoint.kind === 'port' && endpoint.componentId === componentId) ids.add(endpoint.portId);
    }
  }
  return ids;
}

function calculateContentBounds(
  document: EditorDocument,
  geometries: Record<EntityId, ComponentGeometry>,
  placements: Record<EntityId, LabelPlacement>,
  padding: number,
): Rect {
  const bounds: Rect[] = [];
  for (const geometry of Object.values(geometries)) bounds.push(geometry.worldBounds);
  for (const wire of Object.values(document.wires)) {
    if (wire.route?.points.length) bounds.push(routeBounds(wire.route.points, Math.max(8, wire.style.width + 5)));
  }
  for (const placement of Object.values(placements)) bounds.push(placement.bounds);
  if (bounds.length === 0) return { x: -500, y: -300, width: 1000, height: 600 };
  return inflateRect(unionRects(bounds), padding);
}

/**
 * Pure scene derivation pipeline. Hosts can use this without the stateful
 * engine when rendering a saved snapshot, generating a PDF/SVG, or running
 * deterministic validation in a worker.
 */
export function deriveEditorScene(source: EditorDocument, options: EditorSceneOptions = {}): EditorScene {
  const document = cloneDocument(source);
  const geometries: Record<EntityId, ComponentGeometry> = {};
  for (const componentId of document.componentOrder) {
    const component = document.components[componentId];
    if (!component || component.hidden) continue;
    geometries[componentId] = buildComponentGeometry(component, {
      textMeasurer: options.textMeasurer,
      connectedPortIds: connectedPortIds(document, componentId),
      minimumPortHitSize: document.settings.portTargetSizePx,
    });
  }

  const obstacles: RoutingObstacle[] = [
    ...Object.values(geometries).map((geometry) => ({
      id: geometry.componentId,
      rect: geometry.worldBody,
      kind: 'component' as const,
    })),
    ...(options.extraRoutingObstacles ?? []),
  ];
  const existingRoutes: Array<{ wireId: EntityId; points: { x: number; y: number }[]; zIndex?: number }> = [];
  if (options.autoRoute ?? true) {
    for (const wireId of document.wireOrder) {
      const wire = document.wires[wireId];
      if (!wire || wire.hidden) continue;
      wire.route = routeWire(wire, {
        componentGeometries: geometries,
        obstacles,
        existingRoutes,
        revision: document.revision,
      });
      existingRoutes.push({ wireId, points: wire.route.points, zIndex: wire.style.zIndex });
    }
  }

  const routes = Object.fromEntries(
    document.wireOrder
      .map((id) => document.wires[id])
      .filter((wire): wire is WireEdge => Boolean(wire?.route))
      .map((wire) => [wire.id, wire.route!]),
  );
  const labelPlacements = placeLabels(
    document.labelOrder
      .map((id) => document.labels[id])
      .filter((label) => Boolean(label)),
    options.textMeasurer ?? new ApproximateTextMeasurer(),
    {
      components: geometries,
      routes,
      previousPlacements: options.previousLabelPlacements,
      fixedObstacles: options.fixedLabelObstacles,
      labelGap: document.settings.labelGap,
      wireClearance: Math.max(2, document.settings.hitTolerancePx / 2),
    },
  );
  const labelPlacementList = Object.values(labelPlacements);
  const wires = document.wireOrder.map((id) => document.wires[id]).filter((wire): wire is WireEdge => Boolean(wire));
  const crossings = findWireCrossings(wires);
  const validationIssues = options.validate ?? true
    ? validateDocument(document, geometries, labelPlacements)
    : [];
  const contentBounds = calculateContentBounds(document, geometries, labelPlacements, options.contentPadding ?? 80);
  return {
    document,
    componentGeometries: geometries,
    routes,
    labelPlacements,
    labelPlacementList,
    crossings,
    validationIssues,
    contentBounds,
  };
}
