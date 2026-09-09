function endpointKey(endpoint) {
    return endpoint?.kind === 'port' ? `${endpoint.componentId}:${endpoint.portId}` : undefined;
}

function endpointRecords(wire) {
    const result = [];
    for (const endpoint of [wire?.source, wire?.target]) {
        if (endpoint?.kind !== 'port')
            continue;
        result.push({
            componentId: endpoint.componentId,
            portId: endpoint.portId,
            portKey: endpointKey(endpoint),
        });
    }
    return result;
}

function add(map, key, value) {
    const set = map.get(key) ?? new Set();
    set.add(value);
    map.set(key, set);
}

function remove(map, key, value) {
    const set = map.get(key);
    if (!set)
        return;
    set.delete(value);
    if (set.size === 0)
        map.delete(key);
}

const EMPTY_SET = Object.freeze(new Set());

/**
 * Incrementally maintained document connectivity. Unlike rebuilding a complete
 * component/port connectivity map after each gesture, reconnecting one wire is
 * O(1) map maintenance plus its two endpoints.
 */
export class MutableConnectivityIndex {
    componentPorts = new Map();
    componentWires = new Map();
    portWires = new Map();
    wireEndpoints = new Map();

    constructor(document) {
        if (document)
            this.reset(document);
    }

    reset(document) {
        this.componentPorts.clear();
        this.componentWires.clear();
        this.portWires.clear();
        this.wireEndpoints.clear();
        for (const wireId of document.wireOrder ?? Object.keys(document.wires ?? {})) {
            const wire = document.wires?.[wireId];
            if (wire)
                this.upsertWire(wire);
        }
        return this;
    }

    removeWire(wireId) {
        const endpoints = this.wireEndpoints.get(wireId);
        if (!endpoints)
            return false;
        for (const endpoint of endpoints) {
            remove(this.componentWires, endpoint.componentId, wireId);
            remove(this.portWires, endpoint.portKey, wireId);
            const remainingWires = this.portWires.get(endpoint.portKey);
            if (!remainingWires || remainingWires.size === 0)
                remove(this.componentPorts, endpoint.componentId, endpoint.portId);
        }
        this.wireEndpoints.delete(wireId);
        return true;
    }

    upsertWire(wire) {
        this.removeWire(wire.id);
        const endpoints = endpointRecords(wire);
        this.wireEndpoints.set(wire.id, endpoints);
        for (const endpoint of endpoints) {
            add(this.componentPorts, endpoint.componentId, endpoint.portId);
            add(this.componentWires, endpoint.componentId, wire.id);
            add(this.portWires, endpoint.portKey, wire.id);
        }
        return this;
    }

    applyDocumentWires(document, wireIds) {
        for (const wireId of wireIds) {
            const wire = document.wires?.[wireId];
            if (wire)
                this.upsertWire(wire);
            else
                this.removeWire(wireId);
        }
        return this;
    }

    connectedPortIds(componentId) {
        return this.componentPorts.get(componentId) ?? EMPTY_SET;
    }

    wiresForComponent(componentId) {
        return this.componentWires.get(componentId) ?? EMPTY_SET;
    }

    wiresForPort(componentId, portId) {
        return this.portWires.get(`${componentId}:${portId}`) ?? EMPTY_SET;
    }

    endpointsForWire(wireId) {
        return this.wireEndpoints.get(wireId) ?? [];
    }

    get stats() {
        return {
            components: this.componentPorts.size,
            connectedPorts: this.portWires.size,
            wires: this.wireEndpoints.size,
        };
    }
}
