import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSampleDocument,
  deriveEditorScene,
  renderEditorSvg,
} from '../editor-core/index.js';

test('scene derivation is pure and produces routes, placements and bounds', () => {
  const document = createSampleDocument();
  const before = JSON.stringify(document);
  const scene = deriveEditorScene(document);
  assert.equal(JSON.stringify(document), before);
  assert.equal(Object.keys(scene.componentGeometries).length, 3);
  assert.equal(Object.keys(scene.routes).length, 6);
  assert.equal(Object.keys(scene.labelPlacements).length, 5);
  assert.ok(scene.contentBounds.width > 500);
});

test('SVG renderer preserves engineering color patterns and accessibility metadata', () => {
  const scene = deriveEditorScene(createSampleDocument());
  const svg = renderEditorSvg(scene.document, {
    geometries: scene.componentGeometries,
    labelPlacements: scene.labelPlacementList,
    selection: { items: [{ kind: 'wire', id: 'W3' }, { kind: 'component', id: 'A1' }] },
    options: { showRouteHandles: true },
  });
  assert.match(svg, /role="graphics-document"/u);
  assert.match(svg, /data-component-id="A1"/u);
  assert.match(svg, /data-wire-id="W3"/u);
  assert.match(svg, /stroke-dasharray/u);
  assert.match(svg, /editor-core-route|data-route-handle/u);
  assert.match(svg, /TWISTED PAIR/u);
});

test('SVG renderer includes interaction overlays', () => {
  const scene = deriveEditorScene(createSampleDocument());
  const svg = renderEditorSvg(scene.document, {
    geometries: scene.componentGeometries,
    labelPlacements: scene.labelPlacementList,
    overlay: {
      snapGuides: [{ axis: 'x', coordinate: 200, from: 0, to: 300, kind: 'center' }],
      marquee: { bounds: { x: 0, y: 0, width: 100, height: 100 }, mode: 'window' },
      connection: {
        source: { kind: 'port', componentId: 'J1', portId: 'J1:5' },
        point: { x: 350, y: 250 },
        valid: false,
        reason: 'Choose a target port.',
      },
    },
  });
  assert.match(svg, /editor-core-snap-guide/u);
  assert.match(svg, /editor-core-marquee/u);
  assert.match(svg, /editor-core-connection-preview/u);
});
