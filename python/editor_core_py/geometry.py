from __future__ import annotations

import math
from .model import Point, Rect

EPSILON = 1e-9


def distance(a: Point, b: Point) -> float:
    return math.hypot(b.x - a.x, b.y - a.y)


def manhattan(a: Point, b: Point) -> float:
    return abs(b.x - a.x) + abs(b.y - a.y)


def rect_right(r: Rect) -> float:
    return r.x + r.width


def rect_bottom(r: Rect) -> float:
    return r.y + r.height


def inflate_rect(r: Rect, amount: float) -> Rect:
    return Rect(r.x - amount, r.y - amount, r.width + amount * 2, r.height + amount * 2)


def rects_intersect(a: Rect, b: Rect) -> bool:
    return not (rect_right(a) < b.x or rect_right(b) < a.x or rect_bottom(a) < b.y or rect_bottom(b) < a.y)


def rect_contains_point(r: Rect, p: Point) -> bool:
    return r.x <= p.x <= rect_right(r) and r.y <= p.y <= rect_bottom(r)


def union_rects(rects: list[Rect]) -> Rect:
    if not rects:
        return Rect(-500, -300, 1000, 600)
    min_x = min(r.x for r in rects)
    min_y = min(r.y for r in rects)
    max_x = max(rect_right(r) for r in rects)
    max_y = max(rect_bottom(r) for r in rects)
    return Rect(min_x, min_y, max_x - min_x, max_y - min_y)


def segment_bounds(a: Point, b: Point, padding: float = 0.0) -> Rect:
    return Rect(min(a.x, b.x) - padding, min(a.y, b.y) - padding,
                abs(b.x - a.x) + 2 * padding, abs(b.y - a.y) + 2 * padding)


def segment_intersects_rect(a: Point, b: Point, r: Rect) -> bool:
    # Fast path for orthogonal segments, with Liang-Barsky fallback.
    if abs(a.y - b.y) <= EPSILON:
        return r.y < a.y < rect_bottom(r) and max(a.x, b.x) > r.x and min(a.x, b.x) < rect_right(r)
    if abs(a.x - b.x) <= EPSILON:
        return r.x < a.x < rect_right(r) and max(a.y, b.y) > r.y and min(a.y, b.y) < rect_bottom(r)
    dx, dy = b.x - a.x, b.y - a.y
    p = (-dx, dx, -dy, dy)
    q = (a.x - r.x, rect_right(r) - a.x, a.y - r.y, rect_bottom(r) - a.y)
    t0, t1 = 0.0, 1.0
    for pi, qi in zip(p, q):
        if abs(pi) <= EPSILON:
            if qi < 0:
                return False
            continue
        ratio = qi / pi
        if pi < 0:
            t0 = max(t0, ratio)
        else:
            t1 = min(t1, ratio)
        if t0 > t1:
            return False
    return True


def point_segment_distance(p: Point, a: Point, b: Point) -> float:
    dx, dy = b.x - a.x, b.y - a.y
    length2 = dx * dx + dy * dy
    if length2 <= EPSILON:
        return distance(p, a)
    t = max(0.0, min(1.0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
    q = Point(a.x + t * dx, a.y + t * dy)
    return distance(p, q)


def polyline_length(points: list[Point]) -> float:
    return sum(distance(points[i], points[i + 1]) for i in range(len(points) - 1))


def simplify_polyline(points: list[Point]) -> list[Point]:
    dedup: list[Point] = []
    for p in points:
        if not dedup or abs(dedup[-1].x - p.x) > EPSILON or abs(dedup[-1].y - p.y) > EPSILON:
            dedup.append(p)
    if len(dedup) <= 2:
        return dedup
    out = [dedup[0]]
    for i in range(1, len(dedup) - 1):
        a, b, c = out[-1], dedup[i], dedup[i + 1]
        collinear = (abs(a.x - b.x) <= EPSILON and abs(b.x - c.x) <= EPSILON) or \
                    (abs(a.y - b.y) <= EPSILON and abs(b.y - c.y) <= EPSILON)
        if not collinear:
            out.append(b)
    out.append(dedup[-1])
    return out
