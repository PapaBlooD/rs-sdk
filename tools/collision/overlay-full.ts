#!/usr/bin/env bun
// Generates a comprehensive collision overlay PNG with multi-region rendering and legend panel
// Reads JSON collision data exported by export-collision.ts
// Usage: bun tools/collision/overlay-full.ts [json-path]
// Default: sdk/collision-data.json

import { loadJson } from './lib/collision-loader';
import { createPixelBuffer, fillTile, drawWallEdge, drawDiagonalWall, type RenderContext } from './lib/renderer';
import { COLORS as C } from './lib/constants';
import { writePNG } from './lib/png-writer';

const jsonPath = process.argv[2] || 'sdk/collision-data.json';
const pngPath = 'sdk/collision-overlay.png';

console.log(`Loading collision data from ${jsonPath}...`);
const data = loadJson(jsonPath);

const tileCount = data.tiles.length;
const doorCount = data.doors.length;
const closeDoorCount = data.closeDoors.length;
const locGateCount = data.locGates.length;
const closeLocGateCount = data.closeLocGates.length;
const searchableCount = data.searchables.length;

console.log(`Loaded ${tileCount} tiles, ${doorCount} doors, ${closeDoorCount} close-doors, ${locGateCount} loc-gates, ${closeLocGateCount} close-loc-gates, ${searchableCount} searchables`);
console.log('\nGenerating collision overlay PNG...');

// Collision flag constants (matching rsmod-pathfinder CollisionFlag)
const CF = {
    LOC: 256, FLOOR: 2097152, ROOF: -2147483648,
    WALL_NORTH: 2, WALL_EAST: 8, WALL_SOUTH: 32, WALL_WEST: 128,
    WALL_NORTH_WEST: 1, WALL_NORTH_EAST: 4, WALL_SOUTH_EAST: 16, WALL_SOUTH_WEST: 64,
};

const SCALE = 11;
const SECTION_GAP = 66;
const KEY_WIDTH = 3400;

interface MapSection { label: string; minX: number; maxX: number; minZ: number; maxZ: number; }
const sections: MapSection[] = [
    { label: 'OVERWORLD', minX: 2300, maxX: 3600, minZ: 2800, maxZ: 3600 },
    { label: 'DUNGEONS', minX: 2240, maxX: 3520, minZ: 9216, maxZ: 9984 },
    { label: 'WILDERNESS DUNGEONS', minX: 1856, maxX: 3072, minZ: 4608, maxZ: 4928 },
];

const overworldPixW = (sections[0].maxX - sections[0].minX) * SCALE;
const maxSectionPixW = Math.max(...sections.map(s => (s.maxX - s.minX) * SCALE));
const WIDTH = Math.max(overworldPixW + KEY_WIDTH, maxSectionPixW);
let totalMapHeight = 0;
const sectionOffsets: number[] = [];
for (const sec of sections) {
    sectionOffsets.push(totalMapHeight);
    totalMapHeight += (sec.maxZ - sec.minZ) * SCALE + SECTION_GAP;
}
totalMapHeight -= SECTION_GAP;
const HEIGHT = totalMapHeight;

const pixels = createPixelBuffer(WIDTH, HEIGHT, 15, 15, 20);

function setPixel(px: number, py: number, r: number, g: number, b: number) {
    if (px < 0 || px >= WIDTH || py < 0 || py >= HEIGHT) return;
    const idx = (py * WIDTH + px) * 3;
    pixels[idx] = r; pixels[idx + 1] = g; pixels[idx + 2] = b;
}

// Simple 5x7 bitmap font for legend text
const FONT: Record<string, number[]> = {
    'A': [0x7C,0x12,0x11,0x12,0x7C], 'B': [0x7F,0x49,0x49,0x49,0x36], 'C': [0x3E,0x41,0x41,0x41,0x22],
    'D': [0x7F,0x41,0x41,0x41,0x3E], 'E': [0x7F,0x49,0x49,0x49,0x41], 'F': [0x7F,0x09,0x09,0x09,0x01],
    'G': [0x3E,0x41,0x49,0x49,0x7A], 'H': [0x7F,0x08,0x08,0x08,0x7F], 'I': [0x00,0x41,0x7F,0x41,0x00],
    'J': [0x20,0x40,0x41,0x3F,0x01], 'K': [0x7F,0x08,0x14,0x22,0x41], 'L': [0x7F,0x40,0x40,0x40,0x40],
    'M': [0x7F,0x02,0x0C,0x02,0x7F], 'N': [0x7F,0x04,0x08,0x10,0x7F], 'O': [0x3E,0x41,0x41,0x41,0x3E],
    'P': [0x7F,0x09,0x09,0x09,0x06], 'R': [0x7F,0x09,0x19,0x29,0x46], 'S': [0x46,0x49,0x49,0x49,0x31],
    'T': [0x01,0x01,0x7F,0x01,0x01], 'U': [0x3F,0x40,0x40,0x40,0x3F], 'V': [0x1F,0x20,0x40,0x20,0x1F],
    'W': [0x3F,0x40,0x38,0x40,0x3F], 'X': [0x63,0x14,0x08,0x14,0x63], 'Y': [0x07,0x08,0x70,0x08,0x07],
    'Z': [0x61,0x51,0x49,0x45,0x43], ' ': [0x00,0x00,0x00,0x00,0x00], '/': [0x20,0x10,0x08,0x04,0x02],
    '-': [0x08,0x08,0x08,0x08,0x08], '=': [0x14,0x14,0x14,0x14,0x14], ':': [0x00,0x36,0x36,0x00,0x00],
    '(': [0x00,0x1C,0x22,0x41,0x00], ')': [0x00,0x41,0x22,0x1C,0x00], '.': [0x00,0x60,0x60,0x00,0x00],
    'Q': [0x3E,0x41,0x51,0x21,0x5E],
    '0': [0x3E,0x51,0x49,0x45,0x3E], '1': [0x00,0x42,0x7F,0x40,0x00], '2': [0x42,0x61,0x51,0x49,0x46],
    '3': [0x21,0x41,0x45,0x4B,0x31], '4': [0x18,0x14,0x12,0x7F,0x10], '5': [0x27,0x45,0x45,0x45,0x39],
    '6': [0x3C,0x4A,0x49,0x49,0x30], '7': [0x01,0x71,0x09,0x05,0x03], '8': [0x36,0x49,0x49,0x49,0x36],
    '9': [0x06,0x49,0x49,0x29,0x1E],
};

function drawText(text: string, startX: number, y: number, r: number, g: number, b: number) {
    let cx = startX;
    for (const ch of text.toUpperCase()) {
        const glyph = FONT[ch];
        if (!glyph) { cx += 6; continue; }
        for (let col = 0; col < 5; col++) {
            for (let row = 0; row < 7; row++) {
                if (glyph[col] & (1 << row)) setPixel(cx + col, y + row, r, g, b);
            }
        }
        cx += 6;
    }
}

function drawTextScaled(text: string, sx: number, sy: number, r: number, g: number, b: number, scale: number) {
    let cx = sx;
    for (const ch of text.toUpperCase()) {
        const glyph = FONT[ch];
        if (!glyph) { cx += 6 * scale; continue; }
        for (let col = 0; col < 5; col++) {
            for (let row = 0; row < 7; row++) {
                if (glyph[col] & (1 << row)) {
                    for (let dy = 0; dy < scale; dy++)
                        for (let dx = 0; dx < scale; dx++)
                            setPixel(cx + col * scale + dx, sy + row * scale + dy, r, g, b);
                }
            }
        }
        cx += 6 * scale;
    }
}

// Render each section
let totalTilesRendered = 0, totalDoorsRendered = 0, totalCloseDoorsRendered = 0;
let totalLocGatesRendered = 0, totalCloseLocGatesRendered = 0, totalSearchablesRendered = 0;

for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const secTileW = sec.maxX - sec.minX;
    const secTileH = sec.maxZ - sec.minZ;
    const yOff = sectionOffsets[si];
    const xOff = si === 0 ? 0 : Math.floor((WIDTH - secTileW * SCALE) / 2);

    // Section label + separator
    drawText(sec.label, xOff + 4, yOff + 4, 200, 200, 220);
    for (let x = xOff; x < xOff + secTileW * SCALE; x++) setPixel(x, yOff + 14, 40, 40, 50);
    const mapYOff = yOff + 16;

    const ctx: RenderContext = { pixels, width: WIDTH, height: HEIGHT, scale: SCALE, xOff, yOff: mapYOff, minX: sec.minX, maxZ: sec.maxZ };

    // Tiles
    let secTiles = 0;
    for (const [level, x, z, flags] of data.tiles) {
        if (level !== 0 || x < sec.minX || x >= sec.maxX || z < sec.minZ || z >= sec.maxZ) continue;
        secTiles++;
        if (flags & (CF.LOC | CF.FLOOR)) fillTile(ctx, x, z, C.FLOOR.r, C.FLOOR.g, C.FLOOR.b, 200);
        if (flags & CF.ROOF) fillTile(ctx, x, z, C.ROOF.r, C.ROOF.g, C.ROOF.b, 100);
        if (flags & CF.WALL_NORTH) drawWallEdge(ctx, x, z, 'n', C.WALL_N.r, C.WALL_N.g, C.WALL_N.b);
        if (flags & CF.WALL_EAST)  drawWallEdge(ctx, x, z, 'e', C.WALL_E.r, C.WALL_E.g, C.WALL_E.b);
        if (flags & CF.WALL_SOUTH) drawWallEdge(ctx, x, z, 's', C.WALL_S.r, C.WALL_S.g, C.WALL_S.b);
        if (flags & CF.WALL_WEST)  drawWallEdge(ctx, x, z, 'w', C.WALL_W.r, C.WALL_W.g, C.WALL_W.b);
        if (flags & CF.WALL_NORTH_WEST) drawDiagonalWall(ctx, x, z, 'nw', C.WALL_NW.r, C.WALL_NW.g, C.WALL_NW.b);
        if (flags & CF.WALL_NORTH_EAST) drawDiagonalWall(ctx, x, z, 'ne', C.WALL_NE.r, C.WALL_NE.g, C.WALL_NE.b);
        if (flags & CF.WALL_SOUTH_EAST) drawDiagonalWall(ctx, x, z, 'se', C.WALL_SE.r, C.WALL_SE.g, C.WALL_SE.b);
        if (flags & CF.WALL_SOUTH_WEST) drawDiagonalWall(ctx, x, z, 'sw', C.WALL_SW.r, C.WALL_SW.g, C.WALL_SW.b);
    }

    let secDoors = 0;
    for (const [level, x, z] of data.doors) {
        if (level !== 0 || x < sec.minX || x >= sec.maxX || z < sec.minZ || z >= sec.maxZ) continue;
        secDoors++; fillTile(ctx, x, z, C.DOOR.r, C.DOOR.g, C.DOOR.b, 255);
    }

    let secCloseDoors = 0;
    for (const [level, x, z] of data.closeDoors) {
        if (level !== 0 || x < sec.minX || x >= sec.maxX || z < sec.minZ || z >= sec.maxZ) continue;
        secCloseDoors++; fillTile(ctx, x, z, C.CLOSE_DOOR.r, C.CLOSE_DOOR.g, C.CLOSE_DOOR.b, 255);
    }

    let secLocGates = 0;
    for (const [level, x, z, width, length, angle] of data.locGates) {
        if (level !== 0) continue;
        const rw = (angle === 1 || angle === 3) ? length : width;
        const rl = (angle === 1 || angle === 3) ? width : length;
        for (let dx = 0; dx < rw; dx++) for (let dz = 0; dz < rl; dz++) {
            const tx = x + dx, tz = z + dz;
            if (tx < sec.minX || tx >= sec.maxX || tz < sec.minZ || tz >= sec.maxZ) continue;
            fillTile(ctx, tx, tz, C.LOC_GATE.r, C.LOC_GATE.g, C.LOC_GATE.b, 255);
            secLocGates++;
        }
    }

    let secCloseLocGates = 0;
    for (const [level, x, z, width, length, angle] of data.closeLocGates) {
        if (level !== 0) continue;
        const rw = (angle === 1 || angle === 3) ? length : width;
        const rl = (angle === 1 || angle === 3) ? width : length;
        for (let dx = 0; dx < rw; dx++) for (let dz = 0; dz < rl; dz++) {
            const tx = x + dx, tz = z + dz;
            if (tx < sec.minX || tx >= sec.maxX || tz < sec.minZ || tz >= sec.maxZ) continue;
            fillTile(ctx, tx, tz, C.CLOSE_LOC_GATE.r, C.CLOSE_LOC_GATE.g, C.CLOSE_LOC_GATE.b, 255);
            secCloseLocGates++;
        }
    }

    let secSearchables = 0;
    for (const [level, x, z, width, length, angle] of data.searchables) {
        if (level !== 0) continue;
        const rw = (angle === 1 || angle === 3) ? length : width;
        const rl = (angle === 1 || angle === 3) ? width : length;
        for (let dx = 0; dx < rw; dx++) for (let dz = 0; dz < rl; dz++) {
            const tx = x + dx, tz = z + dz;
            if (tx < sec.minX || tx >= sec.maxX || tz < sec.minZ || tz >= sec.maxZ) continue;
            fillTile(ctx, tx, tz, C.SEARCHABLE.r, C.SEARCHABLE.g, C.SEARCHABLE.b, 255);
            secSearchables++;
        }
    }

    totalTilesRendered += secTiles; totalDoorsRendered += secDoors; totalCloseDoorsRendered += secCloseDoors;
    totalLocGatesRendered += secLocGates; totalCloseLocGatesRendered += secCloseLocGates; totalSearchablesRendered += secSearchables;
    console.log(`  ${sec.label}: ${secTiles} tiles, ${secDoors} doors, ${secCloseDoors} close-doors, ${secLocGates} loc-gate tiles, ${secCloseLocGates} close-loc-gate tiles, ${secSearchables} searchable tiles (${secTileW}x${secTileH} tiles)`);
}

// Legend key panel (right of overworld)
const KEY_X = overworldPixW + 20;
const KEY_TOP = 30;
const FONT_SCALE = 8;
const SWATCH_SIZE = 77;
const KEY_ROW_H = 121;

function drawKeyBlock(x: number, y: number, w: number, h: number, r: number, g: number, b: number) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) setPixel(x + dx, y + dy, r, g, b);
}

function drawKeyLine(x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i++) {
        const px = Math.round(x1 + (x2 - x1) * i / steps);
        const py = Math.round(y1 + (y2 - y1) * i / steps);
        setPixel(px, py, r, g, b); setPixel(px + 1, py, r, g, b); setPixel(px, py + 1, r, g, b);
    }
}

// Vertical separator
for (let y = 0; y < (sections[0].maxZ - sections[0].minZ) * SCALE + 16; y++) {
    setPixel(KEY_X - 10, y, 40, 40, 50); setPixel(KEY_X - 9, y, 40, 40, 50);
}

drawTextScaled('LEGEND', KEY_X, KEY_TOP, 220, 220, 240, FONT_SCALE);

const keyItems: { label: string; desc?: string; draw: (x: number, y: number, s: number) => void }[] = [
    { label: 'LOC/FLOOR', draw: (x, y, s) => drawKeyBlock(x, y, s, s, C.FLOOR.r, C.FLOOR.g, C.FLOOR.b) },
    { label: 'ROOF', draw: (x, y, s) => drawKeyBlock(x, y, s, s, C.ROOF.r, C.ROOF.g, C.ROOF.b) },
    { label: 'WALL N', draw: (x, y, s) => drawKeyBlock(x, y, s, s / 3 | 0, C.WALL_N.r, C.WALL_N.g, C.WALL_N.b) },
    { label: 'WALL E', draw: (x, y, s) => drawKeyBlock(x, y, s, s / 3 | 0, C.WALL_E.r, C.WALL_E.g, C.WALL_E.b) },
    { label: 'WALL S', draw: (x, y, s) => drawKeyBlock(x, y, s, s / 3 | 0, C.WALL_S.r, C.WALL_S.g, C.WALL_S.b) },
    { label: 'WALL W', draw: (x, y, s) => drawKeyBlock(x, y, s, s / 3 | 0, C.WALL_W.r, C.WALL_W.g, C.WALL_W.b) },
    { label: 'WALL NW', draw: (x, y, s) => drawKeyLine(x, y, x + s - 1, y + s - 1, C.WALL_NW.r, C.WALL_NW.g, C.WALL_NW.b) },
    { label: 'WALL NE', draw: (x, y, s) => drawKeyLine(x + s - 1, y, x, y + s - 1, C.WALL_NE.r, C.WALL_NE.g, C.WALL_NE.b) },
    { label: 'WALL SE', draw: (x, y, s) => drawKeyLine(x + s - 1, y + s - 1, x, y, C.WALL_SE.r, C.WALL_SE.g, C.WALL_SE.b) },
    { label: 'WALL SW', draw: (x, y, s) => drawKeyLine(x, y + s - 1, x + s - 1, y, C.WALL_SW.r, C.WALL_SW.g, C.WALL_SW.b) },
    { label: 'DOOR', desc: 'CLOSED BY DEFAULT. BOT CAN OPEN', draw: (x, y, s) => drawKeyBlock(x, y, s, s, C.DOOR.r, C.DOOR.g, C.DOOR.b) },
    { label: 'CLOSE DOOR', desc: 'OPEN BY DEFAULT. BOT CAN CLOSE', draw: (x, y, s) => drawKeyBlock(x, y, s, s, C.CLOSE_DOOR.r, C.CLOSE_DOOR.g, C.CLOSE_DOOR.b) },
    { label: 'LOC GATE', desc: 'SPECIAL GATE. BOT CAN OPEN', draw: (x, y, s) => drawKeyBlock(x, y, s, s, C.LOC_GATE.r, C.LOC_GATE.g, C.LOC_GATE.b) },
    { label: 'CLOSE LOC GATE', desc: 'SPECIAL GATE. OPEN BY DEFAULT', draw: (x, y, s) => drawKeyBlock(x, y, s, s, C.CLOSE_LOC_GATE.r, C.CLOSE_LOC_GATE.g, C.CLOSE_LOC_GATE.b) },
    { label: 'SEARCHABLE OBJECT', desc: 'CHESTS. CUPBOARDS. CRATES. ETC', draw: (x, y, s) => drawKeyBlock(x, y, s, s, C.SEARCHABLE.r, C.SEARCHABLE.g, C.SEARCHABLE.b) },
];

const keyStartY = KEY_TOP + FONT_SCALE * 7 + 20;
for (let i = 0; i < keyItems.length; i++) {
    const itemY = keyStartY + i * KEY_ROW_H;
    keyItems[i].draw(KEY_X, itemY, SWATCH_SIZE);
    drawTextScaled(keyItems[i].label, KEY_X + SWATCH_SIZE + 16, itemY + 3, 200, 200, 210, 3);
    if (keyItems[i].desc) drawTextScaled(keyItems[i].desc!, KEY_X + SWATCH_SIZE + 16, itemY + 30, 140, 140, 150, 2);
}

// Stats at bottom of key
const statsY = keyStartY + keyItems.length * KEY_ROW_H + 20;
drawTextScaled(`${tileCount} TILES`, KEY_X, statsY, 140, 140, 160, 2);
drawTextScaled(`${doorCount} DOORS`, KEY_X, statsY + 30, 140, 140, 160, 2);
drawTextScaled(`${closeDoorCount} CLOSE DOORS`, KEY_X, statsY + 60, 140, 140, 160, 2);
drawTextScaled(`${locGateCount} LOC GATES`, KEY_X, statsY + 90, 140, 140, 160, 2);
drawTextScaled(`${closeLocGateCount} CLOSE LOC GATES`, KEY_X, statsY + 120, 140, 140, 160, 2);
drawTextScaled(`${searchableCount} SEARCHABLE OBJECTS`, KEY_X, statsY + 150, 140, 140, 160, 2);

console.log(`  Total: ${totalTilesRendered} tiles, ${totalDoorsRendered} doors, ${totalCloseDoorsRendered} close-doors, ${totalLocGatesRendered} loc-gate tiles, ${totalCloseLocGatesRendered} close-loc-gate tiles, ${totalSearchablesRendered} searchable tiles`);
writePNG(pngPath, WIDTH, HEIGHT, pixels);
