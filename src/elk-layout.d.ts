import type { EntityId, MutationImpact, Point } from './types.js';
import type { OptimizedEditorScene } from './advanced-visual.js';
import type { HarnessEditorEngine } from './performance-engine.js';

export interface ElkLayoutBackendOptions {
    elk?: { layout(graph: unknown, options?: unknown): Promise<any> };
    importer?: () => Promise<any>;
    constructorOptions?: unknown;
    graph?: Record<string, unknown>;
}
export declare class ElkLayoutBackend {
    constructor(options?: ElkLayoutBackendOptions);
    init(): Promise<any>;
    layoutScene(scene: OptimizedEditorScene, options?: Record<string, any>): Promise<any>;
    route(request: OptimizedEditorScene | { scene: OptimizedEditorScene }, options?: Record<string, any>): Promise<{ result: any; routes: Map<EntityId, Point[]> }>;
    get capabilities(): Record<string, boolean>;
}
export interface ApplyElkLayoutOptions extends Record<string, any> {
    applyRoutes?: boolean;
    label?: string;
}
export declare function applyElkLayoutTransaction(engine: HarnessEditorEngine, backend?: ElkLayoutBackend, options?: ApplyElkLayoutOptions): Promise<{ result: any; routes: Map<EntityId, Point[]>; impact: MutationImpact }>;
export declare function createElkBackend(options?: ElkLayoutBackendOptions): ElkLayoutBackend;
