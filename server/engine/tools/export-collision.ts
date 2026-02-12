#!/usr/bin/env bun
// Exports collision data from a running server
// Outputs: JSON, gzipped JSON, binary v5
// Usage: bun engine/tools/export-collision.ts [server-url]
// Default: http://localhost:8888

import fs from 'fs';

const serverUrl = process.argv[2] || 'http://localhost:8888';
const outputPath = 'sdk/collision-data.json';

console.log(`Fetching collision data from ${serverUrl}/api/exportCollision...`);

const response = await fetch(`${serverUrl}/api/exportCollision`);
if (!response.ok) {
    console.error(`Failed to fetch: ${response.status} ${response.statusText}`);
    process.exit(1);
}

const data = await response.json();
console.log(`Received ${data.tiles.length} tiles, ${data.zones.length} zones, ${data.doors?.length ?? 0} doors, ${data.closeDoors?.length ?? 0} close-doors, ${data.locGates?.length ?? 0} loc-gates, ${data.closeLocGates?.length ?? 0} close-loc-gates, ${data.searchables?.length ?? 0} searchables, ${data.closeSearchables?.length ?? 0} close-searchables, ${data.wallLocs?.length ?? 0} wall-locs`);

// Write JSON
fs.writeFileSync(outputPath, JSON.stringify(data));
const stats = fs.statSync(outputPath);
console.log(`Written to ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

// Write compressed version
const compressed = Bun.gzipSync(Buffer.from(JSON.stringify(data)));
fs.writeFileSync(`${outputPath}.gz`, compressed);
console.log(`Compressed: ${(compressed.length / 1024 / 1024).toFixed(2)} MB`);

// Write binary version (v5 — adds closeSearchables)
const binPath = 'sdk/collision-data.bin';
const tileCount = data.tiles.length;
const zoneCount = data.zones.length;
const doorCount = data.doors?.length ?? 0;
const closeDoorCount = data.closeDoors?.length ?? 0;
const locGateCount = data.locGates?.length ?? 0;
const closeLocGateCount = data.closeLocGates?.length ?? 0;
const searchableCount = data.searchables?.length ?? 0;
const closeSearchableCount = data.closeSearchables?.length ?? 0;

const headerSize = 40; // v5: added closeSearchableCount (4 bytes)
const tilesSize = tileCount * 8;
const zonesSize = zoneCount * 4;
const doorsSize = doorCount * 7;
const closeDoorsSize = closeDoorCount * 7;
const locGatesSize = locGateCount * 8;
const closeLocGatesSize = closeLocGateCount * 8;
const searchablesSize = searchableCount * 8;
const closeSearchablesSize = closeSearchableCount * 8;
const totalSize = headerSize + tilesSize + zonesSize + doorsSize + closeDoorsSize + locGatesSize + closeLocGatesSize + searchablesSize + closeSearchablesSize;

const buffer = new ArrayBuffer(totalSize);
const view = new DataView(buffer);

function packCoord(level: number, x: number, z: number): number {
    return (z & 0x3FFF) | ((x & 0x3FFF) << 14) | ((level & 0x3) << 28);
}

// Header (v5)
view.setUint8(0, 0x43);  // 'C'
view.setUint8(1, 0x4F);  // 'O'
view.setUint8(2, 0x4C);  // 'L'
view.setUint8(3, 0x4C);  // 'L'
view.setUint32(4, 5, true);  // version 5
view.setUint32(8, tileCount, true);
view.setUint32(12, zoneCount, true);
view.setUint32(16, doorCount, true);
view.setUint32(20, closeDoorCount, true);
view.setUint32(24, locGateCount, true);
view.setUint32(28, closeLocGateCount, true);
view.setUint32(32, searchableCount, true);
view.setUint32(36, closeSearchableCount, true);

// Tiles
let offset = headerSize;
for (const [level, x, z, flags] of data.tiles) {
    view.setUint32(offset, packCoord(level, x, z), true);
    view.setInt32(offset + 4, flags, true);
    offset += 8;
}

// Zones
for (const [level, zoneX, zoneZ] of data.zones) {
    view.setUint32(offset, packCoord(level, zoneX, zoneZ), true);
    offset += 4;
}

// Doors (Open doors — wall collision will be removed)
for (const [level, x, z, shape, angle, blockrange] of data.doors ?? []) {
    view.setUint32(offset, packCoord(level, x, z), true);
    view.setUint8(offset + 4, shape);
    view.setUint8(offset + 5, angle);
    view.setUint8(offset + 6, blockrange);
    offset += 7;
}

// Close doors (default-open doors — wall collision will be added)
for (const [level, x, z, shape, angle, blockrange] of data.closeDoors ?? []) {
    view.setUint32(offset, packCoord(level, x, z), true);
    view.setUint8(offset + 4, shape);
    view.setUint8(offset + 5, angle);
    view.setUint8(offset + 6, blockrange);
    offset += 7;
}

// Loc gates (multi-tile openable locs — LOC collision will be removed)
for (const [level, x, z, width, length, angle, blockrange] of data.locGates ?? []) {
    view.setUint32(offset, packCoord(level, x, z), true);
    view.setUint8(offset + 4, width);
    view.setUint8(offset + 5, length);
    view.setUint8(offset + 6, angle);
    view.setUint8(offset + 7, blockrange);
    offset += 8;
}

// Close loc gates (default-open multi-tile locs — LOC collision will be added)
for (const [level, x, z, width, length, angle, blockrange] of data.closeLocGates ?? []) {
    view.setUint32(offset, packCoord(level, x, z), true);
    view.setUint8(offset + 4, width);
    view.setUint8(offset + 5, length);
    view.setUint8(offset + 6, angle);
    view.setUint8(offset + 7, blockrange);
    offset += 8;
}

// Searchables (cupboards, chests, drawers etc. — collision stays, used for overlay only)
for (const [level, x, z, width, length, angle, blockrange] of data.searchables ?? []) {
    view.setUint32(offset, packCoord(level, x, z), true);
    view.setUint8(offset + 4, width);
    view.setUint8(offset + 5, length);
    view.setUint8(offset + 6, angle);
    view.setUint8(offset + 7, blockrange);
    offset += 8;
}

// Close searchables (default-open searchable objects — collision stays, used for overlay only)
for (const [level, x, z, width, length, angle, blockrange] of data.closeSearchables ?? []) {
    view.setUint32(offset, packCoord(level, x, z), true);
    view.setUint8(offset + 4, width);
    view.setUint8(offset + 5, length);
    view.setUint8(offset + 6, angle);
    view.setUint8(offset + 7, blockrange);
    offset += 8;
}

fs.writeFileSync(binPath, Buffer.from(buffer));
const binStats = fs.statSync(binPath);
console.log(`Binary: ${binPath} (${(binStats.size / 1024 / 1024).toFixed(2)} MB) — ${((1 - binStats.size / stats.size) * 100).toFixed(1)}% smaller than JSON`);
