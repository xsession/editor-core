import { ApproximateTextMeasurer, buildComponentGeometry } from './component.js';
import { cloneDocument } from './serialization.js';
import { inflateRect, routeBounds, unionRects } from './geometry.js';
import { placeLabels } from './labels.js';
import { findWireCrossings, routeWire } from './routing.js';
import { validateDocument } from './validation.js';
function connectedPortIds(document, componentId) {
    const ids = new Set();
    for (const wire of Object.values(document.wires)) {
        for (const endpoint of [wire.source, wire.target]) {
            if (endpoint.kind === 'port' && endpoint.componentId === componentId)
                ids.add(endpoint.portId);
        }
    }
    return ids;
}
function calculateContentBounds(document, geometries, placements, padding) {
    const bounds = [];
    for (const geometry of Object.values(geometries))
        bounds.push(geometry.worldBounds);
    for (const wire of Object.values(document.wires)) {
        if (wire.route?.points.length)
            bounds.push(routeBounds(wire.route.points, Math.max(8, wire.style.width + 5)));
    }
    for (const placement of Object.values(placements))
        bounds.push(placement.bounds);
    if (bounds.length === 0)
        return { x: -500, y: -300, width: 1000, height: 600 };
    return inflateRect(unionRects(bounds), padding);
}
/**
 * Pure scene derivation pipeline. Hosts can use this without the stateful
 * engine when rendering a saved snapshot, generating a PDF/SVG, or running
 * deterministic validation in a worker.
 */
export function deriveEditorScene(source, options = {}) {
    const document = cloneDocument(source);
    const geometries = {};
    for (const componentId of document.componentOrder) {
        const component = document.components[componentId];
        if (!component || component.hidden)
            continue;
        geometries[componentId] = buildComponentGeometry(component, {
            textMeasurer: options.textMeasurer,
            connectedPortIds: connectedPortIds(document, componentId),
            minimumPortHitSize: document.settings.portTargetSizePx,
        });
    }
    const obstacles = [
        ...Object.values(geometries).map((geometry) => ({
            id: geometry.componentId,
            rect: geometry.worldBody,
            kind: 'component',
        })),
        ...(options.extraRoutingObstacles ?? []),
    ];
    const existingRoutes = [];
    if (options.autoRoute ?? true) {
        for (const wireId of document.wireOrder) {
            const wire = document.wires[wireId];
            if (!wire || wire.hidden)
                continue;
            wire.route = routeWire(wire, {
                componentGeometries: geometries,
                obstacles,
                existingRoutes,
                revision: document.revision,
            });
            existingRoutes.push({ wireId, points: wire.route.points, zIndex: wire.style.zIndex });
        }
    }
    const routes = Object.fromEntries(document.wireOrder
        .map((id) => document.wires[id])
        .filter((wire) => Boolean(wire?.route))
        .map((wire) => [wire.id, wire.route]));
    const labelPlacements = placeLabels(document.labelOrder
        .map((id) => document.labels[id])
        .filter((label) => Boolean(label)), options.textMeasurer ?? new ApproximateTextMeasurer(), {
        components: geometries,
        routes,
        previousPlacements: options.previousLabelPlacements,
        fixedObstacles: options.fixedLabelObstacles,
        labelGap: document.settings.labelGap,
        wireClearance: Math.max(2, document.settings.hitTolerancePx / 2),
    });
    const labelPlacementList = Object.values(labelPlacements);
    const wires = document.wireOrder.map((id) => document.wires[id]).filter((wire) => Boolean(wire));
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
//# sourceMappingURL=scene.js.map