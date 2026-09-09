import { inflateRect, rectsIntersect, routeBounds, unionRects } from './geometry.js';

function numberToken(value) {
    return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}

function rectToken(rect) {
    return rect ? `${numberToken(rect.x)},${numberToken(rect.y)},${numberToken(rect.width)},${numberToken(rect.height)}` : '-';
}


function pointsToken(points) {
    let hash = 2166136261;
    for (const point of points ?? []) {
        for (const value of [Math.round((point.x ?? 0) * 1000), Math.round((point.y ?? 0) * 1000)]) {
            hash ^= value;
            hash = Math.imul(hash, 16777619);
        }
    }
    return (hash >>> 0).toString(36);
}

function styleToken(style) {
    return style ? JSON.stringify(style) : '-';
}

function componentToken(value) {
    return [value.id, rectToken(value.body), rectToken(value.header), value.title, value.subtitle, value.selected ? 1 : 0, value.ports?.length ?? 0, styleToken(value.style)].join('|');
}

function wireToken(value) {
    const points = value.points ?? [];
    return [value.id, value.routeRevision ?? -1, value.status, value.selected ? 1 : 0, points.length,
        pointsToken(points), styleToken(value.style)].join('|');
}

function labelToken(value) {
    return [value.id, rectToken(value.bounds), value.text, value.secondaryText, value.status, value.selected ? 1 : 0, styleToken(value.style)].join('|');
}

function ownerBounds(kind, value) {
    if (kind === 'component')
        return value.body;
    if (kind === 'wire')
        return value.points?.length ? routeBounds(value.points, Math.max(6, (value.style?.width ?? 1) + 4)) : undefined;
    return value.bounds;
}

function keyed(items) {
    return new Map((items ?? []).map((item) => [item.id, item]));
}

function compareOwnerIds(kind, previous, next, ids, token, changed, regions, padding) {
    for (const id of ids) {
        const before = previous.get(id);
        const after = next.get(id);
        if (before && after && token(before) === token(after))
            continue;
        changed.add(`${kind}:${id}`);
        const beforeBounds = before && ownerBounds(kind, before);
        const afterBounds = after && ownerBounds(kind, after);
        if (beforeBounds)
            regions.push(inflateRect(beforeBounds, padding));
        if (afterBounds)
            regions.push(inflateRect(afterBounds, padding));
    }
}

function compareOwners(kind, previousItems, nextItems, token, changed, regions, padding, hintedIds) {
    const previous = keyed(previousItems);
    const next = keyed(nextItems);
    const ids = hintedIds ? new Set(hintedIds) : new Set([...previous.keys(), ...next.keys()]);
    compareOwnerIds(kind, previous, next, ids, token, changed, regions, padding);
}

function mergePair(a, b) {
    return unionRects([a, b]);
}

function rectArea(rect) {
    return rect ? Math.max(0, rect.width) * Math.max(0, rect.height) : 0;
}

/**
 * Bounded dirty-region accumulator. Nearby/overlapping rectangles are merged,
 * while excessive fragmentation collapses to a single conservative region.
 */
export class DirtyRegionTracker {
    regions = [];
    options;

    constructor(options = {}) {
        this.options = {
            mergeGap: options.mergeGap ?? 8,
            maxRegions: Math.max(1, options.maxRegions ?? 24),
            collapseAreaRatio: Math.min(1, Math.max(0, options.collapseAreaRatio ?? 0.6)),
        };
    }

    add(rect) {
        if (!rect || rect.width < 0 || rect.height < 0)
            return this;
        let candidate = { ...rect };
        const gap = this.options.mergeGap;
        for (let index = this.regions.length - 1; index >= 0; index -= 1) {
            const current = this.regions[index];
            if (!rectsIntersect(inflateRect(current, gap), candidate))
                continue;
            candidate = mergePair(candidate, current);
            this.regions.splice(index, 1);
        }
        this.regions.push(candidate);
        if (this.regions.length > this.options.maxRegions)
            this.collapse();
        return this;
    }

    addMany(rects) {
        for (const rect of rects ?? [])
            this.add(rect);
        return this;
    }

    collapse() {
        if (this.regions.length > 1)
            this.regions = [unionRects(this.regions)];
        return this;
    }

    optimize(viewport) {
        if (this.regions.length <= 1 || !viewport)
            return this;
        const viewportArea = Math.max(1, viewport.width * viewport.height);
        const totalArea = this.regions.reduce((sum, rect) => sum + rect.width * rect.height, 0);
        if (totalArea / viewportArea >= this.options.collapseAreaRatio)
            this.collapse();
        return this;
    }

    clear() {
        this.regions = [];
    }

    snapshot() {
        return this.regions.map((rect) => ({ ...rect }));
    }

    get bounds() {
        return this.regions.length ? unionRects(this.regions) : undefined;
    }
}

/** Computes owner-level render changes and conservative repaint regions. */
export class RenderPlanDiffer {
    diff(previous, next, options = {}) {
        if (!previous)
            return {
                fullRedraw: true,
                changedOwners: new Set(),
                dirtyRegions: next.viewport ? [{ ...next.viewport }] : [],
                reason: 'initial-render',
            };
        if (previous.lod !== next.lod || previous.zoom !== next.zoom ||
            rectToken(previous.viewport) !== rectToken(next.viewport)) {
            return {
                fullRedraw: true,
                changedOwners: new Set(),
                dirtyRegions: next.viewport ? [{ ...next.viewport }] : [],
                reason: previous.lod !== next.lod ? 'lod-change' : 'camera-change',
            };
        }

        const changedOwners = new Set();
        const rawRegions = [];
        const padding = options.padding ?? 6 / Math.max(next.zoom ?? 1, 0.0001);
        const hints = options.ownerHints;
        compareOwners('component', previous.components, next.components, componentToken, changedOwners, rawRegions, padding, hints?.components);
        compareOwners('wire', previous.wires, next.wires, wireToken, changedOwners, rawRegions, padding, hints?.wires);
        compareOwners('label', previous.labels, next.labels, labelToken, changedOwners, rawRegions, padding, hints?.labels);

        const tracker = new DirtyRegionTracker(options).addMany(rawRegions).optimize(next.viewport);
        const dirtyRegions = tracker.snapshot();
        const fullRedraw = Boolean(next.viewport && tracker.bounds && rectArea(tracker.bounds) >=
            (options.fullRedrawAreaRatio ?? 0.72) * next.viewport.width * next.viewport.height);
        return {
            fullRedraw,
            changedOwners,
            dirtyRegions: fullRedraw && next.viewport ? [{ ...next.viewport }] : dirtyRegions,
            reason: fullRedraw ? 'dirty-area-threshold' : 'incremental',
        };
    }
}

/** Retains the previous visual plan and returns its minimal repaint diff. */
export class RetainedRenderState {
    plan;
    differ;

    constructor(options = {}) {
        this.differ = new RenderPlanDiffer(options);
    }

    update(nextPlan, options = {}) {
        const diff = this.differ.diff(this.plan, nextPlan, options);
        this.plan = nextPlan;
        return diff;
    }

    reset() {
        this.plan = undefined;
    }
}
