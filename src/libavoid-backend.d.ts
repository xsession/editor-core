import type { EntityId, MutationImpact, Point, RouteResult, WireEdge } from './types.js';
import type { OptimizedEditorScene } from './advanced-visual.js';
import type { HarnessEditorEngine } from './performance-engine.js';

export declare function createLibavoidElkGraph(scene: OptimizedEditorScene): any;
export declare function libavoidRouteToEditorRoute(route: any, revision?: number, requestedRadius?: number): RouteResult;
export interface LibavoidWasmBackendOptions {
    wasmPath?: string;
    importer?: () => Promise<any>;
    module?: any;
}
export declare class LibavoidWasmBackend {
    constructor(options?: LibavoidWasmBackendOptions);
    init(wasmPath?: string): Promise<any>;
    routeScene(scene: OptimizedEditorScene, options?: Record<string, any>): Promise<{ graph: any; raw: Map<EntityId, any>; routes: Map<EntityId, RouteResult> }>;
    createSession(scene: OptimizedEditorScene, options?: Record<string, any>): Promise<LibavoidRoutingSession>;
    route(request: OptimizedEditorScene | { scene: OptimizedEditorScene }, options?: Record<string, any>): Promise<{ graph: any; raw: Map<EntityId, any>; routes: Map<EntityId, RouteResult> }>;
    get capabilities(): Record<string, boolean>;
}
export declare class LibavoidRoutingSession {
    constructor(scene: OptimizedEditorScene, session: any, options?: Record<string, any>);
    moveComponent(componentId: EntityId, positionOrBody: Point & { center?: boolean }): boolean;
    addWire(wire: WireEdge): boolean;
    removeWire(wireId: EntityId): void;
    processTransaction(revision?: number): Map<EntityId, RouteResult>;
    destroy(): void;
}
export declare function applyExternalRoutesTransaction(engine: HarnessEditorEngine, routes: Map<EntityId, RouteResult>, options?: { label?: string; locked?: boolean }): MutationImpact;
export declare function createLibavoidWasmBackend(options?: LibavoidWasmBackendOptions): LibavoidWasmBackend;
