import { clamp } from './geometry.js';
import type { Point, Rect, ViewportState } from './types.js';

export interface ViewportLimits {
  minimumZoom: number;
  maximumZoom: number;
  overscroll?: number;
}

export const DEFAULT_VIEWPORT_LIMITS: ViewportLimits = {
  minimumZoom: 0.05,
  maximumZoom: 16,
  overscroll: 2000,
};

export function worldToScreen(point: Point, viewport: ViewportState): Point {
  return {
    x: point.x * viewport.zoom + viewport.pan.x,
    y: point.y * viewport.zoom + viewport.pan.y,
  };
}

export function screenToWorld(point: Point, viewport: ViewportState): Point {
  const zoom = Math.max(1e-9, viewport.zoom);
  return {
    x: (point.x - viewport.pan.x) / zoom,
    y: (point.y - viewport.pan.y) / zoom,
  };
}

export function panViewport(viewport: ViewportState, screenDelta: Point): ViewportState {
  return {
    ...viewport,
    pan: { x: viewport.pan.x + screenDelta.x, y: viewport.pan.y + screenDelta.y },
  };
}

/** Zooms around a screen-space focal point without moving the world point under the pointer. */
export function zoomViewportAt(
  viewport: ViewportState,
  screenPoint: Point,
  factor: number,
  limits: ViewportLimits = DEFAULT_VIEWPORT_LIMITS,
): ViewportState {
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

export function viewportWorldRect(viewport: ViewportState): Rect {
  const topLeft = screenToWorld({ x: 0, y: 0 }, viewport);
  const bottomRight = screenToWorld({ x: viewport.width, y: viewport.height }, viewport);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

export interface FitViewportOptions {
  paddingPx?: number;
  minimumZoom?: number;
  maximumZoom?: number;
}

export function fitViewportToBounds(
  bounds: Rect,
  screenSize: { width: number; height: number },
  options: FitViewportOptions = {},
): ViewportState {
  const padding = Math.max(0, options.paddingPx ?? 48);
  const availableWidth = Math.max(1, screenSize.width - padding * 2);
  const availableHeight = Math.max(1, screenSize.height - padding * 2);
  const zoom = clamp(
    Math.min(availableWidth / Math.max(1e-9, bounds.width), availableHeight / Math.max(1e-9, bounds.height)),
    options.minimumZoom ?? DEFAULT_VIEWPORT_LIMITS.minimumZoom,
    options.maximumZoom ?? DEFAULT_VIEWPORT_LIMITS.maximumZoom,
  );
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
  private stateValue: ViewportState;

  public constructor(initial: ViewportState, private readonly limits: ViewportLimits = DEFAULT_VIEWPORT_LIMITS) {
    this.stateValue = { ...initial, pan: { ...initial.pan } };
  }

  public get state(): Readonly<ViewportState> {
    return this.stateValue;
  }

  public resize(width: number, height: number): ViewportState {
    this.stateValue = { ...this.stateValue, width, height };
    return this.snapshot();
  }

  public pan(screenDelta: Point): ViewportState {
    this.stateValue = panViewport(this.stateValue, screenDelta);
    return this.snapshot();
  }

  public zoomAt(screenPoint: Point, factor: number): ViewportState {
    this.stateValue = zoomViewportAt(this.stateValue, screenPoint, factor, this.limits);
    return this.snapshot();
  }

  public fit(bounds: Rect, paddingPx = 48): ViewportState {
    this.stateValue = fitViewportToBounds(bounds, this.stateValue, {
      paddingPx,
      minimumZoom: this.limits.minimumZoom,
      maximumZoom: this.limits.maximumZoom,
    });
    return this.snapshot();
  }

  public worldToScreen(point: Point): Point {
    return worldToScreen(point, this.stateValue);
  }

  public screenToWorld(point: Point): Point {
    return screenToWorld(point, this.stateValue);
  }

  private snapshot(): ViewportState {
    return { ...this.stateValue, pan: { ...this.stateValue.pan } };
  }
}
