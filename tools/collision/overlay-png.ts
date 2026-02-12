#!/usr/bin/env bun
// Generates a collision overlay PNG from binary data (4x scale, overworld only)
// Usage: bun tools/collision/overlay-png.ts
// Output: collision-overlay-v2.png

import { CollisionFlag } from '../../server/vendor/rsmod-pathfinder';
import { loadBinary, unpackCoord, resolveBinPath } from './lib/collision-loader';
import { createPixelBuffer, fillTile, drawWallEdge, type RenderContext } from './lib/renderer';
import { OVERWORLD_BOUNDS as B, COLORS as C, BG_COLOR } from './lib/constants';
import { writePNG } from './lib/png-writer';

const SCALE = 4;
const TILE_W = B.MAX_X - B.MIN_X;
const TILE_H = B.MAX_Z - B.MIN_Z;
const WIDTH = TILE_W * SCALE;
const HEIGHT = TILE_H * SCALE;

const binPath = resolveBinPath(import.meta.url);
console.log(`Loading collision data...`);
const bin = loadBinary(binPath);
console.log(`Output: ${WIDTH}x${HEIGHT} (${SCALE}x scale)`);

const pixels = createPixelBuffer(WIDTH, HEIGHT, BG_COLOR.r, BG_COLOR.g, BG_COLOR.b);
const ctx: RenderContext = { pixels, width: WIDTH, height: HEIGHT, scale: SCALE, xOff: 0, yOff: 0, minX: B.MIN_X, maxZ: B.MAX_Z };

// Tiles
let offset = bin.headerSize;
let rendered = 0;
for (let i = 0; i < bin.tileCount; i++) {
    const packed = bin.view.getUint32(offset, true);
    const flags = bin.view.getInt32(offset + 4, true);
    offset += 8;
    const { level, x, z } = unpackCoord(packed);
    if (level !== 0 || x < B.MIN_X || x >= B.MAX_X || z < B.MIN_Z || z >= B.MAX_Z) continue;
    rendered++;
    if (flags & (CollisionFlag.LOC | CollisionFlag.FLOOR)) fillTile(ctx, x, z, C.FLOOR.r, C.FLOOR.g, C.FLOOR.b, 200);
    if (flags & CollisionFlag.ROOF) fillTile(ctx, x, z, C.ROOF.r, C.ROOF.g, C.ROOF.b, 100);
    if (flags & CollisionFlag.WALL_NORTH) drawWallEdge(ctx, x, z, 'n', C.WALL_N.r, C.WALL_N.g, C.WALL_N.b);
    if (flags & CollisionFlag.WALL_EAST)  drawWallEdge(ctx, x, z, 'e', C.WALL_E.r, C.WALL_E.g, C.WALL_E.b);
    if (flags & CollisionFlag.WALL_SOUTH) drawWallEdge(ctx, x, z, 's', C.WALL_S.r, C.WALL_S.g, C.WALL_S.b);
    if (flags & CollisionFlag.WALL_WEST)  drawWallEdge(ctx, x, z, 'w', C.WALL_W.r, C.WALL_W.g, C.WALL_W.b);
}

// Doors
const tilesEnd = bin.headerSize + bin.tileCount * 8;
const zonesEnd = tilesEnd + bin.zoneCount * 4;
offset = zonesEnd;
let doorsRendered = 0;
for (let i = 0; i < bin.doorCount; i++) {
    const { level, x, z } = unpackCoord(bin.view.getUint32(offset, true));
    offset += 7;
    if (level !== 0 || x < B.MIN_X || x >= B.MAX_X || z < B.MIN_Z || z >= B.MAX_Z) continue;
    doorsRendered++;
    fillTile(ctx, x, z, C.DOOR.r, C.DOOR.g, C.DOOR.b, 255);
}

// Close doors
offset = zonesEnd + bin.doorCount * 7;
let closeDoorsRendered = 0;
for (let i = 0; i < bin.closeDoorCount; i++) {
    const { level, x, z } = unpackCoord(bin.view.getUint32(offset, true));
    offset += 7;
    if (level !== 0 || x < B.MIN_X || x >= B.MAX_X || z < B.MIN_Z || z >= B.MAX_Z) continue;
    closeDoorsRendered++;
    fillTile(ctx, x, z, C.CLOSE_DOOR.r, C.CLOSE_DOOR.g, C.CLOSE_DOOR.b, 255);
}

console.log(`Rendered ${rendered} tiles, ${doorsRendered} doors, ${closeDoorsRendered} close-doors`);
writePNG('collision-overlay-v2.png', WIDTH, HEIGHT, pixels);

console.log(`\nLegend: Gray=LOC/Floor, Red=Wall N, Green=Wall E, Blue=Wall S, Yellow=Wall W, Purple=Roof, Orange=Door, Cyan=Close-Door`);
console.log(`Coords: X=[${B.MIN_X}..${B.MAX_X}], Z=[${B.MIN_Z}..${B.MAX_Z}] (level 0, ${SCALE}x scale)`);
