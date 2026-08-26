import { deepClone } from './commands.js';
import { TypedEventEmitter } from './events.js';
import { add, rect, snapPoint, subtract } from './geometry.js';
import { hitTestDocument, marqueeSelect } from './spatial.js';
import { HarnessEditorEngine } from './engine.js';
import { createWaypointConstraint, moveOrthogonalSegment } from './routing.js';
import { snapComponentDrag } from './snapping.js';
function selectionFromHit(hit) {
    switch (hit.kind) {
        case 'component-body':
        case 'component-header':
            return { kind: 'component', id: hit.entityId };
        case 'port':
            return { kind: 'port', id: hit.entityId, subId: hit.subId };
        case 'wire':
        case 'route-segment':
        case 'route-waypoint':
            return { kind: 'wire', id: hit.entityId, subId: hit.subId };
        case 'label':
            return { kind: 'label', id: hit.entityId };
        default:
            return undefined;
    }
}
function portEndpointFromHit(hit) {
    if (hit.kind !== 'port' || typeof hit.subId !== 'string')
        return undefined;
    return { kind: 'port', componentId: hit.entityId, portId: hit.subId };
}
function marqueeBounds(start, current) {
    return rect(Math.min(start.x, current.x), Math.min(start.y, current.y), Math.abs(current.x - start.x), Math.abs(current.y - start.y));
}
function modifiersAdd(modifiers) {
    return modifiers.shift || modifiers.ctrl || modifiers.meta;
}
export class EditorInteractionController {
    engine;
    options;
    stateValue = { kind: 'idle' };
    events = new TypedEventEmitter();
    dragThresholdPx;
    componentDragStartGeometries;
    constructor(engine, options) {
        this.engine = engine;
        this.options = options;
        this.dragThresholdPx = options.dragThresholdPx ?? 3;
    }
    get state() {
        return this.stateValue;
    }
    on(type, listener) {
        return this.events.on(type, listener);
    }
    pointerDown(event) {
        const hits = this.hitsAt(event.point);
        const primary = hits[0];
        if (event.button === 2) {
            this.events.emit('contextMenuRequested', { point: event.point, hit: primary });
            return;
        }
        const panGesture = event.button === 1 || event.modifiers.space || (event.pointerType === 'touch' && (this.options.enableTouchPan ?? true));
        if (panGesture) {
            this.setState({ kind: 'pan', pointerId: event.pointerId, start: event.point, current: event.point });
            this.events.emit('cursorRequested', { cursor: 'grabbing' });
            return;
        }
        if (!primary) {
            this.setState({
                kind: 'marquee',
                pointerId: event.pointerId,
                start: event.point,
                current: event.point,
                additive: modifiersAdd(event.modifiers),
                subtractive: event.modifiers.alt,
            });
            if (!modifiersAdd(event.modifiers) && !event.modifiers.alt)
                this.engine.clearSelection();
            this.events.emit('marqueeChanged', { bounds: marqueeBounds(event.point, event.point), mode: 'window' });
            return;
        }
        if (primary.kind === 'port') {
            const source = portEndpointFromHit(primary);
            this.setState({ kind: 'connect-wire', pointerId: event.pointerId, source, current: event.point, valid: false });
            this.events.emit('connectionPreview', { source, point: event.point, valid: false, reason: 'Choose a target port.' });
            this.events.emit('cursorRequested', { cursor: 'crosshair' });
            return;
        }
        const selection = selectionFromHit(primary);
        if (selection) {
            if (modifiersAdd(event.modifiers))
                this.engine.toggleSelection(selection);
            else if (!this.engine.selection.items.some((item) => item.kind === selection.kind && item.id === selection.id && item.subId === selection.subId))
                this.engine.select([selection], selection);
        }
        if ((primary.kind === 'component-body' || primary.kind === 'component-header') && !this.engine.document.components[primary.entityId]?.locked) {
            const selectedComponents = this.engine.selection.items.filter((item) => item.kind === 'component').map((item) => item.id);
            const componentIds = selectedComponents.includes(primary.entityId) ? selectedComponents : [primary.entityId];
            this.componentDragStartGeometries = deepClone(this.engine.geometries);
            this.engine.beginPreview(componentIds.length === 1 ? 'Move component' : 'Move components', `move:${[...componentIds].sort().join(',')}`);
            this.setState({ kind: 'drag-components', pointerId: event.pointerId, start: event.point, componentIds });
            this.events.emit('cursorRequested', { cursor: 'move' });
            return;
        }
        if (primary.kind === 'label' && !this.engine.document.labels[primary.entityId]?.locked) {
            this.engine.beginPreview('Move label', `label:${primary.entityId}`);
            this.setState({ kind: 'drag-label', pointerId: event.pointerId, start: event.point, labelId: primary.entityId });
            this.events.emit('cursorRequested', { cursor: 'move' });
            return;
        }
        if (primary.kind === 'route-segment' && typeof primary.subId === 'number') {
            const wire = this.engine.document.wires[primary.entityId];
            if (wire?.route && !wire.locked) {
                this.engine.beginPreview('Move wire segment', `route:${wire.id}:${primary.subId}`);
                this.setState({
                    kind: 'drag-wire-segment',
                    pointerId: event.pointerId,
                    start: event.point,
                    wireId: wire.id,
                    segmentIndex: primary.subId,
                    originalPoints: deepClone(wire.route.points),
                });
                this.events.emit('cursorRequested', { cursor: 'move' });
            }
        }
    }
    pointerMove(event) {
        if (this.stateValue.kind === 'idle') {
            const hit = this.hitsAt(event.point)[0];
            this.events.emit('cursorRequested', {
                cursor: hit?.kind === 'port' ? 'crosshair' : hit?.kind === 'component-body' || hit?.kind === 'component-header' ? 'move' : hit?.kind === 'wire' || hit?.kind === 'route-segment' ? 'pointer' : 'default',
            });
            return;
        }
        if (event.pointerId !== this.stateValue.pointerId)
            return;
        switch (this.stateValue.kind) {
            case 'marquee': {
                this.stateValue = { ...this.stateValue, current: event.point };
                this.events.emit('marqueeChanged', {
                    bounds: marqueeBounds(this.stateValue.start, event.point),
                    mode: event.point.x >= this.stateValue.start.x ? 'window' : 'crossing',
                });
                break;
            }
            case 'drag-components': {
                let proposedDelta = subtract(event.point, this.stateValue.start);
                if (event.modifiers.shift) {
                    proposedDelta = Math.abs(proposedDelta.x) >= Math.abs(proposedDelta.y)
                        ? { x: proposedDelta.x, y: 0 }
                        : { x: 0, y: proposedDelta.y };
                }
                const snapshot = this.componentDragStartGeometries ?? this.engine.geometries;
                const snapResult = event.modifiers.alt
                    ? { delta: proposedDelta, guides: [] }
                    : snapComponentDrag(snapshot, this.stateValue.componentIds, proposedDelta, {
                        zoom: this.options.zoom(),
                        tolerancePx: 8,
                        gridSpacing: this.engine.document.settings.grid.spacing,
                        enableGrid: this.engine.document.settings.grid.snap,
                        enableAlignment: true,
                        enablePortAlignment: true,
                        primaryComponentId: this.stateValue.componentIds[0],
                    });
                const delta = snapResult.delta;
                this.events.emit('snapGuidesChanged', { guides: snapResult.guides });
                this.engine.updatePreview((draft, impact) => {
                    for (const componentId of this.stateValue.kind === 'drag-components' ? this.stateValue.componentIds : []) {
                        const component = draft.components[componentId];
                        if (!component || component.locked)
                            continue;
                        component.position = add(component.position, delta);
                        impact.changedComponents.push(componentId);
                    }
                });
                break;
            }
            case 'drag-label': {
                const labelId = this.stateValue.labelId;
                this.engine.updatePreview((draft, impact) => {
                    const label = draft.labels[labelId];
                    if (!label)
                        return;
                    label.mode = 'world-pinned';
                    label.worldPosition = draft.settings.grid.snap && event.modifiers.shift ? snapPoint(event.point, draft.settings.grid.spacing) : { ...event.point };
                    impact.movedLabels.push(labelId);
                });
                break;
            }
            case 'drag-wire-segment': {
                const delta = subtract(event.point, this.stateValue.start);
                const moved = moveOrthogonalSegment(this.stateValue.originalPoints, this.stateValue.segmentIndex, delta);
                const wireId = this.stateValue.wireId;
                this.engine.updatePreview((draft, impact) => {
                    const wire = draft.wires[wireId];
                    if (!wire)
                        return;
                    wire.routing.pattern = 'manual';
                    wire.routing.constraints = moved.slice(1, -1).map((point, index) => createWaypointConstraint(`${wireId}:waypoint:${index + 1}`, point, true));
                    impact.reroutedWires.push(wireId);
                });
                break;
            }
            case 'connect-wire': {
                const targetHit = this.hitsAt(event.point).find((hit) => hit.kind === 'port');
                const target = targetHit ? portEndpointFromHit(targetHit) : undefined;
                const validation = target ? this.engine.canConnect(this.stateValue.source, target) : { valid: false, reason: 'Choose a target port.' };
                this.stateValue = { ...this.stateValue, current: event.point, target, valid: validation.valid, reason: validation.reason };
                this.events.emit('connectionPreview', {
                    source: this.stateValue.source,
                    target,
                    point: event.point,
                    valid: validation.valid,
                    reason: validation.reason,
                });
                break;
            }
            case 'pan': {
                const delta = subtract(event.point, this.stateValue.current);
                this.stateValue = { ...this.stateValue, current: event.point };
                this.events.emit('panRequested', { delta });
                break;
            }
        }
        this.events.emit('stateChanged', { state: this.stateValue });
    }
    pointerUp(event) {
        if (this.stateValue.kind === 'idle' || event.pointerId !== this.stateValue.pointerId)
            return;
        const state = this.stateValue;
        switch (state.kind) {
            case 'marquee': {
                const bounds = marqueeBounds(state.start, event.point);
                const mode = event.point.x >= state.start.x ? 'window' : 'crossing';
                const selected = marqueeSelect(this.engine.document, bounds, mode, {
                    componentGeometries: this.engine.geometries,
                    labelPlacements: [...this.engine.labelPlacements],
                });
                if (state.additive)
                    this.engine.select([...this.engine.selection.items, ...selected]);
                else if (state.subtractive) {
                    const remove = new Set(selected.map((item) => `${item.kind}:${item.id}:${String(item.subId ?? '')}`));
                    this.engine.select(this.engine.selection.items.filter((item) => !remove.has(`${item.kind}:${item.id}:${String(item.subId ?? '')}`)));
                }
                else
                    this.engine.select(selected);
                this.events.emit('marqueeChanged', {});
                break;
            }
            case 'drag-components':
            case 'drag-label':
            case 'drag-wire-segment':
                this.engine.commitPreview();
                this.componentDragStartGeometries = undefined;
                this.events.emit('snapGuidesChanged', { guides: [] });
                break;
            case 'connect-wire':
                if (state.target && state.valid) {
                    this.engine.connectWire({ source: state.source, target: state.target });
                    this.engine.announce('Wire connected.', [state.source.kind === 'port' ? state.source.componentId : '', state.target.kind === 'port' ? state.target.componentId : ''].filter(Boolean));
                }
                else if (state.reason)
                    this.engine.announce(state.reason);
                this.events.emit('connectionPreview', {});
                break;
            case 'pan':
                break;
        }
        this.setState({ kind: 'idle' });
        this.events.emit('cursorRequested', { cursor: 'default' });
    }
    pointerCancel(pointerId) {
        if (this.stateValue.kind === 'idle' || this.stateValue.pointerId !== pointerId)
            return;
        if (this.stateValue.kind === 'drag-components' || this.stateValue.kind === 'drag-label' || this.stateValue.kind === 'drag-wire-segment')
            this.engine.cancelPreview();
        this.componentDragStartGeometries = undefined;
        this.events.emit('snapGuidesChanged', { guides: [] });
        this.events.emit('marqueeChanged', {});
        this.events.emit('connectionPreview', {});
        this.setState({ kind: 'idle' });
    }
    keyDown(key, modifiers) {
        const normalized = key.toLowerCase();
        if (normalized === 'escape') {
            if (this.stateValue.kind !== 'idle')
                this.pointerCancel(this.stateValue.pointerId);
            else
                this.engine.clearSelection();
            return true;
        }
        const command = modifiers.ctrl || modifiers.meta;
        if (command && normalized === 'z' && !modifiers.shift) {
            this.engine.undo();
            return true;
        }
        if ((command && normalized === 'y') || (command && modifiers.shift && normalized === 'z')) {
            this.engine.redo();
            return true;
        }
        if (normalized === 'r' && this.stateValue.kind === 'idle') {
            const ids = this.engine.selection.items.filter((item) => item.kind === 'component').map((item) => item.id);
            if (ids.length > 0)
                this.engine.rotateComponents(ids, !modifiers.shift);
            return ids.length > 0;
        }
        if ((normalized === 'delete' || normalized === 'backspace') && this.stateValue.kind === 'idle') {
            const items = [...this.engine.selection.items];
            for (const item of items) {
                if (item.kind === 'wire')
                    this.engine.removeWire(item.id);
                if (item.kind === 'label')
                    this.engine.removeLabel(item.id);
                if (item.kind === 'component')
                    this.engine.removeComponent(item.id, modifiers.shift ? 'detach' : 'prevent');
            }
            this.engine.clearSelection();
            return items.length > 0;
        }
        return false;
    }
    hitsAt(point) {
        return hitTestDocument(this.engine.document, point, {
            componentGeometries: this.engine.geometries,
            labelPlacements: this.engine.labelPlacements,
            zoom: this.options.zoom(),
            hitTolerancePx: this.engine.document.settings.hitTolerancePx,
            includeRouteHandles: true,
        });
    }
    setState(state) {
        this.stateValue = state;
        this.events.emit('stateChanged', { state });
    }
}
//# sourceMappingURL=interaction.js.map