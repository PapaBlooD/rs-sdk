// Shared collision data loading — binary and JSON formats
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

export function unpackCoord(packed: number): { level: number; x: number; z: number } {
    return {
        z: packed & 0x3FFF,
        x: (packed >> 14) & 0x3FFF,
        level: (packed >> 28) & 0x3,
    };
}

export interface BinaryCollisionData {
    view: DataView;
    version: number;
    tileCount: number;
    zoneCount: number;
    doorCount: number;
    closeDoorCount: number;
    locGateCount: number;
    closeLocGateCount: number;
    searchableCount: number;
    closeSearchableCount: number;
    headerSize: number;
}

/** Resolve a path relative to the calling script's directory */
export function resolveBinPath(importMetaUrl: string, relPath = '../../sdk/collision-data.bin'): string {
    return resolve(dirname(new URL(importMetaUrl).pathname.replace(/^\/([A-Z]:)/, '$1')), relPath);
}

/** Load binary collision data file, parse header, return structured data + DataView */
export function loadBinary(path: string): BinaryCollisionData {
    const buf = readFileSync(path);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    // Validate magic
    if (view.getUint8(0) !== 0x43 || view.getUint8(1) !== 0x4F ||
        view.getUint8(2) !== 0x4C || view.getUint8(3) !== 0x4C) {
        throw new Error('Invalid collision binary — bad magic');
    }

    const version = view.getUint32(4, true);
    const tileCount = view.getUint32(8, true);
    const zoneCount = view.getUint32(12, true);
    const doorCount = view.getUint32(16, true);
    const closeDoorCount = version >= 2 ? view.getUint32(20, true) : 0;
    const locGateCount = version >= 3 ? view.getUint32(24, true) : 0;
    const closeLocGateCount = version >= 3 ? view.getUint32(28, true) : 0;
    const searchableCount = version >= 4 ? view.getUint32(32, true) : 0;
    const closeSearchableCount = version >= 5 ? view.getUint32(36, true) : 0;

    // Header size depends on version
    let headerSize: number;
    if (version >= 5) headerSize = 40;
    else if (version >= 4) headerSize = 36;
    else if (version >= 3) headerSize = 32;
    else if (version >= 2) headerSize = 24;
    else headerSize = 20;

    return { view, version, tileCount, zoneCount, doorCount, closeDoorCount, locGateCount, closeLocGateCount, searchableCount, closeSearchableCount, headerSize };
}

export interface JsonCollisionData {
    tiles: [number, number, number, number][];
    zones: [number, number, number][];
    doors: [number, number, number, number, number, number][];
    closeDoors: [number, number, number, number, number, number][];
    locGates: [number, number, number, number, number, number, number][];
    closeLocGates: [number, number, number, number, number, number, number][];
    searchables: [number, number, number, number, number, number, number][];
    closeSearchables: [number, number, number, number, number, number, number][];
    wallLocs?: [number, number, number, number, number, number, number, string][];
}

/** Load JSON collision data file */
export function loadJson(path: string): JsonCollisionData {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    return {
        tiles: raw.tiles ?? [],
        zones: raw.zones ?? [],
        doors: raw.doors ?? [],
        closeDoors: raw.closeDoors ?? [],
        locGates: raw.locGates ?? [],
        closeLocGates: raw.closeLocGates ?? [],
        searchables: raw.searchables ?? [],
        closeSearchables: raw.closeSearchables ?? [],
        wallLocs: raw.wallLocs,
    };
}
