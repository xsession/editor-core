import { clamp } from './geometry.js';
export const DEFAULT_VIEWPORT_LIMITS = {
    minimumZoom: 0.05,
    maximumZoom: 16,
    overscroll: 2000,
};
export function worldToScreen(point, viewport) {
    return {
        x: point.x * viewport.zoom + viewport.pan.x,
        y: point.y * viewport.zoom + viewport.pan.y,
    };
}
export function screenToWorld(point, viewport) {
    const zoom = Math.max(1e-9, viewport.zoom);
    return {
        x: (point.x - viewport.pan.x) / zoom,
        y: (point.y - viewport.pan.y) / zoom,
    };
}
export function panViewport(viewport, screenDelta) {
    return {
        ...viewport,
        pan: { x: viewport.pan.x + screenDelta.x, y: viewport.pan.y + screenDelta.y },
    };
}
/** Zooms around a screen-space focal point without moving the world point under the pointer. */
export function zoomViewportAt(viewport, screenPoint, factor, limits = DEFAULT_VIEWPORT_LIMITS) {
    const before = screenToWorld(screenPoint, viewport);
    const zoom = clamp(viewport.zoom * factor, limits.minimumZoom, limits.maximumZoom);
    return {
        ...viewport,
        zoom,
        pan: {
            x: screenPoint.x - before.x * zoom,
            y: screenPoint.y - before.y * zoom,
        },
    };
}
export function viewportWorldRect(viewport) {
    const topLeft = screenToWorld({ x: 0, y: 0 }, viewport);
    const bottomRight = screenToWorld({ x: viewport.width, y: viewport.height }, viewport);
    return {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
    };
}
export function fitViewportToBounds(bounds, screenSize, options = {}) {
    const padding = Math.max(0, options.paddingPx ?? 48);
    const availableWidth = Math.max(1, screenSize.width - padding * 2);
    const availableHeight = Math.max(1, screenSize.height - padding * 2);
    const zoom = clamp(Math.min(availableWidth / Math.max(1e-9, bounds.width), availableHeight / Math.max(1e-9, bounds.height)), options.minimumZoom ?? DEFAULT_VIEWPORT_LIMITS.minimumZoom, options.maximumZoom ?? DEFAULT_VIEWPORT_LIMITS.maximumZoom);
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    return {
        width: screenSize.width,
        height: screenSize.height,
        zoom,
        pan: {
            x: screenSize.width / 2 - center.x * zoom,
            y: screenSize.height / 2 - center.y * zoom,
        },
    };
}
export class ViewportController {
    limits;
    stateValue;
    constructor(initial, limits = DEFAULT_VIEWPORT_LIMITS) {
        this.limits = limits;
        this.stateValue = { ...initial, pan: { ...initial.pan } };
    }
    get state() {
        return this.stateValue;
    }
    resize(width, height) {
        this.stateValue = { ...this.stateValue, width, height };
        return this.snapshot();
    }
    pan(screenDelta) {
        this.stateValue = panViewport(this.stateValue, screenDelta);
        return this.snapshot();
    }
    zoomAt(screenPoint, factor) {
        this.stateValue = zoomViewportAt(this.stateValue, screenPoint, factor, this.limits);
        return this.snapshot();
    }
    fit(bounds, paddingPx = 48) {
        this.stateValue = fitViewportToBounds(bounds, this.stateValue, {
            paddingPx,
            minimumZoom: this.limits.minimumZoom,
            maximumZoom: this.limits.maximumZoom,
        });
        return this.snapshot();
    }
    worldToScreen(point) {
        return worldToScreen(point, this.stateValue);
    }
    screenToWorld(point) {
        return screenToWorld(point, this.stateValue);
    }
    snapshot() {
        return { ...this.stateValue, pan: { ...this.stateValue.pan } };
    }
}
//# sourceMappingURL=viewport.js.map