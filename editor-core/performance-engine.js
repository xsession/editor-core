import { HarnessEditorEngine as LegacyHarnessEditorEngine } from './engine.js';
import { deepClone } from './commands.js';
import { IncrementalSceneRuntime } from './incremental-runtime.js';
import { parseDocument } from './serialization.js';

function createImpact() {
    return {
        changedComponents: [],
        changedPorts: [],
        reroutedWires: [],
        invalidatedWires: [],
        detachedWires: [],
        movedLabels: [],
        overlappingLabels: [],
        warnings: [],
        addedComponents: [],
        removedComponents: [],
        addedWires: [],
        removedWires: [],
        addedLabels: [],
        removedLabels: [],
        changedObstacles: [],
        dependencyReroutedWires: [],
        reflowedLabels: [],
        routingObstacleRevision: 0,
        routingTopologyRevision: 0,
        routingEnvironmentRevision: 0,
        fullRebuild: false,
    };
}

function addUnique(target, values) {
    const seen = new Set(target);
    for (const value of values ?? []) {
        if (!seen.has(value)) {
            seen.add(value);
            target.push(value);
        }
    }
}

function mergeImpact(target, source) {
    if (!source)
        return target;
    for (const key of [
        'changedComponents', 'changedPorts', 'reroutedWires', 'invalidatedWires',
        'detachedWires', 'movedLabels', 'overlappingLabels', 'warnings',
        'addedComponents', 'removedComponents', 'addedWires', 'removedWires',
        'addedLabels', 'removedLabels', 'changedObstacles',
        'dependencyReroutedWires', 'reflowedLabels',
    ])
        addUnique(target[key] ?? (target[key] = []), source[key] ?? []);
    for (const key of ['routingObstacleRevision', 'routingTopologyRevision', 'routingEnvironmentRevision']) {
        if (source[key] !== undefined)
            target[key] = source[key];
    }
    target.fullRebuild = Boolean(target.fullRebuild || source.fullRebuild);
    return target;
}

function semanticWire(wire) {
    if (!wire)
        return wire;
    const { route: _route, ...rest } = wire;
    return rest;
}

function changed(before, after) {
    return JSON.stringify(before) !== JSON.stringify(after);
}

function copyRoutes(source, target) {
    for (const wireId of target.wireOrder ?? []) {
        const from = source.wires?.[wireId];
        const to = target.wires?.[wireId];
        if (!from || !to)
            continue;
        to.route = from.route ? deepClone(from.route) : undefined;
    }
}

function endpointMatches(endpoint, componentId, portId) {
    return endpoint?.kind === 'port' && endpoint.componentId === componentId && endpoint.portId === portId;
}

/**
 * Production-oriented engine facade. The package entry point exports this class
 * as HarnessEditorEngine while retaining the original generated engine as
 * LegacyHarnessEditorEngine.
 *
 * The class keeps mutation impacts authoritative by diffing semantic document
 * state after every mutation and then merges dependency-driven reroutes/reflows
 * discovered by IncrementalSceneRuntime. Scene derivation is performed once per
 * committed operation rather than twice as in the legacy execute path.
 */
export class HarnessEditorEngine extends LegacyHarnessEditorEngine {
    constructor(document, options = {}) {
        super(document, options);
        this.performanceOptions = {
            spatialCellSize: options.spatialCellSize,
            spatialCellSizes: options.spatialCellSizes,
            adaptiveSpatial: options.adaptiveSpatial,
            routingCellSize: options.routingCellSize,
            dirtyPadding: options.dirtyPadding,
            labelFullReflowRatio: options.labelFullReflowRatio,
            acceleratedRouting: options.acceleratedRouting,
            findCrossings: options.findCrossings,
            ...options.performance,
        };
        // The base constructor calls the overridden recomputeDerived before the
        // subclass constructor body runs. Reinitialize only when explicit
        // performance options differ from the lazy defaults used there.
        if (Object.values(this.performanceOptions).some((value) => value !== undefined)) {
            this.__performanceState = undefined;
            this.recomputeDerived(this.documentState, true);
        }
    }

    static fromJSON(serialized, options = {}) {
        return new HarnessEditorEngine(parseDocument(serialized), options);
    }

    get scene() {
        return this.__performanceState?.runtime?.scene;
    }

    get connectivityIndex() {
        return this.__performanceState?.runtime?.connectivityIndex;
    }

    get routingObstacleRevision() {
        return this.__performanceState?.obstacleRevision ?? 0;
    }

    get routingTopologyRevision() {
        return this.__performanceState?.topologyRevision ?? 0;
    }

    get routingEnvironmentRevision() {
        return this.__performanceState?.environmentRevision ?? 0;
    }

    get performanceMetrics() {
        return {
            ...(this.__performanceState?.runtime?.metrics ?? {}),
            routingObstacleRevision: this.routingObstacleRevision,
            routingTopologyRevision: this.routingTopologyRevision,
            routingEnvironmentRevision: this.routingEnvironmentRevision,
            lastImpact: this.__performanceState?.lastImpact,
        };
    }

    ensurePerformanceState(document = this.documentState) {
        if (this.__performanceState)
            return this.__performanceState;
        const runtime = new IncrementalSceneRuntime({
            autoRoute: this.options?.autoRoute ?? true,
            validate: this.options?.validateOnChange ?? true,
            ...(this.performanceOptions ?? {}),
        });
        this.__performanceState = {
            runtime,
            obstacleRevision: 0,
            topologyRevision: 0,
            environmentRevision: 0,
            lastImpact: undefined,
            pendingScene: undefined,
            pendingRevision: undefined,
        };
        const scene = runtime.reset(document);
        copyRoutes(scene.document, document);
        this.adoptScene(scene);
        return this.__performanceState;
    }

    adoptScene(scene) {
        if (!scene)
            return;
        this.geometryState = scene.componentGeometries;
        this.labelPlacementState = scene.labelPlacementList;
        this.validationState = scene.validationIssues;
    }

    authoritativeDiff(before, after) {
        const impact = createImpact();
        const componentIds = new Set([...Object.keys(before.components ?? {}), ...Object.keys(after.components ?? {})]);
        for (const id of componentIds) {
            const a = before.components?.[id];
            const b = after.components?.[id];
            if (!a && b)
                impact.addedComponents.push(id);
            else if (a && !b)
                impact.removedComponents.push(id);
            if (changed(a, b)) {
                impact.changedComponents.push(id);
                const beforePorts = new Set((a?.ports ?? []).map((port) => port.id));
                const afterPorts = new Set((b?.ports ?? []).map((port) => port.id));
                for (const portId of new Set([...beforePorts, ...afterPorts]))
                    impact.changedPorts.push(portId);
            }
        }

        const wireIds = new Set([...Object.keys(before.wires ?? {}), ...Object.keys(after.wires ?? {})]);
        for (const id of wireIds) {
            const a = before.wires?.[id];
            const b = after.wires?.[id];
            if (!a && b)
                impact.addedWires.push(id);
            else if (a && !b)
                impact.removedWires.push(id);
            if (changed(semanticWire(a), semanticWire(b)))
                impact.reroutedWires.push(id);
        }

        const labelIds = new Set([...Object.keys(before.labels ?? {}), ...Object.keys(after.labels ?? {})]);
        for (const id of labelIds) {
            const a = before.labels?.[id];
            const b = after.labels?.[id];
            if (!a && b)
                impact.addedLabels.push(id);
            else if (a && !b)
                impact.removedLabels.push(id);
            if (changed(a, b))
                impact.movedLabels.push(id);
        }
        return impact;
    }

    updateEnvironmentRevisions(before, after, impact) {
        const state = this.ensurePerformanceState(before);
        const obstacleChanged = impact.changedComponents.length > 0 || impact.changedPorts.length > 0;
        let topologyChanged = impact.addedWires.length > 0 || impact.removedWires.length > 0;
        if (!topologyChanged) {
            for (const wireId of impact.reroutedWires) {
                if (changed(semanticWire(before.wires?.[wireId]), semanticWire(after.wires?.[wireId]))) {
                    topologyChanged = true;
                    break;
                }
            }
        }
        if (obstacleChanged) {
            state.obstacleRevision += 1;
            addUnique(impact.changedObstacles, impact.changedComponents);
        }
        if (topologyChanged)
            state.topologyRevision += 1;
        if (obstacleChanged || topologyChanged)
            state.environmentRevision += 1;
        impact.routingObstacleRevision = state.obstacleRevision;
        impact.routingTopologyRevision = state.topologyRevision;
        impact.routingEnvironmentRevision = state.environmentRevision;
    }

    finalizeDerivedImpact(impact, scene) {
        const incremental = scene?.incrementalImpact;
        if (incremental) {
            addUnique(impact.dependencyReroutedWires, incremental.affectedWires);
            addUnique(impact.reroutedWires, incremental.affectedWires);
            addUnique(impact.reflowedLabels, incremental.affectedLabels);
            addUnique(impact.movedLabels, incremental.affectedLabels);
            impact.fullRebuild = Boolean(incremental.full);
        }
        for (const wireId of impact.reroutedWires) {
            const wire = scene?.document?.wires?.[wireId];
            if (wire?.route?.status === 'invalid')
                addUnique(impact.invalidatedWires, [wireId]);
        }
        for (const placement of scene?.labelPlacementList ?? []) {
            if (placement.status === 'overlap')
                addUnique(impact.overlappingLabels, [placement.labelId]);
        }
        const state = this.ensurePerformanceState(scene?.document ?? this.documentState);
        impact.routingObstacleRevision = state.obstacleRevision;
        impact.routingTopologyRevision = state.topologyRevision;
        impact.routingEnvironmentRevision = state.environmentRevision;
        state.lastImpact = deepClone(impact);
        return impact;
    }

    recomputeDerived(document, updateInstance, impact) {
        const state = this.ensurePerformanceState(document);
        let scene;
        if (state.pendingScene && state.pendingRevision === document.revision) {
            scene = state.pendingScene;
        }
        else if (!state.runtime.scene || state.runtime.scene.document.id !== document.id) {
            scene = state.runtime.reset(document);
        }
        else {
            scene = state.runtime.update(document, impact ?? {});
        }
        copyRoutes(scene.document, document);
        if (impact)
            this.finalizeDerivedImpact(impact, scene);
        state.pendingScene = scene;
        state.pendingRevision = document.revision;
        if (updateInstance) {
            this.adoptScene(scene);
            state.pendingScene = undefined;
            state.pendingRevision = undefined;
        }
        return scene;
    }

    execute(label, mutate, options = {}) {
        if (this.preview)
            throw new Error('Cannot execute a committed command while a preview gesture is active.');
        this.ensurePerformanceState();
        const before = deepClone(this.documentState);
        const impact = createImpact();
        const result = this.history.execute(label, this.documentState, (draft) => {
            mutate(draft, impact);
            mergeImpact(impact, this.authoritativeDiff(before, draft));
            this.updateEnvironmentRevisions(before, draft, impact);
            draft.revision += 1;
            const scene = this.recomputeDerived(draft, false, impact);
            copyRoutes(scene.document, draft);
        }, options);
        this.documentState = result.state;
        const state = this.ensurePerformanceState();
        this.adoptScene(state.pendingScene ?? state.runtime.scene);
        state.pendingScene = undefined;
        state.pendingRevision = undefined;
        this.finalizeDerivedImpact(impact, state.runtime.scene);
        this.emitAll(label, impact);
        return impact;
    }

    beginPreview(label, mergeKey) {
        if (this.preview)
            throw new Error('A preview gesture is already active.');
        this.ensurePerformanceState();
        this.preview = { label, before: deepClone(this.documentState), mergeKey };
        this.events.emit('interactionChanged', { state: `preview:${label}` });
    }

    updatePreview(mutate) {
        if (!this.preview)
            throw new Error('No preview gesture is active.');
        const previousDisplayed = deepClone(this.documentState);
        const draft = deepClone(this.preview.before);
        const impact = createImpact();
        mutate(draft, impact);
        mergeImpact(impact, this.authoritativeDiff(previousDisplayed, draft));
        this.updateEnvironmentRevisions(previousDisplayed, draft, impact);
        const scene = this.recomputeDerived(draft, false, impact);
        copyRoutes(scene.document, draft);
        this.documentState = draft;
        this.adoptScene(scene);
        const state = this.ensurePerformanceState();
        state.pendingScene = undefined;
        state.pendingRevision = undefined;
        this.finalizeDerivedImpact(impact, scene);
        this.events.emit('documentChanged', { document: this.documentState, reason: `preview:${this.preview.label}`, impact });
        return impact;
    }

    commitPreview() {
        if (!this.preview)
            return createImpact();
        const preview = this.preview;
        const before = preview.before;
        const after = deepClone(this.documentState);
        const impact = this.authoritativeDiff(before, after);
        // Geometry/routing has already been derived by the latest preview frame.
        after.revision = before.revision + 1;
        const state = this.ensurePerformanceState();
        if (state.runtime.scene) {
            state.runtime.scene.document = deepClone(after);
            state.runtime.scene.document.revision = after.revision;
            state.runtime.scene.spatialIndex.revision = after.revision;
        }
        impact.routingObstacleRevision = state.obstacleRevision;
        impact.routingTopologyRevision = state.topologyRevision;
        impact.routingEnvironmentRevision = state.environmentRevision;
        this.history.record(preview.label, before, after, { mergeKey: preview.mergeKey });
        this.documentState = after;
        this.preview = undefined;
        this.adoptScene(state.runtime.scene);
        this.finalizeDerivedImpact(impact, state.runtime.scene);
        this.emitAll(preview.label, impact);
        this.events.emit('interactionChanged', { state: 'idle' });
        return impact;
    }

    cancelPreview() {
        if (!this.preview)
            return;
        const label = this.preview.label;
        const current = deepClone(this.documentState);
        const restored = deepClone(this.preview.before);
        const impact = this.authoritativeDiff(current, restored);
        this.updateEnvironmentRevisions(current, restored, impact);
        this.documentState = restored;
        this.preview = undefined;
        const scene = this.ensurePerformanceState().runtime.update(restored, impact);
        copyRoutes(scene.document, this.documentState);
        this.adoptScene(scene);
        this.finalizeDerivedImpact(impact, scene);
        this.events.emit('documentChanged', { document: this.documentState, reason: `cancel:${label}`, impact });
        this.events.emit('interactionChanged', { state: 'idle' });
    }

    replaceDocument(document, reason = 'replace document') {
        this.documentState = deepClone(document);
        this.history.clear();
        this.preview = undefined;
        this.selectionState = { items: [] };
        const state = this.ensurePerformanceState();
        const scene = state.runtime.reset(this.documentState);
        state.obstacleRevision += 1;
        state.topologyRevision += 1;
        state.environmentRevision += 1;
        copyRoutes(scene.document, this.documentState);
        this.adoptScene(scene);
        const impact = createImpact();
        impact.fullRebuild = true;
        impact.changedComponents = [...this.documentState.componentOrder];
        impact.reroutedWires = [...this.documentState.wireOrder];
        impact.movedLabels = [...this.documentState.labelOrder];
        impact.routingObstacleRevision = state.obstacleRevision;
        impact.routingTopologyRevision = state.topologyRevision;
        impact.routingEnvironmentRevision = state.environmentRevision;
        this.emitAll(reason, impact);
    }

    undo() {
        if (this.preview)
            this.cancelPreview();
        const before = deepClone(this.documentState);
        const result = this.history.undo(this.documentState);
        if (!result.entry)
            return;
        const impact = this.authoritativeDiff(before, result.state);
        this.updateEnvironmentRevisions(before, result.state, impact);
        this.documentState = result.state;
        const scene = this.ensurePerformanceState().runtime.update(this.documentState, impact);
        copyRoutes(scene.document, this.documentState);
        this.adoptScene(scene);
        this.finalizeDerivedImpact(impact, scene);
        this.emitAll(`undo:${result.entry.label}`, impact);
    }

    redo() {
        if (this.preview)
            this.cancelPreview();
        const before = deepClone(this.documentState);
        const result = this.history.redo(this.documentState);
        if (!result.entry)
            return;
        const impact = this.authoritativeDiff(before, result.state);
        this.updateEnvironmentRevisions(before, result.state, impact);
        this.documentState = result.state;
        const scene = this.ensurePerformanceState().runtime.update(this.documentState, impact);
        copyRoutes(scene.document, this.documentState);
        this.adoptScene(scene);
        this.finalizeDerivedImpact(impact, scene);
        this.emitAll(`redo:${result.entry.label}`, impact);
    }

    canConnectInDocument(document, source, target, excludingWireId) {
        if (document !== this.documentState)
            return super.canConnectInDocument(document, source, target, excludingWireId);
        if (source.kind === 'port' && target.kind === 'port' && source.componentId === target.componentId && source.portId === target.portId)
            return { valid: false, reason: 'A port cannot be connected to itself.' };
        const connectivity = this.connectivityIndex;
        for (const endpoint of [source, target]) {
            if (endpoint.kind !== 'port')
                continue;
            const component = document.components[endpoint.componentId];
            const port = component?.ports.find((candidate) => candidate.id === endpoint.portId);
            if (!component || !port)
                return { valid: false, reason: `Missing connection target ${endpoint.componentId}.${endpoint.portId}.` };
            let count = connectivity?.wiresForPort(endpoint.componentId, endpoint.portId)?.size ?? 0;
            if (excludingWireId) {
                const excluded = document.wires[excludingWireId];
                if (excluded && (endpointMatches(excluded.source, endpoint.componentId, endpoint.portId) || endpointMatches(excluded.target, endpoint.componentId, endpoint.portId)))
                    count -= 1;
            }
            if (count >= port.connectionPolicy.maximumConnections)
                return { valid: false, reason: `${component.designator}.${port.label} has reached its connection limit.` };
        }
        if (source.kind === 'port' && target.kind === 'port') {
            const sourcePort = document.components[source.componentId].ports.find((port) => port.id === source.portId);
            const targetPort = document.components[target.componentId].ports.find((port) => port.id === target.portId);
            if (!sourcePort.connectionPolicy.allowSelfConnection && source.componentId === target.componentId)
                return { valid: false, reason: 'Connections within the same component require an explicit self-connection policy.' };
            const allowed = sourcePort.connectionPolicy.allowedElectricalClasses;
            if (allowed && !allowed.includes(targetPort.electricalClass))
                return { valid: false, reason: `Electrical class ${targetPort.electricalClass} is not permitted by the source port.` };
        }
        return { valid: true, reason: '' };
    }
}

export { LegacyHarnessEditorEngine };
