import {
  EPSILON,
  add,
  clamp,
  countPolylineCrossings,
  distance,
  inflateRect,
  lineSegmentsCross,
  manhattanDistance,
  normalize,
  orthogonalizePolyline,
  pointsEqual,
  polylineIntersectsRect,
  polylineLength,
  rectBottom,
  rectContainsPoint,
  rectRight,
  routeSegments,
  roundedOrthogonalPath,
  segmentAxis,
  segmentIntersectsRect,
  sideNormal,
  simplifyPolyline,
  snap,
  subtract,
} from './geometry.js';
import type {
  ComponentGeometry,
  EntityId,
  Point,
  Rect,
  RouteConstraint,
  RouteCrossing,
  RoutePattern,
  RouteResult,
  RoutingOptions,
  Side,
  WireEdge,
  WireEndpoint,
} from './types.js';

export interface RoutingObstacle {
  id: EntityId;
  rect: Rect;
  kind?: 'component' | 'label' | 'keepout' | 'group';
  soft?: boolean;
}

export interface ResolvedEndpoint {
  point: Point;
  normal: Point;
  side?: Side;
  componentId?: EntityId;
  portId?: EntityId;
}

export interface RoutingContext {
  componentGeometries: Record<EntityId, ComponentGeometry>;
  obstacles: RoutingObstacle[];
  existingRoutes?: Array<{ wireId: EntityId; points: Point[]; zIndex?: number }>;
  revision?: number;
}

export const DEFAULT_ROUTING_OPTIONS: RoutingOptions = {
  pattern: 'orthogonal',
  clearance: 12,
  grid: 8,
  leadIn: 20,
  requestedRadius: 8,
  minimumSegment: 6,
  bendPenalty: 32,
  crossingPenalty: 100,
  proximityPenalty: 4,
  reversePenalty: 18,
  previousRouteStability: 3,
  maxSearchNodes: 20_000,
  allowCrossings: true,
  preferSharedChannels: false,
  constraints: [],
};

export function resolveEndpoint(
  endpoint: WireEndpoint,
  componentGeometries: Record<EntityId, ComponentGeometry>,
): ResolvedEndpoint | undefined {
  if (endpoint.kind === 'port') {
    const component = componentGeometries[endpoint.componentId];
    const port = component?.ports[endpoint.portId];
    if (!port) return undefined;
    return {
      point: { ...port.center },
      normal: normalize(port.normal),
      side: port.side,
      componentId: endpoint.componentId,
      portId: endpoint.portId,
    };
  }
  if (endpoint.kind === 'free' || endpoint.kind === 'off-page') {
    return {
      point: { ...endpoint.point },
      normal: endpoint.direction ? sideNormal(endpoint.direction) : { x: 0, y: 0 },
      side: endpoint.direction,
    };
  }
  return { point: { ...endpoint.point }, normal: { x: 0, y: 0 } };
}

function endpointLead(endpoint: ResolvedEndpoint, options: RoutingOptions): Point {
  const normalLength = Math.hypot(endpoint.normal.x, endpoint.normal.y);
  if (normalLength <= EPSILON) return { ...endpoint.point };
  const leadDistance = Math.max(options.leadIn, options.clearance + options.minimumSegment);
  return add(endpoint.point, { x: endpoint.normal.x * leadDistance, y: endpoint.normal.y * leadDistance });
}

function routeDirect(start: Point, end: Point): Point[] {
  return pointsEqual(start, end) ? [{ ...start }] : [{ ...start }, { ...end }];
}

function routeHorizontalFirst(start: Point, end: Point): Point[] {
  if (pointsEqual(start, end)) return [{ ...start }];
  if (Math.abs(start.x - end.x) <= EPSILON || Math.abs(start.y - end.y) <= EPSILON) return [start, end].map((value) => ({ ...value }));
  return simplifyPolyline([{ ...start }, { x: end.x, y: start.y }, { ...end }]);
}

function routeVerticalFirst(start: Point, end: Point): Point[] {
  if (pointsEqual(start, end)) return [{ ...start }];
  if (Math.abs(start.x - end.x) <= EPSILON || Math.abs(start.y - end.y) <= EPSILON) return [start, end].map((value) => ({ ...value }));
  return simplifyPolyline([{ ...start }, { x: start.x, y: end.y }, { ...end }]);
}

function routeDogleg(start: Point, end: Point, axis: 'horizontal' | 'vertical', coordinate?: number): Point[] {
  if (axis === 'horizontal') {
    const y = coordinate ?? (start.y + end.y) / 2;
    return simplifyPolyline([{ ...start }, { x: start.x, y }, { x: end.x, y }, { ...end }]);
  }
  const x = coordinate ?? (start.x + end.x) / 2;
  return simplifyPolyline([{ ...start }, { x, y: start.y }, { x, y: end.y }, { ...end }]);
}

function routeTrunk(start: Point, end: Point, axis: 'horizontal' | 'vertical', coordinate?: number): Point[] {
  return routeDogleg(start, end, axis, coordinate);
}

function uniqueSorted(values: number[], grid: number): number[] {
  const snapped = values.map((value) => (grid > EPSILON ? snap(value, grid) : value)).sort((a, b) => a - b);
  const result: number[] = [];
  for (const value of snapped) {
    if (result.length === 0 || Math.abs(value - result[result.length - 1]!) > EPSILON) result.push(value);
  }
  return result;
}

function pointKey(point: Point): string {
  return `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
}

function routeSegmentBlocked(start: Point, end: Point, obstacles: RoutingObstacle[]): boolean {
  return obstacles.some((obstacle) => !obstacle.soft && segmentIntersectsRect(start, end, obstacle.rect, true));
}

function pointBlocked(candidate: Point, obstacles: RoutingObstacle[]): boolean {
  return obstacles.some((obstacle) => !obstacle.soft && rectContainsPoint(obstacle.rect, candidate, false));
}

function proximityCost(start: Point, end: Point, obstacles: RoutingObstacle[], weight: number): number {
  if (weight <= 0) return 0;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  let cost = 0;
  for (const obstacle of obstacles) {
    const dx = Math.max(obstacle.rect.x - midpoint.x, 0, midpoint.x - rectRight(obstacle.rect));
    const dy = Math.max(obstacle.rect.y - midpoint.y, 0, midpoint.y - rectBottom(obstacle.rect));
    const d = Math.hypot(dx, dy);
    if (d < 32) cost += weight * (32 - d) / 32;
  }
  return cost;
}

function crossingCost(
  start: Point,
  end: Point,
  existingRoutes: RoutingContext['existingRoutes'],
  crossingPenalty: number,
): number {
  if (!existingRoutes || crossingPenalty <= 0) return 0;
  let count = 0;
  for (const route of existingRoutes) {
    for (let index = 0; index < route.points.length - 1; index += 1) {
      if (lineSegmentsCross(start, end, route.points[index]!, route.points[index + 1]!)) count += 1;
    }
  }
  return count * crossingPenalty;
}

interface SearchNode {
  point: Point;
  row: number;
  column: number;
}

type Direction = 'none' | 'horizontal' | 'vertical';

interface QueueEntry {
  stateKey: string;
  nodeIndex: number;
  direction: Direction;
  priority: number;
}

class MinQueue {
  private readonly heap: QueueEntry[] = [];

  public get size(): number {
    return this.heap.length;
  }

  public push(value: QueueEntry): void {
    this.heap.push(value);
    let index = this.heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.heap[parent]!.priority <= value.priority) break;
      this.heap[index] = this.heap[parent]!;
      index = parent;
    }
    this.heap[index] = value;
  }

  public pop(): QueueEntry | undefined {
    if (this.heap.length === 0) return undefined;
    const first = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.heap.length) break;
      let child = left;
      if (right < this.heap.length && this.heap[right]!.priority < this.heap[left]!.priority) child = right;
      if (this.heap[child]!.priority >= last.priority) break;
      this.heap[index] = this.heap[child]!;
      index = child;
    }
    this.heap[index] = last;
    return first;
  }
}

function createVisibilityGrid(
  start: Point,
  end: Point,
  obstacles: RoutingObstacle[],
  options: RoutingOptions,
  forcedCoordinates: Point[] = [],
): { nodes: SearchNode[]; rowMap: Map<number, number[]>; columnMap: Map<number, number[]>; startIndex: number; endIndex: number } {
  const grid = Math.max(options.grid, 1);
  const hardObstacles = obstacles.filter((obstacle) => !obstacle.soft);
  const xs = [start.x, end.x, ...forcedCoordinates.map((value) => value.x)];
  const ys = [start.y, end.y, ...forcedCoordinates.map((value) => value.y)];
  for (const obstacle of hardObstacles) {
    xs.push(obstacle.rect.x - grid, obstacle.rect.x, rectRight(obstacle.rect), rectRight(obstacle.rect) + grid);
    ys.push(obstacle.rect.y - grid, obstacle.rect.y, rectBottom(obstacle.rect), rectBottom(obstacle.rect) + grid);
  }
  const allPoints = [start, end, ...forcedCoordinates];
  const minX = Math.min(...allPoints.map((value) => value.x), ...hardObstacles.map((value) => value.rect.x));
  const maxX = Math.max(...allPoints.map((value) => value.x), ...hardObstacles.map((value) => rectRight(value.rect)));
  const minY = Math.min(...allPoints.map((value) => value.y), ...hardObstacles.map((value) => value.rect.y));
  const maxY = Math.max(...allPoints.map((value) => value.y), ...hardObstacles.map((value) => rectBottom(value.rect)));
  xs.push(minX - grid * 2, maxX + grid * 2);
  ys.push(minY - grid * 2, maxY + grid * 2);

  const xValues = uniqueSorted(xs, 0);
  const yValues = uniqueSorted(ys, 0);
  const nodes: SearchNode[] = [];
  const indexByPoint = new Map<string, number>();
  const rowMap = new Map<number, number[]>();
  const columnMap = new Map<number, number[]>();

  for (let row = 0; row < yValues.length; row += 1) {
    const y = yValues[row]!;
    for (let column = 0; column < xValues.length; column += 1) {
      const x = xValues[column]!;
      const candidate = { x, y };
      if (pointBlocked(candidate, hardObstacles) && !pointsEqual(candidate, start) && !pointsEqual(candidate, end)) continue;
      const nodeIndex = nodes.length;
      nodes.push({ point: candidate, row, column });
      indexByPoint.set(pointKey(candidate), nodeIndex);
      const rowNodes = rowMap.get(row) ?? [];
      rowNodes.push(nodeIndex);
      rowMap.set(row, rowNodes);
      const columnNodes = columnMap.get(column) ?? [];
      columnNodes.push(nodeIndex);
      columnMap.set(column, columnNodes);
    }
  }
  for (const indices of rowMap.values()) indices.sort((a, b) => nodes[a]!.point.x - nodes[b]!.point.x);
  for (const indices of columnMap.values()) indices.sort((a, b) => nodes[a]!.point.y - nodes[b]!.point.y);

  const ensureNode = (candidate: Point): number => {
    const existing = indexByPoint.get(pointKey(candidate));
    if (existing !== undefined) return existing;
    const row = yValues.indexOf(candidate.y);
    const column = xValues.indexOf(candidate.x);
    const nodeIndex = nodes.length;
    nodes.push({ point: { ...candidate }, row, column });
    const rowNodes = rowMap.get(row) ?? [];
    rowNodes.push(nodeIndex);
    rowNodes.sort((a, b) => nodes[a]!.point.x - nodes[b]!.point.x);
    rowMap.set(row, rowNodes);
    const columnNodes = columnMap.get(column) ?? [];
    columnNodes.push(nodeIndex);
    columnNodes.sort((a, b) => nodes[a]!.point.y - nodes[b]!.point.y);
    columnMap.set(column, columnNodes);
    indexByPoint.set(pointKey(candidate), nodeIndex);
    return nodeIndex;
  };

  return {
    nodes,
    rowMap,
    columnMap,
    startIndex: ensureNode(start),
    endIndex: ensureNode(end),
  };
}

function neighboringNodes(
  nodeIndex: number,
  grid: ReturnType<typeof createVisibilityGrid>,
  obstacles: RoutingObstacle[],
): Array<{ nodeIndex: number; direction: Exclude<Direction, 'none'> }> {
  const node = grid.nodes[nodeIndex]!;
  const neighbors: Array<{ nodeIndex: number; direction: Exclude<Direction, 'none'> }> = [];
  const rowNodes = grid.rowMap.get(node.row) ?? [];
  const rowPosition = rowNodes.indexOf(nodeIndex);
  for (const adjacentPosition of [rowPosition - 1, rowPosition + 1]) {
    const adjacent = rowNodes[adjacentPosition];
    if (adjacent === undefined) continue;
    if (!routeSegmentBlocked(node.point, grid.nodes[adjacent]!.point, obstacles)) neighbors.push({ nodeIndex: adjacent, direction: 'horizontal' });
  }
  const columnNodes = grid.columnMap.get(node.column) ?? [];
  const columnPosition = columnNodes.indexOf(nodeIndex);
  for (const adjacentPosition of [columnPosition - 1, columnPosition + 1]) {
    const adjacent = columnNodes[adjacentPosition];
    if (adjacent === undefined) continue;
    if (!routeSegmentBlocked(node.point, grid.nodes[adjacent]!.point, obstacles)) neighbors.push({ nodeIndex: adjacent, direction: 'vertical' });
  }
  return neighbors;
}

function reconstructPath(
  stateKey: string,
  parent: Map<string, string | undefined>,
  stateNode: Map<string, number>,
  nodes: SearchNode[],
): Point[] {
  const reversed: Point[] = [];
  let current: string | undefined = stateKey;
  while (current) {
    const nodeIndex = stateNode.get(current);
    if (nodeIndex !== undefined) reversed.push({ ...nodes[nodeIndex]!.point });
    current = parent.get(current);
  }
  return simplifyPolyline(reversed.reverse());
}

function stateKey(nodeIndex: number, direction: Direction): string {
  return `${nodeIndex}|${direction}`;
}

function routeOrthogonalVisibility(
  start: Point,
  end: Point,
  obstacles: RoutingObstacle[],
  options: RoutingOptions,
  context: RoutingContext,
): Point[] | undefined {
  if (pointsEqual(start, end)) return [{ ...start }];
  if (segmentAxis(start, end) !== 'diagonal' && !routeSegmentBlocked(start, end, obstacles)) return [{ ...start }, { ...end }];
  const grid = createVisibilityGrid(start, end, obstacles, options);
  const queue = new MinQueue();
  const best = new Map<string, number>();
  const parent = new Map<string, string | undefined>();
  const stateNode = new Map<string, number>();
  const startKey = stateKey(grid.startIndex, 'none');
  best.set(startKey, 0);
  parent.set(startKey, undefined);
  stateNode.set(startKey, grid.startIndex);
  queue.push({ stateKey: startKey, nodeIndex: grid.startIndex, direction: 'none', priority: manhattanDistance(start, end) });
  let expanded = 0;

  while (queue.size > 0 && expanded < options.maxSearchNodes) {
    const current = queue.pop()!;
    const currentCost = best.get(current.stateKey);
    if (currentCost === undefined) continue;
    if (current.nodeIndex === grid.endIndex) return reconstructPath(current.stateKey, parent, stateNode, grid.nodes);
    expanded += 1;
    for (const neighbor of neighboringNodes(current.nodeIndex, grid, obstacles)) {
      const from = grid.nodes[current.nodeIndex]!.point;
      const to = grid.nodes[neighbor.nodeIndex]!.point;
      const lengthCost = distance(from, to);
      const bendCost = current.direction !== 'none' && current.direction !== neighbor.direction ? options.bendPenalty : 0;
      const crossCost = crossingCost(from, to, context.existingRoutes, options.crossingPenalty);
      if (!options.allowCrossings && crossCost > 0) continue;
      const nearCost = proximityCost(from, to, obstacles, options.proximityPenalty);
      const nextCost = currentCost + lengthCost + bendCost + crossCost + nearCost;
      const nextKey = stateKey(neighbor.nodeIndex, neighbor.direction);
      if (nextCost + EPSILON >= (best.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(nextKey, nextCost);
      parent.set(nextKey, current.stateKey);
      stateNode.set(nextKey, neighbor.nodeIndex);
      queue.push({
        stateKey: nextKey,
        nodeIndex: neighbor.nodeIndex,
        direction: neighbor.direction,
        priority: nextCost + manhattanDistance(to, end),
      });
    }
  }
  return undefined;
}

function hardWaypointConstraints(constraints: RouteConstraint[]): Point[] {
  return constraints
    .filter((constraint) => (constraint.kind === 'waypoint' || constraint.kind === 'locked-waypoint') && constraint.point && constraint.strength !== 'soft')
    .map((constraint) => ({ ...constraint.point! }));
}

function softAvoidObstacles(constraints: RouteConstraint[]): RoutingObstacle[] {
  return constraints
    .filter((constraint) => constraint.kind === 'avoid-rect' && constraint.rect)
    .map((constraint) => ({ id: constraint.id, rect: { ...constraint.rect! }, kind: 'keepout', soft: constraint.strength === 'soft' }));
}

function routePatternSegment(
  pattern: RoutePattern,
  start: Point,
  end: Point,
  obstacles: RoutingObstacle[],
  options: RoutingOptions,
  context: RoutingContext,
): { points: Point[]; fallback: boolean; diagnostic?: string } {
  if (pattern === 'direct') return { points: routeDirect(start, end), fallback: false };
  if (pattern === 'horizontal-first') return { points: routeHorizontalFirst(start, end), fallback: false };
  if (pattern === 'vertical-first') return { points: routeVerticalFirst(start, end), fallback: false };
  if (pattern === 'dogleg-horizontal') return { points: routeDogleg(start, end, 'horizontal', options.doglegCoordinate), fallback: false };
  if (pattern === 'dogleg-vertical') return { points: routeDogleg(start, end, 'vertical', options.doglegCoordinate), fallback: false };
  if (pattern === 'trunk-horizontal') return { points: routeTrunk(start, end, 'horizontal', options.trunkCoordinate), fallback: false };
  if (pattern === 'trunk-vertical') return { points: routeTrunk(start, end, 'vertical', options.trunkCoordinate), fallback: false };
  if (pattern === 'manual') return { points: routeHorizontalFirst(start, end), fallback: false };
  const routed = routeOrthogonalVisibility(start, end, obstacles, options, context);
  if (routed) return { points: routed, fallback: false };
  const h = routeHorizontalFirst(start, end);
  const v = routeVerticalFirst(start, end);
  const hViolations = obstacles.filter((obstacle) => polylineIntersectsRect(h, obstacle.rect)).length;
  const vViolations = obstacles.filter((obstacle) => polylineIntersectsRect(v, obstacle.rect)).length;
  return {
    points: hViolations <= vViolations ? h : v,
    fallback: true,
    diagnostic: 'Obstacle router exhausted its search budget; a deterministic fallback path was used.',
  };
}

function appendPath(target: Point[], addition: Point[]): void {
  if (addition.length === 0) return;
  if (target.length === 0) {
    target.push(...addition.map((value) => ({ ...value })));
    return;
  }
  const startIndex = pointsEqual(target[target.length - 1]!, addition[0]!) ? 1 : 0;
  for (let index = startIndex; index < addition.length; index += 1) target.push({ ...addition[index]! });
}

function routeThroughWaypoints(
  start: Point,
  end: Point,
  waypoints: Point[],
  pattern: RoutePattern,
  obstacles: RoutingObstacle[],
  options: RoutingOptions,
  context: RoutingContext,
): { points: Point[]; fallback: boolean; diagnostics: string[] } {
  const stages = [start, ...waypoints, end];
  const points: Point[] = [];
  let fallback = false;
  const diagnostics: string[] = [];
  for (let index = 0; index < stages.length - 1; index += 1) {
    const result = routePatternSegment(pattern === 'manual' ? 'orthogonal' : pattern, stages[index]!, stages[index + 1]!, obstacles, options, context);
    appendPath(points, result.points);
    fallback ||= result.fallback;
    if (result.diagnostic) diagnostics.push(result.diagnostic);
  }
  return { points: simplifyPolyline(points), fallback, diagnostics };
}

export function routeWire(wire: WireEdge, context: RoutingContext): RouteResult {
  const options: RoutingOptions = { ...DEFAULT_ROUTING_OPTIONS, ...wire.routing, constraints: [...(wire.routing.constraints ?? [])] };
  const source = resolveEndpoint(wire.source, context.componentGeometries);
  const target = resolveEndpoint(wire.target, context.componentGeometries);
  if (!source || !target) {
    return {
      points: [],
      segments: [],
      cornerRadii: [],
      length: 0,
      bends: 0,
      crossings: 0,
      obstacleViolations: [],
      status: 'invalid',
      diagnostics: ['A wire endpoint references a missing component or port.'],
      generatedAtRevision: context.revision,
    };
  }

  const sourceLead = endpointLead(source, options);
  const targetLead = endpointLead(target, options);
  const constraintObstacles = softAvoidObstacles(options.constraints);
  const obstacles = [...context.obstacles, ...constraintObstacles].map((obstacle) => ({
    ...obstacle,
    rect: inflateRect(obstacle.rect, obstacle.kind === 'keepout' ? 0 : options.clearance),
  }));
  const waypoints = hardWaypointConstraints(options.constraints);
  let core: Point[];
  let fallback = false;
  const diagnostics: string[] = [];

  if (options.pattern === 'manual' && waypoints.length > 0) {
    core = orthogonalizePolyline([sourceLead, ...waypoints, targetLead], true);
  } else {
    const routed = routeThroughWaypoints(sourceLead, targetLead, waypoints, options.pattern, obstacles, options, context);
    core = routed.points;
    fallback = routed.fallback;
    diagnostics.push(...routed.diagnostics);
  }

  const points: Point[] = [{ ...source.point }];
  if (!pointsEqual(source.point, sourceLead)) points.push(sourceLead);
  appendPath(points, core);
  if (!pointsEqual(targetLead, target.point)) points.push({ ...target.point });
  const simplified = simplifyPolyline(points);
  const obstacleViolations = context.obstacles
    .filter((obstacle) => {
      const isEndpointComponent = obstacle.id === source.componentId || obstacle.id === target.componentId;
      const pathToCheck = isEndpointComponent ? simplified.slice(1, -1) : simplified;
      return pathToCheck.length >= 2 && polylineIntersectsRect(pathToCheck, inflateRect(obstacle.rect, options.clearance));
    })
    .map((obstacle) => obstacle.id);
  const existingCrossings = (context.existingRoutes ?? []).reduce(
    (total, route) => total + countPolylineCrossings(simplified, route.points),
    0,
  );
  const rounded = roundedOrthogonalPath(simplified, options.requestedRadius, obstacles.filter((value) => !value.soft).map((value) => value.rect));
  void rounded.path;
  if (obstacleViolations.length > 0) diagnostics.push(`Route intersects ${obstacleViolations.length} obstacle keep-out region(s).`);
  const status: RouteResult['status'] = obstacleViolations.length > 0 ? 'invalid' : fallback ? 'fallback' : 'valid';
  return {
    points: simplified,
    segments: routeSegments(simplified),
    cornerRadii: rounded.radii,
    length: polylineLength(simplified),
    bends: Math.max(0, simplified.length - 2),
    crossings: existingCrossings,
    obstacleViolations,
    status,
    diagnostics,
    generatedAtRevision: context.revision,
  };
}

export function findWireCrossings(wires: WireEdge[]): RouteCrossing[] {
  const crossings: RouteCrossing[] = [];
  const visible = wires.filter((wire) => wire.route && !wire.hidden);
  for (let aIndex = 0; aIndex < visible.length; aIndex += 1) {
    const a = visible[aIndex]!;
    for (let bIndex = aIndex + 1; bIndex < visible.length; bIndex += 1) {
      const b = visible[bIndex]!;
      for (let ai = 0; ai < a.route!.points.length - 1; ai += 1) {
        for (let bi = 0; bi < b.route!.points.length - 1; bi += 1) {
          const crossing = lineSegmentsCross(a.route!.points[ai]!, a.route!.points[ai + 1]!, b.route!.points[bi]!, b.route!.points[bi + 1]!);
          if (!crossing) continue;
          const overWire = a.style.zIndex >= b.style.zIndex ? a.id : b.id;
          crossings.push({
            point: crossing,
            wireA: a.id,
            wireB: b.id,
            overWire,
            underWire: overWire === a.id ? b.id : a.id,
          });
        }
      }
    }
  }
  return crossings;
}

export interface FanoutPair {
  id: EntityId;
  source: Point;
  target: Point;
}

export interface FanoutOptions {
  orientation: 'horizontal' | 'vertical';
  sourceLaneStart?: number;
  targetLaneStart?: number;
  laneSpacing: number;
  centerCoordinate?: number;
  reverseOrder?: boolean;
}

/**
 * Creates deterministic, non-overlapping lane routes for two ordered pin banks.
 * The caller can feed the result into wire constraints or use it as a preview.
 */
export function routePinBankFanout(pairs: FanoutPair[], options: FanoutOptions): Map<EntityId, Point[]> {
  const sorted = [...pairs].sort((a, b) => {
    const delta = options.orientation === 'horizontal' ? a.source.y - b.source.y : a.source.x - b.source.x;
    return options.reverseOrder ? -delta : delta;
  });
  const result = new Map<EntityId, Point[]>();
  const center = options.centerCoordinate ?? (
    options.orientation === 'horizontal'
      ? (Math.max(...sorted.map((pair) => pair.source.x)) + Math.min(...sorted.map((pair) => pair.target.x))) / 2
      : (Math.max(...sorted.map((pair) => pair.source.y)) + Math.min(...sorted.map((pair) => pair.target.y))) / 2
  );
  for (let index = 0; index < sorted.length; index += 1) {
    const pair = sorted[index]!;
    const laneOffset = (index - (sorted.length - 1) / 2) * options.laneSpacing;
    if (options.orientation === 'horizontal') {
      const x = center + laneOffset;
      result.set(pair.id, simplifyPolyline([pair.source, { x, y: pair.source.y }, { x, y: pair.target.y }, pair.target]));
    } else {
      const y = center + laneOffset;
      result.set(pair.id, simplifyPolyline([pair.source, { x: pair.source.x, y }, { x: pair.target.x, y }, pair.target]));
    }
  }
  return result;
}

export function moveOrthogonalSegment(points: Point[], segmentIndex: number, delta: Point): Point[] {
  if (segmentIndex < 0 || segmentIndex >= points.length - 1) return points.map((value) => ({ ...value }));
  const result = points.map((value) => ({ ...value }));
  const start = result[segmentIndex]!;
  const end = result[segmentIndex + 1]!;
  const axis = segmentAxis(start, end);
  if (axis === 'diagonal') return result;
  if (axis === 'horizontal') {
    const newY = start.y + delta.y;
    if (segmentIndex === 0) {
      result.splice(1, 0, { x: start.x, y: newY });
      result[2] = { x: end.x, y: newY };
    } else if (segmentIndex === result.length - 2) {
      result[segmentIndex] = { x: start.x, y: newY };
      result.splice(segmentIndex + 1, 0, { x: end.x, y: newY });
    } else {
      result[segmentIndex] = { x: start.x, y: newY };
      result[segmentIndex + 1] = { x: end.x, y: newY };
    }
  } else {
    const newX = start.x + delta.x;
    if (segmentIndex === 0) {
      result.splice(1, 0, { x: newX, y: start.y });
      result[2] = { x: newX, y: end.y };
    } else if (segmentIndex === result.length - 2) {
      result[segmentIndex] = { x: newX, y: start.y };
      result.splice(segmentIndex + 1, 0, { x: newX, y: end.y });
    } else {
      result[segmentIndex] = { x: newX, y: start.y };
      result[segmentIndex + 1] = { x: newX, y: end.y };
    }
  }
  return simplifyPolyline(result);
}

export function createWaypointConstraint(id: EntityId, point: Point, locked = false): RouteConstraint {
  return {
    id,
    kind: locked ? 'locked-waypoint' : 'waypoint',
    point: { ...point },
    strength: locked ? 'hard' : 'strong',
    ownerFrame: 'world',
  };
}

export function nearestCardinalSide(vector: Point): Side {
  if (Math.abs(vector.x) >= Math.abs(vector.y)) return vector.x >= 0 ? 'east' : 'west';
  return vector.y >= 0 ? 'south' : 'north';
}

export function suggestRoutePattern(source: ResolvedEndpoint, target: ResolvedEndpoint): RoutePattern {
  const delta = subtract(target.point, source.point);
  const sourceSide = source.side ?? nearestCardinalSide(source.normal);
  const targetSide = target.side ?? nearestCardinalSide(target.normal);
  if ((sourceSide === 'east' && targetSide === 'west') || (sourceSide === 'west' && targetSide === 'east')) {
    return Math.abs(delta.x) > Math.abs(delta.y) ? 'orthogonal' : 'dogleg-vertical';
  }
  if ((sourceSide === 'north' && targetSide === 'south') || (sourceSide === 'south' && targetSide === 'north')) {
    return Math.abs(delta.y) > Math.abs(delta.x) ? 'orthogonal' : 'dogleg-horizontal';
  }
  return 'orthogonal';
}

export function validateRouteClearance(points: Point[], obstacles: RoutingObstacle[], clearance: number): EntityId[] {
  return obstacles
    .filter((obstacle) => polylineIntersectsRect(points, inflateRect(obstacle.rect, clamp(clearance, 0, Number.POSITIVE_INFINITY))))
    .map((obstacle) => obstacle.id);
}
