import { analyzeSpatialCable } from './spatial-harness.js';
function pointDistance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
function circumradius(a, b, c) {
    const ab = pointDistance(a, b);
    const bc = pointDistance(b, c);
    const ac = pointDistance(a, c);
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const cross = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (cross < 1e-9 || ab < 1e-9 || bc < 1e-9 || ac < 1e-9)
        return Number.POSITIVE_INFINITY;
    return (ab * bc * ac) / (2 * cross);
}
function closestPointOnSegment(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
    const lengthSq = abx * abx + aby * aby + abz * abz;
    const t = lengthSq <= 1e-12 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / lengthSq));
    return { x: a.x + t * abx, y: a.y + t * aby, z: a.z + t * abz };
}
/**
 * Closest point on a triangle plus barycentric edge coordinates (u, v) such
 * that point = a + u * (b - a) + v * (c - a).
 */
export function closestPointOnTriangle(p, a, b, c) {
    const ab = closestPointOnSegment(p, a, b);
    const ac = closestPointOnSegment(p, a, c);
    const bc = closestPointOnSegment(p, b, c);
    const dAb = pointDistance(p, ab), dAc = pointDistance(p, ac), dBc = pointDistance(p, bc);
    let u = 0;
    let v = 0;
    let point;
    if (dAb <= dAc && dAb <= dBc) {
        // Edge ab: weight a = 1 - t, weight b = t → (u, v) = (t, 0).
        const edgeLength = pointDistance(a, b);
        const t = edgeLength <= 1e-9 ? 0 : pointDistance(ab, a) / edgeLength;
        u = t;
        point = ab;
    }
    else if (dAc <= dBc) {
        // Edge ac: (u, v) = (0, t).
        const edgeLength = pointDistance(a, c);
        const t = edgeLength <= 1e-9 ? 0 : pointDistance(ac, a) / edgeLength;
        v = t;
        point = ac;
    }
    else {
        // Edge bc: (u, v) = (t, 1 - t).
        const edgeLength = pointDistance(b, c);
        const t = edgeLength <= 1e-9 ? 0 : pointDistance(bc, b) / edgeLength;
        u = t;
        v = 1 - t;
        point = bc;
    }
    return { point, barycentric: [u, v] };
}
function distancePointToTriangle(p, triangle) {
    const e1 = { x: triangle.b.x - triangle.a.x, y: triangle.b.y - triangle.a.y, z: triangle.b.z - triangle.a.z };
    const e2 = { x: triangle.c.x - triangle.a.x, y: triangle.c.y - triangle.a.y, z: triangle.c.z - triangle.a.z };
    const n = { x: e1.y * e2.z - e1.z * e2.y, y: e1.z * e2.x - e1.x * e2.z, z: e1.x * e2.y - e1.y * e2.x };
    const nLen = Math.hypot(n.x, n.y, n.z);
    if (nLen <= 1e-12) {
        const flat = closestPointOnTriangle(p, triangle.a, triangle.b, triangle.c);
        return pointDistance(p, flat.point);
    }
    const ap = { x: p.x - triangle.a.x, y: p.y - triangle.a.y, z: p.z - triangle.a.z };
    const dist = (ap.x * n.x + ap.y * n.y + ap.z * n.z) / nLen;
    const projection = { x: p.x - dist * n.x / nLen, y: p.y - dist * n.y / nLen, z: p.z - dist * n.z / nLen };
    const dot = (m, k) => m.x * k.x + m.y * k.y + m.z * k.z;
    const b1 = { x: projection.x - triangle.b.x, y: projection.y - triangle.b.y, z: projection.z - triangle.b.z };
    const b2 = { x: triangle.c.x - triangle.b.x, y: triangle.c.y - triangle.b.y, z: triangle.c.z - triangle.b.z };
    const b3 = { x: triangle.c.x - triangle.a.x, y: triangle.c.y - triangle.a.y, z: triangle.c.z - triangle.a.z };
    const onTriangle = dot(b1, b2) >= -1e-9 && dot(b1, b3) <= dot(b2, b3) + 1e-9;
    if (onTriangle)
        return Math.abs(dist);
    const nearest = closestPointOnTriangle(p, triangle.a, triangle.b, triangle.c);
    return pointDistance(p, nearest.point);
}
function triangleBounds(t) {
    return {
        lo: {
            x: Math.min(t.a.x, t.b.x, t.c.x),
            y: Math.min(t.a.y, t.b.y, t.c.y),
            z: Math.min(t.a.z, t.b.z, t.c.z),
        },
        hi: {
            x: Math.max(t.a.x, t.b.x, t.c.x),
            y: Math.max(t.a.y, t.b.y, t.c.y),
            z: Math.max(t.a.z, t.b.z, t.c.z),
        },
    };
}
/**
 * Point-in-solid test for a closed triangle soup. Casts a ray from the
 * point along +x and counts forward triangle crossings (Möller–Trumbore);
 * an odd count means the point is inside. Winding-orientation independent,
 * with a deterministic micro-offset to avoid degenerate exact-face hits.
 */
export function isPointInsideSolid(p, triangles) {
    const px = p.x + 1e-9;
    const py = p.y;
    const pz = p.z;
    let crossings = 0;
    for (const t of triangles) {
        const a = t.a, b = t.b, c = t.c;
        const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
        const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
        // h = cross(e1, dir) with dir = (1, 0, 0): h = (0, e1z, -e1y)
        const h1 = e1z, h2 = -e1y;
        const det = e2x * 0 + e2y * h1 + e2z * h2;
        if (Math.abs(det) < 1e-12)
            continue;
        const invDet = 1 / det;
        const sx = px - a.x, sy = py - a.y, sz = pz - a.z;
        const u = (sx * 0 + sy * h1 + sz * h2) * invDet;
        if (u < 0 || u > 1)
            continue;
        // q = cross(s, e2)
        const qx = sy * e2z - sz * e2y;
        const qy = sz * e2x - sx * e2z;
        const qz = sx * e2y - sy * e2x;
        const v = (e1x * qx + e1y * qy + e1z * qz) * invDet;
        if (v < 0 || u + v > 1)
            continue;
        const tParam = (e2x * qx + e2y * qy + e2z * qz) * invDet;
        if (tParam > 1e-9)
            crossings += 1;
    }
    return crossings % 2 === 1;
}
/**
 * Builds a uniform-grid keep-out volume from product triangles. A voxel is
 * blocked when its center is inside the solid or within `clearanceMm` of the
 * surface. Returns null when the mesh is empty or too large for the grid cap.
 */
export function buildSpatialKeepOutVolume(triangles, options = {}) {
    if (!triangles.length)
        return null;
    if (triangles.length > (options.maxTriangles ?? 12000))
        return null;
    const clearanceMm = Math.max(0, options.clearanceMm ?? 0);
    const cap = Math.max(8, options.maxCellsPerAxis ?? 160);
    let cell = Math.max(2, options.cellSizeMm ?? 4);
    const margin = clearanceMm + cell;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const triangle of triangles) {
        const { lo, hi } = triangleBounds(triangle);
        minX = Math.min(minX, lo.x - margin);
        minY = Math.min(minY, lo.y - margin);
        minZ = Math.min(minZ, lo.z - margin);
        maxX = Math.max(maxX, hi.x + margin);
        maxY = Math.max(maxY, hi.y + margin);
        maxZ = Math.max(maxZ, hi.z + margin);
    }
    const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
    const perAxis = (span) => Math.min(cap, Math.ceil(span / cell) + 1);
    if (Math.max(perAxis(spanX), perAxis(spanY), perAxis(spanZ)) === cap && cell < Math.max(spanX, spanY, spanZ) / cap) {
        cell = Math.max(spanX, spanY, spanZ) / cap;
    }
    const nx = perAxis(spanX), ny = perAxis(spanY), nz = perAxis(spanZ);
    const origin = { x: minX, y: minY, z: minZ };
    const idOf = (ix, iy, iz) => ix + nx * (iy + ny * iz);
    // Pass 1a: thin clearance shell (the user-requested clearance, quantized to
    // the voxel grid) — the final keep-out boundary.
    // Pass 1b: a thick shell (clearance + ~0.9 * cell) used only as the sealed
    // boundary for the interior flood below; a 0.25 * cell shell would not seal
    // the 8-neighbor flood and interior voxels would be misread as exterior.
    // The final blocked set is (interior) OR (thin shell), so routing clearance
    // is not inflated beyond the requested value by the sealing margin.
    const shell = new Uint8Array(nx * ny * nz);
    const thick = new Uint8Array(nx * ny * nz);
    const inflate = Math.max(clearanceMm, cell * 0.9);
    const thinRadius = clearanceMm + cell * 0.25;
    const thickRadius = clearanceMm + cell * 0.9;
    for (const triangle of triangles) {
        const { lo, hi } = triangleBounds(triangle);
        const ix0 = Math.max(0, Math.floor((lo.x - inflate - origin.x) / cell));
        const iy0 = Math.max(0, Math.floor((lo.y - inflate - origin.y) / cell));
        const iz0 = Math.max(0, Math.floor((lo.z - inflate - origin.z) / cell));
        const ix1 = Math.min(nx - 1, Math.ceil((hi.x + inflate - origin.x) / cell));
        const iy1 = Math.min(ny - 1, Math.ceil((hi.y + inflate - origin.y) / cell));
        const iz1 = Math.min(nz - 1, Math.ceil((hi.z + inflate - origin.z) / cell));
        for (let iz = iz0; iz <= iz1; iz += 1) {
            for (let iy = iy0; iy <= iy1; iy += 1) {
                for (let ix = ix0; ix <= ix1; ix += 1) {
                    const center = { x: origin.x + (ix + 0.5) * cell, y: origin.y + (iy + 0.5) * cell, z: origin.z + (iz + 0.5) * cell };
                    const dist = distancePointToTriangle(center, triangle);
                    if (dist < thickRadius)
                        thick[idOf(ix, iy, iz)] = 1;
                    if (dist < thinRadius)
                        shell[idOf(ix, iy, iz)] = 1;
                }
            }
        }
    }
    // Pass 2: interior fill. Flood from the grid border through thick-free
    // voxels; free voxels the exterior flood never reaches are enclosed by the
    // solid and are blocked as well.
    const exterior = new Uint8Array(nx * ny * nz);
    const stack = [];
    const pushFree = (ix, iy, iz) => {
        const id = idOf(ix, iy, iz);
        if (thick[id] || exterior[id])
            return;
        exterior[id] = 1;
        stack.push(id);
    };
    for (let iz = 0; iz < nz; iz += 1) {
        for (let iy = 0; iy < ny; iy += 1) {
            pushFree(0, iy, iz);
            pushFree(nx - 1, iy, iz);
        }
    }
    for (let iz = 0; iz < nz; iz += 1) {
        for (let ix = 0; ix < nx; ix += 1) {
            pushFree(ix, 0, iz);
            pushFree(ix, ny - 1, iz);
        }
    }
    for (let iy = 0; iy < ny; iy += 1) {
        for (let ix = 0; ix < nx; ix += 1) {
            pushFree(ix, iy, 0);
            pushFree(ix, iy, nz - 1);
        }
    }
    while (stack.length) {
        const id = stack.pop();
        const iz = Math.floor(id / (nx * ny));
        const iy = Math.floor((id - iz * nx * ny) / nx);
        const ix = id - iz * nx * ny - iy * nx;
        if (ix > 0)
            pushFree(ix - 1, iy, iz);
        if (ix < nx - 1)
            pushFree(ix + 1, iy, iz);
        if (iy > 0)
            pushFree(ix, iy - 1, iz);
        if (iy < ny - 1)
            pushFree(ix, iy + 1, iz);
        if (iz > 0)
            pushFree(ix, iy, iz - 1);
        if (iz < nz - 1)
            pushFree(ix, iy, iz + 1);
    }
    const blocked = new Uint8Array(nx * ny * nz);
    for (let id = 0; id < blocked.length; id += 1) {
        if (shell[id] || (!thick[id] && !exterior[id]))
            blocked[id] = 1;
    }
    return { origin, cellSizeMm: cell, nx, ny, nz, blocked };
}
export function volumeVoxelIndex(volume, point) {
    const ix = Math.floor((point.x - volume.origin.x) / volume.cellSizeMm);
    const iy = Math.floor((point.y - volume.origin.y) / volume.cellSizeMm);
    const iz = Math.floor((point.z - volume.origin.z) / volume.cellSizeMm);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= volume.nx || iy >= volume.ny || iz >= volume.nz)
        return -1;
    return ix + volume.nx * (iy + volume.ny * iz);
}
export function volumeIsFree(volume, point) {
    if (!volume)
        return true;
    const id = volumeVoxelIndex(volume, point);
    return id < 0 ? true : volume.blocked[id] === 0;
}
/** Line-of-sight test between two world points through the volume. */
export function volumeLineOfSight(volume, from, to) {
    if (!volume)
        return true;
    const steps = Math.max(1, Math.ceil(pointDistance(from, to) / (volume.cellSizeMm * 0.5)));
    for (let step = 1; step < steps; step += 1) {
        const t = step / steps;
        const sample = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
        if (!volumeIsFree(volume, sample))
            return false;
    }
    return true;
}
function voxelCenter(volume, id) {
    const iz = Math.floor(id / (volume.nx * volume.ny));
    const iy = Math.floor((id - iz * volume.nx * volume.ny) / volume.nx);
    const ix = id - iz * volume.nx * volume.ny - iy * volume.nx;
    return {
        x: volume.origin.x + (ix + 0.5) * volume.cellSizeMm,
        y: volume.origin.y + (iy + 0.5) * volume.cellSizeMm,
        z: volume.origin.z + (iz + 0.5) * volume.cellSizeMm,
    };
}
/** Finds the nearest free voxel to a world point (bounded spiral search). */
function nearestFreeVoxel(volume, point, radiusCells) {
    if (!volume)
        return -1;
    const clampCell = (value, size) => Math.max(0, Math.min(size - 1, Math.floor(value)));
    const ix0 = clampCell((point.x - volume.origin.x) / volume.cellSizeMm, volume.nx);
    const iy0 = clampCell((point.y - volume.origin.y) / volume.cellSizeMm, volume.ny);
    const iz0 = clampCell((point.z - volume.origin.z) / volume.cellSizeMm, volume.nz);
    const idOf = (ix, iy, iz) => ix + volume.nx * (iy + volume.ny * iz);
    const direct = idOf(ix0, iy0, iz0);
    if (volume.blocked[direct] === 0)
        return direct;
    let best = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let iz = iz0 - radiusCells; iz <= iz0 + radiusCells; iz += 1) {
        if (iz < 0 || iz >= volume.nz)
            continue;
        for (let iy = iy0 - radiusCells; iy <= iy0 + radiusCells; iy += 1) {
            if (iy < 0 || iy >= volume.ny)
                continue;
            for (let ix = ix0 - radiusCells; ix <= ix0 + radiusCells; ix += 1) {
                if (ix < 0 || ix >= volume.nx)
                    continue;
                const id = idOf(ix, iy, iz);
                if (volume.blocked[id])
                    continue;
                const dist = pointDistance(point, voxelCenter(volume, id));
                if (dist < bestDist) {
                    bestDist = dist;
                    best = id;
                }
            }
        }
    }
    return best;
}
const FACE_OFFSETS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const DIAGONAL_OFFSETS = [
    [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
    [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
    [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
];
/** Minimal binary heap ordered by (f, h, id) for deterministic ties. */
class RouteHeap {
    ids = [];
    getF;
    getH;
    constructor(getF, getH) {
        this.getF = getF;
        this.getH = getH;
    }
    get size() { return this.ids.length; }
    less(a, b) {
        const fa = this.getF(a), fb = this.getF(b);
        if (fa !== fb)
            return fa < fb;
        const ha = this.getH(a), hb = this.getH(b);
        if (ha !== hb)
            return ha < hb;
        return a < b;
    }
    push(id) {
        this.ids.push(id);
        let index = this.ids.length - 1;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (this.less(this.ids[index], this.ids[parent])) {
                [this.ids[index], this.ids[parent]] = [this.ids[parent], this.ids[index]];
                index = parent;
            }
            else
                break;
        }
    }
    pop() {
        if (!this.ids.length)
            return undefined;
        const top = this.ids[0];
        const last = this.ids.pop();
        if (this.ids.length) {
            this.ids[0] = last;
            let index = 0;
            for (;;) {
                const left = index * 2 + 1, right = left + 1;
                let smallest = index;
                if (left < this.ids.length && this.less(this.ids[left], this.ids[smallest]))
                    smallest = left;
                if (right < this.ids.length && this.less(this.ids[right], this.ids[smallest]))
                    smallest = right;
                if (smallest === index)
                    break;
                [this.ids[index], this.ids[smallest]] = [this.ids[smallest], this.ids[index]];
                index = smallest;
            }
        }
        return top;
    }
}
/**
 * Routes a single cable between its locked endpoints through the keep-out
 * volume using bend-aware A* with Theta* line-of-sight reduction.
 *
 * The three-point circumradius test runs during neighbor expansion: a
 * candidate turn whose fitted radius is below the cable's minimum bend
 * radius is rejected. Returns the route as a world-space polyline; the
 * caller replaces the cable's intermediate control points with it.
 */
export function routeSpatialCable(cable, volume, options = {}) {
    const start = cable.controlPoints[0];
    const goal = cable.controlPoints[cable.controlPoints.length - 1];
    if (!start || !goal)
        return { success: false, controlPoints: cable.controlPoints, expansions: 0, pathVoxels: [], bendValid: false, reason: 'start-blocked' };
    const costModifier = options.costModifier;
    const maxExpansions = Math.max(1000, options.maxExpansions ?? 250_000);
    const minBend = cable.minimumBendRadiusMm;
    const activeVolume = cable.surfaceMode === 'inside-product' ? null : volume;
    if (!activeVolume)
        return { success: true, controlPoints: [{ ...start }, { ...goal }], expansions: 0, pathVoxels: [], bendValid: true };
    const startId = nearestFreeVoxel(activeVolume, start, 5);
    const goalId = nearestFreeVoxel(activeVolume, goal, 5);
    if (startId < 0)
        return { success: false, controlPoints: cable.controlPoints, expansions: 0, pathVoxels: [], bendValid: false, reason: 'start-blocked' };
    if (goalId < 0)
        return { success: false, controlPoints: cable.controlPoints, expansions: 0, pathVoxels: [], bendValid: false, reason: 'goal-blocked' };
    if (startId === goalId)
        return { success: true, controlPoints: [{ ...start }, { ...goal }], expansions: 0, pathVoxels: [startId], bendValid: true };
    const { nx, ny, nz, blocked } = activeVolume;
    const idOf = (ix, iy, iz) => ix + nx * (iy + ny * iz);
    const partsOf = (id) => {
        const iz = Math.floor(id / (nx * ny));
        const iy = Math.floor((id - iz * nx * ny) / nx);
        const ix = id - iz * nx * ny - iy * nx;
        return [ix, iy, iz];
    };
    // Jump-chain world points: endpoints are the true control points, not
    // voxel centers.
    const worldPoint = (id) => id === startId ? start : id === goalId ? goal : voxelCenter(activeVolume, id);
    const g = new Map();
    const cameFrom = new Map();
    const jump = new Map();
    const closed = new Set();
    g.set(startId, 0);
    cameFrom.set(startId, startId);
    jump.set(startId, startId);
    const heuristic = (id) => pointDistance(worldPoint(id), goal);
    const heap = new RouteHeap((id) => (g.get(id) ?? Number.POSITIVE_INFINITY) + heuristic(id), heuristic);
    heap.push(startId);
    let expansions = 0;
    let reached = false;
    while (heap.size) {
        const currentId = heap.pop();
        if (currentId === undefined)
            break;
        if (closed.has(currentId))
            continue;
        closed.add(currentId);
        expansions += 1;
        if (expansions > maxExpansions)
            break;
        if (currentId === goalId) {
            reached = true;
            break;
        }
        const [cx, cy, cz] = partsOf(currentId);
        const currentG = g.get(currentId);
        const currentPoint = worldPoint(currentId);
        const gridParentId = cameFrom.get(currentId);
        const gridParentPoint = gridParentId === currentId ? currentPoint : worldPoint(gridParentId);
        const isFaceFree = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && !blocked[idOf(x, y, z)];
        const tryNeighbor = (ox, oy, oz, diagonal) => {
            const ix = cx + ox, iy = cy + oy, iz = cz + oz;
            if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz)
                return;
            const neighborId = idOf(ix, iy, iz);
            if (blocked[neighborId])
                return;
            if (diagonal) {
                // Wall-cut prevention: every face neighbor along the diagonal must be free.
                if (ox !== 0 && !isFaceFree(cx + Math.sign(ox), cy, cz))
                    return;
                if (oy !== 0 && !isFaceFree(cx, cy + Math.sign(oy), cz))
                    return;
                if (oz !== 0 && !isFaceFree(cx, cy, cz + Math.sign(oz)))
                    return;
            }
            const candidatePoint = worldPoint(neighborId);
            // Bend-aware test (three-point principle): the turn at `current` is
            // measured against the run it turns out of. Walk back to the run start
            // and reject only turns that are geometrically impossible no matter how
            // long the outgoing leg is: R * tan(theta/2) <= L1 (fillet tangent
            // distance). Turns with a short outgoing leg are accepted here and are
            // reported by the final bend validation on the polyline.
            const turnLeg = (basePoint, mid, out) => {
                const ux = mid.x - basePoint.x, uy = mid.y - basePoint.y, uz = mid.z - basePoint.z;
                const vx = out.x - mid.x, vy = out.y - mid.y, vz = out.z - mid.z;
                const lenU = Math.hypot(ux, uy, uz), lenV = Math.hypot(vx, vy, vz);
                if (lenU <= 1e-9 || lenV <= 1e-9)
                    return { angle: 0, leg: lenU };
                const cosAngle = Math.min(1, Math.max(-1, (ux * vx + uy * vy + uz * vz) / (lenU * lenV)));
                const angle = Math.PI - Math.acos(cosAngle); // 0 = straight on, PI = reversal
                return { angle, leg: lenU };
            };
            if (gridParentId !== currentId && minBend > 0) {
                let cursor = currentId;
                for (let guard = 0; guard < 32; guard += 1) {
                    const parentId = cameFrom.get(cursor);
                    if (parentId === cursor)
                        break;
                    const parentPoint = worldPoint(parentId);
                    const cursorPoint = worldPoint(cursor);
                    const check = turnLeg(parentPoint, cursorPoint, candidatePoint);
                    if (check.angle > 1e-6)
                        break; // this is the run start
                    cursor = parentId;
                }
                const basePoint = worldPoint(cursor);
                const { angle, leg } = turnLeg(basePoint, currentPoint, candidatePoint);
                if (angle > 1e-6 && leg + 1e-6 < minBend * Math.tan(angle / 2))
                    return;
            }
            // Theta* line-of-sight update against the visible (jump) parent.
            const jumpId = jump.get(currentId);
            const jumpPoint = worldPoint(jumpId);
            let nextG;
            let nextJump;
            const segmentCost = (from, to) => {
                const span = pointDistance(from, to);
                if (span <= 1e-9)
                    return 0;
                if (!costModifier)
                    return span;
                let total = 0;
                const samples = 3;
                for (let s = 1; s <= samples; s += 1) {
                    const t = s / samples;
                    const sample = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
                    const id = volumeVoxelIndex(activeVolume, sample);
                    total += Math.max(0.1, costModifier(id >= 0 ? id : neighborId));
                }
                return (span / samples) * total;
            };
            if (jumpId === currentId || volumeLineOfSight(activeVolume, jumpPoint, candidatePoint)) {
                nextG = g.get(jumpId) + segmentCost(jumpPoint, candidatePoint);
                nextJump = jumpId;
            }
            else {
                nextG = currentG + segmentCost(currentPoint, candidatePoint);
                nextJump = currentId;
            }
            const tentativeG = nextG;
            const previous = g.get(neighborId);
            if (previous === undefined || tentativeG < previous) {
                g.set(neighborId, tentativeG);
                cameFrom.set(neighborId, currentId);
                jump.set(neighborId, nextJump);
                heap.push(neighborId);
            }
        };
        for (const [ox, oy, oz] of FACE_OFFSETS)
            tryNeighbor(ox, oy, oz, false);
        for (const [ox, oy, oz] of DIAGONAL_OFFSETS)
            tryNeighbor(ox, oy, oz, true);
    }
    if (!reached)
        return { success: false, controlPoints: cable.controlPoints, expansions, pathVoxels: [], bendValid: false, reason: 'search-limit' };
    // Reconstruct via the jump chain (line-of-sight reduction), including
    // every grid parent so the reported voxel occupancy is continuous.
    const jumpChain = [goalId];
    let cursor = goalId;
    let guard = 0;
    while (cursor !== startId && guard < 200_000) {
        cursor = jump.get(cursor) ?? startId;
        if (cursor === undefined)
            return { success: false, controlPoints: cable.controlPoints, expansions, pathVoxels: [], bendValid: false, reason: 'search-limit' };
        jumpChain.push(cursor);
        guard += 1;
    }
    jumpChain.reverse(); // [startId, ..., goalId]
    const pathVoxels = [startId];
    for (let index = 1; index < jumpChain.length; index += 1) {
        let gridCursor = jumpChain[index];
        while (gridCursor !== jumpChain[index - 1] && guard < 400_000) {
            pathVoxels.push(gridCursor);
            gridCursor = cameFrom.get(gridCursor) ?? gridCursor;
            if (cameFrom.get(gridCursor) === gridCursor)
                break;
            guard += 1;
        }
    }
    let controlPoints = jumpChain.map((id) => worldPoint(id));
    controlPoints = removeCollinear(controlPoints);
    // Fillet tight corners to satisfy the minimum bend radius; if a fillet arc
    // would leave the keep-out volume, keep the raw polyline instead.
    const filleted = filletSpatialCorners(controlPoints, minBend);
    const filletClear = filleted.every((sample) => volumeIsFree(activeVolume, sample));
    if (filletClear && filleted.length >= 2)
        controlPoints = filleted;
    const bendValid = circumradiusMinimum(controlPoints) >= minBend - 1e-6;
    return { success: true, controlPoints, expansions, pathVoxels, bendValid };
}
function circumradiusMinimum(points) {
    let minimum = Number.POSITIVE_INFINITY;
    for (let index = 1; index < points.length - 1; index += 1) {
        minimum = Math.min(minimum, circumradius(points[index - 1], points[index], points[index + 1]));
    }
    return minimum;
}
/**
 * Replaces every corner whose three-point circumradius is below the minimum
 * bend radius with a tangent-arc fillet (tangent points + arc midpoint).
 * This is the standard two-tangent fillet: for a turn of angle θ the tangent
 * distance is t = R * tan(θ/2); the fillet circle of radius R has its center
 * on the turn bisector at B + w * R / sin(θ/2), and the arc midpoint is the
 * point of the circle nearest to B. When the available leg length is too
 * short for the full radius, the fillet radius is scaled down (the corner
 * then remains reported as a violation by the analysis).
 */
export function filletSpatialCorners(points, minimumBendRadiusMm) {
    if (points.length < 3 || minimumBendRadiusMm <= 0)
        return points.map((p) => ({ ...p }));
    const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
    const out = [{ ...points[0] }];
    for (let index = 1; index < points.length - 1; index += 1) {
        const A = points[index - 1];
        const B = points[index];
        const C = points[index + 1];
        const u = sub(B, A);
        const v = sub(C, B);
        const lenU = Math.hypot(u.x, u.y, u.z);
        const lenV = Math.hypot(v.x, v.y, v.z);
        if (lenU <= 1e-9 || lenV <= 1e-9) {
            out.push({ ...B });
            continue;
        }
        const cos = Math.min(1, Math.max(-1, (u.x * v.x + u.y * v.y + u.z * v.z) / (lenU * lenV)));
        const angle = Math.PI - Math.acos(cos); // 0 = straight on
        if (angle < 1e-3) {
            out.push({ ...B });
            continue;
        }
        const radius = circumradius(A, B, C);
        if (radius + 1e-6 >= minimumBendRadiusMm) {
            out.push({ ...B });
            continue;
        }
        const tangent = Math.min(minimumBendRadiusMm * Math.tan(angle / 2), Math.min(lenU, lenV) * 0.5);
        if (tangent < 1e-6) {
            out.push({ ...B });
            continue;
        }
        const filletRadius = tangent / Math.tan(angle / 2);
        const uUnit = { x: u.x / lenU, y: u.y / lenU, z: u.z / lenU };
        const vUnit = { x: v.x / lenV, y: v.y / lenV, z: v.z / lenV };
        const t1 = { x: B.x - uUnit.x * tangent, y: B.y - uUnit.y * tangent, z: B.z - uUnit.z * tangent };
        const t2 = { x: B.x + vUnit.x * tangent, y: B.y + vUnit.y * tangent, z: B.z + vUnit.z * tangent };
        // Turn-bisector direction from B into the turn (between B→A and B→C).
        let wx = -uUnit.x + vUnit.x;
        let wy = -uUnit.y + vUnit.y;
        let wz = -uUnit.z + vUnit.z;
        const wLen = Math.hypot(wx, wy, wz);
        if (wLen <= 1e-9) {
            out.push({ ...B });
            continue;
        }
        wx /= wLen;
        wy /= wLen;
        wz /= wLen;
        const centerDist = filletRadius / Math.sin(angle / 2);
        const center = { x: B.x + wx * centerDist, y: B.y + wy * centerDist, z: B.z + wz * centerDist };
        const bx = B.x - center.x, by = B.y - center.y, bz = B.z - center.z;
        const bDist = Math.hypot(bx, by, bz);
        const mid = {
            x: center.x + (bx / bDist) * filletRadius,
            y: center.y + (by / bDist) * filletRadius,
            z: center.z + (bz / bDist) * filletRadius,
        };
        out.push(t1, mid, t2);
    }
    out.push({ ...points[points.length - 1] });
    return out;
}
function removeCollinear(points) {
    if (points.length <= 2)
        return points;
    const output = [points[0]];
    for (let index = 1; index < points.length - 1; index += 1) {
        const a = output[output.length - 1];
        const b = points[index];
        const c = points[index + 1];
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
        const cross = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        const length = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
        if (!(cross < 1e-9 * Math.max(1, length)))
            output.push(b);
    }
    output.push(points[points.length - 1]);
    return output;
}
/**
 * Catmull-Rom evaluation for an open point list. Each segment between the
 * interior control points is the uniform Catmull-Rom cubic
 *
 *   C(t) = 0.5 * [ 2p1
 *                + (p2 - p0) t
 *                + (2p0 - 5p1 + 4p2 - p3) t^2
 *                + (p3 - 3p2 + 3p1 - p0) t^3 ],  t in [0, 1]
 *
 * which interpolates p1 at t=0 and p2 at t=1, so every control point lies
 * on the curve. Endpoints are duplicated so the first/last segment has a
 * natural tangent. (Centripetal chord-length parameterization can be
 * substituted for the knot spacing if a specific spline family is required;
 * uniform spacing is sufficient for smoothing an already bend-validated
 * A* polyline.)
 */
export function sampleCatmullRom(points, samplesPerSegment) {
    if (points.length < 3)
        return points.map((p) => ({ ...p }));
    const samples = Math.max(2, Math.floor(samplesPerSegment));
    const n = points.length;
    const out = [{ ...points[0] }];
    const evalSegment = (p0, p1, p2, p3, t) => {
        const t2 = t * t, t3 = t2 * t;
        const x = 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const y = 0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        const z = 0.5 * (2 * p1.z + (p2.z - p0.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
        return { x, y, z };
    };
    for (let index = 0; index < n - 1; index += 1) {
        const p0 = points[Math.max(0, index - 1)];
        const p1 = points[index];
        const p2 = points[index + 1];
        const p3 = points[Math.min(n - 1, index + 2)];
        for (let s = 1; s <= samples; s += 1)
            out.push(evalSegment(p0, p1, p2, p3, s / samples));
    }
    return out;
}
/**
 * Smooths a route polyline with centripetal Catmull-Rom sampling and rejects
 * the smoothed result when any sample violates clearance or the minimum bend
 * radius, falling back to the input polyline (already A*-valid). Progressively
 * coarser sampling keeps the fallback close to the raw path.
 */
export function smoothSpatialPath(points, minimumBendRadiusMm, volume, options = {}) {
    const base = Math.max(2, options.samplesPerSegment ?? 6);
    for (const factor of [1, 0.66, 0.33]) {
        const candidate = sampleCatmullRom(points, Math.max(2, Math.round(base * factor)));
        const check = analyzeSpatialCable({
            id: 'smooth-check',
            wireId: 'smooth-check',
            label: '',
            diameterMm: 1,
            minimumBendRadiusMm,
            color: '#ffffff',
            controlPoints: candidate,
            lockedPointIndices: [],
            surfaceMode: 'free',
        });
        if (!check.valid)
            continue;
        if (volume) {
            let clear = true;
            for (const sample of candidate) {
                if (!volumeIsFree(volume, sample)) {
                    clear = false;
                    break;
                }
            }
            if (!clear)
                continue;
        }
        return { points: candidate, smoothed: true };
    }
    return { points: points.map((p) => ({ ...p })), smoothed: false };
}
/**
 * Routes a bundle of cables with shared-edge discounts (harness-routing
 * heuristic). Cables are routed longest-first so the trunk is established
 * early; every route gets a cost modifier that discounts voxels already
 * occupied by earlier cables. A final deterministic re-route pass lets later
 * cables join existing shared trunks (creating branch points) whenever the
 * accepted route does not add more than `acceptLengthOverhead` (default 8%)
 * to their length.
 */
export function routeSpatialBundle(cables, volume, options = {}) {
    const discount = Math.max(0, Math.min(1, options.sharedEdgeDiscount ?? 0.25));
    const acceptance = Math.max(1, options.acceptLengthOverhead ?? 1.08);
    const shared = new Map();
    const results = new Map();
    const countShared = (voxels) => {
        let sharedCount = 0;
        const seen = new Set();
        for (const voxel of voxels) {
            if (seen.has(voxel))
                continue;
            seen.add(voxel);
            if ((shared.get(voxel) ?? 0) > 0)
                sharedCount += 1;
        }
        return sharedCount;
    };
    const applyOccupancy = (voxels, delta) => {
        for (const voxel of new Set(voxels)) {
            const next = (shared.get(voxel) ?? 0) + delta;
            if (next <= 0)
                shared.delete(voxel);
            else
                shared.set(voxel, next);
        }
    };
    const costModifier = (improvement, floor) => (voxelIndex) => {
        const levels = Math.min(4, shared.get(voxelIndex) ?? 0);
        return Math.max(floor, 1 - improvement * levels);
    };
    const order = [...cables].sort((a, b) => {
        const la = analyzeSpatialCable(a).lengthMm;
        const lb = analyzeSpatialCable(b).lengthMm;
        return lb !== la ? lb - la : a.id.localeCompare(b.id);
    });
    for (const cable of order) {
        const route = routeSpatialCable(cable, volume, { ...options, costModifier: costModifier(discount, 0.2) });
        if (!route.success) {
            results.set(cable.id, {
                cableId: cable.id,
                success: false,
                controlPoints: cable.controlPoints,
                lengthMm: analyzeSpatialCable(cable).lengthMm,
                sharedVoxelCount: 0,
                pathVoxels: [],
            });
            continue;
        }
        applyOccupancy(route.pathVoxels, +1);
        results.set(cable.id, {
            cableId: cable.id,
            success: true,
            controlPoints: route.controlPoints,
            lengthMm: analyzeSpatialCable({ ...cable, controlPoints: route.controlPoints }).lengthMm,
            sharedVoxelCount: countShared(route.pathVoxels),
            pathVoxels: route.pathVoxels,
        });
    }
    // Branch-point optimization: re-route each cable (after the trunk) with a
    // stronger shared-voxel discount and accept it only when the length
    // penalty stays within the acceptance band.
    for (let index = 1; index < order.length; index += 1) {
        const cable = order[index];
        const current = results.get(cable.id);
        if (!current.success)
            continue;
        const route = routeSpatialCable(cable, volume, { ...options, costModifier: costModifier(discount * 2, 0.15) });
        if (!route.success)
            continue;
        const candidateLength = analyzeSpatialCable({ ...cable, controlPoints: route.controlPoints }).lengthMm;
        if (candidateLength > current.lengthMm * acceptance)
            continue;
        applyOccupancy(current.pathVoxels, -1);
        applyOccupancy(route.pathVoxels, +1);
        results.set(cable.id, {
            cableId: cable.id,
            success: true,
            controlPoints: route.controlPoints,
            lengthMm: candidateLength,
            sharedVoxelCount: countShared(route.pathVoxels),
            pathVoxels: route.pathVoxels,
        });
    }
    return cables.map((cable) => results.get(cable.id));
}
//# sourceMappingURL=spatial-autoroute.js.map