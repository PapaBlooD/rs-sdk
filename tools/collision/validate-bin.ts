#!/usr/bin/env bun
// Validates that collision-data.bin is a lossless encoding of collision-data.json
// Usage: bun tools/collision/validate-bin.ts

import fs from 'fs';
import { loadBinary, unpackCoord } from './lib/collision-loader';

const jsonPath = 'sdk/collision-data.json';
const binPath = 'sdk/collision-data.bin';

console.log('Loading JSON...');
const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

console.log('Loading binary...');
const bin = loadBinary(binPath);

console.log(`Binary header: ${bin.tileCount} tiles, ${bin.zoneCount} zones, ${bin.doorCount} doors (v${bin.version})`);
console.log(`JSON counts:   ${json.tiles.length} tiles, ${json.zones.length} zones, ${(json.doors ?? []).length} doors`);

let errors = 0;

if (bin.tileCount !== json.tiles.length) { console.error(`FAIL: Tile count mismatch (bin=${bin.tileCount}, json=${json.tiles.length})`); errors++; }
if (bin.zoneCount !== json.zones.length) { console.error(`FAIL: Zone count mismatch (bin=${bin.zoneCount}, json=${json.zones.length})`); errors++; }
if (bin.doorCount !== (json.doors ?? []).length) { console.error(`FAIL: Door count mismatch (bin=${bin.doorCount}, json=${(json.doors ?? []).length})`); errors++; }

// Validate tiles
console.log('Validating tiles...');
let offset = bin.headerSize;
for (let i = 0; i < bin.tileCount && i < json.tiles.length; i++) {
    const packed = bin.view.getUint32(offset, true);
    const flags = bin.view.getInt32(offset + 4, true);
    const { level, x, z } = unpackCoord(packed);
    const [jLevel, jX, jZ, jFlags] = json.tiles[i];
    if (level !== jLevel || x !== jX || z !== jZ || flags !== jFlags) {
        if (errors < 10) console.error(`FAIL: Tile ${i} mismatch — bin=[${level},${x},${z},${flags}] json=[${jLevel},${jX},${jZ},${jFlags}]`);
        errors++;
    }
    offset += 8;
}

// Validate zones
console.log('Validating zones...');
for (let i = 0; i < bin.zoneCount && i < json.zones.length; i++) {
    const { level, x, z } = unpackCoord(bin.view.getUint32(offset, true));
    const [jLevel, jX, jZ] = json.zones[i];
    if (level !== jLevel || x !== jX || z !== jZ) {
        if (errors < 10) console.error(`FAIL: Zone ${i} mismatch — bin=[${level},${x},${z}] json=[${jLevel},${jX},${jZ}]`);
        errors++;
    }
    offset += 4;
}

// Validate doors
console.log('Validating doors...');
const doors = json.doors ?? [];
for (let i = 0; i < bin.doorCount && i < doors.length; i++) {
    const packed = bin.view.getUint32(offset, true);
    const shape = bin.view.getUint8(offset + 4);
    const angle = bin.view.getUint8(offset + 5);
    const blockrange = bin.view.getUint8(offset + 6);
    const { level, x, z } = unpackCoord(packed);
    const [jLevel, jX, jZ, jShape, jAngle, jBlockrange] = doors[i];
    if (level !== jLevel || x !== jX || z !== jZ || shape !== jShape || angle !== jAngle || blockrange !== jBlockrange) {
        if (errors < 10) console.error(`FAIL: Door ${i} mismatch — bin=[${level},${x},${z},${shape},${angle},${blockrange}] json=[${jLevel},${jX},${jZ},${jShape},${jAngle},${jBlockrange}]`);
        errors++;
    }
    offset += 7;
}

if (errors === 0) {
    console.log(`\nPASS: Binary is a lossless encoding of JSON (${bin.tileCount} tiles, ${bin.zoneCount} zones, ${bin.doorCount} doors)`);
    console.log(`JSON: ${(fs.statSync(jsonPath).size / 1024 / 1024).toFixed(2)} MB → Binary: ${(fs.statSync(binPath).size / 1024 / 1024).toFixed(2)} MB`);
} else {
    console.error(`\nFAIL: ${errors} error(s) found`);
    process.exit(1);
}
