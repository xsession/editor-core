from __future__ import annotations

import heapq
from dataclasses import dataclass
from itertools import count
from .geometry import distance, inflate_rect, manhattan, polyline_length, segment_intersects_rect, simplify_polyline
from .model import ComponentGeometry, Point, Rect, RouteResult, Wire, WireEndpoint


@dataclass(slots=True)
class RoutingObstacle:
    id: str
    rect: Rect
    soft: bool = False


def resolve_endpoint(endpoint: WireEndpoint, geometries: dict[str, ComponentGeometry]) -> Point | None:
    if endpoint.kind == 'free':
        return endpoint.point
    if endpoint.kind == 'port' and endpoint.component_id and endpoint.port_id:
        return geometries.get(endpoint.component_id, ComponentGeometry('', Rect(0, 0, 0, 0), {}, {})).port_centers.get(endpoint.port_id)
    return None


def _blocked(a: Point, b: Point, obstacles: list[RoutingObstacle]) -> bool:
    return any(not obstacle.soft and segment_intersects_rect(a, b, obstacle.rect) for obstacle in obstacles)


def _visibility_coordinates(start: Point, end: Point, obstacles: list[RoutingObstacle], clearance: float, grid: float) -> tuple[list[float], list[float]]:
    xs = {start.x, end.x}
    ys = {start.y, end.y}
    for obstacle in obstacles:
        r = inflate_rect(obstacle.rect, clearance)
        xs.update((r.x - grid, r.x, r.x + r.width, r.x + r.width + grid))
        ys.update((r.y - grid, r.y, r.y + r.height, r.y + r.height + grid))
    return sorted(xs), sorted(ys)


def route_orthogonal(start: Point, end: Point, obstacles: list[RoutingObstacle], wire: Wire) -> list[Point] | None:
    if (abs(start.x - end.x) < 1e-9 or abs(start.y - end.y) < 1e-9) and not _blocked(start, end, obstacles):
        return [start, end]
    options = wire.routing
    xs, ys = _visibility_coordinates(start, end, obstacles, options.clearance, max(1.0, options.grid))
    nodes: list[Point] = []
    index: dict[tuple[float, float], int] = {}
    for y in ys:
        for x in xs:
            p = Point(x, y)
            if p != start and p != end and any(not o.soft and o.rect.x < x < o.rect.x + o.rect.width and o.rect.y < y < o.rect.y + o.rect.height for o in obstacles):
                continue
            index[(x, y)] = len(nodes)
            nodes.append(p)
    for p in (start, end):
        if (p.x, p.y) not in index:
            index[(p.x, p.y)] = len(nodes)
            nodes.append(p)
    start_idx, end_idx = index[(start.x, start.y)], index[(end.x, end.y)]
    by_x: dict[float, list[int]] = {}
    by_y: dict[float, list[int]] = {}
    for idx, p in enumerate(nodes):
        by_x.setdefault(p.x, []).append(idx)
        by_y.setdefault(p.y, []).append(idx)
    for ids in by_x.values():
        ids.sort(key=lambda i: nodes[i].y)
    for ids in by_y.values():
        ids.sort(key=lambda i: nodes[i].x)
    position_x = {idx: pos for ids in by_x.values() for pos, idx in enumerate(ids)}
    position_y = {idx: pos for ids in by_y.values() for pos, idx in enumerate(ids)}

    def neighbors(idx: int):
        p = nodes[idx]
        x_ids, y_ids = by_x[p.x], by_y[p.y]
        for ids, pos, direction in ((x_ids, position_x[idx], 'v'), (y_ids, position_y[idx], 'h')):
            for next_pos in (pos - 1, pos + 1):
                if 0 <= next_pos < len(ids):
                    other = ids[next_pos]
                    if not _blocked(p, nodes[other], obstacles):
                        yield other, direction

    serial = count()
    heap: list[tuple[float, int, int, str]] = [(manhattan(start, end), next(serial), start_idx, 'n')]
    best: dict[tuple[int, str], float] = {(start_idx, 'n'): 0.0}
    parent: dict[tuple[int, str], tuple[int, str] | None] = {(start_idx, 'n'): None}
    expanded = 0
    target_state: tuple[int, str] | None = None
    while heap and expanded < options.max_search_nodes:
        _, _, idx, direction = heapq.heappop(heap)
        state = (idx, direction)
        cost = best.get(state)
        if cost is None:
            continue
        if idx == end_idx:
            target_state = state
            break
        expanded += 1
        for other, next_direction in neighbors(idx):
            bend = options.bend_penalty if direction not in ('n', next_direction) else 0.0
            next_cost = cost + distance(nodes[idx], nodes[other]) + bend
            next_state = (other, next_direction)
            if next_cost >= best.get(next_state, float('inf')):
                continue
            best[next_state] = next_cost
            parent[next_state] = state
            priority = next_cost + manhattan(nodes[other], end)
            heapq.heappush(heap, (priority, next(serial), other, next_direction))
    if target_state is None:
        return None
    result: list[Point] = []
    state: tuple[int, str] | None = target_state
    while state is not None:
        result.append(nodes[state[0]])
        state = parent[state]
    return simplify_polyline(list(reversed(result)))


def route_wire(wire: Wire, geometries: dict[str, ComponentGeometry], obstacles: list[RoutingObstacle], revision: int = 0) -> RouteResult:
    start = resolve_endpoint(wire.source, geometries)
    end = resolve_endpoint(wire.target, geometries)
    if start is None or end is None:
        return RouteResult([], 0.0, 0, status='invalid', diagnostics=['Unresolved endpoint'], generated_at_revision=revision)
    if wire.routing.pattern == 'direct':
        points = [start, end]
    else:
        points = route_orthogonal(start, end, obstacles, wire)
        if not points:
            elbow = Point(end.x, start.y)
            points = simplify_polyline([start, elbow, end])
            return RouteResult(points, polyline_length(points), max(0, len(points) - 2), status='fallback', diagnostics=['Visibility search exhausted; dogleg fallback used.'], generated_at_revision=revision)
    return RouteResult(points, polyline_length(points), max(0, len(points) - 2), generated_at_revision=revision)
