export const EPSILON = 1e-6;
export function point(x, y) {
    return { x, y };
}
export function rect(x, y, width, height) {
    return { x, y, width, height };
}
export function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
}
export function subtract(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
}
export function scale(a, scalar) {
    return { x: a.x * scalar, y: a.y * scalar };
}
export function dot(a, b) {
    return a.x * b.x + a.y * b.y;
}
export function cross(a, b) {
    return a.x * b.y - a.y * b.x;
}
export function magnitude(a) {
    return Math.hypot(a.x, a.y);
}
export function normalize(a) {
    const length = magnitude(a);
    if (length <= EPSILON)
        return { x: 0, y: 0 };
    return { x: a.x / length, y: a.y / length };
}
export function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}
export function manhattanDistance(a, b) {
    return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
}
export function nearlyEqual(a, b, epsilon = EPSILON) {
    return Math.abs(a - b) <= epsilon;
}
export function pointsEqual(a, b, epsilon = EPSILON) {
    return nearlyEqual(a.x, b.x, epsilon) && nearlyEqual(a.y, b.y, epsilon);
}
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
export function snap(value, spacing) {
    if (spacing <= EPSILON)
        return value;
    return Math.round(value / spacing) * spacing;
}
export function snapPoint(value, spacing) {
    return { x: snap(value.x, spacing), y: snap(value.y, spacing) };
}
export function sideNormal(side) {
    switch (side) {
        case 'north':
            return { x: 0, y: -1 };
        case 'east':
            return { x: 1, y: 0 };
        case 'south':
            return { x: 0, y: 1 };
        case 'west':
            return { x: -1, y: 0 };
    }
}
export function sideTangent(side) {
    const normal = sideNormal(side);
    return { x: -normal.y, y: normal.x };
}
export function oppositeSide(side) {
    switch (side) {
        case 'north':
            return 'south';
        case 'east':
            return 'west';
        case 'south':
            return 'north';
        case 'west':
            return 'east';
    }
}
export function rotateSide(side, rotation) {
    const order = ['north', 'east', 'south', 'west'];
    const index = order.indexOf(side);
    return order[(index + rotation / 90) % 4];
}
export function rotatePoint(pointValue, rotation) {
    switch (rotation) {
        case 0:
            return { ...pointValue };
        case 90:
            return { x: -pointValue.y, y: pointValue.x };
        case 180:
            return { x: -pointValue.x, y: -pointValue.y };
        case 270:
            return { x: pointValue.y, y: -pointValue.x };
    }
}
export function transformLocalPoint(local, localSize, worldCenter, rotation, mirrorX = false, mirrorY = false) {
    let centered = {
        x: local.x - localSize.width / 2,
        y: local.y - localSize.height / 2,
    };
    if (mirrorX)
        centered.x *= -1;
    if (mirrorY)
        centered.y *= -1;
    const rotated = rotatePoint(centered, rotation);
    return add(worldCenter, rotated);
}
export function transformLocalVector(vector, rotation, mirrorX = false, mirrorY = false) {
    const mirrored = {
        x: mirrorX ? -vector.x : vector.x,
        y: mirrorY ? -vector.y : vector.y,
    };
    return rotatePoint(mirrored, rotation);
}
export function boundsFromPoints(points) {
    if (points.length === 0)
        return { x: 0, y: 0, width: 0, height: 0 };
    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    for (let index = 1; index < points.length; index += 1) {
        const current = points[index];
        minX = Math.min(minX, current.x);
        maxX = Math.max(maxX, current.x);
        minY = Math.min(minY, current.y);
        maxY = Math.max(maxY, current.y);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
export function rectCorners(value) {
    return [
        { x: value.x, y: value.y },
        { x: value.x + value.width, y: value.y },
        { x: value.x + value.width, y: value.y + value.height },
        { x: value.x, y: value.y + value.height },
    ];
}
export function rectCenter(value) {
    return { x: value.x + value.width / 2, y: value.y + value.height / 2 };
}
export function rectRight(value) {
    return value.x + value.width;
}
export function rectBottom(value) {
    return value.y + value.height;
}
export function inflateRect(value, amount) {
    return {
        x: value.x - amount,
        y: value.y - amount,
        width: value.width + amount * 2,
        height: value.height + amount * 2,
    };
}
export function translateRect(value, delta) {
    return { ...value, x: value.x + delta.x, y: value.y + delta.y };
}
export function unionRects(values) {
    if (values.length === 0)
        return { x: 0, y: 0, width: 0, height: 0 };
    let minX = values[0].x;
    let minY = values[0].y;
    let maxX = rectRight(values[0]);
    let maxY = rectBottom(values[0]);
    for (let index = 1; index < values.length; index += 1) {
        const current = values[index];
        minX = Math.min(minX, current.x);
        minY = Math.min(minY, current.y);
        maxX = Math.max(maxX, rectRight(current));
        maxY = Math.max(maxY, rectBottom(current));
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
export function rectContainsPoint(value, candidate, inclusive = true) {
    if (inclusive) {
        return (candidate.x >= value.x - EPSILON &&
            candidate.x <= rectRight(value) + EPSILON &&
            candidate.y >= value.y - EPSILON &&
            candidate.y <= rectBottom(value) + EPSILON);
    }
    return (candidate.x > value.x + EPSILON &&
        candidate.x < rectRight(value) - EPSILON &&
        candidate.y > value.y + EPSILON &&
        candidate.y < rectBottom(value) - EPSILON);
}
export function rectContainsRect(container, candidate) {
    return (candidate.x >= container.x - EPSILON &&
        candidate.y >= container.y - EPSILON &&
        rectRight(candidate) <= rectRight(container) + EPSILON &&
        rectBottom(candidate) <= rectBottom(container) + EPSILON);
}
export function rectsIntersect(a, b, inclusive = true) {
    if (inclusive) {
        return !(rectRight(a) < b.x - EPSILON ||
            rectRight(b) < a.x - EPSILON ||
            rectBottom(a) < b.y - EPSILON ||
            rectBottom(b) < a.y - EPSILON);
    }
    return !(rectRight(a) <= b.x + EPSILON ||
        rectRight(b) <= a.x + EPSILON ||
        rectBottom(a) <= b.y + EPSILON ||
        rectBottom(b) <= a.y + EPSILON);
}
export function intersectionArea(a, b) {
    const width = Math.max(0, Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x));
    const height = Math.max(0, Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y));
    return width * height;
}
export function distancePointToSegment(candidate, start, end) {
    const segment = subtract(end, start);
    const lengthSquared = dot(segment, segment);
    if (lengthSquared <= EPSILON)
        return distance(candidate, start);
    const projection = clamp(dot(subtract(candidate, start), segment) / lengthSquared, 0, 1);
    const closest = add(start, scale(segment, projection));
    return distance(candidate, closest);
}
export function closestPointOnSegment(candidate, start, end) {
    const segment = subtract(end, start);
    const lengthSquared = dot(segment, segment);
    if (lengthSquared <= EPSILON)
        return { ...start };
    const projection = clamp(dot(subtract(candidate, start), segment) / lengthSquared, 0, 1);
    return add(start, scale(segment, projection));
}
export function segmentAxis(start, end) {
    if (nearlyEqual(start.y, end.y))
        return 'horizontal';
    if (nearlyEqual(start.x, end.x))
        return 'vertical';
    return 'diagonal';
}
export function isOrthogonalSegment(start, end) {
    return segmentAxis(start, end) !== 'diagonal';
}
export function segmentIntersectsRect(start, end, obstacle, allowBoundaryTouch = true) {
    const axis = segmentAxis(start, end);
    if (axis === 'horizontal') {
        const y = start.y;
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const yInside = allowBoundaryTouch
            ? y > obstacle.y + EPSILON && y < rectBottom(obstacle) - EPSILON
            : y >= obstacle.y - EPSILON && y <= rectBottom(obstacle) + EPSILON;
        if (!yInside)
            return false;
        return allowBoundaryTouch
            ? maxX > obstacle.x + EPSILON && minX < rectRight(obstacle) - EPSILON
            : maxX >= obstacle.x - EPSILON && minX <= rectRight(obstacle) + EPSILON;
    }
    if (axis === 'vertical') {
        const x = start.x;
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);
        const xInside = allowBoundaryTouch
            ? x > obstacle.x + EPSILON && x < rectRight(obstacle) - EPSILON
            : x >= obstacle.x - EPSILON && x <= rectRight(obstacle) + EPSILON;
        if (!xInside)
            return false;
        return allowBoundaryTouch
            ? maxY > obstacle.y + EPSILON && minY < rectBottom(obstacle) - EPSILON
            : maxY >= obstacle.y - EPSILON && minY <= rectBottom(obstacle) + EPSILON;
    }
    // Liang-Barsky clipping for diagonal segments.
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [start.x - obstacle.x, rectRight(obstacle) - start.x, start.y - obstacle.y, rectBottom(obstacle) - start.y];
    for (let index = 0; index < 4; index += 1) {
        const pi = p[index];
        const qi = q[index];
        if (Math.abs(pi) <= EPSILON) {
            if (qi < 0)
                return false;
            continue;
        }
        const ratio = qi / pi;
        if (pi < 0)
            t0 = Math.max(t0, ratio);
        else
            t1 = Math.min(t1, ratio);
        if (t0 > t1)
            return false;
    }
    if (allowBoundaryTouch && nearlyEqual(t0, t1))
        return false;
    return true;
}
export function polylineIntersectsRect(points, obstacle) {
    for (let index = 0; index < points.length - 1; index += 1) {
        if (segmentIntersectsRect(points[index], points[index + 1], obstacle))
            return true;
    }
    return false;
}
export function simplifyPolyline(points) {
    if (points.length <= 2)
        return points.map((value) => ({ ...value }));
    const deduplicated = [];
    for (const current of points) {
        if (deduplicated.length === 0 || !pointsEqual(deduplicated[deduplicated.length - 1], current)) {
            deduplicated.push({ ...current });
        }
    }
    if (deduplicated.length <= 2)
        return deduplicated;
    const simplified = [deduplicated[0]];
    for (let index = 1; index < deduplicated.length - 1; index += 1) {
        const previous = simplified[simplified.length - 1];
        const current = deduplicated[index];
        const next = deduplicated[index + 1];
        if (segmentAxis(previous, current) === segmentAxis(current, next))
            continue;
        simplified.push(current);
    }
    simplified.push(deduplicated[deduplicated.length - 1]);
    return simplified;
}
export function orthogonalizePolyline(points, horizontalFirst = true) {
    if (points.length < 2)
        return points.map((value) => ({ ...value }));
    const result = [{ ...points[0] }];
    for (let index = 1; index < points.length; index += 1) {
        const previous = result[result.length - 1];
        const current = points[index];
        if (isOrthogonalSegment(previous, current)) {
            result.push({ ...current });
            continue;
        }
        result.push(horizontalFirst
            ? { x: current.x, y: previous.y }
            : { x: previous.x, y: current.y });
        result.push({ ...current });
    }
    return simplifyPolyline(result);
}
export function routeSegments(points) {
    const segments = [];
    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        segments.push({ start: { ...start }, end: { ...end }, axis: segmentAxis(start, end), length: distance(start, end) });
    }
    return segments;
}
export function polylineLength(points) {
    let total = 0;
    for (let index = 0; index < points.length - 1; index += 1)
        total += distance(points[index], points[index + 1]);
    return total;
}
export function pointAtPolylineFraction(points, fraction) {
    if (points.length === 0)
        return { point: { x: 0, y: 0 }, segmentIndex: 0, tangent: { x: 1, y: 0 } };
    if (points.length === 1)
        return { point: { ...points[0] }, segmentIndex: 0, tangent: { x: 1, y: 0 } };
    const total = polylineLength(points);
    if (total <= EPSILON)
        return { point: { ...points[0] }, segmentIndex: 0, tangent: { x: 1, y: 0 } };
    let remaining = clamp(fraction, 0, 1) * total;
    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const segmentLength = distance(start, end);
        if (remaining <= segmentLength || index === points.length - 2) {
            const ratio = segmentLength <= EPSILON ? 0 : remaining / segmentLength;
            return {
                point: { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio },
                segmentIndex: index,
                tangent: normalize(subtract(end, start)),
            };
        }
        remaining -= segmentLength;
    }
    return {
        point: { ...points[points.length - 1] },
        segmentIndex: points.length - 2,
        tangent: normalize(subtract(points[points.length - 1], points[points.length - 2])),
    };
}
export function closestPointOnPolyline(candidate, points) {
    if (points.length === 0)
        return { point: { x: 0, y: 0 }, segmentIndex: 0, distance: Number.POSITIVE_INFINITY, fraction: 0 };
    if (points.length === 1)
        return { point: { ...points[0] }, segmentIndex: 0, distance: distance(candidate, points[0]), fraction: 0 };
    const totalLength = polylineLength(points);
    let traversed = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestPoint = { ...points[0] };
    let bestSegment = 0;
    let bestFraction = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const projected = closestPointOnSegment(candidate, start, end);
        const currentDistance = distance(candidate, projected);
        const segmentLength = distance(start, end);
        if (currentDistance < bestDistance) {
            bestDistance = currentDistance;
            bestPoint = projected;
            bestSegment = index;
            bestFraction = totalLength <= EPSILON ? 0 : (traversed + distance(start, projected)) / totalLength;
        }
        traversed += segmentLength;
    }
    return { point: bestPoint, segmentIndex: bestSegment, distance: bestDistance, fraction: bestFraction };
}
export function lineSegmentsCross(a1, a2, b1, b2) {
    const aAxis = segmentAxis(a1, a2);
    const bAxis = segmentAxis(b1, b2);
    if (aAxis === 'horizontal' && bAxis === 'vertical') {
        const x = b1.x;
        const y = a1.y;
        if (x > Math.min(a1.x, a2.x) + EPSILON &&
            x < Math.max(a1.x, a2.x) - EPSILON &&
            y > Math.min(b1.y, b2.y) + EPSILON &&
            y < Math.max(b1.y, b2.y) - EPSILON) {
            return { x, y };
        }
    }
    if (aAxis === 'vertical' && bAxis === 'horizontal')
        return lineSegmentsCross(b1, b2, a1, a2);
    return undefined;
}
export function countPolylineCrossings(a, b) {
    let count = 0;
    for (let ai = 0; ai < a.length - 1; ai += 1) {
        for (let bi = 0; bi < b.length - 1; bi += 1) {
            if (lineSegmentsCross(a[ai], a[ai + 1], b[bi], b[bi + 1]))
                count += 1;
        }
    }
    return count;
}
export function routeBounds(points, padding = 0) {
    return inflateRect(boundsFromPoints(points), padding);
}
export function screenToleranceToWorld(tolerancePx, zoom) {
    return tolerancePx / Math.max(zoom, EPSILON);
}
export function formatNumber(value) {
    if (Number.isInteger(value))
        return String(value);
    return Number(value.toFixed(3)).toString();
}
function arcSamplePoints(start, corner, end, radius) {
    const incoming = normalize(subtract(corner, start));
    const outgoing = normalize(subtract(end, corner));
    const arcStart = subtract(corner, scale(incoming, radius));
    const arcEnd = add(corner, scale(outgoing, radius));
    const turn = cross(incoming, outgoing);
    const center = {
        x: corner.x + (turn > 0 ? -incoming.y : incoming.y) * radius,
        y: corner.y + (turn > 0 ? incoming.x : -incoming.x) * radius,
    };
    const startAngle = Math.atan2(arcStart.y - center.y, arcStart.x - center.x);
    let endAngle = Math.atan2(arcEnd.y - center.y, arcEnd.x - center.x);
    if (turn > 0 && endAngle < startAngle)
        endAngle += Math.PI * 2;
    if (turn < 0 && endAngle > startAngle)
        endAngle -= Math.PI * 2;
    const samples = [];
    for (let index = 0; index <= 6; index += 1) {
        const angle = startAngle + ((endAngle - startAngle) * index) / 6;
        samples.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
    }
    return samples;
}
export function computeSafeCornerRadii(points, requestedRadius, obstacles = []) {
    const radii = new Array(points.length).fill(0);
    for (let index = 1; index < points.length - 1; index += 1) {
        const previous = points[index - 1];
        const corner = points[index];
        const next = points[index + 1];
        const incomingAxis = segmentAxis(previous, corner);
        const outgoingAxis = segmentAxis(corner, next);
        if (incomingAxis === 'diagonal' || outgoingAxis === 'diagonal' || incomingAxis === outgoingAxis)
            continue;
        const maximum = Math.max(0, Math.min(requestedRadius, distance(previous, corner) / 2, distance(corner, next) / 2));
        if (maximum <= EPSILON)
            continue;
        const collides = (candidate) => {
            const samples = arcSamplePoints(previous, corner, next, candidate);
            return obstacles.some((obstacle) => samples.some((sample) => rectContainsPoint(obstacle, sample, false)));
        };
        // Preserve the requested/geometric maximum exactly when it is already safe.
        // Always running bisection would return a value fractionally below maximum,
        // which creates false "radius clamped" diagnostics and unstable exports.
        if (!collides(maximum)) {
            radii[index] = maximum;
            continue;
        }
        let low = 0;
        let high = maximum;
        for (let iteration = 0; iteration < 12; iteration += 1) {
            const candidate = (low + high) / 2;
            if (collides(candidate))
                high = candidate;
            else
                low = candidate;
        }
        radii[index] = low;
    }
    return radii;
}
export function roundedOrthogonalPath(points, requestedRadius, obstacles = []) {
    const simplified = simplifyPolyline(points);
    if (simplified.length === 0)
        return { path: '', radii: [] };
    if (simplified.length === 1) {
        return { path: `M ${formatNumber(simplified[0].x)} ${formatNumber(simplified[0].y)}`, radii: [0] };
    }
    const radii = computeSafeCornerRadii(simplified, requestedRadius, obstacles);
    let pathData = `M ${formatNumber(simplified[0].x)} ${formatNumber(simplified[0].y)}`;
    for (let index = 1; index < simplified.length; index += 1) {
        const current = simplified[index];
        if (index === simplified.length - 1) {
            pathData += ` L ${formatNumber(current.x)} ${formatNumber(current.y)}`;
            continue;
        }
        const previous = simplified[index - 1];
        const next = simplified[index + 1];
        const radius = radii[index];
        if (radius <= EPSILON) {
            pathData += ` L ${formatNumber(current.x)} ${formatNumber(current.y)}`;
            continue;
        }
        const incoming = normalize(subtract(current, previous));
        const outgoing = normalize(subtract(next, current));
        const arcStart = subtract(current, scale(incoming, radius));
        const arcEnd = add(current, scale(outgoing, radius));
        const sweep = cross(incoming, outgoing) > 0 ? 1 : 0;
        pathData += ` L ${formatNumber(arcStart.x)} ${formatNumber(arcStart.y)}`;
        pathData += ` A ${formatNumber(radius)} ${formatNumber(radius)} 0 0 ${sweep} ${formatNumber(arcEnd.x)} ${formatNumber(arcEnd.y)}`;
    }
    return { path: pathData, radii };
}
//# sourceMappingURL=geometry.js.map