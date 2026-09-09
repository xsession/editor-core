import {
    closestPointOnSegment,
    distancePointToSegment,
    inflateRect,
    polylineIntersectsRect,
    rectContainsPoint,
    rectContainsRect,
    rectsIntersect,
    routeBounds,
    screenToleranceToWorld,
    unionRects,
} from './geometry.js';
import { ApproximateTextMeasurer, buildComponentGeometry } from './component.js';
import { placeLabels } from './labels.js';
import { routeWire } from './routing.js';
import { findWireCrossingsIndexed } from './routing-accelerator.js';
import { cloneDocument } from './serialization.js';
import { UniformGridIndex } from './spatial.js';
import { validateDocument } from './validation.js';
import { MutableConnectivityIndex } from './connectivity-index.js';

const HIT_PRIORITY = {
    port: 900,
    'route-waypoint': 850,
    'route-segment': 800,
    label: 700,
    'component-header': 650,
    'component-body': 600,
    wire: 500,
};

function unique(values) {
    return [...new Set(values)];
}

function rectFromSegment(start, end, padding = 0) {
    const x = Math.min(start.x, end.x) - padding;
    const y = Math.min(start.y, end.y) - padding;
    return {
        x,
        y,
        width: Math.abs(end.x - start.x) + padding * 2,
        height: Math.abs(end.y - start.y) + padding * 2,
    };
}

function selected(selection, kind, id) {
    return Boolean(selection?.items?.some((item) => item.kind === kind && item.id === id));
}

/**
 * Builds reusable connectivity maps in O(wires + endpoints), avoiding the
 * component-by-component wire scans used by naive scene derivation.
 */
export function buildConnectivityIndex(document) {
    return new MutableConnectivityIndex(document);
}

/**
 * Multi-kind spatial index for components, ports, labels, wires, route
 * segments and route waypoints. It keeps exact geometry in the scene model,
 * while using a compact grid only to narrow candidate sets.
 */
export class SceneSpatialIndex {
    index;
    revision = -1;
    stats = {
        components: 0,
        ports: 0,
        labels: 0,
        wires: 0,
        segments: 0,
        waypoints: 0,
    };

    constructor(cellSize = 128) {
        this.index = new UniformGridIndex(cellSize);
    }

    rebuild(document, componentGeometries, labelPlacements = []) {
        this.index.clear();
        this.revision = document.revision ?? -1;
        this.stats = { components: 0, ports: 0, labels: 0, wires: 0, segments: 0, waypoints: 0 };

        for (let orderIndex = 0; orderIndex < document.componentOrder.length; orderIndex += 1) {
            const componentId = document.componentOrder[orderIndex];
            const component = document.components[componentId];
            const geometry = componentGeometries[componentId];
            if (!component || !geometry)
                continue;
            this.index.insert({
                id: `component:${componentId}`,
                bounds: geometry.worldBounds,
                zIndex: orderIndex * 10 + HIT_PRIORITY['component-body'],
                value: { kind: 'component', id: componentId },
            });
            this.stats.components += 1;
            for (const port of Object.values(geometry.ports)) {
                this.index.insert({
                    id: `port:${componentId}:${port.portId}`,
                    bounds: port.hitBounds,
                    zIndex: orderIndex * 10 + HIT_PRIORITY.port,
                    value: { kind: 'port', id: componentId, subId: port.portId },
                });
                this.stats.ports += 1;
            }
        }

        for (const placement of labelPlacements) {
            const label = document.labels[placement.labelId];
            if (!label || label.visible === false)
                continue;
            this.index.insert({
                id: `label:${placement.labelId}`,
                bounds: placement.bounds,
                zIndex: 10_000 + (label.priority ?? 0) + HIT_PRIORITY.label,
                value: { kind: 'label', id: placement.labelId },
            });
            this.stats.labels += 1;
        }

        for (const wireId of document.wireOrder) {
            const wire = document.wires[wireId];
            if (!wire?.route?.points?.length || wire.hidden)
                continue;
            const points = wire.route.points;
            const padding = Math.max(1, (wire.style?.width ?? 1) / 2);
            this.index.insert({
                id: `wire:${wireId}`,
                bounds: routeBounds(points, padding),
                zIndex: (wire.style?.zIndex ?? 0) + HIT_PRIORITY.wire,
                value: { kind: 'wire', id: wireId },
            });
            this.stats.wires += 1;
            for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
                const start = points[segmentIndex];
                const end = points[segmentIndex + 1];
                this.index.insert({
                    id: `segment:${wireId}:${segmentIndex}`,
                    bounds: rectFromSegment(start, end, padding),
                    zIndex: (wire.style?.zIndex ?? 0) + HIT_PRIORITY['route-segment'],
                    value: { kind: 'route-segment', id: wireId, subId: segmentIndex },
                });
                this.stats.segments += 1;
            }
            for (let waypointIndex = 1; waypointIndex < points.length - 1; waypointIndex += 1) {
                const waypoint = points[waypointIndex];
                this.index.insert({
                    id: `waypoint:${wireId}:${waypointIndex}`,
                    bounds: { x: waypoint.x - padding, y: waypoint.y - padding, width: padding * 2, height: padding * 2 },
                    zIndex: (wire.style?.zIndex ?? 0) + HIT_PRIORITY['route-waypoint'],
                    value: { kind: 'route-waypoint', id: wireId, subId: waypointIndex },
                });
                this.stats.waypoints += 1;
            }
        }
        return this;
    }

    queryPoint(point, tolerance = 0) {
        return this.index.queryPoint(point, tolerance);
    }

    queryRect(bounds) {
        return this.index.queryRect(bounds);
    }

    queryVisible(viewport, overscan = 0) {
        return this.queryRect(overscan > 0 ? inflateRect(viewport, overscan) : viewport);
    }

    get size() {
        return this.index.size;
    }
}

function candidateIds(items, kind) {
    return unique(items.filter((item) => item.value.kind === kind).map((item) => item.value.id));
}

/** Accelerated hit testing that preserves the existing HitResult shape. */
export function hitTestDocumentIndexed(document, point, context, spatialIndex) {
    const tolerance = screenToleranceToWorld(context.hitTolerancePx, context.zoom);
    const candidates = spatialIndex.queryPoint(point, tolerance * 1.5);
    const hits = [];

    const componentIds = unique([
        ...candidateIds(candidates, 'component'),
        ...candidateIds(candidates, 'port'),
    ]);
    const orderMap = new Map(document.componentOrder.map((id, index) => [id, index]));
    for (const componentId of componentIds) {
        const component = document.components[componentId];
        const geometry = context.componentGeometries[componentId];
        if (!component || !geometry || (component.hidden && !context.includeHidden))
            continue;
        const componentZ = (orderMap.get(componentId) ?? 0) * 10;
        const portCandidates = candidates.filter((item) => item.value.kind === 'port' && item.value.id === componentId);
        for (const candidate of portCandidates) {
            const port = geometry.ports[candidate.value.subId];
            if (!port)
                continue;
            const inflated = inflateRect(port.hitBounds, tolerance);
            if (!rectContainsPoint(inflated, point))
                continue;
            hits.push({
                kind: 'port',
                entityId: componentId,
                subId: port.portId,
                distance: Math.hypot(point.x - port.center.x, point.y - port.center.y),
                zIndex: componentZ + HIT_PRIORITY.port,
                point: port.center,
            });
        }
        if (rectContainsPoint(geometry.headerBounds, point)) {
            hits.push({
                kind: 'component-header',
                entityId: componentId,
                distance: 0,
                zIndex: componentZ + HIT_PRIORITY['component-header'],
                point,
            });
        }
        else if (rectContainsPoint(geometry.worldBody, point)) {
            hits.push({
                kind: 'component-body',
                entityId: componentId,
                distance: 0,
                zIndex: componentZ + HIT_PRIORITY['component-body'],
                point,
            });
        }
    }

    const placementMap = context.labelPlacementMap ?? new Map(context.labelPlacements.map((item) => [item.labelId, item]));
    for (const labelId of candidateIds(candidates, 'label')) {
        const label = document.labels[labelId];
        const placement = placementMap.get(labelId);
        if (!label || !placement || (label.visible === false && !context.includeHidden))
            continue;
        if (!rectContainsPoint(inflateRect(placement.bounds, tolerance), point))
            continue;
        hits.push({
            kind: 'label',
            entityId: labelId,
            distance: 0,
            zIndex: 10_000 + (label.priority ?? 0) + HIT_PRIORITY.label,
            point: placement.position,
        });
    }

    const wireSegmentCandidates = candidates.filter((item) => item.value.kind === 'route-segment');
    const wireWaypointCandidates = context.includeRouteHandles
        ? candidates.filter((item) => item.value.kind === 'route-waypoint')
        : [];

    for (const candidate of wireWaypointCandidates) {
        const wire = document.wires[candidate.value.id];
        if (!wire?.route || (wire.hidden && !context.includeHidden))
            continue;
        const waypoint = wire.route.points[candidate.value.subId];
        if (!waypoint)
            continue;
        const wireTolerance = tolerance + Math.max(1, (wire.style?.width ?? 1) / 2);
        const distance = Math.hypot(point.x - waypoint.x, point.y - waypoint.y);
        if (distance <= wireTolerance * 1.35) {
            hits.push({
                kind: 'route-waypoint',
                entityId: wire.id,
                subId: candidate.value.subId,
                distance,
                zIndex: (wire.style?.zIndex ?? 0) + HIT_PRIORITY['route-waypoint'],
                point: waypoint,
            });
        }
    }

    const bestByWire = new Map();
    for (const candidate of wireSegmentCandidates) {
        const wire = document.wires[candidate.value.id];
        if (!wire?.route || (wire.hidden && !context.includeHidden))
            continue;
        const segmentIndex = candidate.value.subId;
        const start = wire.route.points[segmentIndex];
        const end = wire.route.points[segmentIndex + 1];
        if (!start || !end)
            continue;
        const distance = distancePointToSegment(point, start, end);
        const wireTolerance = tolerance + Math.max(1, (wire.style?.width ?? 1) / 2);
        if (distance > wireTolerance)
            continue;
        const previous = bestByWire.get(wire.id);
        if (!previous || distance < previous.distance) {
            bestByWire.set(wire.id, {
                wire,
                segmentIndex,
                distance,
                point: closestPointOnSegment(point, start, end),
            });
        }
    }

    for (const result of bestByWire.values()) {
        hits.push({
            kind: context.includeRouteHandles ? 'route-segment' : 'wire',
            entityId: result.wire.id,
            subId: context.includeRouteHandles ? result.segmentIndex : undefined,
            distance: result.distance,
            zIndex: (result.wire.style?.zIndex ?? 0) + HIT_PRIORITY[context.includeRouteHandles ? 'route-segment' : 'wire'],
            point: result.point,
        });
    }

    return hits.sort((a, b) => b.zIndex - a.zIndex || a.distance - b.distance || a.entityId.localeCompare(b.entityId));
}

/** Accelerated CAD-style marquee selection using the spatial index as a broad phase. */
export function marqueeSelectIndexed(document, bounds, mode, context, spatialIndex) {
    const candidates = spatialIndex.queryRect(bounds);
    const selectedItems = [];
    const matches = (candidate) => mode === 'window' ? rectContainsRect(bounds, candidate) : rectsIntersect(bounds, candidate);

    for (const componentId of candidateIds(candidates, 'component')) {
        const component = document.components[componentId];
        const geometry = context.componentGeometries[componentId];
        if (!component || !geometry || (component.hidden && !context.includeHidden))
            continue;
        if (matches(geometry.worldBounds))
            selectedItems.push({ kind: 'component', id: componentId });
    }

    const wireIds = unique([
        ...candidateIds(candidates, 'wire'),
        ...candidateIds(candidates, 'route-segment'),
    ]);
    for (const wireId of wireIds) {
        const wire = document.wires[wireId];
        if (!wire?.route || (wire.hidden && !context.includeHidden))
            continue;
        const isMatch = mode === 'window'
            ? rectContainsRect(bounds, routeBounds(wire.route.points, (wire.style?.width ?? 1) / 2))
            : polylineIntersectsRect(wire.route.points, bounds);
        if (isMatch)
            selectedItems.push({ kind: 'wire', id: wireId });
    }

    const placementMap = context.labelPlacementMap ?? new Map(context.labelPlacements.map((placement) => [placement.labelId, placement]));
    for (const labelId of candidateIds(candidates, 'label')) {
        const label = document.labels[labelId];
        const placement = placementMap.get(labelId);
        if (!label || !placement || (!label.visible && !context.includeHidden))
            continue;
        if (matches(placement.bounds))
            selectedItems.push({ kind: 'label', id: labelId });
    }
    return selectedItems;
}

export function chooseLevelOfDetail(zoom, thresholds = {}) {
    const full = thresholds.full ?? 0.55;
    const medium = thresholds.medium ?? 0.2;
    if (zoom >= full)
        return 'full';
    if (zoom >= medium)
        return 'medium';
    return 'low';
}

/**
 * Returns visible entity ids using the scene index. Selected/edited entities
 * may be pinned so they remain available even when just outside the viewport.
 */
export function queryVisibleScene(spatialIndex, viewport, options = {}) {
    const overscan = options.overscan ?? 64;
    const items = spatialIndex.queryVisible(viewport, overscan);
    const pinned = options.pinnedIds ?? [];
    const componentIds = new Set(candidateIds(items, 'component'));
    const wireIds = new Set([...candidateIds(items, 'wire'), ...candidateIds(items, 'route-segment')]);
    const labelIds = new Set(candidateIds(items, 'label'));
    for (const pin of pinned) {
        if (pin.kind === 'component')
            componentIds.add(pin.id);
        else if (pin.kind === 'wire')
            wireIds.add(pin.id);
        else if (pin.kind === 'label')
            labelIds.add(pin.id);
    }
    return { componentIds, wireIds, labelIds };
}

/**
 * Backend-neutral render plan. Canvas2D, PixiJS, Konva or a DOM/SVG host can
 * consume this without owning document semantics or hit testing.
 */
export function buildVisualRenderPlan(scene, options = {}) {
    const document = scene.document;
    const zoom = options.zoom ?? 1;
    const lod = options.lod ?? (options.cameraMoving ? 'low' : chooseLevelOfDetail(zoom, options.lodThresholds));
    let visible = undefined;
    if (options.viewport && options.spatialIndex) {
        visible = queryVisibleScene(options.spatialIndex, options.viewport, {
            overscan: options.overscan,
            pinnedIds: options.selection?.items,
        });
    }
    const isVisible = (kind, id) => {
        if (!visible)
            return true;
        if (kind === 'component')
            return visible.componentIds.has(id);
        if (kind === 'wire')
            return visible.wireIds.has(id);
        return visible.labelIds.has(id);
    };

    const components = [];
    for (const componentId of document.componentOrder) {
        const component = document.components[componentId];
        const geometry = scene.componentGeometries[componentId];
        if (!component || !geometry || component.hidden || !isVisible('component', componentId))
            continue;
        const ports = lod === 'full'
            ? Object.values(geometry.ports).map((port) => ({
                id: port.portId,
                center: port.center,
                hitBounds: port.hitBounds,
                side: port.side,
                labelPoint: port.labelPoint,
                functionPoint: port.functionPoint,
            }))
            : [];
        components.push({
            id: componentId,
            kind: component.kind,
            designator: component.designator,
            title: component.labels?.title ?? component.designator,
            subtitle: component.labels?.subtitle,
            body: geometry.worldBody,
            header: geometry.headerBounds,
            titlePoint: geometry.titlePoint,
            subtitlePoint: geometry.subtitlePoint,
            ports,
            style: component.style,
            selected: selected(options.selection, 'component', componentId),
        });
    }

    const wires = [];
    for (const wireId of document.wireOrder) {
        const wire = document.wires[wireId];
        if (!wire?.route || wire.hidden || !isVisible('wire', wireId))
            continue;
        wires.push({
            id: wireId,
            points: wire.route.points,
            style: wire.style,
            routing: wire.routing,
            status: wire.route.status,
            routeRevision: wire.route.generatedAtRevision ?? document.revision ?? 0,
            selected: selected(options.selection, 'wire', wireId),
            label: wire.label ?? wire.signal ?? wireId,
        });
    }

    const labels = [];
    if (lod !== 'low') {
        for (const placement of scene.labelPlacementList ?? Object.values(scene.labelPlacements ?? {})) {
            const label = document.labels[placement.labelId];
            if (!label || label.visible === false || !isVisible('label', placement.labelId))
                continue;
            labels.push({
                id: placement.labelId,
                text: label.text,
                secondaryText: lod === 'full' ? label.secondaryText : undefined,
                position: placement.position,
                bounds: placement.bounds,
                leader: placement.leader,
                status: placement.status,
                style: label.style,
                selected: selected(options.selection, 'label', placement.labelId),
            });
        }
    }

    return {
        revision: document.revision ?? 0,
        lod,
        zoom,
        viewport: options.viewport,
        components,
        wires,
        labels,
        counts: {
            components: components.length,
            wires: wires.length,
            labels: labels.length,
        },
    };
}


function calculateContentBounds(document, geometries, placements, padding) {
    const bounds = [];
    for (const geometry of Object.values(geometries))
        bounds.push(geometry.worldBounds);
    for (const wire of Object.values(document.wires)) {
        if (wire.route?.points?.length)
            bounds.push(routeBounds(wire.route.points, Math.max(8, (wire.style?.width ?? 1) + 5)));
    }
    for (const placement of Object.values(placements))
        bounds.push(placement.bounds);
    if (bounds.length === 0)
        return { x: -500, y: -300, width: 1000, height: 600 };
    return inflateRect(unionRects(bounds), padding);
}

/**
 * Drop-in scene derivation with a one-pass connectivity index and an optional
 * spatial index returned alongside the normal EditorScene fields.
 */
export function deriveEditorSceneOptimized(source, options = {}) {
    const document = cloneDocument(source);
    const connectivityIndex = buildConnectivityIndex(document);
    const geometries = {};
    for (const componentId of document.componentOrder) {
        const component = document.components[componentId];
        if (!component || component.hidden)
            continue;
        geometries[componentId] = buildComponentGeometry(component, {
            textMeasurer: options.textMeasurer,
            connectedPortIds: connectivityIndex.connectedPortIds(componentId),
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
    const crossings = options.findCrossings === false ? [] : findWireCrossingsIndexed(wires, { cellSize: options.crossingCellSize ?? 192 });
    const validationIssues = options.validate ?? true
        ? validateDocument(document, geometries, labelPlacements)
        : [];
    const contentBounds = calculateContentBounds(document, geometries, labelPlacements, options.contentPadding ?? 80);
    const spatialIndex = options.buildSpatialIndex === false
        ? undefined
        : (options.spatialIndex ?? new SceneSpatialIndex(options.spatialCellSize ?? 128))
            .rebuild(document, geometries, labelPlacementList);

    return {
        document,
        componentGeometries: geometries,
        routes,
        labelPlacements,
        labelPlacementList,
        labelPlacementMap: new Map(labelPlacementList.map((placement) => [placement.labelId, placement])),
        crossings,
        validationIssues,
        contentBounds,
        connectivityIndex,
        spatialIndex,
    };
}

/**
 * Small registry that keeps heavyweight renderers and routers optional. This
 * lets host apps plug in PixiJS/Konva for drawing and ELK/libavoid for layout
 * without forcing those dependencies on the framework-neutral core.
 */
export class VisualBackendRegistry {
    renderers = new Map();
    routers = new Map();

    registerRenderer(name, backend) {
        if (!name || typeof backend?.render !== 'function')
            throw new Error('Renderer backend must have a name and render(plan, target, options) function.');
        this.renderers.set(name, backend);
        return this;
    }

    registerRouter(name, backend) {
        if (!name || typeof backend?.route !== 'function')
            throw new Error('Router backend must have a name and route(request, options) function.');
        this.routers.set(name, backend);
        return this;
    }

    renderer(name) {
        return this.renderers.get(name);
    }

    router(name) {
        return this.routers.get(name);
    }

    capabilities() {
        return {
            renderers: [...this.renderers.entries()].map(([name, backend]) => ({ name, ...(backend.capabilities ?? {}) })),
            routers: [...this.routers.entries()].map(([name, backend]) => ({ name, ...(backend.capabilities ?? {}) })),
        };
    }
}

/** Create an ELK-compatible graph without importing elkjs into editor-core. */
export function createElkGraph(scene, options = {}) {
    const document = scene.document;
    const direction = options.direction ?? 'RIGHT';
    const children = [];
    for (const componentId of document.componentOrder) {
        const component = document.components[componentId];
        const geometry = scene.componentGeometries[componentId];
        if (!component || !geometry || component.hidden)
            continue;
        const body = geometry.worldBody;
        children.push({
            id: componentId,
            x: body.x,
            y: body.y,
            width: body.width,
            height: body.height,
            ports: Object.values(geometry.ports).map((port) => ({
                id: `${componentId}:${port.portId}`,
                x: port.center.x - body.x,
                y: port.center.y - body.y,
                width: 1,
                height: 1,
                layoutOptions: {
                    'elk.port.side': String(port.side ?? '').toUpperCase(),
                },
            })),
            layoutOptions: {
                'elk.portConstraints': 'FIXED_POS',
            },
        });
    }

    const edges = [];
    for (const wireId of document.wireOrder) {
        const wire = document.wires[wireId];
        if (!wire || wire.hidden || wire.source.kind !== 'port' || wire.target.kind !== 'port')
            continue;
        edges.push({
            id: wireId,
            sources: [`${wire.source.componentId}:${wire.source.portId}`],
            targets: [`${wire.target.componentId}:${wire.target.portId}`],
        });
    }

    return {
        id: options.id ?? document.id ?? 'editor-core',
        children,
        edges,
        layoutOptions: {
            'elk.algorithm': options.algorithm ?? 'layered',
            'elk.direction': direction,
            'elk.edgeRouting': options.edgeRouting ?? 'ORTHOGONAL',
            'elk.spacing.nodeNode': String(options.nodeSpacing ?? 32),
            'elk.layered.spacing.nodeNodeBetweenLayers': String(options.layerSpacing ?? 48),
            ...(options.layoutOptions ?? {}),
        },
    };
}

/** Converts ELK edge sections into editor-core route point arrays. */
export function routesFromElkResult(result) {
    const routes = new Map();
    for (const edge of result?.edges ?? []) {
        const points = [];
        for (const section of edge.sections ?? []) {
            const sectionPoints = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].filter(Boolean);
            for (const candidate of sectionPoints) {
                const previous = points[points.length - 1];
                if (!previous || previous.x !== candidate.x || previous.y !== candidate.y)
                    points.push({ x: candidate.x, y: candidate.y });
            }
        }
        if (points.length >= 2)
            routes.set(edge.id, points);
    }
    return routes;
}

/**
 * Creates a libavoid-style request model that can be serialized to a worker or
 * WASM adapter. No libavoid binary is bundled by editor-core.
 */
export function createLibavoidRequest(scene, options = {}) {
    const shapes = [];
    for (const [componentId, geometry] of Object.entries(scene.componentGeometries)) {
        const body = geometry.worldBody;
        shapes.push({
            id: componentId,
            rect: {
                x: body.x - (options.clearance ?? 12),
                y: body.y - (options.clearance ?? 12),
                width: body.width + (options.clearance ?? 12) * 2,
                height: body.height + (options.clearance ?? 12) * 2,
            },
            pins: Object.values(geometry.ports).map((port) => ({
                id: port.portId,
                point: port.center,
                side: port.side,
            })),
        });
    }
    const connectors = [];
    for (const wireId of scene.document.wireOrder) {
        const wire = scene.document.wires[wireId];
        if (!wire || wire.hidden)
            continue;
        connectors.push({
            id: wireId,
            source: wire.source,
            target: wire.target,
            orthogonal: wire.routing?.pattern !== 'direct',
            existingRoute: wire.route?.points,
        });
    }
    return {
        shapes,
        connectors,
        options: {
            orthogonal: options.orthogonal ?? true,
            nudgeSharedPaths: options.nudgeSharedPaths ?? true,
            transaction: options.transaction ?? true,
        },
    };
}
