import type { EditorDocument, EntityId, MutationImpact, WireEndpoint } from './types.js';
import { HarnessEditorEngine as LegacyHarnessEditorEngine, type EngineOptions } from './engine.js';
import type { OptimizedEditorScene } from './advanced-visual.js';
import type { MutableConnectivityIndex } from './connectivity-index.js';

export interface PerformanceMutationImpact extends MutationImpact {
    addedComponents?: EntityId[];
    removedComponents?: EntityId[];
    addedWires?: EntityId[];
    removedWires?: EntityId[];
    addedLabels?: EntityId[];
    removedLabels?: EntityId[];
    changedObstacles?: EntityId[];
    dependencyReroutedWires?: EntityId[];
    reflowedLabels?: EntityId[];
    routingObstacleRevision?: number;
    routingTopologyRevision?: number;
    routingEnvironmentRevision?: number;
    fullRebuild?: boolean;
}

export interface PerformanceEngineOptions extends EngineOptions {
    spatialCellSize?: number;
    spatialCellSizes?: number[];
    adaptiveSpatial?: boolean;
    routingCellSize?: number;
    dirtyPadding?: number;
    labelFullReflowRatio?: number;
    acceleratedRouting?: Record<string, unknown>;
    findCrossings?: boolean;
    performance?: Record<string, unknown>;
}

export declare class HarnessEditorEngine extends LegacyHarnessEditorEngine {
    constructor(document?: EditorDocument, options?: PerformanceEngineOptions);
    static fromJSON(serialized: string, options?: PerformanceEngineOptions): HarnessEditorEngine;
    get scene(): OptimizedEditorScene | undefined;
    get connectivityIndex(): MutableConnectivityIndex | undefined;
    get routingObstacleRevision(): number;
    get routingTopologyRevision(): number;
    get routingEnvironmentRevision(): number;
    get performanceMetrics(): Record<string, unknown>;
    execute(label: string, mutate: (draft: EditorDocument, impact: PerformanceMutationImpact) => void, options?: { mergeKey?: string }): PerformanceMutationImpact;
    updatePreview(mutate: (draft: EditorDocument, impact: PerformanceMutationImpact) => void): PerformanceMutationImpact;
    commitPreview(): PerformanceMutationImpact;
}

export { LegacyHarnessEditorEngine };
