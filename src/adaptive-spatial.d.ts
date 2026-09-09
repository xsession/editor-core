import type { Point, Rect } from './types.js';
import type { SpatialItem } from './spatial.js';
import { SceneSpatialIndex } from './advanced-visual.js';

export interface AdaptiveSpatialOptions {
    cellSizes?: number[];
    cellSize?: number;
    maxCellsPerAxis?: number;
    maxCellsPerItem?: number;
}

export declare class AdaptiveSpatialIndex<T = unknown> {
    readonly options: Required<Pick<AdaptiveSpatialOptions, 'cellSizes' | 'maxCellsPerAxis' | 'maxCellsPerItem'>>;
    readonly records: Map<string, { item: SpatialItem<T>; level: number }>;
    readonly overflow: Map<string, SpatialItem<T>>;
    constructor(options?: AdaptiveSpatialOptions);
    chooseLevel(bounds: Rect): number;
    insert(item: SpatialItem<T>): void;
    update(item: SpatialItem<T>): void;
    remove(id: string): boolean;
    clear(): void;
    get(id: string): SpatialItem<T> | undefined;
    queryRect(bounds: Rect): SpatialItem<T>[];
    queryPoint(point: Point, tolerance?: number): SpatialItem<T>[];
    all(): SpatialItem<T>[];
    readonly size: number;
    readonly stats: { items: number; overflow: number; levels: Array<{ cellSize: number; items: number }> };
}

export declare class AdaptiveSceneSpatialIndex extends SceneSpatialIndex {
    index: AdaptiveSpatialIndex<any>;
    constructor(options?: AdaptiveSpatialOptions);
}
