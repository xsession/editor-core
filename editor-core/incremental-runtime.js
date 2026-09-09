import {
    inflateRect,
    polylineIntersectsRect,
    rectsIntersect,
    routeBounds,
    unionRects,
} from './geometry.js';
import { ApproximateTextMeasurer, buildComponentGeometry } from './component.js';
import { placeLabels } from './labels.js';
import { cloneDocument } from './serialization.js';
import { validateDocument } from './validation.js';
import {
    buildVisualRenderPlan,
    deriveEditorSceneOptimized,
    SceneSpatialIndex,
} from './advanced-visual.js';
import {
    findWireCrossingsIndexed,
    routeWireAccelerated,
    RoutingSpatialAccelerator,
} from './routing-accelerator.js';
import { AdaptiveSpatialIndex } from './adaptive-spatial.js';
import { MutableConnectivityIndex } from './connectivity-index.js';

const ZERO_COUNTS = Object.freeze({ components: 0, ports: 0, labels: 0, wires: 0, segments: 0, waypoints: 0 });

function sameOrder(a, b) {
    if (a.length !== b.length)
        return false;
    for (let index = 0; index < a.length; index += 1)
        if (a[index] !== b[index])
            return false;
    return true;
}

function copyCounts(value = ZERO_COUNTS) {
    return { ...ZERO_COUNTS, ...value };
}

function addCounts(target, source, sign = 1) {
    for (const key of Object.keys(ZERO_COUNTS))
        target[key] += (source[key] ?? 0) * sign;
}

function segmentBounds(start, end, padding = 0) {
    return {
        x: Math.min(start.x, end.x) - padding,
        y: Math.min(start.y, end.y) - padding,
        width: Math.abs(end.x - start.x) + padding * 2,
        height: Math.abs(end.y - start.y) + padding * 2,
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

function cloneRoute(route) {
    if (!route)
        return route;
    return {
        ...route,
        points: route.points?.map((point) => ({ ...point })) ?? [],
        segments: route.segments?.map((segment) => ({ start: { ...segment.start }, end: { ...segment.end }, axis: segment.axis, length: segment.length })) ?? [],
        cornerRadii: [...(route.cornerRadii ?? [])],
        obstacleViolations: [...(route.obstacleViolations ?? [])],
        diagnostics: [...(route.diagnostics ?? [])],
    };
}

function labelAnchoredTo(label, componentIds, wireIds) {
    if (!label?.anchor)
        return false;
    if ((label.anchor.ownerKind === 'component' || label.anchor.ownerKind === 'port') && label.anchor.ownerId)
        return componentIds.has(label.anchor.ownerId);
    if (label.anchor.ownerKind === 'wire' && label.anchor.ownerId)
        return wireIds.has(label.anchor.ownerId);
    return false;
}

/**
 * SceneSpatialIndex variant that can update one component/wire/label owner at
 * a time instead of rebuilding all broad-phase items after every edit.
 */
export class IncrementalSceneSpatialIndex extends SceneSpatialIndex {
    ownerItems = new Map();
    ownerCounts = new Map();

    constructor(cellSizeOrOptions = 128) {
        const options = typeof cellSizeOrOptions === 'object' ? cellSizeOrOptions : undefined;
        const baseCellSize = options?.cellSizes?.[0] ?? options?.cellSize ?? cellSizeOrOptions;
        super(baseCellSize);
        if (options?.adaptive !== false)
            this.index = new AdaptiveSpatialIndex(options);
    }

    rebuild(document, componentGeometries, labelPlacements = []) {
        super.rebuild(document, componentGeometries, labelPlacements);
        this.ownerItems.clear();
        this.ownerCounts.clear();
        for (let orderIndex = 0; orderIndex < document.componentOrder.length; orderIndex += 1) {
            const componentId = document.componentOrder[orderIndex];
            const geometry = componentGeometries[componentId];
            if (!geometry)
                continue;
            const ids = new Set([`component:${componentId}`]);
            for (const port of Object.values(geometry.ports))
                ids.add(`port:${componentId}:${port.portId}`);
            this.ownerItems.set(`component:${componentId}`, ids);
            this.ownerCounts.set(`component:${componentId}`, copyCounts({ components: 1, ports: ids.size - 1 }));
        }
        for (const placement of labelPlacements) {
            this.ownerItems.set(`label:${placement.labelId}`, new Set([`label:${placement.labelId}`]));
            this.ownerCounts.set(`label:${placement.labelId}`, copyCounts({ labels: 1 }));
        }
        for (const wireId of document.wireOrder) {
            const wire = document.wires[wireId];
            if (!wire?.route?.points?.length)
                continue;
            const ids = new Set([`wire:${wireId}`]);
            for (let index = 0; index < wire.route.points.length - 1; index += 1)
                ids.add(`segment:${wireId}:${index}`);
            for (let index = 1; index < wire.route.points.length - 1; index += 1)
                ids.add(`waypoint:${wireId}:${index}`);
            this.ownerItems.set(`wire:${wireId}`, ids);
            this.ownerCounts.set(`wire:${wireId}`, copyCounts({ wires: 1, segments: Math.max(0, wire.route.points.length - 1), waypoints: Math.max(0, wire.route.points.length - 2) }));
        }
        return this;
    }

    removeOwner(ownerKey) {
        for (const itemId of this.ownerItems.get(ownerKey) ?? [])
            this.index.remove(itemId);
        const previous = this.ownerCounts.get(ownerKey);
        if (previous)
            addCounts(this.stats, previous, -1);
        this.ownerItems.delete(ownerKey);
        this.ownerCounts.delete(ownerKey);
    }

    setOwner(ownerKey, items, counts) {
        this.removeOwner(ownerKey);
        const ids = new Set();
        for (const item of items) {
            this.index.insert(item);
            ids.add(item.id);
        }
        this.ownerItems.set(ownerKey, ids);
        const normalized = copyCounts(counts);
        this.ownerCounts.set(ownerKey, normalized);
        addCounts(this.stats, normalized, 1);
    }

    upsertComponent(document, componentId, geometry, orderIndex = document.componentOrder.indexOf(componentId)) {
        const component = document.components[componentId];
        if (!component || !geometry || component.hidden) {
            this.removeOwner(`component:${componentId}`);
            return;
        }
        const items = [{
            id: `component:${componentId}`,
            bounds: geometry.worldBounds,
            zIndex: orderIndex * 10 + 600,
            value: { kind: 'component', id: componentId },
        }];
        for (const port of Object.values(geometry.ports)) {
            items.push({
                id: `port:${componentId}:${port.portId}`,
                bounds: port.hitBounds,
                zIndex: orderIndex * 10 + 900,
                value: { kind: 'port', id: componentId, subId: port.portId },
            });
        }
        this.setOwner(`component:${componentId}`, items, { components: 1, ports: items.length - 1 });
    }

    upsertWire(wire) {
        if (!wire?.route?.points?.length || wire.hidden) {
            this.removeOwner(`wire:${wire?.id}`);
            return;
        }
        const points = wire.route.points;
        const padding = Math.max(1, (wire.style?.width ?? 1) / 2);
        const items = [{
            id: `wire:${wire.id}`,
            bounds: routeBounds(points, padding),
            zIndex: (wire.style?.zIndex ?? 0) + 500,
            value: { kind: 'wire', id: wire.id },
        }];
        for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
            items.push({
                id: `segment:${wire.id}:${segmentIndex}`,
                bounds: segmentBounds(points[segmentIndex], points[segmentIndex + 1], padding),
                zIndex: (wire.style?.zIndex ?? 0) + 800,
                value: { kind: 'route-segment', id: wire.id, subId: segmentIndex },
            });
        }
        for (let waypointIndex = 1; waypointIndex < points.length - 1; waypointIndex += 1) {
            const waypoint = points[waypointIndex];
            items.push({
                id: `waypoint:${wire.id}:${waypointIndex}`,
                bounds: { x: waypoint.x - padding, y: waypoint.y - padding, width: padding * 2, height: padding * 2 },
                zIndex: (wire.style?.zIndex ?? 0) + 850,
                value: { kind: 'route-waypoint', id: wire.id, subId: waypointIndex },
            });
        }
        this.setOwner(`wire:${wire.id}`, items, {
            wires: 1,
            segments: Math.max(0, points.length - 1),
            waypoints: Math.max(0, points.length - 2),
        });
    }

    upsertLabel(document, placement) {
        const label = document.labels[placement?.labelId];
        if (!label || !placement || label.visible === false) {
            if (placement?.labelId)
                this.removeOwner(`label:${placement.labelId}`);
            return;
        }
        this.setOwner(`label:${placement.labelId}`, [{
            id: `label:${placement.labelId}`,
            bounds: placement.bounds,
            zIndex: 10_000 + (label.priority ?? 0) + 700,
            value: { kind: 'label', id: placement.labelId },
        }], { labels: 1 });
    }
}

function normalizeImpact(impact = {}) {
    return {
        changedComponents: new Set(impact.changedComponents ?? []),
        changedPorts: new Set(impact.changedPorts ?? []),
        reroutedWires: new Set(impact.reroutedWires ?? []),
        invalidatedWires: new Set(impact.invalidatedWires ?? []),
        detachedWires: new Set(impact.detachedWires ?? []),
        movedLabels: new Set(impact.movedLabels ?? []),
    };
}

/**
 * Incremental scene coordinator intended for drag/edit hot paths. It reuses
 * unchanged geometry/routes/labels, reroutes wires near moved obstacles, and
 * updates the broad-phase index per owner.
 */
export class IncrementalSceneRuntime {
    options;
    scene;
    spatialIndex;
    connectivityIndex;
    metrics = {
        fullRebuilds: 0,
        incrementalUpdates: 0,
        lastUpdateMs: 0,
        lastChangedComponents: 0,
        lastReroutedWires: 0,
        lastReflowedLabels: 0,
    };

    constructor(options = {}) {
        this.options = {
            spatialCellSize: options.spatialCellSize ?? 128,
            spatialCellSizes: options.spatialCellSizes ?? [64, 256, 1024, 4096],
            adaptiveSpatial: options.adaptiveSpatial ?? true,
            routingCellSize: options.routingCellSize ?? 192,
            dirtyPadding: options.dirtyPadding ?? 48,
            labelFullReflowRatio: options.labelFullReflowRatio ?? 0.35,
            validate: options.validate ?? true,
            findCrossings: options.findCrossings ?? true,
            ...options,
        };
    }

    reset(source) {
        const started = globalThis.performance?.now?.() ?? Date.now();
        const scene = deriveEditorSceneOptimized(source, {
            ...this.options,
            buildSpatialIndex: false,
            findCrossings: false,
        });
        if (this.options.findCrossings)
            scene.crossings = findWireCrossingsIndexed(Object.values(scene.document.wires), { cellSize: this.options.routingCellSize });
        this.connectivityIndex = new MutableConnectivityIndex(scene.document);
        scene.connectivityIndex = this.connectivityIndex;
        const spatialOptions = this.options.adaptiveSpatial
            ? { cellSizes: this.options.spatialCellSizes, adaptive: true }
            : this.options.spatialCellSize;
        this.spatialIndex = new IncrementalSceneSpatialIndex(spatialOptions)
            .rebuild(scene.document, scene.componentGeometries, scene.labelPlacementList);
        scene.spatialIndex = this.spatialIndex;
        scene.incrementalImpact = { full: true, changedComponents: [...scene.document.componentOrder], affectedWires: [...scene.document.wireOrder], affectedLabels: [...scene.document.labelOrder] };
        this.scene = scene;
        const finished = globalThis.performance?.now?.() ?? Date.now();
        this.metrics.fullRebuilds += 1;
        this.metrics.lastUpdateMs = finished - started;
        return scene;
    }

    requiresFullRebuild(source, impact) {
        if (!this.scene)
            return true;
        const previous = this.scene.document;
        if (source.id !== previous.id || source.schemaVersion !== previous.schemaVersion)
            return true;
        if (!sameOrder(source.componentOrder, previous.componentOrder) ||
            !sameOrder(source.wireOrder, previous.wireOrder) ||
            !sameOrder(source.labelOrder, previous.labelOrder))
            return true;
        const hinted = (impact.changedComponents?.length ?? 0) +
            (impact.changedPorts?.length ?? 0) +
            (impact.reroutedWires?.length ?? 0) +
            (impact.invalidatedWires?.length ?? 0) +
            (impact.detachedWires?.length ?? 0) +
            (impact.movedLabels?.length ?? 0);
        return source.revision !== previous.revision && hinted === 0;
    }

    update(source, impact = {}) {
        if (this.requiresFullRebuild(source, impact))
            return this.reset(source);
        const started = globalThis.performance?.now?.() ?? Date.now();
        const previous = this.scene;
        const document = cloneDocument(source);
        const normalized = normalizeImpact(impact);
        const impactedWireIds = new Set([
            ...normalized.reroutedWires,
            ...normalized.invalidatedWires,
            ...normalized.detachedWires,
        ]);
        const connectivityIndex = this.connectivityIndex ?? new MutableConnectivityIndex(previous.document);
        connectivityIndex.applyDocumentWires(document, impactedWireIds);
        const geometries = { ...previous.componentGeometries };

        const changedComponents = new Set(normalized.changedComponents);
        for (const wireId of impactedWireIds) {
            for (const endpoint of [previous.document.wires[wireId]?.source, previous.document.wires[wireId]?.target, document.wires[wireId]?.source, document.wires[wireId]?.target]) {
                if (endpoint?.kind === 'port')
                    changedComponents.add(endpoint.componentId);
            }
        }

        const dirtyBounds = [];
        const textMeasurer = this.options.textMeasurer ?? new ApproximateTextMeasurer();
        for (const componentId of changedComponents) {
            const oldGeometry = previous.componentGeometries[componentId];
            if (oldGeometry)
                dirtyBounds.push(oldGeometry.worldBounds);
            const component = document.components[componentId];
            if (!component || component.hidden) {
                delete geometries[componentId];
                continue;
            }
            const geometry = buildComponentGeometry(component, {
                textMeasurer,
                connectedPortIds: connectivityIndex.connectedPortIds(componentId),
                minimumPortHitSize: document.settings.portTargetSizePx,
            });
            geometries[componentId] = geometry;
            dirtyBounds.push(geometry.worldBounds);
        }

        let dirtyRegion;
        if (dirtyBounds.length > 0)
            dirtyRegion = inflateRect(unionRects(dirtyBounds), this.options.dirtyPadding);

        const affectedWires = new Set(impactedWireIds);
        for (const componentId of changedComponents) {
            for (const wireId of connectivityIndex.wiresForComponent(componentId))
                affectedWires.add(wireId);
            for (const wireId of previous.connectivityIndex?.wiresForComponent?.(componentId) ?? [])
                affectedWires.add(wireId);
        }
        if (dirtyRegion && previous.spatialIndex) {
            for (const item of previous.spatialIndex.queryRect(dirtyRegion)) {
                if (item.value.kind === 'wire' || item.value.kind === 'route-segment')
                    affectedWires.add(item.value.id);
            }
        }

        const obstacles = [
            ...Object.values(geometries).map((geometry) => ({ id: geometry.componentId, rect: geometry.worldBody, kind: 'component' })),
            ...(this.options.extraRoutingObstacles ?? []),
        ];
        const accelerator = new RoutingSpatialAccelerator(this.options.routingCellSize).rebuild(obstacles, [], document.revision);
        const routes = {};
        let reroutedCount = 0;
        for (const wireId of document.wireOrder) {
            const wire = document.wires[wireId];
            if (!wire || wire.hidden)
                continue;
            const previousWire = previous.document.wires[wireId];
            if (!affectedWires.has(wireId) && previousWire?.route)
                wire.route = cloneRoute(previousWire.route);
            if (affectedWires.has(wireId) || !wire.route) {
                wire.route = routeWireAccelerated(wire, {
                    componentGeometries: geometries,
                    obstacles,
                    existingRoutes: [...accelerator.routes.values()],
                    revision: document.revision,
                }, accelerator, this.options.acceleratedRouting);
                reroutedCount += 1;
            }
            if (wire.route) {
                routes[wireId] = wire.route;
                accelerator.upsertRoute({ wireId, points: wire.route.points, zIndex: wire.style?.zIndex });
            }
        }

        const affectedLabels = new Set(normalized.movedLabels);
        for (const labelId of document.labelOrder) {
            const label = document.labels[labelId];
            if (labelAnchoredTo(label, changedComponents, affectedWires))
                affectedLabels.add(labelId);
        }
        if (dirtyRegion && previous.spatialIndex) {
            for (const item of previous.spatialIndex.queryRect(dirtyRegion))
                if (item.value.kind === 'label')
                    affectedLabels.add(item.value.id);
        }

        let labelPlacements;
        const reflowRatio = document.labelOrder.length > 0 ? affectedLabels.size / document.labelOrder.length : 0;
        if (affectedLabels.size === 0) {
            labelPlacements = { ...previous.labelPlacements };
        }
        else if (reflowRatio >= this.options.labelFullReflowRatio) {
            labelPlacements = placeLabels(document.labelOrder.map((id) => document.labels[id]).filter(Boolean), textMeasurer, {
                components: geometries,
                routes,
                previousPlacements: previous.labelPlacements,
                fixedObstacles: this.options.fixedLabelObstacles,
                labelGap: document.settings.labelGap,
                wireClearance: Math.max(2, document.settings.hitTolerancePx / 2),
            });
        }
        else {
            const unchanged = {};
            for (const labelId of document.labelOrder) {
                if (affectedLabels.has(labelId))
                    continue;
                const placement = previous.labelPlacements[labelId];
                if (placement)
                    unchanged[labelId] = placement;
            }
            const fixedObstacles = [
                ...(this.options.fixedLabelObstacles ?? []),
                ...Object.values(unchanged).map((placement) => ({ id: `label:${placement.labelId}`, rect: placement.bounds, weight: 1 })),
            ];
            const changedPlacements = placeLabels(
                [...affectedLabels].map((id) => document.labels[id]).filter(Boolean),
                textMeasurer,
                {
                    components: geometries,
                    routes,
                    previousPlacements: previous.labelPlacements,
                    fixedObstacles,
                    labelGap: document.settings.labelGap,
                    wireClearance: Math.max(2, document.settings.hitTolerancePx / 2),
                },
            );
            labelPlacements = { ...unchanged, ...changedPlacements };
        }

        const labelPlacementList = document.labelOrder.map((id) => labelPlacements[id]).filter(Boolean);
        const wires = document.wireOrder.map((id) => document.wires[id]).filter(Boolean);
        const crossings = this.options.findCrossings
            ? findWireCrossingsIndexed(wires, { cellSize: this.options.routingCellSize })
            : [];
        const validationIssues = this.options.validate
            ? validateDocument(document, geometries, labelPlacements)
            : [];
        const contentBounds = calculateContentBounds(document, geometries, labelPlacements, this.options.contentPadding ?? 80);

        for (const componentId of changedComponents)
            this.spatialIndex.upsertComponent(document, componentId, geometries[componentId]);
        for (const wireId of affectedWires)
            this.spatialIndex.upsertWire(document.wires[wireId]);
        for (const labelId of affectedLabels) {
            const placement = labelPlacements[labelId];
            if (placement)
                this.spatialIndex.upsertLabel(document, placement);
            else
                this.spatialIndex.removeOwner(`label:${labelId}`);
        }
        this.spatialIndex.revision = document.revision;

        this.connectivityIndex = connectivityIndex;
        this.scene = {
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
            spatialIndex: this.spatialIndex,
            incrementalImpact: {
                full: false,
                changedComponents: [...changedComponents],
                affectedWires: [...affectedWires],
                affectedLabels: [...affectedLabels],
            },
        };
        const finished = globalThis.performance?.now?.() ?? Date.now();
        this.metrics.incrementalUpdates += 1;
        this.metrics.lastUpdateMs = finished - started;
        this.metrics.lastChangedComponents = changedComponents.size;
        this.metrics.lastReroutedWires = reroutedCount;
        this.metrics.lastReflowedLabels = affectedLabels.size;
        return this.scene;
    }

    renderPlan(options = {}) {
        if (!this.scene)
            throw new Error('IncrementalSceneRuntime has no scene. Call reset(document) first.');
        return buildVisualRenderPlan(this.scene, {
            ...options,
            spatialIndex: options.spatialIndex ?? this.spatialIndex,
        });
    }
}
