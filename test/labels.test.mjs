import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ApproximateTextMeasurer,
  buildComponentGeometry,
  createConnector,
  pinLabelToWorld,
  placeLabel,
  resetLabelToAutomatic,
} from '../editor-core/index.js';

function baseLabel() {
  return {
    id: 'L1',
    text: 'DESTINATION X2.3',
    anchor: { ownerKind: 'component', ownerId: 'X1' },
    mode: 'auto',
    orientation: 'horizontal',
    offset: { x: 0, y: 0 },
    priority: 10,
    avoidWires: true,
    avoidComponents: true,
    allowLeader: true,
    visible: true,
    locked: false,
    style: {},
  };
}

test('automatic label placement chooses an external candidate without overlap', () => {
  const component = createConnector('X1', 'X1', 4, { x: 100, y: 100 });
  const geometry = buildComponentGeometry(component);
  const placement = placeLabel(baseLabel(), new ApproximateTextMeasurer(), {
    components: { X1: geometry },
    routes: {},
    labelGap: 12,
  });
  assert.equal(placement.status, 'placed');
  assert.ok(placement.candidate);
  assert.ok(placement.leader);
});

test('previous automatic placement contributes stability', () => {
  const component = createConnector('X1', 'X1', 4, { x: 100, y: 100 });
  const geometry = buildComponentGeometry(component);
  const first = placeLabel(baseLabel(), new ApproximateTextMeasurer(), { components: { X1: geometry }, routes: {}, labelGap: 10 });
  const second = placeLabel(baseLabel(), new ApproximateTextMeasurer(), {
    components: { X1: geometry }, routes: {}, labelGap: 10, previousPlacements: { L1: first },
  });
  assert.equal(second.candidate, first.candidate);
  assert.deepEqual(second.position, first.position);
});

test('pinning and reset preserve content while changing placement ownership', () => {
  const label = baseLabel();
  const pinned = pinLabelToWorld(label, { x: 400, y: 200 });
  assert.equal(pinned.mode, 'world-pinned');
  assert.deepEqual(pinned.worldPosition, { x: 400, y: 200 });
  const reset = resetLabelToAutomatic(pinned);
  assert.equal(reset.mode, 'auto');
  assert.equal(reset.worldPosition, undefined);
  assert.equal(reset.text, label.text);
});
