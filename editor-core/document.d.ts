import type { ComponentMutationOptions, ComponentNode, EditorDocument, EditorSettings, EntityId, IdFactory, MutationImpact, PortEndpoint, PortSpec, WireEdge, WireKind } from './types.js';
export declare const DEFAULT_EDITOR_SETTINGS: EditorSettings;
export declare class SequentialIdFactory implements IdFactory {
    private readonly seed;
    private counter;
    constructor(seed?: string);
    next(prefix: string): EntityId;
}
export declare function createDocument(id?: string): EditorDocument;
export declare function cloneDocument(document: EditorDocument): EditorDocument;
export declare function connectedPortIds(document: EditorDocument, componentId: EntityId): Set<EntityId>;
export declare function wiresConnectedToPort(document: EditorDocument, componentId: EntityId, portId: EntityId): WireEdge[];
export declare function wiresConnectedToComponent(document: EditorDocument, componentId: EntityId): WireEdge[];
export interface ConnectionCheck {
    valid: boolean;
    reasons: string[];
    sourcePort?: PortSpec;
    targetPort?: PortSpec;
}
export declare function canConnectPorts(document: EditorDocument, source: PortEndpoint, target: PortEndpoint, kind?: WireKind): ConnectionCheck;
export interface ComponentMutationResult {
    document: EditorDocument;
    impact: MutationImpact;
}
export declare class ComponentMutationError extends Error {
    readonly connectedRemovedPorts: EntityId[];
    constructor(message: string, connectedRemovedPorts: EntityId[]);
}
export declare function mutateComponent(document: EditorDocument, componentId: EntityId, mutate: (component: ComponentNode) => ComponentNode, options?: ComponentMutationOptions): ComponentMutationResult;
export declare function addComponent(document: EditorDocument, component: ComponentNode): EditorDocument;
export declare function addWire(document: EditorDocument, wire: WireEdge, validate?: boolean): EditorDocument;
export declare function removeWire(document: EditorDocument, wireId: EntityId): EditorDocument;
//# sourceMappingURL=document.d.ts.map