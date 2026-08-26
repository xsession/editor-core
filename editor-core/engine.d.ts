import type { ComponentGeometry, ComponentMutationOptions, ComponentNode, EditorDocument, EditorEventMap, EditorSettings, EntityId, IdFactory, LabelNode, LabelPlacement, MutationImpact, Point, PortSpec, RouteConstraint, SelectionRef, SelectionState, ValidationIssue, WireEdge, WireEndpoint, WireStyle } from './types.js';
export declare const DEFAULT_EDITOR_SETTINGS: EditorSettings;
export declare const DEFAULT_WIRE_STYLE: WireStyle;
export declare class DefaultIdFactory implements IdFactory {
    private counter;
    next(prefix: string): EntityId;
}
export declare class SequentialIdFactory implements IdFactory {
    private counters;
    next(prefix: string): EntityId;
}
export interface ConnectWireInput {
    id?: EntityId;
    kind?: WireEdge['kind'];
    label?: string;
    signal?: string;
    source: WireEndpoint;
    target: WireEndpoint;
    routing?: Partial<WireEdge['routing']>;
    style?: Partial<WireStyle>;
}
export interface EngineOptions {
    idFactory?: IdFactory;
    historyLimit?: number;
    autoRoute?: boolean;
    validateOnChange?: boolean;
}
export declare function createEmptyDocument(id?: string, settings?: Partial<EditorSettings>): EditorDocument;
export declare class HarnessEditorEngine {
    private documentState;
    private readonly events;
    private readonly history;
    private readonly idFactory;
    private readonly options;
    private geometryState;
    private labelPlacementState;
    private validationState;
    private selectionState;
    private preview?;
    constructor(document?: EditorDocument, options?: EngineOptions);
    static fromJSON(serialized: string, options?: EngineOptions): HarnessEditorEngine;
    get document(): Readonly<EditorDocument>;
    get geometries(): Readonly<Record<EntityId, ComponentGeometry>>;
    get labelPlacements(): readonly LabelPlacement[];
    get validationIssues(): readonly ValidationIssue[];
    get selection(): Readonly<SelectionState>;
    get canUndo(): boolean;
    get canRedo(): boolean;
    /** True while a direct-manipulation preview is active and not yet committed. */
    get isPreviewActive(): boolean;
    on<TKey extends keyof EditorEventMap>(type: TKey, listener: (event: EditorEventMap[TKey]) => void): () => void;
    toJSON(pretty?: boolean): string;
    replaceDocument(document: EditorDocument, reason?: string): void;
    execute(label: string, mutate: (draft: EditorDocument, impact: MutationImpact) => void, options?: {
        mergeKey?: string;
    }): MutationImpact;
    beginPreview(label: string, mergeKey?: string): void;
    updatePreview(mutate: (draft: EditorDocument, impact: MutationImpact) => void): MutationImpact;
    commitPreview(): MutationImpact;
    cancelPreview(): void;
    undo(): void;
    redo(): void;
    addComponent(component: ComponentNode): MutationImpact;
    removeComponent(componentId: EntityId, wirePolicy?: 'prevent' | 'delete' | 'detach'): MutationImpact;
    moveComponents(componentIds: EntityId[], delta: Point, options?: {
        snap?: boolean;
        preview?: boolean;
    }): MutationImpact;
    setComponentPosition(componentId: EntityId, position: Point): MutationImpact;
    rotateComponents(componentIds: EntityId[], clockwise?: boolean): MutationImpact;
    updateComponent(componentId: EntityId, update: Partial<ComponentNode> | ((component: ComponentNode) => void), options?: Partial<ComponentMutationOptions>): MutationImpact;
    replacePorts(componentId: EntityId, ports: PortSpec[], options?: Partial<ComponentMutationOptions>): MutationImpact;
    connectWire(input: ConnectWireInput): {
        wire: WireEdge;
        impact: MutationImpact;
    };
    removeWire(wireId: EntityId): MutationImpact;
    reconnectWireEndpoint(wireId: EntityId, end: 'source' | 'target', endpoint: WireEndpoint): MutationImpact;
    updateWire(wireId: EntityId, update: Partial<WireEdge> | ((wire: WireEdge) => void)): MutationImpact;
    setManualRoute(wireId: EntityId, points: Point[], locked?: boolean): MutationImpact;
    moveWireSegment(wireId: EntityId, segmentIndex: number, delta: Point): MutationImpact;
    addRouteConstraint(wireId: EntityId, constraint: RouteConstraint): MutationImpact;
    autoRoute(wireIds?: EntityId[]): MutationImpact;
    addLabel(label: LabelNode): MutationImpact;
    updateLabel(labelId: EntityId, update: Partial<LabelNode> | ((label: LabelNode) => void)): MutationImpact;
    moveLabel(labelId: EntityId, worldPosition: Point): MutationImpact;
    resetLabel(labelId: EntityId): MutationImpact;
    removeLabel(labelId: EntityId): MutationImpact;
    select(items: SelectionRef[], primary?: SelectionRef): void;
    toggleSelection(item: SelectionRef): void;
    clearSelection(): void;
    canConnect(source: WireEndpoint, target: WireEndpoint): {
        valid: boolean;
        reason: string;
    };
    announce(message: string, entityIds?: EntityId[]): void;
    private canConnectInDocument;
    private handleRemovedPorts;
    private recomputeDerived;
    private diffImpact;
    private emitAll;
}
//# sourceMappingURL=engine.d.ts.map