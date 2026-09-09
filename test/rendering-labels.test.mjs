import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ApproximateTextMeasurer,
  DEFAULT_DARK_THEME,
  DEFAULT_EDITOR_THEME,
  DEFAULT_WIRE_STYLE,
  bestTextColor,
  contrastRatio,
  createSampleDocument,
  deriveEditorScene,
  parseDocument,
  pinLabelToWorld,
  renderEditorSvg,
  resetLabelToAutomatic,
  resolveWirePaint,
  serializeDocument,
} from '../editor-core/index.js';

test('scene derivation produces routes, placements, crossings, and finite content bounds', () => {
  const scene = deriveEditorScene(createSampleDocument());
  assert.equal(Object.keys(scene.componentGeometries).length, 3);
  assert.equal(Object.keys(scene.routes).length, 6);
  assert.equal(scene.labelPlacementList.length, 5);
  assert.ok(scene.contentBounds.width > 900);
  assert.ok(scene.contentBounds.height > 300);
  assert.ok(Object.values(scene.routes).every((route) => route.status !== 'invalid'));
});

test('world-pinned labels stay at the requested coordinates and can be reset', () => {
  const document = createSampleDocument();
  const original = document.labels['L-J1'];
  const pinned = pinLabelToWorld(original, { x: 777, y: 333 });
  document.labels['L-J1'] = pinned;
  const scene = deriveEditorScene(document);
  const placement = scene.labelPlacements['L-J1'];
  assert.deepEqual(placement.position, { x: 777, y: 333 });
  assert.equal(resetLabelToAutomatic(pinned).mode, 'auto');
});

test('wire color patterns render as layered engineering strokes plus independent selection halo', () => {
  const style = {
    ...DEFAULT_WIRE_STYLE,
    pattern: { kind: 'stripe', base: '#111827', stripe: '#facc15', stripeWidth: 1.5, repeat: 14 },
  };
  const paint = resolveWirePaint(style, DEFAULT_EDITOR_THEME, { selected: true, warning: true });
  assert.equal(paint.engineeringLayers.length, 2);
  assert.ok(paint.outline);
  assert.ok(paint.selection);
  assert.ok(paint.warning);
  assert.notEqual(paint.selection.color, style.pattern.base);
});

test('contrast helpers select legible text color', () => {
  assert.ok(contrastRatio('#ffffff', '#111827') > 10);
  assert.equal(bestTextColor('#ffffff'), '#111827');
  assert.equal(bestTextColor('#000000'), '#ffffff');
});

test('SVG renderer emits semantic layers, rounded wires, and escaped user text', () => {
  const document = createSampleDocument();
  document.labels['L-J1'].text = '<script>alert("x")</script>&';
  const scene = deriveEditorScene(document);
  const svg = renderEditorSvg(scene.document, {
    geometries: scene.componentGeometries,
    labelPlacements: scene.labelPlacementList,
    selection: { items: [{ kind: 'wire', id: 'W1' }], primary: { kind: 'wire', id: 'W1' } },
    options: { showRouteHandles: true, includeAccessibility: true },
  });

  assert.ok(svg.startsWith('<svg'));
  assert.match(svg, /role="graphics-document"/u);
  for (const layer of ['editor-core-grid-layer', 'editor-core-wire-layer', 'editor-core-crossing-layer', 'editor-core-component-layer', 'editor-core-label-layer', 'editor-core-handle-layer']) {
    assert.match(svg, new RegExp(`id="${layer}"`, 'u'));
  }
  assert.ok(svg.includes(' A '), 'rounded routes should use SVG arc commands');
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;'));
});

test('serialization is deterministic and round-trips the full editor document', () => {
  const document = createSampleDocument();
  const first = serializeDocument(document, false);
  const second = serializeDocument(document, false);
  assert.equal(first, second);
  const parsed = parseDocument(first);
  assert.equal(serializeDocument(parsed, false), first);
  assert.equal(parsed.id, document.id);
  assert.deepEqual(parsed.componentOrder, document.componentOrder);
  assert.deepEqual(parsed.wireOrder, document.wireOrder);
});

test('approximate text metrics are deterministic for offline layout', () => {
  const measurer = new ApproximateTextMeasurer();
  assert.deepEqual(measurer.measure('ABC'), measurer.measure('ABC'));
  assert.ok(measurer.measure('ABCDEFGHIJ').width > measurer.measure('ABC').width);
  assert.ok(measurer.measure('A\nB').height > measurer.measure('A').height);
});

test('dark editor theme derives readable label text from the label background', () => {
  const document = createSampleDocument();
  document.labels['L-J1'].style = { fontSize: 11, fontWeight: 500 };
  const scene = deriveEditorScene(document);
  const svg = renderEditorSvg(scene.document, {
    geometries: scene.componentGeometries,
    labelPlacements: scene.labelPlacementList,
    theme: DEFAULT_DARK_THEME,
  });
  const group = svg.match(/<g class="editor-core-label" data-label-id="L-J1"[\s\S]*?<\/g>/u)?.[0] || '';
  assert.match(group, /<rect[^>]+fill="#f8fafc"/u);
  assert.match(group, /<text[^>]+fill="#111827"/u);
});

test('dark theme keeps default label cards and component pin text readable', () => {
  const document = createSampleDocument();
  document.labels['L-J1'].style = {};
  const scene = deriveEditorScene(document);
  const svg = renderEditorSvg(scene.document, {
    geometries: scene.componentGeometries,
    labelPlacements: scene.labelPlacementList,
    theme: DEFAULT_DARK_THEME,
  });
  const labelGroup = svg.match(/<g class="editor-core-label" data-label-id="L-J1"[\s\S]*?<\/g>/u)?.[0] || '';
  assert.match(labelGroup, /<rect[^>]+fill="#f8fafc"/u);
  assert.match(labelGroup, /<text[^>]+fill="#111827"/u);
  assert.doesNotMatch(labelGroup, /<text[^>]+fill="#f8fafc"/u);
  assert.match(svg, /data-port-label-for="[^"]+"[^>]+fill="#(?:334155|111827)"/u);
  assert.doesNotMatch(svg, /data-port-label-for="[^"]+"[^>]+fill="#f8fafc"/u);
});
