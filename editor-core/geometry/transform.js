import { rectFromPointList } from './rect.js';
export function rotatePointAround(value, center, rotation) {
    const deltaX = value.x - center.x;
    const deltaY = value.y - center.y;
    switch (rotation) {
        case 0:
            return { ...value };
        case 90:
            return { x: center.x - deltaY, y: center.y + deltaX };
        case 180:
            return { x: center.x - deltaX, y: center.y - deltaY };
        case 270:
            return { x: center.x + deltaY, y: center.y - deltaX };
    }
}
export function inverseRotation(rotation) {
    return rotation === 90 ? 270 : rotation === 270 ? 90 : rotation;
}
export function rotateRectAround(value, center, rotation) {
    return rectFromPointList([
        rotatePointAround({ x: value.x, y: value.y }, center, rotation),
        rotatePointAround({ x: value.x + value.width, y: value.y }, center, rotation),
        rotatePointAround({ x: value.x + value.width, y: value.y + value.height }, center, rotation),
        rotatePointAround({ x: value.x, y: value.y + value.height }, center, rotation),
    ]);
}
export function rotateSide(side, rotation) {
    const sequence = ['north', 'east', 'south', 'west'];
    const index = sequence.indexOf(side);
    return sequence[(index + rotation / 90) % 4];
}
export function localToWorld(local, origin, size, rotation) {
    const center = { x: origin.x + size.width / 2, y: origin.y + size.height / 2 };
    return rotatePointAround({ x: origin.x + local.x, y: origin.y + local.y }, center, rotation);
}
export function worldToLocal(world, origin, size, rotation) {
    const center = { x: origin.x + size.width / 2, y: origin.y + size.height / 2 };
    const unrotated = rotatePointAround(world, center, inverseRotation(rotation));
    return { x: unrotated.x - origin.x, y: unrotated.y - origin.y };
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
    return side === 'north' || side === 'south' ? { x: 1, y: 0 } : { x: 0, y: 1 };
}
//# sourceMappingURL=transform.js.map