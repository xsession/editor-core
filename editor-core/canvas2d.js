import { resolveWirePaint } from './colors.js';
import { DEFAULT_EDITOR_THEME } from './svg.js';

function canvasContext(target) {
    if (target?.canvas && typeof target.save === 'function')
        return target;
    if (typeof target?.getContext === 'function')
        return target.getContext('2d');
    throw new Error('Canvas2DRenderer requires a CanvasRenderingContext2D or canvas-like target.');
}

function roundRectPath(context, rect, radius) {
    const r = Math.max(0, Math.min(radius ?? 0, rect.width / 2, rect.height / 2));
    if (typeof context.roundRect === 'function') {
        context.beginPath();
        context.roundRect(rect.x, rect.y, rect.width, rect.height, r);
        return;
    }
    context.beginPath();
    context.moveTo(rect.x + r, rect.y);
    context.lineTo(rect.x + rect.width - r, rect.y);
    context.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + r);
    context.lineTo(rect.x + rect.width, rect.y + rect.height - r);
    context.quadraticCurveTo(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - r, rect.y + rect.height);
    context.lineTo(rect.x + r, rect.y + rect.height);
    context.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - r);
    context.lineTo(rect.x, rect.y + r);
    context.quadraticCurveTo(rect.x, rect.y, rect.x + r, rect.y);
    context.closePath();
}

function drawPolyline(context, points) {
    if (!points?.length)
        return false;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1)
        context.lineTo(points[index].x, points[index].y);
    return true;
}


function buildPath2D(points) {
    const Path2DConstructor = globalThis.Path2D;
    if (typeof Path2DConstructor !== 'function' || !points?.length)
        return undefined;
    const path = new Path2DConstructor();
    path.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1)
        path.lineTo(points[index].x, points[index].y);
    return path;
}

function applyStroke(context, layer, scale) {
    context.strokeStyle = layer.color;
    context.lineWidth = (layer.width ?? 1) / scale;
    context.globalAlpha = layer.opacity ?? 1;
    context.lineCap = layer.lineCap ?? 'round';
    context.lineJoin = 'round';
    context.setLineDash((layer.dash ?? []).map((value) => value / scale));
    context.lineDashOffset = (layer.dashOffset ?? 0) / scale;
}

function drawGrid(context, viewport, theme, options, scale) {
    if (!viewport || options.showGrid === false)
        return;
    const spacing = options.gridSpacing ?? 10;
    const majorEvery = options.gridMajorEvery ?? 5;
    const minimumPixels = options.minimumGridPixels ?? 8;
    let step = spacing;
    while (step * scale < minimumPixels)
        step *= majorEvery;
    const startX = Math.floor(viewport.x / step) * step;
    const endX = viewport.x + viewport.width;
    const startY = Math.floor(viewport.y / step) * step;
    const endY = viewport.y + viewport.height;

    context.save();
    context.lineWidth = 1 / scale;
    context.setLineDash([]);
    for (let x = startX; x <= endX; x += step) {
        const index = Math.round(x / spacing);
        context.strokeStyle = index % majorEvery === 0 ? theme.gridMajor : theme.gridMinor;
        context.beginPath();
        context.moveTo(x, viewport.y);
        context.lineTo(x, endY);
        context.stroke();
    }
    for (let y = startY; y <= endY; y += step) {
        const index = Math.round(y / spacing);
        context.strokeStyle = index % majorEvery === 0 ? theme.gridMajor : theme.gridMinor;
        context.beginPath();
        context.moveTo(viewport.x, y);
        context.lineTo(endX, y);
        context.stroke();
    }
    context.restore();
}

/**
 * Immediate-mode Canvas2D renderer for large interactive scenes. It consumes
 * a culled/LOD render plan, so the hot frame only touches visible entities.
 */
export class Canvas2DRenderer {
    pathCache = new Map();
    lastRevision = -1;
    metrics = {
        frames: 0,
        components: 0,
        wires: 0,
        labels: 0,
        lastFrameMs: 0,
        pathCacheHits: 0,
        pathCacheMisses: 0,
        dirtyRegions: 0,
    };

    clearCaches() {
        this.pathCache.clear();
        this.lastRevision = -1;
    }

    pathForWire(wire, maximumEntries = 20_000) {
        const revision = wire.routeRevision ?? -1;
        const existing = this.pathCache.get(wire.id);
        if (existing?.revision === revision) {
            this.metrics.pathCacheHits += 1;
            return existing.path;
        }
        const path = buildPath2D(wire.points);
        this.metrics.pathCacheMisses += 1;
        if (!path)
            return undefined;
        if (this.pathCache.size >= maximumEntries)
            this.pathCache.clear();
        this.pathCache.set(wire.id, { revision, path });
        return path;
    }

    render(plan, target, options = {}) {
        const started = globalThis.performance?.now?.() ?? Date.now();
        const context = canvasContext(target);
        const canvas = context.canvas;
        const devicePixelRatio = options.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1;
        const scale = Math.max(options.scale ?? plan.zoom ?? 1, 0.0001);
        const translateX = options.translateX ?? (plan.viewport ? -plan.viewport.x * scale : 0);
        const translateY = options.translateY ?? (plan.viewport ? -plan.viewport.y * scale : 0);
        const theme = { ...DEFAULT_EDITOR_THEME, ...(options.theme ?? {}) };

        let resized = false;
        if (canvas && options.resizeToDisplaySize !== false) {
            const cssWidth = options.width ?? canvas.clientWidth ?? canvas.width / devicePixelRatio;
            const cssHeight = options.height ?? canvas.clientHeight ?? canvas.height / devicePixelRatio;
            const pixelWidth = Math.max(1, Math.round(cssWidth * devicePixelRatio));
            const pixelHeight = Math.max(1, Math.round(cssHeight * devicePixelRatio));
            if (canvas.width !== pixelWidth) {
                canvas.width = pixelWidth;
                resized = true;
            }
            if (canvas.height !== pixelHeight) {
                canvas.height = pixelHeight;
                resized = true;
            }
        }

        const dirtyRegions = !resized && options.dirtyRegions?.length ? options.dirtyRegions : undefined;
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = 1;
        context.setLineDash([]);
        if (options.clear !== false) {
            context.fillStyle = options.background ?? theme.background;
            if (dirtyRegions) {
                for (const region of dirtyRegions) {
                    const x = (region.x * scale + translateX) * devicePixelRatio;
                    const y = (region.y * scale + translateY) * devicePixelRatio;
                    const width = region.width * scale * devicePixelRatio;
                    const height = region.height * scale * devicePixelRatio;
                    context.fillRect(x, y, width, height);
                }
            }
            else {
                context.fillRect(0, 0, canvas?.width ?? options.width ?? 1, canvas?.height ?? options.height ?? 1);
            }
        }
        context.restore();

        context.save();
        context.setTransform(
            devicePixelRatio * scale,
            0,
            0,
            devicePixelRatio * scale,
            devicePixelRatio * translateX,
            devicePixelRatio * translateY,
        );
        if (dirtyRegions) {
            context.beginPath();
            for (const region of dirtyRegions)
                context.rect(region.x, region.y, region.width, region.height);
            context.clip();
        }

        drawGrid(context, plan.viewport, theme, options, scale);

        for (const wire of plan.wires) {
            if (!wire.points?.length)
                continue;
            const paint = resolveWirePaint(wire.style, theme, {
                selected: wire.selected,
                invalid: wire.status === 'invalid',
                warning: wire.status === 'fallback',
            });
            const layers = [paint.selection, paint.warning, paint.outline, ...(paint.engineeringLayers ?? [])].filter(Boolean);
            const cachedPath = options.cachePaths === false ? undefined : this.pathForWire(wire, options.maxPathCacheEntries ?? 20_000);
            for (const layer of layers) {
                context.save();
                applyStroke(context, layer, scale);
                if (cachedPath)
                    context.stroke(cachedPath);
                else if (drawPolyline(context, wire.points))
                    context.stroke();
                context.restore();
            }
        }

        for (const component of plan.components) {
            const style = { ...theme.component, ...(component.style ?? {}) };
            if (component.selected) {
                context.save();
                context.strokeStyle = theme.selection;
                context.lineWidth = 2.5 / scale;
                context.setLineDash([9 / scale, 5 / scale]);
                roundRectPath(context, {
                    x: component.body.x - 4 / scale,
                    y: component.body.y - 4 / scale,
                    width: component.body.width + 8 / scale,
                    height: component.body.height + 8 / scale,
                }, (style.bodyRadius ?? 4) + 3 / scale);
                context.stroke();
                context.restore();
            }

            context.save();
            roundRectPath(context, component.body, style.bodyRadius ?? 4);
            context.fillStyle = style.bodyFill ?? '#ffffff';
            context.fill();
            context.strokeStyle = style.bodyStroke ?? '#334155';
            context.lineWidth = (style.bodyStrokeWidth ?? 1) / scale;
            context.stroke();

            roundRectPath(context, component.header, style.bodyRadius ?? 4);
            context.fillStyle = style.headerFill ?? '#1f2937';
            context.fill();

            if (plan.lod !== 'low') {
                context.fillStyle = style.headerText ?? '#ffffff';
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                context.font = `${12.5 / scale}px sans-serif`;
                context.fillText(component.title ?? component.designator ?? component.id, component.titlePoint.x, component.titlePoint.y);
                if (component.subtitle && component.subtitlePoint && plan.lod === 'full') {
                    context.font = `${9.5 / scale}px sans-serif`;
                    context.fillText(component.subtitle, component.subtitlePoint.x, component.subtitlePoint.y);
                }
            }

            if (plan.lod === 'full') {
                for (const port of component.ports) {
                    context.beginPath();
                    context.arc(port.center.x, port.center.y, (style.pinDotRadius ?? 3) / scale, 0, Math.PI * 2);
                    context.fillStyle = style.pinDotFill ?? '#ffffff';
                    context.fill();
                    context.strokeStyle = style.pinDotStroke ?? '#334155';
                    context.lineWidth = 1.5 / scale;
                    context.stroke();
                }
            }
            context.restore();
        }

        for (const label of plan.labels) {
            const style = label.style ?? {};
            context.save();
            roundRectPath(context, label.bounds, style.borderRadius ?? 3);
            context.fillStyle = style.background ?? theme.labelBackground;
            context.fill();
            context.strokeStyle = label.status === 'overlap' ? theme.warning : label.selected ? theme.selection : theme.labelBorder;
            context.lineWidth = (label.selected ? 2 : 1) / scale;
            context.stroke();
            context.fillStyle = style.fill ?? theme.text;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.font = `${(style.fontSize ?? 11) / scale}px ${style.fontFamily ?? 'sans-serif'}`;
            context.fillText(label.text ?? '', label.position.x, label.position.y);
            if (label.secondaryText) {
                context.fillStyle = theme.mutedText;
                context.font = `${(style.fontSize ?? 11) * 0.88 / scale}px ${style.fontFamily ?? 'sans-serif'}`;
                context.fillText(label.secondaryText, label.position.x, label.position.y + (style.lineHeight ?? 14) / scale);
            }
            if (label.leader) {
                context.strokeStyle = theme.mutedText;
                context.lineWidth = 1 / scale;
                context.setLineDash([3 / scale, 3 / scale]);
                context.beginPath();
                context.moveTo(label.leader.start.x, label.leader.start.y);
                context.lineTo(label.leader.end.x, label.leader.end.y);
                context.stroke();
            }
            context.restore();
        }

        context.restore();

        const finished = globalThis.performance?.now?.() ?? Date.now();
        this.metrics = {
            frames: this.metrics.frames + 1,
            components: plan.components.length,
            wires: plan.wires.length,
            labels: plan.labels.length,
            lastFrameMs: finished - started,
            dirtyRegions: dirtyRegions?.length ?? 0,
            pathCacheHits: this.metrics.pathCacheHits,
            pathCacheMisses: this.metrics.pathCacheMisses,
        };
        this.lastRevision = plan.revision;
        return { ...this.metrics };
    }
}

export function createCanvas2DBackend(options = {}) {
    const renderer = new Canvas2DRenderer();
    return {
        capabilities: {
            kind: 'canvas2d',
            viewportCulling: true,
            levelOfDetail: true,
            immediateMode: true,
            workerFriendlyPlan: true,
        },
        render(plan, target, renderOptions = {}) {
            return renderer.render(plan, target, { ...options, ...renderOptions });
        },
        renderer,
    };
}
