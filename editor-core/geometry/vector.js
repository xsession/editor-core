export const EPSILON = 1e-9;
export function point(x = 0, y = 0) {
    return { x, y };
}
export function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
}
export function subtract(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
}
export function multiply(a, scalar) {
    return { x: a.x * scalar, y: a.y * scalar };
}
export function dot(a, b) {
    return a.x * b.x + a.y * b.y;
}
export function magnitudeSquared(value) {
    return dot(value, value);
}
export function magnitude(value) {
    return Math.hypot(value.x, value.y);
}
export function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}
export function normalize(value) {
    const length = magnitude(value);
    return length < EPSILON ? { x: 0, y: 0 } : multiply(value, 1 / length);
}
export function perpendicular(value) {
    return { x: -value.y, y: value.x };
}
export function lerp(a, b, amount) {
    return {
        x: a.x + (b.x - a.x) * amount,
        y: a.y + (b.y - a.y) * amount,
    };
}
export function midpoint(a, b) {
    return lerp(a, b, 0.5);
}
export function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}
export function snap(value, spacing) {
    return spacing <= 0 ? value : Math.round(value / spacing) * spacing;
}
export function snapPoint(value, spacing) {
    return { x: snap(value.x, spacing), y: snap(value.y, spacing) };
}
export function almostEqual(a, b, epsilon = EPSILON) {
    return Math.abs(a - b) <= epsilon;
}
export function pointsEqual(a, b, epsilon = EPSILON) {
    return almostEqual(a.x, b.x, epsilon) && almostEqual(a.y, b.y, epsilon);
}
export function isAxisAligned(a, b, epsilon = EPSILON) {
    return almostEqual(a.x, b.x, epsilon) || almostEqual(a.y, b.y, epsilon);
}
export function projectPointToSegment(value, start, end) {
    const segment = subtract(end, start);
    const denominator = magnitudeSquared(segment);
    if (denominator < EPSILON)
        return { ...start };
    const amount = clamp(dot(subtract(value, start), segment) / denominator, 0, 1);
    return add(start, multiply(segment, amount));
}
export function distancePointToSegment(value, start, end) {
    return distance(value, projectPointToSegment(value, start, end));
}
export function angleDegrees(start, end) {
    return (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
}
export function roundPoint(value, decimalPlaces = 3) {
    const factor = 10 ** decimalPlaces;
    return {
        x: Math.round(value.x * factor) / factor,
        y: Math.round(value.y * factor) / factor,
    };
}
//# sourceMappingURL=vector.js.map