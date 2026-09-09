import type { EditorDocument, EntityId, WireEdge } from './types.js';

export interface ConnectivityEndpointRecord {
    componentId: EntityId;
    portId: EntityId;
    portKey: string;
}

export declare class MutableConnectivityIndex {
    readonly componentPorts: Map<EntityId, Set<EntityId>>;
    readonly componentWires: Map<EntityId, Set<EntityId>>;
    readonly portWires: Map<string, Set<EntityId>>;
    readonly wireEndpoints: Map<EntityId, ConnectivityEndpointRecord[]>;
    constructor(document?: EditorDocument);
    reset(document: EditorDocument): this;
    removeWire(wireId: EntityId): boolean;
    upsertWire(wire: WireEdge): this;
    applyDocumentWires(document: EditorDocument, wireIds: Iterable<EntityId>): this;
    connectedPortIds(componentId: EntityId): ReadonlySet<EntityId>;
    wiresForComponent(componentId: EntityId): ReadonlySet<EntityId>;
    wiresForPort(componentId: EntityId, portId: EntityId): ReadonlySet<EntityId>;
    endpointsForWire(wireId: EntityId): readonly ConnectivityEndpointRecord[];
    readonly stats: { components: number; connectedPorts: number; wires: number };
}
