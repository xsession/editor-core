import { rectFromPointList } from './rect.js';
import { add, distance, distancePointToSegment, isAxisAligned, multiply, normalize, pointsEqual, subtract, } from './vector.js';
export function removeDuplicatePoints(points) {
    const result = [];
    for (const current of points) {
        if (result.length === 0 || !pointsEqual(result[result.length - 1], current))
            result.push({ ...current });
    }
    return result;
}
export function simplifyOrthogonal(points) {
    const input = removeDuplicatePoints(points);
    if (input.length <= 2)
        return input;
    const result = [input[0]];
    for (let index = 1; index < input.length - 1; index += 1) {
        const previous = result[result.length - 1];
        const current = input[index];
        const next = input[index + 1];
        if (!((previous.x === current.x && current.x === next.x) || (previous.y === current.y && current.y === next.y))) {
            result.push(current);
        }
    }
    result.push(input[input.length - 1]);
    return result;
}
export function polylineLength(points) {
    let total = 0;
    for (let index = 1; index < points.length; index += 1)
        total += distance(points[index - 1], points[index]);
    return total;
}
export function segmentsFromPoints(points) {
    const segments = [];
    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1];
        const end = points[index];
        const axis = start.y === end.y ? 'horizontal' : start.x === end.x ? 'vertical' : 'diagonal';
        segments.push({ start, end, axis, length: distance(start, end) });
    }
    return segments;
}
export function pointAtFraction(points, fraction) {
    if (points.length === 0)
        return { point: { x: 0, y: 0 }, tangent: { x: 1, y: 0 }, segmentIndex: 0 };
    if (points.length === 1)
        return { point: { ...points[0] }, tangent: { x: 1, y: 0 }, segmentIndex: 0 };
    const total = polylineLength(points);
    if (total === 0)
        return { point: { ...points[0] }, tangent: { x: 1, y: 0 }, segmentIndex: 0 };
    let remaining = Math.max(0, Math.min(1, fraction)) * total;
    for (let index = 1; index < points.length; index += 1) {
        const segmentLength = distance(points[index - 1], points[index]);
        if (remaining <= segmentLength || index === points.length - 1) {
            const amount = segmentLength === 0 ? 0 : remaining / segmentLength;
            return {
                point: {
                    x: points[index - 1].x + (points[index].x - points[index - 1].x) * amount,
                    y: points[index - 1].y + (points[index].y - points[index - 1].y) * amount,
                },
                tangent: normalize(subtract(points[index], points[index - 1])),
                segmentIndex: index - 1,
            };
        }
        remaining -= segmentLength;
    }
    return {
        point: { ...points[points.length - 1] },
        tangent: normalize(subtract(points[points.length - 1], points[points.length - 2])),
        segmentIndex: points.length - 2,
    };
}
export function distanceToPolyline(value, points) {
    if (points.length === 0)
        return Number.POSITIVE_INFINITY;
    if (points.length === 1)
        return distance(value, points[0]);
    let minimum = Number.POSITIVE_INFINITY;
    for (let index = 1; index < points.length; index += 1) {
        minimum = Math.min(minimum, distancePointToSegment(value, points[index - 1], points[index]));
    }
    return minimum;
}
export function polylineBounds(points) {
    return rectFromPointList(points);
}
function format(value) {
    return Number(value.toFixed(3)).toString();
}
function formatPoint(value) {
    return `${format(value.x)} ${format(value.y)}`;
}
export function roundedPath(points, requestedRadius) {
    const clean = removeDuplicatePoints(points);
    if (clean.length === 0)
        return { d: '', corners: [] };
    if (clean.length === 1)
        return { d: `M ${formatPoint(clean[0])}`, corners: [] };
    if (requestedRadius <= 0 || clean.length === 2) {
        return {
            d: `M ${formatPoint(clean[0])} ${clean.slice(1).map((value) => `L ${formatPoint(value)}`).join(' ')}`,
            corners: [],
        };
    }
    const commands = [`M ${formatPoint(clean[0])}`];
    const corners = [];
    for (let index = 1; index < clean.length - 1; index += 1) {
        const previous = clean[index - 1];
        const vertex = clean[index];
        const next = clean[index + 1];
        const incoming = subtract(previous, vertex);
        const outgoing = subtract(next, vertex);
        const incomingLength = distance(previous, vertex);
        const outgoingLength = distance(vertex, next);
        const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
        if (Math.abs(cross) < 1e-9 || incomingLength === 0 || outgoingLength === 0) {
            commands.push(`L ${formatPoint(vertex)}`);
            continue;
        }
        const maximum = Math.max(0, Math.min(incomingLength / 2, outgoingLength / 2));
        const effective = Math.min(requestedRadius, maximum);
        const entry = add(vertex, multiply(normalize(incoming), effective));
        const exit = add(vertex, multiply(normalize(outgoing), effective));
        commands.push(`L ${formatPoint(entry)}`);
        commands.push(`Q ${formatPoint(vertex)} ${formatPoint(exit)}`);
        corners.push({
            index,
            vertex: { ...vertex },
            entry,
            exit,
            requestedRadius,
            effectiveRadius: effective,
            clamped: effective < requestedRadius,
        });
    }
    commands.push(`L ${formatPoint(clean[clean.length - 1])}`);
    return { d: commands.join(' '), corners };
}
export function allSegmentsAxisAligned(points) {
    for (let index = 1; index < points.length; index += 1) {
        if (!isAxisAligned(points[index - 1], points[index]))
            return false;
    }
    return true;
}
export function segmentIntersectsRect(start, end, value) {
    if (start.x === end.x) {
        const minimum = Math.min(start.y, end.y);
        const maximum = Math.max(start.y, end.y);
        return start.x >= value.x && start.x <= value.x + value.width && maximum >= value.y && minimum <= value.y + value.height;
    }
    if (start.y === end.y) {
        const minimum = Math.min(start.x, end.x);
        const maximum = Math.max(start.x, end.x);
        return start.y >= value.y && start.y <= value.y + value.height && maximum >= value.x && minimum <= value.x + value.width;
    }
    let lower = 0;
    let upper = 1;
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const checks = [
        [-deltaX, start.x - value.x],
        [deltaX, value.x + value.width - start.x],
        [-deltaY, start.y - value.y],
        [deltaY, value.y + value.height - start.y],
    ];
    for (const [p, q] of checks) {
        if (p === 0 && q < 0)
            return false;
        if (p !== 0) {
            const ratio = q / p;
            if (p < 0)
                lower = Math.max(lower, ratio);
            else
                upper = Math.min(upper, ratio);
            if (lower > upper)
                return false;
        }
    }
    return true;
}
//# sourceMappingURL=polyline.js.map