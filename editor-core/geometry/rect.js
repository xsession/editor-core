import { clamp } from './vector.js';
export function rectangle(x, y, width, height) {
    return { x, y, width, height };
}
export function normalizeRect(value) {
    const x = value.width < 0 ? value.x + value.width : value.x;
    const y = value.height < 0 ? value.y + value.height : value.y;
    return { x, y, width: Math.abs(value.width), height: Math.abs(value.height) };
}
export function rectFromPoints(a, b) {
    return normalizeRect({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
}
export function rectFromPointList(points) {
    if (points.length === 0)
        return { x: 0, y: 0, width: 0, height: 0 };
    let minimumX = points[0].x;
    let minimumY = points[0].y;
    let maximumX = points[0].x;
    let maximumY = points[0].y;
    for (const current of points.slice(1)) {
        minimumX = Math.min(minimumX, current.x);
        minimumY = Math.min(minimumY, current.y);
        maximumX = Math.max(maximumX, current.x);
        maximumY = Math.max(maximumY, current.y);
    }
    return {
        x: minimumX,
        y: minimumY,
        width: maximumX - minimumX,
        height: maximumY - minimumY,
    };
}
export function right(value) {
    return value.x + value.width;
}
export function bottom(value) {
    return value.y + value.height;
}
export function center(value) {
    return { x: value.x + value.width / 2, y: value.y + value.height / 2 };
}
export function containsPoint(value, target, inclusive = true) {
    if (inclusive) {
        return target.x >= value.x && target.x <= right(value) && target.y >= value.y && target.y <= bottom(value);
    }
    return target.x > value.x && target.x < right(value) && target.y > value.y && target.y < bottom(value);
}
export function containsRect(outer, inner) {
    return inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);
}
export function intersects(a, b, inclusive = true) {
    if (inclusive) {
        return !(right(a) < b.x || right(b) < a.x || bottom(a) < b.y || bottom(b) < a.y);
    }
    return !(right(a) <= b.x || right(b) <= a.x || bottom(a) <= b.y || bottom(b) <= a.y);
}
export function intersection(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const maximumX = Math.min(right(a), right(b));
    const maximumY = Math.min(bottom(a), bottom(b));
    return maximumX < x || maximumY < y
        ? undefined
        : { x, y, width: maximumX - x, height: maximumY - y };
}
export function intersectionArea(a, b) {
    const overlap = intersection(a, b);
    return overlap ? overlap.width * overlap.height : 0;
}
export function inflate(value, amount) {
    return {
        x: value.x - amount,
        y: value.y - amount,
        width: value.width + amount * 2,
        height: value.height + amount * 2,
    };
}
export function translate(value, delta) {
    return { ...value, x: value.x + delta.x, y: value.y + delta.y };
}
export function union(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const maximumX = Math.max(right(a), right(b));
    const maximumY = Math.max(bottom(a), bottom(b));
    return { x, y, width: maximumX - x, height: maximumY - y };
}
export function unionAll(values) {
    return values.length === 0
        ? { x: 0, y: 0, width: 0, height: 0 }
        : values.slice(1).reduce((accumulator, current) => union(accumulator, current), values[0]);
}
export function nearestPoint(value, target) {
    return {
        x: clamp(target.x, value.x, right(value)),
        y: clamp(target.y, value.y, bottom(value)),
    };
}
export function corners(value) {
    return [
        { x: value.x, y: value.y },
        { x: right(value), y: value.y },
        { x: right(value), y: bottom(value) },
        { x: value.x, y: bottom(value) },
    ];
}
//# sourceMappingURL=rect.js.map