import { rectBottom, rectCenter, rectRight, screenToleranceToWorld, snap } from './geometry.js';
import type { ComponentGeometry, EntityId, Point, Rect } from './types.js';

export type SnapGuideKind = 'grid' | 'edge' | 'center' | 'port';

export interface SnapGuide {
  axis: 'x' | 'y';
  coordinate: number;
  from: number;
  to: number;
  kind: SnapGuideKind;
  sourceId?: EntityId;
  targetId?: EntityId;
  label?: string;
}

export interface ComponentDragSnapOptions {
  zoom: number;
  tolerancePx?: number;
  gridSpacing?: number;
  enableGrid?: boolean;
  enableAlignment?: boolean;
  enablePortAlignment?: boolean;
  primaryComponentId?: EntityId;
}

export interface ComponentDragSnapResult {
  delta: Point;
  correction: Point;
  guides: SnapGuide[];
  snappedX: boolean;
  snappedY: boolean;
}

interface AxisCandidate {
  axis: 'x' | 'y';
  correction: number;
  coordinate: number;
  kind: SnapGuideKind;
  sourceId?: EntityId;
  targetId?: EntityId;
  sourceSpan: [number, number];
  targetSpan: [number, number];
  priority: number;
  label?: string;
}

function translatedRect(value: Rect, delta: Point): Rect {
  return { x: value.x + delta.x, y: value.y + delta.y, width: value.width, height: value.height };
}

function axisValues(value: Rect): { x: Array<{ value: number; kind: 'edge' | 'center' }>; y: Array<{ value: number; kind: 'edge' | 'center' }> } {
  const center = rectCenter(value);
  return {
    x: [
      { value: value.x, kind: 'edge' },
      { value: center.x, kind: 'center' },
      { value: rectRight(value), kind: 'edge' },
    ],
    y: [
      { value: value.y, kind: 'edge' },
      { value: center.y, kind: 'center' },
      { value: rectBottom(value), kind: 'edge' },
    ],
  };
}

function bestCandidate(candidates: AxisCandidate[], tolerance: number): AxisCandidate | undefined {
  return candidates
    .filter((candidate) => Math.abs(candidate.correction) <= tolerance)
    .sort((a, b) => a.priority - b.priority || Math.abs(a.correction) - Math.abs(b.correction) || a.coordinate - b.coordinate)[0];
}

function guideFromCandidate(candidate: AxisCandidate): SnapGuide {
  const [sourceStart, sourceEnd] = candidate.sourceSpan;
  const [targetStart, targetEnd] = candidate.targetSpan;
  return {
    axis: candidate.axis,
    coordinate: candidate.coordinate,
    from: Math.min(sourceStart, sourceEnd, targetStart, targetEnd),
    to: Math.max(sourceStart, sourceEnd, targetStart, targetEnd),
    kind: candidate.kind,
    sourceId: candidate.sourceId,
    targetId: candidate.targetId,
    label: candidate.label,
  };
}

/**
 * Computes CAD-style grid, edge, centerline, and port alignment snapping for a
 * component group. The returned delta is absolute from the gesture start, so
 * it works with snapshot-based preview transactions and never accumulates
 * rounding drift.
 */
export function snapComponentDrag(
  geometries: Record<EntityId, ComponentGeometry>,
  movingComponentIds: readonly EntityId[],
  proposedDelta: Point,
  options: ComponentDragSnapOptions,
): ComponentDragSnapResult {
  const moving = new Set(movingComponentIds);
  const tolerance = screenToleranceToWorld(options.tolerancePx ?? 8, options.zoom);
  const xCandidates: AxisCandidate[] = [];
  const yCandidates: AxisCandidate[] = [];
  const stationary = Object.values(geometries).filter((geometry) => !moving.has(geometry.componentId));

  if (options.enableAlignment ?? true) {
    for (const sourceGeometry of Object.values(geometries).filter((geometry) => moving.has(geometry.componentId))) {
      const sourceRect = translatedRect(sourceGeometry.worldBounds, proposedDelta);
      const sourceValues = axisValues(sourceRect);
      for (const targetGeometry of stationary) {
        const targetRect = targetGeometry.worldBounds;
        const targetValues = axisValues(targetRect);
        for (const source of sourceValues.x) {
          for (const target of targetValues.x) {
            xCandidates.push({
              axis: 'x',
              correction: target.value - source.value,
              coordinate: target.value,
              kind: source.kind === 'center' && target.kind === 'center' ? 'center' : 'edge',
              sourceId: sourceGeometry.componentId,
              targetId: targetGeometry.componentId,
              sourceSpan: [sourceRect.y, rectBottom(sourceRect)],
              targetSpan: [targetRect.y, rectBottom(targetRect)],
              priority: source.kind === target.kind ? (source.kind === 'center' ? 20 : 30) : 45,
            });
          }
        }
        for (const source of sourceValues.y) {
          for (const target of targetValues.y) {
            yCandidates.push({
              axis: 'y',
              correction: target.value - source.value,
              coordinate: target.value,
              kind: source.kind === 'center' && target.kind === 'center' ? 'center' : 'edge',
              sourceId: sourceGeometry.componentId,
              targetId: targetGeometry.componentId,
              sourceSpan: [sourceRect.x, rectRight(sourceRect)],
              targetSpan: [targetRect.x, rectRight(targetRect)],
              priority: source.kind === target.kind ? (source.kind === 'center' ? 20 : 30) : 45,
            });
          }
        }
      }
    }
  }

  if (options.enablePortAlignment ?? true) {
    for (const sourceGeometry of Object.values(geometries).filter((geometry) => moving.has(geometry.componentId))) {
      for (const sourcePort of Object.values(sourceGeometry.ports)) {
        const moved = { x: sourcePort.center.x + proposedDelta.x, y: sourcePort.center.y + proposedDelta.y };
        for (const targetGeometry of stationary) {
          for (const targetPort of Object.values(targetGeometry.ports)) {
            xCandidates.push({
              axis: 'x',
              correction: targetPort.center.x - moved.x,
              coordinate: targetPort.center.x,
              kind: 'port',
              sourceId: sourcePort.portId,
              targetId: targetPort.portId,
              sourceSpan: [moved.y, targetPort.center.y],
              targetSpan: [targetPort.center.y, moved.y],
              priority: 0,
              label: `${sourcePort.portId} ↔ ${targetPort.portId}`,
            });
            yCandidates.push({
              axis: 'y',
              correction: targetPort.center.y - moved.y,
              coordinate: targetPort.center.y,
              kind: 'port',
              sourceId: sourcePort.portId,
              targetId: targetPort.portId,
              sourceSpan: [moved.x, targetPort.center.x],
              targetSpan: [targetPort.center.x, moved.x],
              priority: 0,
              label: `${sourcePort.portId} ↔ ${targetPort.portId}`,
            });
          }
        }
      }
    }
  }

  const primary = geometries[options.primaryComponentId ?? movingComponentIds[0] ?? ''];
  if ((options.enableGrid ?? true) && primary && (options.gridSpacing ?? 0) > 0) {
    const spacing = options.gridSpacing!;
    const proposedPosition = {
      x: primary.worldBody.x + proposedDelta.x,
      y: primary.worldBody.y + proposedDelta.y,
    };
    const snappedX = snap(proposedPosition.x, spacing);
    const snappedY = snap(proposedPosition.y, spacing);
    xCandidates.push({
      axis: 'x',
      correction: snappedX - proposedPosition.x,
      coordinate: snappedX,
      kind: 'grid',
      sourceId: primary.componentId,
      sourceSpan: [primary.worldBody.y + proposedDelta.y, rectBottom(primary.worldBody) + proposedDelta.y],
      targetSpan: [primary.worldBody.y + proposedDelta.y - 40, rectBottom(primary.worldBody) + proposedDelta.y + 40],
      priority: 60,
    });
    yCandidates.push({
      axis: 'y',
      correction: snappedY - proposedPosition.y,
      coordinate: snappedY,
      kind: 'grid',
      sourceId: primary.componentId,
      sourceSpan: [primary.worldBody.x + proposedDelta.x, rectRight(primary.worldBody) + proposedDelta.x],
      targetSpan: [primary.worldBody.x + proposedDelta.x - 40, rectRight(primary.worldBody) + proposedDelta.x + 40],
      priority: 60,
    });
  }

  const bestX = bestCandidate(xCandidates, tolerance);
  const bestY = bestCandidate(yCandidates, tolerance);
  const correction = { x: bestX?.correction ?? 0, y: bestY?.correction ?? 0 };
  return {
    delta: { x: proposedDelta.x + correction.x, y: proposedDelta.y + correction.y },
    correction,
    guides: [bestX, bestY].filter((candidate): candidate is AxisCandidate => Boolean(candidate)).map(guideFromCandidate),
    snappedX: Boolean(bestX),
    snappedY: Boolean(bestY),
  };
}
