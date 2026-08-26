import { ApproximateTextMeasurer, buildComponentGeometry } from './component.js';
import { DEFAULT_ROUTING_OPTIONS } from './routing.js';
export const DEFAULT_EDITOR_SETTINGS = {
    grid: {
        visible: true,
        snap: true,
        spacing: 10,
        majorEvery: 5,
        opacity: 0.55,
    },
    defaultRouting: { ...DEFAULT_ROUTING_OPTIONS, constraints: [] },
    labelGap: 8,
    hitTolerancePx: 7,
    portTargetSizePx: 18,
    componentHandleSizePx: 8,
    wireBridgeRadius: 5,
    preserveManualRoutesOnMove: true,
    reflowLabelsOnEdit: true,
    reduceMotion: false,
};
export class SequentialIdFactory {
    seed;
    counter = 0;
    constructor(seed = '') {
        this.seed = seed;
    }
    next(prefix) {
        this.counter += 1;
        return `${prefix}-${this.seed}${this.counter.toString(36)}`;
    }
}
export function createDocument(id = 'document-1') {
    return {
        schemaVersion: 1,
        id,
        revision: 0,
        settings: JSON.parse(JSON.stringify(DEFAULT_EDITOR_SETTINGS)),
        components: {},
        wires: {},
        labels: {},
        componentOrder: [],
        wireOrder: [],
        labelOrder: [],
    };
}
export function cloneDocument(document) {
    return JSON.parse(JSON.stringify(document));
}
export function connectedPortIds(document, componentId) {
    const result = new Set();
    for (const wire of Object.values(document.wires)) {
        for (const endpoint of [wire.source, wire.target]) {
            if (endpoint.kind === 'port' && endpoint.componentId === componentId)
                result.add(endpoint.portId);
        }
    }
    return result;
}
export function wiresConnectedToPort(document, componentId, portId) {
    return Object.values(document.wires).filter((wire) => [wire.source, wire.target].some((endpoint) => endpoint.kind === 'port' && endpoint.componentId === componentId && endpoint.portId === portId));
}
export function wiresConnectedToComponent(document, componentId) {
    return Object.values(document.wires).filter((wire) => [wire.source, wire.target].some((endpoint) => endpoint.kind === 'port' && endpoint.componentId === componentId));
}
function findPort(document, endpoint) {
    return document.components[endpoint.componentId]?.ports.find((port) => port.id === endpoint.portId);
}
function connectionCount(document, endpoint) {
    return wiresConnectedToPort(document, endpoint.componentId, endpoint.portId).length;
}
export function canConnectPorts(document, source, target, kind = 'discrete') {
    const reasons = [];
    const sourcePort = findPort(document, source);
    const targetPort = findPort(document, target);
    if (!sourcePort)
        reasons.push(`Source port ${source.componentId}.${source.portId} does not exist.`);
    if (!targetPort)
        reasons.push(`Target port ${target.componentId}.${target.portId} does not exist.`);
    if (!sourcePort || !targetPort)
        return { valid: false, reasons, sourcePort, targetPort };
    if (source.componentId === target.componentId && source.portId === target.portId)
        reasons.push('A port cannot connect to itself.');
    if (source.componentId === target.componentId && (!sourcePort.connectionPolicy.allowSelfConnection || !targetPort.connectionPolicy.allowSelfConnection)) {
        reasons.push('One or both ports reject same-component connections.');
    }
    if (connectionCount(document, source) >= sourcePort.connectionPolicy.maximumConnections)
        reasons.push('Source port connection limit reached.');
    if (connectionCount(document, target) >= targetPort.connectionPolicy.maximumConnections)
        reasons.push('Target port connection limit reached.');
    if (sourcePort.connectionPolicy.allowWireKinds && !sourcePort.connectionPolicy.allowWireKinds.includes(kind))
        reasons.push('Source port rejects this wire kind.');
    if (targetPort.connectionPolicy.allowWireKinds && !targetPort.connectionPolicy.allowWireKinds.includes(kind))
        reasons.push('Target port rejects this wire kind.');
    if (sourcePort.connectionPolicy.allowedElectricalClasses && !sourcePort.connectionPolicy.allowedElectricalClasses.includes(targetPort.electricalClass)) {
        reasons.push('Target electrical class is incompatible with the source port.');
    }
    if (targetPort.connectionPolicy.allowedElectricalClasses && !targetPort.connectionPolicy.allowedElectricalClasses.includes(sourcePort.electricalClass)) {
        reasons.push('Source electrical class is incompatible with the target port.');
    }
    const sourceMate = sourcePort.connectionPolicy.requiredMateGroup;
    const targetMate = targetPort.connectionPolicy.requiredMateGroup;
    if (sourceMate && targetMate && sourceMate !== targetMate)
        reasons.push('Required mate groups do not match.');
    return { valid: reasons.length === 0, reasons, sourcePort, targetPort };
}
export class ComponentMutationError extends Error {
    connectedRemovedPorts;
    constructor(message, connectedRemovedPorts) {
        super(message);
        this.connectedRemovedPorts = connectedRemovedPorts;
        this.name = 'ComponentMutationError';
    }
}
function replaceEndpoint(endpoint, componentId, removed, replacementByLabel, oldPortPositions, mode) {
    if (endpoint.kind !== 'port' || endpoint.componentId !== componentId || !removed.has(endpoint.portId)) {
        return { endpoint, detached: false, remapped: false };
    }
    const oldPort = removed.get(endpoint.portId);
    if (mode === 'remap-by-label') {
        const replacement = replacementByLabel.get(oldPort.label);
        if (replacement) {
            return {
                endpoint: { kind: 'port', componentId, portId: replacement },
                detached: false,
                remapped: true,
            };
        }
    }
    const fallback = oldPortPositions.get(endpoint.portId) ?? { x: 0, y: 0 };
    return {
        endpoint: { kind: 'free', point: fallback, direction: oldPort.side, termination: 'detached-port' },
        detached: true,
        remapped: false,
    };
}
export function mutateComponent(document, componentId, mutate, options = {
    connectedPortRemoval: 'prevent',
    reroute: 'full',
    reflowLabels: true,
}) {
    const original = document.components[componentId];
    if (!original)
        throw new Error(`Component ${componentId} does not exist.`);
    const before = JSON.parse(JSON.stringify(original));
    const updated = mutate(JSON.parse(JSON.stringify(original)));
    if (updated.id !== original.id)
        throw new Error('A component mutation may not change the component ID.');
    const beforePorts = new Map(before.ports.map((port) => [port.id, port]));
    const afterPorts = new Map(updated.ports.map((port) => [port.id, port]));
    const removed = new Map([...beforePorts].filter(([id]) => !afterPorts.has(id)));
    const connectedRemovedPorts = [...removed.keys()].filter((portId) => wiresConnectedToPort(document, componentId, portId).length > 0);
    if (connectedRemovedPorts.length > 0 && options.connectedPortRemoval === 'prevent') {
        throw new ComponentMutationError('The edit removes connected ports. Choose detach or remap-by-label.', connectedRemovedPorts);
    }
    const oldGeometry = buildComponentGeometry(before, {
        textMeasurer: new ApproximateTextMeasurer(),
        connectedPortIds: connectedPortIds(document, componentId),
    });
    const oldPortPositions = new Map(Object.values(oldGeometry.ports).map((port) => [port.portId, { ...port.center }]));
    const replacementByLabel = new Map();
    for (const port of updated.ports)
        if (!replacementByLabel.has(port.label))
            replacementByLabel.set(port.label, port.id);
    const next = cloneDocument(document);
    next.components[componentId] = updated;
    const impact = {
        changedComponents: [componentId],
        changedPorts: [...new Set([...removed.keys(), ...updated.ports.filter((port) => beforePorts.get(port.id)?.label !== port.label).map((port) => port.id)])],
        reroutedWires: [],
        invalidatedWires: [],
        detachedWires: [],
        movedLabels: [],
        overlappingLabels: [],
        warnings: [],
    };
    for (const wire of Object.values(next.wires)) {
        const source = replaceEndpoint(wire.source, componentId, removed, replacementByLabel, oldPortPositions, options.connectedPortRemoval);
        const target = replaceEndpoint(wire.target, componentId, removed, replacementByLabel, oldPortPositions, options.connectedPortRemoval);
        if (source.endpoint !== wire.source || target.endpoint !== wire.target) {
            next.wires[wire.id] = { ...wire, source: source.endpoint, target: target.endpoint, route: undefined };
            if (source.detached || target.detached)
                impact.detachedWires.push(wire.id);
            if ((source.remapped || target.remapped) && options.reroute !== 'none')
                impact.reroutedWires.push(wire.id);
        }
        else if ([wire.source, wire.target].some((endpoint) => endpoint.kind === 'port' && endpoint.componentId === componentId) &&
            options.reroute !== 'none') {
            next.wires[wire.id] = { ...wire, route: options.reroute === 'full' ? undefined : wire.route };
            impact.reroutedWires.push(wire.id);
        }
    }
    for (const label of Object.values(next.labels)) {
        if (label.anchor.ownerKind === 'port' && label.anchor.ownerId === componentId && label.anchor.portId && removed.has(label.anchor.portId)) {
            const fallback = oldPortPositions.get(label.anchor.portId) ?? { x: 0, y: 0 };
            next.labels[label.id] = {
                ...label,
                anchor: { ownerKind: 'free', point: fallback },
                mode: 'owner-relative',
            };
            impact.movedLabels.push(label.id);
            impact.warnings.push(`Label ${label.id} was converted to a free annotation because its port was removed.`);
        }
        else if (options.reflowLabels && label.anchor.ownerId === componentId) {
            impact.movedLabels.push(label.id);
        }
    }
    next.revision += 1;
    impact.reroutedWires = [...new Set(impact.reroutedWires)];
    impact.detachedWires = [...new Set(impact.detachedWires)];
    return { document: next, impact };
}
export function addComponent(document, component) {
    if (document.components[component.id])
        throw new Error(`Component ${component.id} already exists.`);
    const next = cloneDocument(document);
    next.components[component.id] = component;
    next.componentOrder.push(component.id);
    next.revision += 1;
    return next;
}
export function addWire(document, wire, validate = true) {
    if (document.wires[wire.id])
        throw new Error(`Wire ${wire.id} already exists.`);
    if (validate && wire.source.kind === 'port' && wire.target.kind === 'port') {
        const check = canConnectPorts(document, wire.source, wire.target, wire.kind);
        if (!check.valid)
            throw new Error(`Cannot connect ports: ${check.reasons.join(' ')}`);
    }
    const next = cloneDocument(document);
    next.wires[wire.id] = wire;
    next.wireOrder.push(wire.id);
    next.revision += 1;
    return next;
}
export function removeWire(document, wireId) {
    if (!document.wires[wireId])
        return document;
    const next = cloneDocument(document);
    delete next.wires[wireId];
    next.wireOrder = next.wireOrder.filter((id) => id !== wireId);
    next.revision += 1;
    return next;
}
//# sourceMappingURL=document.js.map