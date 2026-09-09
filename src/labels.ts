import {
  add,
  clamp,
  inflateRect,
  intersectionArea,
  pointAtPolylineFraction,
  polylineIntersectsRect,
  rect,
  rectBottom,
  rectCenter,
  rectRight,
  rectsIntersect,
  unionRects,
} from './geometry.js';
import { DEFAULT_TEXT_STYLE } from './component.js';
import type {
  ComponentGeometry,
  ComponentLabelCandidate,
  EntityId,
  LabelNode,
  LabelPlacement,
  Point,
  Rect,
  RouteResult,
  TextMeasurer,
  TextStyle,
} from './types.js';

export interface LabelPlacementContext {
  components: Record<EntityId, ComponentGeometry>;
  routes: Record<EntityId, RouteResult>;
  componentObstacles?: Array<{ id: EntityId; rect: Rect }>;
  fixedObstacles?: Array<{ id: EntityId; rect: Rect; weight?: number }>;
  previousPlacements?: Record<EntityId, LabelPlacement>;
  worldBounds?: Rect;
  labelGap: number;
  wireClearance?: number;
}

interface Candidate {
  key: string;
  position: Point;
  bounds: Rect;
  anchorPoint: Point;
  rotation: number;
  componentCandidate?: ComponentLabelCandidate;
  leader?: { start: Point; end: Point };
  intrinsicPenalty: number;
}

function readableAngle(tangent: Point): number {
  let angle = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;
  return angle;
}

function resolveTextStyle(label: LabelNode): TextStyle {
  return { ...DEFAULT_TEXT_STYLE, ...label.style };
}

function labelSize(label: LabelNode, measurer: TextMeasurer): { width: number; height: number } {
  const style = resolveTextStyle(label);
  const primary = measurer.measure(label.text, style);
  const secondary = label.secondaryText ? measurer.measure(label.secondaryText, { ...style, fontSize: style.fontSize * 0.9 }) : undefined;
  return {
    width: Math.max(primary.width, secondary?.width ?? 0) + style.paddingX * 2,
    height: primary.height + (secondary?.height ?? 0) + style.paddingY * 2,
  };
}

function boundsAtCenter(center: Point, size: { width: number; height: number }): Rect {
  return rect(center.x - size.width / 2, center.y - size.height / 2, size.width, size.height);
}

function componentCandidateCenter(
  bounds: Rect,
  size: { width: number; height: number },
  candidate: ComponentLabelCandidate,
  gap: number,
): Point {
  const center = rectCenter(bounds);
  switch (candidate) {
    case 'north':
      return { x: center.x, y: bounds.y - gap - size.height / 2 };
    case 'north-east':
      return { x: rectRight(bounds) + gap + size.width / 2, y: bounds.y - gap - size.height / 2 };
    case 'east':
      return { x: rectRight(bounds) + gap + size.width / 2, y: center.y };
    case 'south-east':
      return { x: rectRight(bounds) + gap + size.width / 2, y: rectBottom(bounds) + gap + size.height / 2 };
    case 'south':
      return { x: center.x, y: rectBottom(bounds) + gap + size.height / 2 };
    case 'south-west':
      return { x: bounds.x - gap - size.width / 2, y: rectBottom(bounds) + gap + size.height / 2 };
    case 'west':
      return { x: bounds.x - gap - size.width / 2, y: center.y };
    case 'north-west':
      return { x: bounds.x - gap - size.width / 2, y: bounds.y - gap - size.height / 2 };
    case 'inside-header':
      return { x: center.x, y: bounds.y + Math.min(bounds.height, size.height + gap) / 2 };
    case 'inside-body':
      return center;
  }
}

function componentCandidates(label: LabelNode, geometry: ComponentGeometry, size: { width: number; height: number }, gap: number): Candidate[] {
  const order: ComponentLabelCandidate[] = label.anchor.preferredCandidates?.length
    ? label.anchor.preferredCandidates
    : ['north', 'east', 'south', 'west', 'north-east', 'south-east', 'south-west', 'north-west', 'inside-header'];
  const ownerCenter = rectCenter(geometry.worldBounds);
  return order.map((candidate, index) => {
    const position = componentCandidateCenter(geometry.worldBounds, size, candidate, gap);
    const bounds = boundsAtCenter(position, size);
    const outside = !candidate.startsWith('inside');
    const nearest = outside
      ? {
          x: clamp(position.x, geometry.worldBounds.x, rectRight(geometry.worldBounds)),
          y: clamp(position.y, geometry.worldBounds.y, rectBottom(geometry.worldBounds)),
        }
      : ownerCenter;
    return {
      key: `component:${candidate}`,
      position,
      bounds,
      anchorPoint: ownerCenter,
      rotation: 0,
      componentCandidate: candidate,
      leader: outside && label.allowLeader ? { start: nearest, end: position } : undefined,
      intrinsicPenalty: index * 4 + (candidate.startsWith('inside') ? 20 : 0),
    };
  });
}

function wireCandidates(label: LabelNode, route: RouteResult, size: { width: number; height: number }, gap: number): Candidate[] {
  const preferredFraction = clamp(label.anchor.wireFraction ?? 0.5, 0, 1);
  const fractions = [preferredFraction, 0.35, 0.65, 0.2, 0.8];
  const uniqueFractions = [...new Set(fractions.map((value) => Number(value.toFixed(3))))];
  const candidates: Candidate[] = [];
  for (const [fractionIndex, fraction] of uniqueFractions.entries()) {
    const resolved = pointAtPolylineFraction(route.points, fraction);
    const normal = { x: -resolved.tangent.y, y: resolved.tangent.x };
    const rotation = label.orientation === 'follow-segment' ? readableAngle(resolved.tangent) : label.orientation === 'vertical' ? 90 : 0;
    for (const [sideIndex, sign] of [1, -1].entries()) {
      const distance = gap + (Math.abs(normal.y) > Math.abs(normal.x) ? size.height / 2 : size.width / 2);
      const position = add(resolved.point, { x: normal.x * distance * sign, y: normal.y * distance * sign });
      candidates.push({
        key: `wire:${fraction}:${sign}`,
        position,
        bounds: boundsAtCenter(position, size),
        anchorPoint: resolved.point,
        rotation,
        leader: label.allowLeader ? { start: resolved.point, end: position } : undefined,
        intrinsicPenalty: fractionIndex * 5 + sideIndex * 2,
      });
    }
  }
  return candidates;
}

function pointCandidates(label: LabelNode, point: Point, size: { width: number; height: number }, gap: number): Candidate[] {
  const centers = [
    { key: 'point:north', center: { x: point.x, y: point.y - gap - size.height / 2 } },
    { key: 'point:east', center: { x: point.x + gap + size.width / 2, y: point.y } },
    { key: 'point:south', center: { x: point.x, y: point.y + gap + size.height / 2 } },
    { key: 'point:west', center: { x: point.x - gap - size.width / 2, y: point.y } },
  ];
  return centers.map((entry, index) => ({
    key: entry.key,
    position: entry.center,
    bounds: boundsAtCenter(entry.center, size),
    anchorPoint: point,
    rotation: label.orientation === 'vertical' ? 90 : 0,
    leader: label.allowLeader ? { start: point, end: entry.center } : undefined,
    intrinsicPenalty: index * 3,
  }));
}

function manualCandidate(label: LabelNode, anchorPoint: Point, size: { width: number; height: number }): Candidate {
  const position = label.mode === 'world-pinned' && label.worldPosition
    ? { ...label.worldPosition }
    : add(anchorPoint, label.offset);
  return {
    key: label.mode,
    position,
    bounds: boundsAtCenter(position, size),
    anchorPoint,
    rotation: label.orientation === 'vertical' ? 90 : 0,
    leader: label.allowLeader ? { start: anchorPoint, end: position } : undefined,
    intrinsicPenalty: 0,
  };
}

function resolveAnchor(label: LabelNode, context: LabelPlacementContext): { point: Point; candidatesOwner?: ComponentGeometry; route?: RouteResult } | undefined {
  switch (label.anchor.ownerKind) {
    case 'component': {
      const geometry = label.anchor.ownerId ? context.components[label.anchor.ownerId] : undefined;
      return geometry ? { point: rectCenter(geometry.worldBounds), candidatesOwner: geometry } : undefined;
    }
    case 'port': {
      const geometry = label.anchor.ownerId ? context.components[label.anchor.ownerId] : undefined;
      const port = geometry && label.anchor.portId ? geometry.ports[label.anchor.portId] : undefined;
      return port ? { point: port.center } : undefined;
    }
    case 'wire': {
      const route = label.anchor.ownerId ? context.routes[label.anchor.ownerId] : undefined;
      if (!route || route.points.length === 0) return undefined;
      return { point: pointAtPolylineFraction(route.points, label.anchor.wireFraction ?? 0.5).point, route };
    }
    case 'free':
    case 'group':
      return label.anchor.point ? { point: label.anchor.point } : undefined;
  }
}

function candidateScore(
  candidate: Candidate,
  label: LabelNode,
  context: LabelPlacementContext,
  placed: Record<EntityId, LabelPlacement>,
): { score: number; collisions: EntityId[] } {
  let score = candidate.intrinsicPenalty;
  const collisions: EntityId[] = [];
  if (label.avoidComponents) {
    for (const obstacle of context.componentObstacles ?? Object.values(context.components).map((geometry) => ({ id: geometry.componentId, rect: geometry.worldBounds }))) {
      const area = intersectionArea(candidate.bounds, obstacle.rect);
      if (area > 0) {
        collisions.push(obstacle.id);
        score += 1000 + area * 4;
      }
    }
  }
  for (const obstacle of context.fixedObstacles ?? []) {
    const area = intersectionArea(candidate.bounds, obstacle.rect);
    if (area > 0) {
      collisions.push(obstacle.id);
      score += (obstacle.weight ?? 700) + area * 3;
    }
  }
  for (const other of Object.values(placed)) {
    const area = intersectionArea(candidate.bounds, other.bounds);
    if (area > 0) {
      collisions.push(other.labelId);
      score += 800 + area * 5;
    }
  }
  if (label.avoidWires) {
    for (const [wireId, route] of Object.entries(context.routes)) {
      if (polylineIntersectsRect(route.points, inflateRect(candidate.bounds, context.wireClearance ?? 2))) {
        collisions.push(wireId);
        score += 350;
      }
    }
  }
  if (context.worldBounds) {
    const outside = !rectsIntersect(context.worldBounds, candidate.bounds) ||
      candidate.bounds.x < context.worldBounds.x || candidate.bounds.y < context.worldBounds.y ||
      rectRight(candidate.bounds) > rectRight(context.worldBounds) || rectBottom(candidate.bounds) > rectBottom(context.worldBounds);
    if (outside) score += 1200;
  }
  const previous = context.previousPlacements?.[label.id];
  if (previous) {
    const deltaX = previous.position.x - candidate.position.x;
    const deltaY = previous.position.y - candidate.position.y;
    score += Math.hypot(deltaX, deltaY) * 0.08;
    if (previous.candidate === candidate.componentCandidate) score -= 18;
  }
  return { score, collisions: [...new Set(collisions)] };
}

export function placeLabel(
  label: LabelNode,
  measurer: TextMeasurer,
  context: LabelPlacementContext,
  alreadyPlaced: Record<EntityId, LabelPlacement> = {},
): LabelPlacement {
  const anchor = resolveAnchor(label, context);
  if (!anchor) {
    return {
      labelId: label.id,
      position: label.worldPosition ?? { x: 0, y: 0 },
      bounds: rect(0, 0, 0, 0),
      anchorPoint: { x: 0, y: 0 },
      rotation: 0,
      score: Number.POSITIVE_INFINITY,
      collisions: [],
      status: 'invalid-anchor',
    };
  }
  const size = labelSize(label, measurer);
  let candidates: Candidate[];
  if (label.mode !== 'auto') {
    candidates = [manualCandidate(label, anchor.point, size)];
  } else if (anchor.candidatesOwner) {
    candidates = componentCandidates(label, anchor.candidatesOwner, size, context.labelGap);
  } else if (anchor.route) {
    candidates = wireCandidates(label, anchor.route, size, context.labelGap);
  } else {
    candidates = pointCandidates(label, anchor.point, size, context.labelGap);
  }

  const scored = candidates
    .map((candidate) => ({ candidate, ...candidateScore(candidate, label, context, alreadyPlaced) }))
    .sort((a, b) => a.score - b.score || a.candidate.key.localeCompare(b.candidate.key));
  const best = scored[0]!;
  return {
    labelId: label.id,
    position: best.candidate.position,
    bounds: best.candidate.bounds,
    anchorPoint: best.candidate.anchorPoint,
    rotation: best.candidate.rotation,
    leader: best.candidate.leader,
    candidate: best.candidate.componentCandidate,
    score: best.score,
    collisions: best.collisions,
    status: best.collisions.length > 0 ? 'overlap' : 'placed',
  };
}

export function placeLabels(
  labels: LabelNode[],
  measurer: TextMeasurer,
  context: LabelPlacementContext,
): Record<EntityId, LabelPlacement> {
  const placed: Record<EntityId, LabelPlacement> = {};
  const ordered = labels
    .filter((label) => label.visible)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const label of ordered) placed[label.id] = placeLabel(label, measurer, context, placed);
  return placed;
}

export function labelPlacementBounds(placements: Record<EntityId, LabelPlacement>): Rect {
  return unionRects(Object.values(placements).map((placement) => placement.bounds));
}

/**
 * Converts a label to an explicit world-space placement. This operation is
 * intentionally data-only so a host can use it during a drag preview without
 * coupling the label subsystem to a UI framework.
 */
export function pinLabelToWorld(label: LabelNode, worldPosition: Point): LabelNode {
  return {
    ...label,
    mode: 'world-pinned',
    worldPosition: { ...worldPosition },
  };
}

/** Restores automatic candidate placement while preserving label content. */
export function resetLabelToAutomatic(label: LabelNode): LabelNode {
  const reset = {
    ...label,
    mode: 'auto' as const,
    offset: { x: 0, y: 0 },
  };
  delete reset.worldPosition;
  return reset;
}
