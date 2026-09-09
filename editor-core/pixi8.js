/**
 * Optional PixiJS v8 renderer. Pixi is injected by the host so editor-core
 * keeps zero mandatory GPU dependencies. The adapter reuses display objects
 * and only rebuilds Graphics when an entity fingerprint changes.
 */
export class Pixi8Renderer {
    PIXI;
    root;
    wireLayer;
    componentLayer;
    labelLayer;
    wires = new Map();
    components = new Map();
    labels = new Map();
    metrics = { frames: 0, created: 0, updated: 0, removed: 0, visible: 0 };

    constructor(PIXI) {
        if (!PIXI?.Container || !PIXI?.Graphics)
            throw new Error('Pixi8Renderer requires a PixiJS v8 namespace with Container and Graphics.');
        this.PIXI = PIXI;
        this.root = new PIXI.Container();
        this.wireLayer = new PIXI.Container();
        this.componentLayer = new PIXI.Container();
        this.labelLayer = new PIXI.Container();
        this.root.addChild(this.wireLayer, this.componentLayer, this.labelLayer);
    }

    mount(target) {
        if (!target || typeof target.addChild !== 'function')
            throw new Error('Pixi8Renderer target must be a Pixi Container or stage.');
        if (this.root.parent !== target)
            target.addChild(this.root);
        return this;
    }

    destroyEntry(entry) {
        entry?.display?.destroy?.({ children: true });
        this.metrics.removed += 1;
    }

    syncMap(map, visibleIds) {
        for (const [id, entry] of map) {
            if (visibleIds.has(id))
                continue;
            this.destroyEntry(entry);
            map.delete(id);
        }
    }

    wireFingerprint(wire) {
        const style = wire.style ?? {};
        return [wire.routeRevision, wire.status, wire.selected ? 1 : 0, style.width, style.opacity, style.zIndex, JSON.stringify(style.pattern ?? {})].join('|');
    }

    componentFingerprint(component, lod) {
        const body = component.body;
        const header = component.header;
        return [
            lod,
            component.selected ? 1 : 0,
            body.x, body.y, body.width, body.height,
            header.x, header.y, header.width, header.height,
            component.title, component.subtitle,
            JSON.stringify(component.style ?? {}),
            component.ports?.length ?? 0,
        ].join('|');
    }

    labelFingerprint(label, lod) {
        return [lod, label.selected ? 1 : 0, label.status, label.text, label.secondaryText, label.bounds.x, label.bounds.y, label.bounds.width, label.bounds.height, JSON.stringify(label.style ?? {})].join('|');
    }

    updateWire(wire, zoom, theme) {
        const fingerprint = this.wireFingerprint(wire);
        let entry = this.wires.get(wire.id);
        if (!entry) {
            entry = { display: new this.PIXI.Graphics(), fingerprint: '' };
            this.wireLayer.addChild(entry.display);
            this.wires.set(wire.id, entry);
            this.metrics.created += 1;
        }
        if (entry.fingerprint === fingerprint)
            return;
        const graphics = entry.display;
        graphics.clear();
        if (wire.points?.length >= 2) {
            graphics.moveTo(wire.points[0].x, wire.points[0].y);
            for (let index = 1; index < wire.points.length; index += 1)
                graphics.lineTo(wire.points[index].x, wire.points[index].y);
            const pattern = wire.style?.pattern ?? {};
            const color = pattern.color ?? pattern.base ?? pattern.primary ?? theme.wireDefault ?? '#2563eb';
            graphics.stroke({
                color,
                width: (wire.style?.width ?? 2) / Math.max(zoom, 0.0001),
                alpha: wire.style?.opacity ?? 1,
            });
            if (wire.selected) {
                graphics.moveTo(wire.points[0].x, wire.points[0].y);
                for (let index = 1; index < wire.points.length; index += 1)
                    graphics.lineTo(wire.points[index].x, wire.points[index].y);
                graphics.stroke({ color: theme.selection ?? '#0f6fff', width: 5 / Math.max(zoom, 0.0001), alpha: 0.35 });
            }
        }
        entry.fingerprint = fingerprint;
        this.metrics.updated += 1;
    }

    updateComponent(component, lod, zoom, theme) {
        const fingerprint = this.componentFingerprint(component, lod);
        let entry = this.components.get(component.id);
        if (!entry) {
            const display = new this.PIXI.Container();
            display.__graphics = new this.PIXI.Graphics();
            display.addChild(display.__graphics);
            entry = { display, fingerprint: '' };
            this.componentLayer.addChild(display);
            this.components.set(component.id, entry);
            this.metrics.created += 1;
        }
        if (entry.fingerprint === fingerprint)
            return;
        const display = entry.display;
        const graphics = display.__graphics;
        graphics.clear();
        const style = { ...(theme.component ?? {}), ...(component.style ?? {}) };
        const radius = style.bodyRadius ?? 4;
        graphics.roundRect(component.body.x, component.body.y, component.body.width, component.body.height, radius)
            .fill(style.bodyFill ?? '#ffffff')
            .stroke({ color: style.bodyStroke ?? '#334155', width: (style.bodyStrokeWidth ?? 1) / Math.max(zoom, 0.0001) });
        graphics.roundRect(component.header.x, component.header.y, component.header.width, component.header.height, radius)
            .fill(style.headerFill ?? '#1f2937');
        if (component.selected) {
            graphics.roundRect(component.body.x - 4 / zoom, component.body.y - 4 / zoom, component.body.width + 8 / zoom, component.body.height + 8 / zoom, radius)
                .stroke({ color: theme.selection ?? '#0f6fff', width: 2 / Math.max(zoom, 0.0001), alpha: 1 });
        }
        if (lod === 'full') {
            for (const port of component.ports ?? []) {
                graphics.circle(port.center.x, port.center.y, (style.pinDotRadius ?? 3) / Math.max(zoom, 0.0001))
                    .fill(style.pinDotFill ?? '#ffffff')
                    .stroke({ color: style.pinDotStroke ?? '#334155', width: 1 / Math.max(zoom, 0.0001) });
            }
        }
        entry.fingerprint = fingerprint;
        this.metrics.updated += 1;
    }

    updateLabel(label, lod, zoom, theme) {
        const fingerprint = this.labelFingerprint(label, lod);
        let entry = this.labels.get(label.id);
        if (!entry) {
            const display = new this.PIXI.Container();
            display.__graphics = new this.PIXI.Graphics();
            display.addChild(display.__graphics);
            if (this.PIXI.Text) {
                display.__text = new this.PIXI.Text({ text: '', style: { fontFamily: 'sans-serif', fontSize: 11, fill: theme.text ?? '#111827' } });
                display.__text.anchor?.set?.(0.5);
                display.addChild(display.__text);
            }
            entry = { display, fingerprint: '' };
            this.labelLayer.addChild(display);
            this.labels.set(label.id, entry);
            this.metrics.created += 1;
        }
        if (entry.fingerprint === fingerprint)
            return;
        const display = entry.display;
        const graphics = display.__graphics;
        const style = label.style ?? {};
        graphics.clear();
        graphics.roundRect(label.bounds.x, label.bounds.y, label.bounds.width, label.bounds.height, style.borderRadius ?? 3)
            .fill(style.background ?? theme.labelBackground ?? '#ffffff')
            .stroke({ color: label.status === 'overlap' ? theme.warning : label.selected ? theme.selection : theme.labelBorder, width: (label.selected ? 2 : 1) / Math.max(zoom, 0.0001) });
        if (display.__text) {
            display.__text.text = label.text ?? '';
            display.__text.position.set(label.position.x, label.position.y);
            display.__text.style.fontSize = (style.fontSize ?? 11) / Math.max(zoom, 0.0001);
            display.__text.style.fill = style.fill ?? theme.text ?? '#111827';
        }
        entry.fingerprint = fingerprint;
        this.metrics.updated += 1;
    }

    render(plan, target, options = {}) {
        this.mount(target);
        const zoom = Math.max(options.scale ?? plan.zoom ?? 1, 0.0001);
        const viewport = plan.viewport;
        const theme = options.theme ?? {};
        this.root.scale.set(zoom);
        this.root.position.set(viewport ? -viewport.x * zoom : 0, viewport ? -viewport.y * zoom : 0);

        const wireIds = new Set(plan.wires.map((wire) => wire.id));
        const componentIds = new Set(plan.components.map((component) => component.id));
        const labelIds = new Set(plan.labels.map((label) => label.id));
        this.syncMap(this.wires, wireIds);
        this.syncMap(this.components, componentIds);
        this.syncMap(this.labels, labelIds);

        for (const wire of plan.wires)
            this.updateWire(wire, zoom, theme);
        for (const component of plan.components)
            this.updateComponent(component, plan.lod, zoom, theme);
        for (const label of plan.labels)
            this.updateLabel(label, plan.lod, zoom, theme);

        this.metrics.frames += 1;
        this.metrics.visible = plan.wires.length + plan.components.length + plan.labels.length;
        return { ...this.metrics };
    }

    destroy() {
        for (const map of [this.wires, this.components, this.labels]) {
            for (const entry of map.values())
                this.destroyEntry(entry);
            map.clear();
        }
        this.root.destroy?.({ children: true });
    }
}

export function createPixi8Backend(PIXI, options = {}) {
    const renderer = new Pixi8Renderer(PIXI);
    return {
        capabilities: {
            kind: 'pixi8',
            webgl: true,
            webgpu: true,
            viewportCulling: true,
            levelOfDetail: true,
            retainedDisplayObjects: true,
        },
        render(plan, target, renderOptions = {}) {
            return renderer.render(plan, target, { ...options, ...renderOptions });
        },
        renderer,
    };
}
