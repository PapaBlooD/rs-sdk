// Local pathfinding using bundled collision data
import * as rsmod from '../server/vendor/rsmod-pathfinder';
import { CollisionType, CollisionFlag } from '../server/vendor/rsmod-pathfinder';
import collisionData from './collision-data.json';

let initialized = false;

interface CollisionData {
    tiles: Array<[number, number, number, number]>;
    zones: Array<[number, number, number]>;
    doors?: Array<[number, number, number, number, number, number]>; // [level, x, z, shape, angle, blockrange]
    closeDoors?: Array<[number, number, number, number, number, number]>;
    locGates?: Array<[number, number, number, number, number, number, number]>; // [level, x, z, width, length, angle, blockrange]
    closeLocGates?: Array<[number, number, number, number, number, number, number]>;
}

export interface DoorInfo {
    level: number;
    x: number;
    z: number;
    shape: number;
    angle: number;
    blockrange: boolean;
}

export interface LocGateInfo {
    level: number;
    x: number;
    z: number;
    width: number;
    length: number;
    angle: number;
    blockrange: boolean;
}

// Spatial index of all known door positions, keyed by "level,x,z"
const doorIndex = new Map<string, DoorInfo>();

// Spatial index of multi-tile openable locs (centrepiece gates), keyed by anchor "level,x,z"
const locGateIndex = new Map<string, LocGateInfo>();
// Reverse index: every occupied tile "level,x,z" → gate anchor key "level,x,z"
const locGateTileIndex = new Map<string, string>();

// Zones that have at least one collision tile — zones with zero collision data
// are likely open ocean/void and should not be treated as walkable land.
const populatedZones = new Set<string>();

// One-way doors that should NOT be unmasked in the door index.
// These doors can only be opened from one side; routing through them traps the bot.
const ONE_WAY_DOORS = new Set<string>([
    '0,3108,3353', // Draynor Manor front door (west tile) — only opens from outside
    '0,3109,3353', // Draynor Manor front door (east tile) — only opens from outside
]);

function doorKey(level: number, x: number, z: number): string {
    return `${level},${x},${z}`;
}

export function initPathfinding(): void {
    if (initialized) return;

    const data = collisionData as CollisionData;
    const start = Date.now();

    // Allocate all zones first (includes walkable areas with no collision tiles)
    for (const [level, zoneX, zoneZ] of data.zones) {
        rsmod.allocateIfAbsent(zoneX, zoneZ, level);
    }

    // Allocate mainland zones so the 2048x2048 BFS grid can traverse
    // open land between cities. Unallocated zones return NULL (blocked),
    // so without this the pathfinder can't cross gaps in the collision data.
    // Newly-allocated zones default to OPEN (walkable), which is correct
    // for grassland/roads. Zones already allocated above keep their flags.
    let mainlandZones = 0;
    for (let x = 2304; x <= 3392; x += 8) {
        for (let z = 2944; z <= 3584; z += 8) {
            if (!rsmod.isZoneAllocated(x, z, 0)) {
                rsmod.allocateIfAbsent(x, z, 0);
                mainlandZones++;
            }
        }
    }

    // Set collision flags for tiles that have them (includes wall flags)
    for (const [level, x, z, flags] of data.tiles) {
        rsmod.__set(x, z, level, flags);
        // Track which zones have at least one collision tile (likely land, not ocean)
        populatedZones.add(`${level},${x & ~7},${z & ~7}`);
    }

    // Remove wall collision at door/gate positions so the pathfinder
    // routes through doorways while still respecting permanent walls.
    // Uses rsmod.changeWall(add=false) — the same method the server uses
    // when doors are opened at runtime.
    let doorCount = 0;
    let skippedOneWay = 0;
    if (data.doors) {
        for (const [level, x, z, shape, angle, blockrange] of data.doors) {
            const key = doorKey(level, x, z);

            // Skip one-way doors — keep their wall collision so the pathfinder
            // won't route through them (entering traps the bot).
            if (ONE_WAY_DOORS.has(key)) {
                skippedOneWay++;
                continue;
            }

            rsmod.changeWall(x, z, level, angle, shape, !!blockrange, false, false);
            doorIndex.set(key, {
                level, x, z, shape, angle, blockrange: !!blockrange
            });
            doorCount++;
        }
    }

    // Add wall collision for default-open doors (closeDoors).
    // These doors have no wall collision in the static map data because they
    // spawn open. We add walls so the pathfinder treats them as closed,
    // preventing routes through doorways that may be closed at runtime.
    let closeDoorsAdded = 0;
    if (data.closeDoors) {
        for (const [level, x, z, shape, angle, blockrange] of data.closeDoors) {
            rsmod.changeWall(x, z, level, angle, shape, !!blockrange, false, true);
            rsmod.changeWall(x, z, level, angle, shape, !!blockrange, false, false);
            const key = doorKey(level, x, z);
            doorIndex.set(key, {
                level, x, z, shape, angle, blockrange: !!blockrange
            });
            closeDoorsAdded++;
        }
    }

    // Loc gates: multi-tile openable locs (centrepiece gates like Tree Gnome Stronghold).
    // These use LOC collision (flag 256) over a width×length area, not wall collision.
    // Unmask using changeLoc with rotation-aware dimensions.
    let locGatesMasked = 0;
    if (data.locGates) {
        for (const [level, x, z, width, length, gateAngle, blockrange] of data.locGates) {
            const key = doorKey(level, x, z);

            // Rotation: angle NORTH(1) or SOUTH(3) swaps width/length
            // (matches GameMap.changeLocCollision logic)
            const rw = (gateAngle === 1 || gateAngle === 3) ? length : width;
            const rl = (gateAngle === 1 || gateAngle === 3) ? width : length;

            // Remove LOC collision over the multi-tile area
            rsmod.changeLoc(x, z, level, rw, rl, !!blockrange, false, false);

            const info: LocGateInfo = { level, x, z, width, length, angle: gateAngle, blockrange: !!blockrange };
            locGateIndex.set(key, info);

            // Populate tile index for all occupied tiles
            for (let dx = 0; dx < rw; dx++) {
                for (let dz = 0; dz < rl; dz++) {
                    locGateTileIndex.set(doorKey(level, x + dx, z + dz), key);
                }
            }
            locGatesMasked++;
        }
    }

    // Close loc gates: default-open multi-tile locs — add then unmask
    let closeLocGatesAdded = 0;
    if (data.closeLocGates) {
        for (const [level, x, z, width, length, gateAngle, blockrange] of data.closeLocGates) {
            const rw = (gateAngle === 1 || gateAngle === 3) ? length : width;
            const rl = (gateAngle === 1 || gateAngle === 3) ? width : length;

            rsmod.changeLoc(x, z, level, rw, rl, !!blockrange, false, true);
            rsmod.changeLoc(x, z, level, rw, rl, !!blockrange, false, false);

            const key = doorKey(level, x, z);
            const info: LocGateInfo = { level, x, z, width, length, angle: gateAngle, blockrange: !!blockrange };
            locGateIndex.set(key, info);

            for (let dx = 0; dx < rw; dx++) {
                for (let dz = 0; dz < rl; dz++) {
                    locGateTileIndex.set(doorKey(level, x + dx, z + dz), key);
                }
            }
            closeLocGatesAdded++;
        }
    }

    initialized = true;
    console.log(`Pathfinding initialized in ${Date.now() - start}ms (${data.zones.length} zones + ${mainlandZones} mainland fill, ${data.tiles.length} tiles, ${doorCount} doors masked, ${skippedOneWay} one-way doors blocked, ${closeDoorsAdded} close-doors walled, ${locGatesMasked} loc gates masked, ${closeLocGatesAdded} close-loc-gates)`);
}

// Check if a zone has collision data
export function isZoneAllocated(level: number, x: number, z: number): boolean {
    if (!initialized) {
        initPathfinding();
    }
    return rsmod.isZoneAllocated(x, z, level);
}

// Find long-distance path (2048x2048 search grid, ±1024 tile reach)
export function findLongPath(
    level: number,
    srcX: number,
    srcZ: number,
    destX: number,
    destZ: number,
    maxWaypoints: number = 500
): Array<{ x: number; z: number; level: number }> {
    if (!initialized) {
        initPathfinding();
    }

    const waypointsRaw = rsmod.findLongPath(
        level, srcX, srcZ, destX, destZ,
        1, 1, 1, 0, -1, true, 0, maxWaypoints, CollisionType.NORMAL
    );

    return unpackWaypoints(waypointsRaw);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Check if a tile is walkable (no blocking flags). */
export function isTileWalkable(level: number, x: number, z: number): boolean {
    if (!initialized) initPathfinding();
    return !rsmod.isFlagged(x, z, level, CollisionFlag.WALK_BLOCKED);
}

/** Check if a tile has specific collision flags set. */
export function isFlagged(x: number, z: number, level: number, masks: number): boolean {
    if (!initialized) initPathfinding();
    return rsmod.isFlagged(x, z, level, masks);
}

/**
 * Check if the zone containing (x, z) has any collision tiles.
 * Zones with zero collision data are likely open ocean/void — real walkable
 * land always has some collision data (objects, walls, floor flags nearby).
 */
export function isZoneLikelyLand(level: number, x: number, z: number): boolean {
    return populatedZones.has(`${level},${x & ~7},${z & ~7}`);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  DOOR PATH ANALYSIS — identify doors a computed path crosses through
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Given a list of waypoints, return the doors the path passes through or
 * steps adjacent to (wall collision is directional so the path may step
 * beside a door tile rather than onto it).  Results are in path order.
 */
export function findDoorsAlongPath(
    waypoints: Array<{ x: number; z: number; level: number }>
): DoorInfo[] {
    const doors: DoorInfo[] = [];
    const seen = new Set<string>();

    for (const wp of waypoints) {
        // Check the waypoint tile and its 4 cardinal neighbours
        const candidates = [
            doorKey(wp.level, wp.x, wp.z),
            doorKey(wp.level, wp.x, wp.z + 1),
            doorKey(wp.level, wp.x, wp.z - 1),
            doorKey(wp.level, wp.x + 1, wp.z),
            doorKey(wp.level, wp.x - 1, wp.z),
        ];
        for (const key of candidates) {
            if (!seen.has(key) && doorIndex.has(key)) {
                seen.add(key);
                doors.push(doorIndex.get(key)!);
            }
        }
    }

    return doors;
}

/**
 * Detect loc gates (multi-tile centrepiece locs) that a path crosses through.
 * Similar to findDoorsAlongPath but checks the locGateTileIndex.
 */
export function findLocGatesAlongPath(
    waypoints: Array<{ x: number; z: number; level: number }>
): LocGateInfo[] {
    if (waypoints.length < 2 || locGateTileIndex.size === 0) return [];

    const gates: LocGateInfo[] = [];
    const seen = new Set<string>();

    for (const wp of waypoints) {
        // Check if this tile is part of a loc gate
        const anchorKey = locGateTileIndex.get(doorKey(wp.level, wp.x, wp.z));
        if (anchorKey && !seen.has(anchorKey)) {
            const gate = locGateIndex.get(anchorKey);
            if (gate) {
                seen.add(anchorKey);
                gates.push(gate);
            }
        }
    }

    return gates;
}

/** Look up a door at an exact position. */
export function getDoorAt(level: number, x: number, z: number): DoorInfo | undefined {
    return doorIndex.get(doorKey(level, x, z));
}

/**
 * Re-add wall collision for a door that couldn't be opened (e.g. locked).
 * This causes the pathfinder to route around it on subsequent queries.
 * Also removes the door from the index so findDoorsAlongPath won't return it.
 */
export function blockDoor(level: number, x: number, z: number): boolean {
    if (!initialized) initPathfinding();
    const key = doorKey(level, x, z);
    const door = doorIndex.get(key);
    if (!door) return false;
    rsmod.changeWall(x, z, level, door.angle, door.shape, door.blockrange, false, true);
    doorIndex.delete(key);
    return true;
}

/** Look up a loc gate by any tile it occupies. Returns the gate info if found. */
export function getLocGateAt(level: number, x: number, z: number): LocGateInfo | undefined {
    const anchorKey = locGateTileIndex.get(doorKey(level, x, z));
    if (!anchorKey) return undefined;
    return locGateIndex.get(anchorKey);
}

/** Re-add LOC collision for a loc gate that couldn't be opened. */
export function blockLocGate(level: number, x: number, z: number): boolean {
    if (!initialized) initPathfinding();
    const key = doorKey(level, x, z);
    const gate = locGateIndex.get(key);
    if (!gate) return false;
    const rw = (gate.angle === 1 || gate.angle === 3) ? gate.length : gate.width;
    const rl = (gate.angle === 1 || gate.angle === 3) ? gate.width : gate.length;
    rsmod.changeLoc(x, z, level, rw, rl, gate.blockrange, false, true);
    locGateIndex.delete(key);
    // Remove all tile index entries
    for (let dx = 0; dx < rw; dx++) {
        for (let dz = 0; dz < rl; dz++) {
            locGateTileIndex.delete(doorKey(level, x + dx, z + dz));
        }
    }
    return true;
}

// Unpack waypoints from rsmod format
function unpackWaypoints(waypointsRaw: Uint32Array): Array<{ x: number; z: number; level: number }> {
    const waypoints: Array<{ x: number; z: number; level: number }> = [];
    for (let i = 0; i < waypointsRaw.length; i++) {
        const packed = waypointsRaw[i]!;
        waypoints.push({
            z: packed & 0x3FFF,
            x: (packed >> 14) & 0x3FFF,
            level: (packed >> 28) & 0x3
        });
    }
    return waypoints;
}
