
import { buildSpatialKeepOutVolume, volumeLineOfSight, volumeIsFree, volumeVoxelIndex } from './editor-core/index.js';
const p = (x,y,z) => ({x,y,z});
const box = (x0,x1,y0,y1,z0,z1) => {
  const f=[[[p(x0,y0,z0),p(x1,y0,z0),p(x1,y0,z1)],[p(x0,y0,z0),p(x1,y0,z1),p(x0,y0,z1)]],
  [[p(x0,y1,z1),p(x1,y1,z1),p(x1,y1,z0)],[p(x0,y1,z1),p(x1,y1,z0),p(x0,y1,z0)]],
  [[p(x0,y0,z0),p(x0,y1,z0),p(x0,y1,z1)],[p(x0,y0,z0),p(x0,y1,z1),p(x0,y0,z1)]],
  [[p(x1,y1,z1),p(x1,y0,z1),p(x1,y0,z0)],[p(x1,y1,z1),p(x1,y0,z0),p(x1,y1,z0)]],
  [[p(x0,y0,z1),p(x1,y0,z1),p(x1,y1,z1)],[p(x0,y0,z1),p(x1,y1,z1),p(x0,y1,z1)]],
  [[p(x0,y1,z0),p(x1,y1,z0),p(x1,y0,z0)],[p(x0,y1,z0),p(x1,y0,z0),p(x0,y0,z0)]]];
  return f.flat().map(([a,b,c])=>({a,b,c}));
};
const vol = buildSpatialKeepOutVolume(box(60,180,10,90,-30,50), { clearanceMm:0, cellSizeMm:5 });
console.log('origin', vol.origin, 'dims', vol.nx, vol.ny, vol.nz);
// Is the box center blocked?
const c = {x:120,y:50,z:10};
console.log('center voxel', volumeVoxelIndex(vol,c), 'free?', volumeIsFree(vol,c));
// Sample points along the line
for (const x of [56,60,80,120,170,180,230]) {
  const pt = {x, y:50, z:10};
  console.log(`x=${x} voxel=${volumeVoxelIndex(vol,pt)} free=${volumeIsFree(vol,pt)}`);
}
console.log('LOS 30->230', volumeLineOfSight(vol, {x:30,y:50,z:10}, {x:230,y:50,z:10}));
