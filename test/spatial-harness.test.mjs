import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeSpatialCable,
  createSampleDocument,
  createSpatialHarnessDocument,
  insertSpatialControlPoint,
} from '../editor-core/index.js';

test('spatial harness projection preserves wire identity and checks bend radius', () => {
  const document = createSampleDocument();
  const spatial = createSpatialHarnessDocument(document);
  assert.deepEqual(spatial.cableOrder, document.wireOrder);
  const cable = spatial.cables[spatial.cableOrder[0]];
  assert.equal(cable.wireId, spatial.cableOrder[0]);
  const withPoint = insertSpatialControlPoint(cable, 0);
  withPoint.controlPoints[1].y = 80;
  withPoint.minimumBendRadiusMm = 1000;
  const analysis = analyzeSpatialCable(withPoint);
  assert.ok(analysis.lengthMm > 0);
  assert.equal(analysis.valid, false);
  assert.ok(analysis.bendViolations.length >= 1);
});
