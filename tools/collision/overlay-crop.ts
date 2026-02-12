#!/usr/bin/env bun
// Generates zoomed-in crops of collision data for specific areas (8x scale)
// Usage: bun tools/collision/overlay-crop.ts
// Output: collision-crop-{name}.png

import { CollisionFlag } from '../../server/vendor/rsmod-pathfinder';
import { loadBinary, unpackCoord, resolveBinPath } from './lib/collision-loader';
import { createPixelBuffer, fillTile, drawWallEdge, drawWallEdgeThick, drawDiagonalWall, setPixel, type RenderContext } from './lib/renderer';
import { COLORS as C, BG_COLOR } from './lib/constants';
import { writePNG } from './lib/png-writer';

const binPath = resolveBinPath(import.meta.url);
const bin = loadBinary(binPath);
const SCALE = 8;

interface Region {
    name: string;
    minX: number; maxX: number;
    minZ: number; maxZ: number;
}

const regions: Region[] = [
    { name: 'lumbridge', minX: 3190, maxX: 3270, minZ: 3190, maxZ: 3270 },
    { name: 'varrock', minX: 3150, maxX: 3290, minZ: 3380, maxZ: 3510 },
    { name: 'falador', minX: 2930, maxX: 3050, minZ: 3300, maxZ: 3400 },
    { name: 'portsarim', minX: 3020, maxX: 3080, minZ: 3230, maxZ: 3280 },
];

for (const region of regions) {
    const tileW = region.maxX - region.minX;
    const tileH = region.maxZ - region.minZ;
    const width = tileW * SCALE;
    const height = tileH * SCALE;

    const pixels = createPixelBuffer(width, height, 18, 18, 24);
    const ctx: RenderContext = { pixels, width, height, scale: SCALE, xOff: 0, yOff: 0, minX: region.minX, maxZ: region.maxZ };

    // Draw grid lines (very faint)
    for (let tx = 0; tx < tileW; tx++) {
        for (let tz = 0; tz < tileH; tz++) {
            const basePX = tx * SCALE;
            const basePY = tz * SCALE;
            for (let dy = 0; dy < SCALE; dy++) {
                const px = basePX + SCALE - 1, py = basePY + dy;
                if (px < width && py < height) setPixel(ctx, px, py, 25, 25, 32);
            }
            for (let dx = 0; dx < SCALE; dx++) {
                const px = basePX + dx, py = basePY + SCALE - 1;
                if (px < width && py < height) setPixel(ctx, px, py, 25, 25, 32);
            }
        }
    }

    console.log(`\nRendering ${region.name} (${tileW}x${tileH} tiles, ${width}x${height} px)...`);
    let rendered = 0;

    let offset = bin.headerSize;
    for (let i = 0; i < bin.tileCount; i++) {
        const packed = bin.view.getUint32(offset, true);
        const flags = bin.view.getInt32(offset + 4, true);
        offset += 8;
        const { level, x, z } = unpackCoord(packed);
        if (level !== 0 || x < region.minX || x >= region.maxX || z < region.minZ || z >= region.maxZ) continue;
        rendered++;

        if (flags & (CollisionFlag.LOC | CollisionFlag.FLOOR)) fillTile(ctx, x, z, 55, 55, 65, 210);
        if (flags & CollisionFlag.ROOF) fillTile(ctx, x, z, 90, 40, 110, 90);
        // Cardinal walls (thick)
        if (flags & CollisionFlag.WALL_NORTH) drawWallEdgeThick(ctx, x, z, 'n', C.WALL_N.r, C.WALL_N.g, C.WALL_N.b, 2);
        if (flags & CollisionFlag.WALL_EAST)  drawWallEdgeThick(ctx, x, z, 'e', C.WALL_E.r, C.WALL_E.g, C.WALL_E.b, 2);
        if (flags & CollisionFlag.WALL_SOUTH) drawWallEdgeThick(ctx, x, z, 's', C.WALL_S.r, C.WALL_S.g, C.WALL_S.b, 2);
        if (flags & CollisionFlag.WALL_WEST)  drawWallEdgeThick(ctx, x, z, 'w', C.WALL_W.r, C.WALL_W.g, C.WALL_W.b, 2);
        // Diagonal walls
        if (flags & CollisionFlag.WALL_NORTH_WEST) drawDiagonalWall(ctx, x, z, 'nw', C.WALL_NW.r, C.WALL_NW.g, C.WALL_NW.b);
        if (flags & CollisionFlag.WALL_NORTH_EAST) drawDiagonalWall(ctx, x, z, 'ne', C.WALL_NE.r, C.WALL_NE.g, C.WALL_NE.b);
        if (flags & CollisionFlag.WALL_SOUTH_EAST) drawDiagonalWall(ctx, x, z, 'se', C.WALL_SE.r, C.WALL_SE.g, C.WALL_SE.b);
        if (flags & CollisionFlag.WALL_SOUTH_WEST) drawDiagonalWall(ctx, x, z, 'sw', C.WALL_SW.r, C.WALL_SW.g, C.WALL_SW.b);
    }

    // Doors
    const tilesEnd = bin.headerSize + bin.tileCount * 8;
    const zonesEnd = tilesEnd + bin.zoneCount * 4;
    offset = zonesEnd;
    let doorsRendered = 0;
    for (let i = 0; i < bin.doorCount; i++) {
        const { level, x, z } = unpackCoord(bin.view.getUint32(offset, true));
        offset += 7;
        if (level !== 0 || x < region.minX || x >= region.maxX || z < region.minZ || z >= region.maxZ) continue;
        doorsRendered++;
        fillTile(ctx, x, z, C.DOOR.r, C.DOOR.g, C.DOOR.b, 255);
    }

    // Close doors
    offset = zonesEnd + bin.doorCount * 7;
    let closeDoorsRendered = 0;
    for (let i = 0; i < bin.closeDoorCount; i++) {
        const { level, x, z } = unpackCoord(bin.view.getUint32(offset, true));
        offset += 7;
        if (level !== 0 || x < region.minX || x >= region.maxX || z < region.minZ || z >= region.maxZ) continue;
        closeDoorsRendered++;
        fillTile(ctx, x, z, C.CLOSE_DOOR.r, C.CLOSE_DOOR.g, C.CLOSE_DOOR.b, 255);
    }

    console.log(`  ${rendered} tiles, ${doorsRendered} doors, ${closeDoorsRendered} close-doors`);
    writePNG(`collision-crop-${region.name}.png`, width, height, pixels);
}

console.log(`\nLegend: Gray=LOC/Floor, Red=Wall N, Green=Wall E, Blue=Wall S, Yellow=Wall W, Purple=Roof, Orange=Door, Cyan=Close-Door`);
