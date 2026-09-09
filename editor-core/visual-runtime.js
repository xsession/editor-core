import { hitTestDocumentIndexed, marqueeSelectIndexed, VisualBackendRegistry } from './advanced-visual.js';
import { IncrementalSceneRuntime } from './incremental-runtime.js';
import { RetainedRenderState } from './render-runtime.js';
import { EditorPerformanceMonitor } from './performance.js';
import { findConnectionCandidates, MagneticConnectionSession } from './connection-intelligence.js';
import { createCanvas2DBackend } from './canvas2d.js';

/**
 * Host-facing coordinator for the optimized editor pipeline. It keeps document
 * semantics in the core while combining incremental derivation, indexed input,
 * viewport/LOD render plans, dirty-region diffing and pluggable renderers.
 */
export class HighPerformanceVisualRuntime {
    sceneRuntime;
    retainedRender;
    backends;
    performance;
    activeConnection;
    lastPlan;
    lastDiff;

    constructor(options = {}) {
        this.options = {
            defaultRenderer: options.defaultRenderer ?? 'canvas2d',
            autoRegisterCanvas2D: options.autoRegisterCanvas2D ?? true,
            ...options,
        };
        this.sceneRuntime = options.sceneRuntime ?? new IncrementalSceneRuntime(options.scene ?? options);
        this.retainedRender = options.retainedRender ?? new RetainedRenderState(options.dirtyRegions);
        this.backends = options.backends ?? new VisualBackendRegistry();
        this.performance = options.performance ?? new EditorPerformanceMonitor(options.performanceSamples ?? 240);
        if (this.options.autoRegisterCanvas2D && !this.backends.renderer('canvas2d'))
            this.backends.registerRenderer('canvas2d', createCanvas2DBackend(options.canvas2d));
    }

    reset(document) {
        this.performance.begin('scene-reset');
        try {
            const scene = this.sceneRuntime.reset(document);
            this.retainedRender.reset();
            this.lastPlan = undefined;
            this.lastDiff = undefined;
            return scene;
        }
        finally {
            this.performance.end('scene-reset');
        }
    }

    update(document, impact = {}) {
        this.performance.begin('scene-update');
        try {
            return this.sceneRuntime.update(document, impact);
        }
        finally {
            this.performance.end('scene-update');
        }
    }

    plan(options = {}) {
        this.performance.begin('render-plan');
        try {
            const plan = this.sceneRuntime.renderPlan(options);
            const incrementalImpact = this.sceneRuntime.scene?.incrementalImpact;
            const diffOptions = {
                ...(options.dirtyRegions ?? {}),
                ownerHints: incrementalImpact && !incrementalImpact.full ? {
                    components: incrementalImpact.changedComponents,
                    wires: incrementalImpact.affectedWires,
                    labels: incrementalImpact.affectedLabels,
                } : undefined,
            };
            const diff = this.retainedRender.update(plan, diffOptions);
            this.lastPlan = plan;
            this.lastDiff = diff;
            return { plan, diff };
        }
        finally {
            this.performance.end('render-plan');
        }
    }

    render(target, options = {}) {
        const { plan, diff } = options.plan
            ? { plan: options.plan, diff: options.diff ?? this.retainedRender.update(options.plan, options.dirtyRegions) }
            : this.plan(options);
        const backendName = options.backend ?? this.options.defaultRenderer;
        const backend = typeof backendName === 'string' ? this.backends.renderer(backendName) : backendName;
        if (!backend)
            throw new Error(`Unknown visual renderer backend: ${String(backendName)}`);
        this.performance.begin('render');
        try {
            const renderOptions = {
                ...(options.renderOptions ?? options),
                dirtyRegions: diff.fullRedraw ? undefined : diff.dirtyRegions,
            };
            const result = backend.render(plan, target, renderOptions);
            this.performance.increment('frames');
            if (diff.fullRedraw)
                this.performance.increment('fullRedraws');
            else
                this.performance.increment('partialRedraws');
            return { plan, diff, result };
        }
        finally {
            this.performance.end('render');
        }
    }

    hitTest(point, options = {}) {
        const scene = this.sceneRuntime.scene;
        const spatialIndex = this.sceneRuntime.spatialIndex;
        if (!scene || !spatialIndex)
            return [];
        this.performance.begin('hit-test');
        try {
            return hitTestDocumentIndexed(scene.document, point, {
                componentGeometries: scene.componentGeometries,
                labelPlacements: scene.labelPlacementList,
                labelPlacementMap: scene.labelPlacementMap,
                zoom: options.zoom ?? 1,
                hitTolerancePx: options.hitTolerancePx ?? scene.document.settings.hitTolerancePx,
                includeRouteHandles: options.includeRouteHandles,
                includeHidden: options.includeHidden,
            }, spatialIndex);
        }
        finally {
            this.performance.end('hit-test');
        }
    }

    marquee(bounds, mode = 'window', options = {}) {
        const scene = this.sceneRuntime.scene;
        const spatialIndex = this.sceneRuntime.spatialIndex;
        if (!scene || !spatialIndex)
            return [];
        return marqueeSelectIndexed(scene.document, bounds, mode, {
            componentGeometries: scene.componentGeometries,
            labelPlacements: scene.labelPlacementList,
            labelPlacementMap: scene.labelPlacementMap,
            includeHidden: options.includeHidden,
        }, spatialIndex);
    }

    beginConnection(sourceEndpoint, options = {}) {
        this.activeConnection = new MagneticConnectionSession(sourceEndpoint, options);
        return this.activeConnection;
    }

    updateConnection(pointer, options = {}) {
        const scene = this.sceneRuntime.scene;
        const spatialIndex = this.sceneRuntime.spatialIndex;
        if (!scene || !spatialIndex || !this.activeConnection)
            return { candidate: undefined, snappedPoint: { ...pointer }, acquired: false };
        return this.activeConnection.update(pointer, scene.document, {
            zoom: options.zoom ?? 1,
            componentGeometries: scene.componentGeometries,
        }, spatialIndex);
    }

    connectionCandidates(sourceEndpoint, pointer, options = {}) {
        const scene = this.sceneRuntime.scene;
        const spatialIndex = this.sceneRuntime.spatialIndex;
        if (!scene || !spatialIndex)
            return [];
        return findConnectionCandidates(scene.document, sourceEndpoint, pointer, {
            zoom: options.zoom ?? 1,
            componentGeometries: scene.componentGeometries,
        }, spatialIndex, options);
    }

    endConnection() {
        this.activeConnection?.clear();
        this.activeConnection = undefined;
    }

    registerRenderer(name, backend) {
        this.backends.registerRenderer(name, backend);
        return this;
    }

    registerRouter(name, backend) {
        this.backends.registerRouter(name, backend);
        return this;
    }

    metrics() {
        return {
            runtime: { ...this.sceneRuntime.metrics },
            performance: this.performance.snapshot(),
            spatial: this.sceneRuntime.spatialIndex?.index?.stats ?? this.sceneRuntime.spatialIndex?.stats,
            visible: this.lastPlan?.counts,
            lastDiff: this.lastDiff ? {
                fullRedraw: this.lastDiff.fullRedraw,
                dirtyRegions: this.lastDiff.dirtyRegions.length,
                changedOwners: this.lastDiff.changedOwners.size,
                reason: this.lastDiff.reason,
            } : undefined,
        };
    }
}
