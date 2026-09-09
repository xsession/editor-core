import { IncrementalSceneRuntime } from '../editor-core/incremental-runtime.js';
import { hitTestDocumentIndexed } from '../editor-core/advanced-visual.js';
import { Canvas2DRenderer } from '../editor-core/canvas2d.js';
import { generateBenchmarkDocument } from './benchmark-data.js';

const sizes = [1_000, 10_000, 50_000];
const output = document.querySelector('#output');
const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');

function now() {
    return performance.now();
}

function ms(value) {
    return `${value.toFixed(2)} ms`;
}

function randomPoint(bounds) {
    return {
        x: bounds.x + Math.random() * Math.max(1, bounds.width),
        y: bounds.y + Math.random() * Math.max(1, bounds.height),
    };
}

async function nextFrame() {
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function runScenario(componentCount) {
    output.textContent += `\n=== ${componentCount.toLocaleString()} components ===\n`;
    await nextFrame();
    const makeStarted = now();
    const source = generateBenchmarkDocument(componentCount, { wireStride: componentCount >= 50_000 ? 10 : 4 });
    const makeMs = now() - makeStarted;

    const runtime = new IncrementalSceneRuntime({
        autoRoute: false,
        validate: false,
        findCrossings: false,
        adaptiveSpatial: true,
    });
    const buildStarted = now();
    const scene = runtime.reset(source);
    const buildMs = now() - buildStarted;

    const viewport = {
        x: scene.contentBounds.x,
        y: scene.contentBounds.y,
        width: 1600,
        height: 900,
    };
    const queryCount = componentCount >= 50_000 ? 2_000 : 5_000;
    const queryStarted = now();
    let hitCount = 0;
    for (let index = 0; index < queryCount; index += 1) {
        const point = randomPoint(scene.contentBounds);
        hitCount += hitTestDocumentIndexed(scene.document, point, {
            componentGeometries: scene.componentGeometries,
            labelPlacements: scene.labelPlacementList,
            labelPlacementMap: scene.labelPlacementMap,
            zoom: 1,
            hitTolerancePx: scene.document.settings.hitTolerancePx,
        }, scene.spatialIndex).length;
    }
    const queryMs = now() - queryStarted;

    const planStarted = now();
    const plan = runtime.renderPlan({ viewport, zoom: 0.9 });
    const planMs = now() - planStarted;

    canvas.width = 1600;
    canvas.height = 900;
    const renderer = new Canvas2DRenderer();
    const renderStarted = now();
    renderer.render(plan, ctx, { viewport, devicePixelRatio: 1 });
    const renderMs = now() - renderStarted;

    output.textContent += [
        `document generation: ${ms(makeMs)}`,
        `scene + adaptive index: ${ms(buildMs)}`,
        `${queryCount.toLocaleString()} indexed hit tests: ${ms(queryMs)} (${(queryMs / queryCount * 1000).toFixed(2)} us/query)` ,
        `viewport render-plan: ${ms(planMs)}`,
        `Canvas2D visible render: ${ms(renderMs)}`,
        `visible: ${plan.counts.components} components, ${plan.counts.wires} wires, ${plan.counts.labels} labels`,
        `semantic hits observed: ${hitCount}`,
        `runtime counters: ${JSON.stringify(runtime.metrics)}`,
    ].join('\n') + '\n';
    await nextFrame();
}

async function runAll() {
    document.querySelector('#run').disabled = true;
    output.textContent = `Browser: ${navigator.userAgent}\n`;
    try {
        for (const size of sizes)
            await runScenario(size);
    }
    catch (error) {
        output.textContent += `\nERROR: ${error.stack ?? error}\n`;
    }
    finally {
        document.querySelector('#run').disabled = false;
    }
}

document.querySelector('#run').addEventListener('click', runAll);
