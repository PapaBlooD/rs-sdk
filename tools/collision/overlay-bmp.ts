#!/usr/bin/env bun
// Generates a collision overlay BMP (1x scale, overworld only, RGBA with alpha blending)
// Usage: bun tools/collision/overlay-bmp.ts
// Output: collision-overlay.bmp

import { writeFileSync } from 'fs';
import { CollisionFlag } from '../../server/vendor/rsmod-pathfinder';
import { loadBinary, unpackCoord, resolveBinPath } from './lib/collision-loader';
import { OVERWORLD_BOUNDS as B } from './lib/constants';

const WIDTH = B.MAX_X - B.MIN_X;
const HEIGHT = B.MAX_Z - B.MIN_Z;

const binPath = resolveBinPath(import.meta.url);
console.log(`Loading collision data from ${binPath}...`);
const bin = loadBinary(binPath);
console.log(`${bin.tileCount} tiles, ${bin.zoneCount} zones, ${bin.doorCount} doors`);

// RGBA pixel buffer (this tool uses alpha compositing for BMP output)
const pixels = new Uint8Array(WIDTH * HEIGHT * 4);

function setPixel(x: number, z: number, color: number[]) {
    const px = x - B.MIN_X;
    const py = (B.MAX_Z - 1) - z;
    if (px < 0 || px >= WIDTH || py < 0 || py >= HEIGHT) return;
    const idx = (py * WIDTH + px) * 4;
    const srcA = color[3] / 255;
    const dstA = pixels[idx + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA > 0) {
        pixels[idx + 0] = ((color[0] * srcA + pixels[idx + 0] * dstA * (1 - srcA)) / outA) | 0;
        pixels[idx + 1] = ((color[1] * srcA + pixels[idx + 1] * dstA * (1 - srcA)) / outA) | 0;
        pixels[idx + 2] = ((color[2] * srcA + pixels[idx + 2] * dstA * (1 - srcA)) / outA) | 0;
        pixels[idx + 3] = (outA * 255) | 0;
    }
}

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

    if (flags & (CollisionFlag.LOC | CollisionFlag.FLOOR)) setPixel(x, z, [40, 40, 40, 180]);
    if (flags & CollisionFlag.ROOF) setPixel(x, z, [128, 0, 128, 140]);
    if (flags & CollisionFlag.WALL_NORTH) setPixel(x, z, [255, 50, 50, 220]);
    if (flags & CollisionFlag.WALL_EAST) setPixel(x, z, [50, 255, 50, 220]);
    if (flags & CollisionFlag.WALL_SOUTH) setPixel(x, z, [50, 50, 255, 220]);
    if (flags & CollisionFlag.WALL_WEST) setPixel(x, z, [255, 255, 50, 220]);
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
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) setPixel(x + dx, z + dz, [255, 165, 0, 255]);
}

console.log(`Rendered ${rendered} tiles, ${doorsRendered} doors`);

// Write BMP
function writeBMP(path: string, width: number, height: number, rgba: Uint8Array) {
    const rowSize = Math.ceil(width * 3 / 4) * 4;
    const imageSize = rowSize * height;
    const fileSize = 54 + imageSize;
    const bmp = Buffer.alloc(fileSize);
    bmp.writeUInt8(0x42, 0); bmp.writeUInt8(0x4D, 1);
    bmp.writeUInt32LE(fileSize, 2); bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(width, 18); bmp.writeInt32LE(height, 22);
    bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(0, 30); bmp.writeUInt32LE(imageSize, 34);
    for (let y = 0; y < height; y++) {
        const srcRow = (height - 1 - y);
        for (let x = 0; x < width; x++) {
            const srcIdx = (srcRow * width + x) * 4;
            const dstIdx = 54 + y * rowSize + x * 3;
            const a = rgba[srcIdx + 3] / 255;
            bmp[dstIdx + 0] = (rgba[srcIdx + 2] * a) | 0;
            bmp[dstIdx + 1] = (rgba[srcIdx + 1] * a) | 0;
            bmp[dstIdx + 2] = (rgba[srcIdx + 0] * a) | 0;
        }
    }
    writeFileSync(path, bmp);
    console.log(`Written ${path} (${(bmp.length / 1024 / 1024).toFixed(2)} MB)`);
}

writeBMP('collision-overlay.bmp', WIDTH, HEIGHT, pixels);
console.log(`\nLegend: Gray=LOC/Floor, Red=Wall N, Green=Wall E, Blue=Wall S, Yellow=Wall W, Purple=Roof, Orange=Door`);
console.log(`Coords: X=[${B.MIN_X}..${B.MAX_X}], Z=[${B.MIN_Z}..${B.MAX_Z}] (level 0)`);
