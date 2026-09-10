import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeSpatialCable,
  buildSpatialKeepOutVolume,
  closestPointOnTriangle,
  routeSpatialBundle,
  routeSpatialCable,
  sampleCatmullRom,
  smoothSpatialPath,
  volumeIsFree,
  volumeLineOfSight,
  volumeVoxelIndex,
} from '../editor-core/index.js';

function cable(overrides = {}) {
  return {
    id: 'cable-1',
    wireId: 'wire-1',
    label: 'test cable',
    diameterMm: 4,
    minimumBendRadiusMm: 12,
    color: '#3b82f6',
    controlPoints: [
      { x: 0, y: 50, z: 0 },
      { x: 200, y: 50, z: 0 },
    ],
    lockedPointIndices: [0, 1],
    surfaceMode: 'free',
    ...overrides,
  };
}

/** A single 120x40x80 box made of 12 triangles, centered near x=100. */
function boxTriangles() {
  const x0 = 60, x1 = 180, y0 = 10, y1 = 90, z0 = -30, z1 = 50;
  const p = (x, y, z) => ({ x, y, z });
  const faces = [
    [[p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1)], [p(x0, y0, z0), p(x1, y0, z1), p(x0, y0, z1)]],
    [[p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0)], [p(x0, y1, z1), p(x1, y1, z0), p(x0, y1, z0)]],
    [[p(x0, y0, z0), p(x0, y1, z0), p(x0, y1, z1)], [p(x0, y0, z0), p(x0, y1, z1), p(x0, y0, z1)]],
    [[p(x1, y1, z1), p(x1, y0, z1), p(x1, y0, z0)], [p(x1, y1, z1), p(x1, y0, z0), p(x1, y1, z0)]],
    [[p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1)], [p(x0, y0, z1), p(x1, y1, z1), p(x0, y1, z1)]],
    [[p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0)], [p(x0, y1, z0), p(x1, y0, z0), p(x0, y0, z0)]],
  ];
  return faces.flat().map(([a, b, c]) => ({ a, b, c }));
}

test('closest point on a triangle reports consistent barycentric coordinates', () => {
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 10, y: 0, z: 0 };
  const c = { x: 0, y: 0, z: 10 };
  const edgeMid = closestPointOnTriangle({ x: 5, y: 0, z: 0 }, a, b, c);
  assert.deepEqual(edgeMid.point, { x: 5, y: 0, z: 0 });
  assert.equal(edgeMid.barycentric[0], 0.5);
  assert.equal(edgeMid.barycentric[1], 0);
  const interior = closestPointOnTriangle({ x: 2, y: 1, z: 2 }, a, b, c);
  // Projection onto the z=0 plane.
  assert.equal(interior.point.y, 0);
  const u = interior.barycentric[0];
  const v = interior.barycentric[1];
  assert.ok(Math.abs((a.x + u * (b.x - a.x) + v * (c.x - a.x)) - interior.point.x) < 1e-9);
  assert.ok(Math.abs((a.z + u * (b.z - a.z) + v * (c.z - a.z)) - interior.point.z) < 1e-9);
});

test('keep-out volume blocks voxels inside an obstacle and keeps clearance', () => {
  const volume = buildSpatialKeepOutVolume(boxTriangles(), { clearanceMm: 10, cellSizeMm: 5 });
  assert.ok(volume);
  const inside = { x: 120, y: 50, z: 10 };
  const outside = { x: 120, y: 140, z: 10 };
  assert.ok(!volumeIsFree(volume, inside), 'voxel inside the box must be blocked');
  assert.ok(volumeIsFree(volume, outside), 'voxel above the box must be free');
  const id = volumeVoxelIndex(volume, inside);
  assert.ok(id >= 0);
  assert.equal(volume.blocked[id], 1);
});

test('bend-aware A* routes around the keep-out box and never enters it', () => {
  const volume = buildSpatialKeepOutVolume(boxTriangles(), { clearanceMm: 8, cellSizeMm: 5 });
  assert.ok(volume);
  const path = cable({ controlPoints: [{ x: 20, y: 50, z: 10 }, { x: 240, y: 50, z: 10 }] });
  const route = routeSpatialCable(path, volume, { maxExpansions: 500000 });
  assert.equal(route.success, true, route.reason);
  assert.ok(route.controlPoints.length >= 2);
  assert.deepEqual(route.controlPoints[0], { x: 20, y: 50, z: 10 });
  assert.deepEqual(route.controlPoints[route.controlPoints.length - 1], { x: 240, y: 50, z: 10 });
  const analysis = analyzeSpatialCable({ ...path, controlPoints: route.controlPoints });
  assert.equal(analysis.valid, true, JSON.stringify(analysis.bendViolations));
  // The direct line through the box is ~220 mm; a detour must be longer.
  assert.ok(analysis.lengthMm > 220, `expected detour, got ${analysis.lengthMm}`);
  for (const point of route.controlPoints) {
    assert.ok(volumeIsFree(volume, point), `route point ${JSON.stringify(point)} enters the keep-out volume`);
  }
  assert.ok(route.expansions > 0);
});

test('A* fails cleanly when the goal is fully enclosed', () => {
  const p = (x, y, z) => ({ x, y, z });
  // A large solid centered on the goal: the goal is at its center, far
  // enough from every face that the endpoint free-voxel snap (25 mm) cannot
  // reach free space, so no free goal voxel exists.
  const x0 = 140, x1 = 320, y0 = -30, y1 = 130, z0 = -40, z1 = 60;
  const faces = [
    [[p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1)], [p(x0, y0, z0), p(x1, y0, z1), p(x0, y0, z1)]],
    [[p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0)], [p(x0, y1, z1), p(x1, y1, z0), p(x0, y1, z0)]],
    [[p(x0, y0, z0), p(x0, y1, z0), p(x0, y1, z1)], [p(x0, y0, z0), p(x0, y1, z1), p(x0, y0, z1)]],
    [[p(x1, y1, z1), p(x1, y0, z1), p(x1, y0, z0)], [p(x1, y1, z1), p(x1, y0, z0), p(x1, y1, z0)]],
    [[p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1)], [p(x0, y0, z1), p(x1, y1, z1), p(x0, y1, z1)]],
    [[p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0)], [p(x0, y1, z0), p(x1, y0, z0), p(x0, y0, z0)]],
  ];
  const volume = buildSpatialKeepOutVolume(boxTriangles().concat(faces.flat().map(([a, b, c]) => ({ a, b, c }))), { clearanceMm: 0, cellSizeMm: 5 });
  assert.ok(volume);
  const path = cable({ controlPoints: [{ x: 20, y: 50, z: 10 }, { x: 230, y: 50, z: 10 }] });
  const route = routeSpatialCable(path, volume, { maxExpansions: 100000 });
  assert.equal(route.success, false);
  assert.equal(route.reason, 'goal-blocked');
});

test('line-of-sight is rejected through obstacles and accepted around them', () => {
  const volume = buildSpatialKeepOutVolume(boxTriangles(), { clearanceMm: 0, cellSizeMm: 5 });
  assert.ok(volume);
  assert.ok(!volumeLineOfSight(volume, { x: 30, y: 50, z: 10 }, { x: 230, y: 50, z: 10 }));
  assert.ok(volumeLineOfSight(volume, { x: 120, y: 150, z: 10 }, { x: 120, y: 150, z: 90 }));
});

test('centripetal Catmull-Rom passes through every control point', () => {
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 40, y: 30, z: 0 },
    { x: 80, y: 0, z: 0 },
    { x: 120, y: 30, z: 0 },
  ];
  const sampled = sampleCatmullRom(points, 8);
  assert.ok(sampled.length > points.length * 2);
  assert.deepEqual(sampled[0], points[0]);
  assert.deepEqual(sampled[sampled.length - 1], points[points.length - 1]);
  for (const control of points) {
    const found = sampled.some((sample) => sample.x === control.x && sample.y === control.y && sample.z === control.z);
    assert.ok(found, `control point ${JSON.stringify(control)} missing from the sampled curve`);
  }
});

test('spline smoothing keeps the path bend- and clearance-valid or falls back', () => {
  const volume = buildSpatialKeepOutVolume(boxTriangles(), { clearanceMm: 0, cellSizeMm: 5 });
  assert.ok(volume);
  const path = cable({ controlPoints: [{ x: 20, y: 50, z: 10 }, { x: 240, y: 50, z: 10 }] });
  const route = routeSpatialCable(path, volume, { maxExpansions: 500000 });
  assert.equal(route.success, true);
  const smooth = smoothSpatialPath(route.controlPoints, path.minimumBendRadiusMm, volume);
  const analysis = analyzeSpatialCable({ ...path, controlPoints: smooth.points });
  assert.equal(analysis.valid, true);
  for (const sample of smooth.points) {
    assert.ok(volumeIsFree(volume, sample), `smoothed sample ${JSON.stringify(sample)} enters the keep-out volume`);
  }
  assert.ok(smooth.points.length >= 2);
});

test('bundle routing shares trunk voxels between cables', () => {
  const volume = buildSpatialKeepOutVolume(boxTriangles(), { clearanceMm: 0, cellSizeMm: 5 });
  assert.ok(volume);
  const sharedTrunk = { controlPoints: [{ x: 20, y: 50, z: 80 }, { x: 240, y: 50, z: 80 }] };
  const cables = [
    cable({ id: 'cable-a', wireId: 'wire-a', controlPoints: [{ x: 20, y: 20, z: 80 }, { x: 240, y: 50, z: 80 }] }),
    cable({ id: 'cable-b', wireId: 'wire-b', controlPoints: [{ x: 20, y: 80, z: 80 }, { x: 240, y: 50, z: 80 }] }),
    cable({ id: 'cable-c', wireId: 'wire-c', controlPoints: [{ x: 20, y: 50, z: 30 }, { x: 240, y: 50, z: 80 }] }),
  ];
  void sharedTrunk;
  const results = routeSpatialBundle(cables, volume, { maxExpansions: 400000, sharedEdgeDiscount: 0.3 });
  assert.equal(results.length, 3);
  for (const result of results) {
    assert.equal(result.success, true, `${result.cableId} ${result.cableId}`);
    assert.ok(result.lengthMm > 0);
    const sourceCable = cables.find((c) => c.id === result.cableId);
    const analysis = analyzeSpatialCable({ ...sourceCable, controlPoints: result.controlPoints });
    assert.equal(analysis.valid, true, JSON.stringify(analysis.bendViolations));
  }
  const sharedTotals = results.reduce((sum, result) => sum + result.sharedVoxelCount, 0);
  assert.ok(sharedTotals > 0, 'expected shared trunk voxels between bundled cables');
});

test('routing without a volume returns the straight endpoint segment', () => {
  const path = cable({ controlPoints: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 50, z: 25 }] });
  const route = routeSpatialCable(path, null);
  assert.equal(route.success, true);
  assert.deepEqual(route.controlPoints, path.controlPoints.map((point) => ({ ...point })));
});
