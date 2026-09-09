import { rectBottom, rectRight, rectsIntersect } from './geometry.js';
import { UniformGridIndex } from './spatial.js';
import { SceneSpatialIndex } from './advanced-visual.js';

function cloneItem(item) {
    return { ...item, bounds: { ...item.bounds } };
}

function cellSpan(bounds, cellSize) {
    const minX = Math.floor(bounds.x / cellSize);
    const minY = Math.floor(bounds.y / cellSize);
    const maxX = Math.floor(rectRight(bounds) / cellSize);
    const maxY = Math.floor(rectBottom(bounds) / cellSize);
    const x = Math.max(1, maxX - minX + 1);
    const y = Math.max(1, maxY - minY + 1);
    return { x, y, cells: x * y };
}

/**
 * Multi-resolution broad-phase index.
 *
 * A single uniform grid performs extremely well for similarly sized objects,
 * but very long wires, huge groups, imported backgrounds and large keepouts can
 * occupy thousands of buckets. AdaptiveSpatialIndex stores each object at the
 * smallest grid level that keeps its bucket fan-out bounded; exceptionally
 * large objects live in a small overflow set.
 */
export class AdaptiveSpatialIndex {
    levels;
    options;
    records = new Map();
    overflow = new Map();

    constructor(options = {}) {
        const configured = options.cellSizes ?? [64, 256, 1024, 4096];
        const cellSizes = [...new Set(configured.filter((value) => Number.isFinite(value) && value > 0))]
            .sort((a, b) => a - b);
        if (cellSizes.length === 0)
            throw new Error('AdaptiveSpatialIndex requires at least one positive cell size.');
        this.options = {
            cellSizes,
            maxCellsPerAxis: Math.max(1, options.maxCellsPerAxis ?? 8),
            maxCellsPerItem: Math.max(1, options.maxCellsPerItem ?? 48),
        };
        this.levels = cellSizes.map((cellSize) => ({ cellSize, index: new UniformGridIndex(cellSize) }));
    }

    chooseLevel(bounds) {
        for (let index = 0; index < this.levels.length; index += 1) {
            const span = cellSpan(bounds, this.levels[index].cellSize);
            if (span.x <= this.options.maxCellsPerAxis &&
                span.y <= this.options.maxCellsPerAxis &&
                span.cells <= this.options.maxCellsPerItem)
                return index;
        }
        return -1;
    }

    insert(item) {
        this.remove(item.id);
        const stored = cloneItem(item);
        const level = this.chooseLevel(stored.bounds);
        if (level < 0)
            this.overflow.set(stored.id, stored);
        else
            this.levels[level].index.insert(stored);
        this.records.set(stored.id, { item: stored, level });
    }

    update(item) {
        this.insert(item);
    }

    remove(id) {
        const record = this.records.get(id);
        if (!record)
            return false;
        if (record.level < 0)
            this.overflow.delete(id);
        else
            this.levels[record.level].index.remove(id);
        this.records.delete(id);
        return true;
    }

    clear() {
        for (const level of this.levels)
            level.index.clear();
        this.records.clear();
        this.overflow.clear();
    }

    get(id) {
        return this.records.get(id)?.item;
    }

    queryRect(bounds) {
        const found = new Map();
        for (const level of this.levels) {
            for (const item of level.index.queryRect(bounds))
                found.set(item.id, item);
        }
        for (const item of this.overflow.values()) {
            if (rectsIntersect(item.bounds, bounds))
                found.set(item.id, item);
        }
        return [...found.values()]
            .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0) || a.id.localeCompare(b.id));
    }

    queryPoint(point, tolerance = 0) {
        return this.queryRect({
            x: point.x - tolerance,
            y: point.y - tolerance,
            width: tolerance * 2,
            height: tolerance * 2,
        });
    }

    all() {
        return [...this.records.values()].map((record) => record.item);
    }

    get size() {
        return this.records.size;
    }

    get stats() {
        return {
            items: this.records.size,
            overflow: this.overflow.size,
            levels: this.levels.map((level) => ({
                cellSize: level.cellSize,
                items: level.index.size,
            })),
        };
    }
}

/** SceneSpatialIndex using the adaptive multi-resolution broad phase. */
export class AdaptiveSceneSpatialIndex extends SceneSpatialIndex {
    constructor(options = {}) {
        super(options.cellSizes?.[0] ?? options.cellSize ?? 64);
        this.index = new AdaptiveSpatialIndex(options);
    }
}
