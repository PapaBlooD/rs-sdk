// Local pathfinding using bundled collision data
import * as rsmod from '../server/vendor/rsmod-pathfinder';
import { CollisionType, CollisionFlag } from '../server/vendor/rsmod-pathfinder';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

let initialized = false;

export interface DoorInfo {
    level: number;
    x: number;
    z: number;
    shape: number;
    angle: number;
    blockrange: boolean;
}

// Spatial index of all known door positions, keyed by "level,x,z"
const doorIndex = new Map<string, DoorInfo>();

// Door info for conditional doors (toll gates etc.) — stored during init
// but NOT unmasked. Used by unblockDoor() to dynamically open them.
const conditionalDoorInfo = new Map<string, DoorInfo>();

// Zones that have at least one collision tile — zones with zero collision data
// are likely open ocean/void and should not be treated as walkable land.
const populatedZones = new Set<string>();

// One-way doors that should NOT be unmasked in the door index.
// These doors can only be opened from one side; routing through them traps the bot.
const ONE_WAY_DOORS = new Set<string>([
    '0,3108,3353', // Draynor Manor front door (west tile) — only opens from outside
    '0,3109,3353', // Draynor Manor front door (east tile) — only opens from outside
]);

// Toll gates / special doors that require items or dialog to pass through.
// These are kept blocked in the pathfinder by default. Scripts can unblock
// them at runtime via unblockDoor() after satisfying the requirement.
// Map of "level,x,z" → { item, amount, description }
const CONDITIONAL_DOORS = new Map<string, { item: string; amount: number; description: string }>([
]);

function doorKey(level: number, x: number, z: number): string {
    return `${level},${x},${z}`;
}

function unpackCoord(packed: number): { level: number; x: number; z: number } {
    return {
        z: packed & 0x3FFF,
        x: (packed >> 14) & 0x3FFF,
        level: (packed >> 28) & 0x3,
    };
}

export function initPathfinding(): void {
    if (initialized) return;

    const start = Date.now();

    // Load binary collision data
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const binPath = resolve(__dirname, 'collision-data.bin');
    const buf = readFileSync(binPath);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    // Validate header
    if (view.getUint8(0) !== 0x43 || view.getUint8(1) !== 0x4F ||
        view.getUint8(2) !== 0x4C || view.getUint8(3) !== 0x4C) {
        throw new Error('Invalid collision binary: bad magic bytes');
    }
    const version = view.getUint32(4, true);
    if (version < 1 || version > 5) {
        throw new Error(`Unsupported collision binary version: ${version}`);
    }

    const tileCount = view.getUint32(8, true);
    const zoneCount = view.getUint32(12, true);
    const doorCount = view.getUint32(16, true);
    const closeDoorCount = version >= 2 ? view.getUint32(20, true) : 0;
    const locGateCount = version >= 3 ? view.getUint32(24, true) : 0;
    const closeLocGateCount = version >= 3 ? view.getUint32(28, true) : 0;
    const searchableCount = version >= 4 ? view.getUint32(32, true) : 0;
    const closeSearchableCount = version >= 5 ? view.getUint32(36, true) : 0;
    const loadMs = Date.now() - start;

    const headerSize = version >= 5 ? 40 : (version >= 4 ? 36 : (version >= 3 ? 32 : (version >= 2 ? 24 : 20)));
    const tilesEnd = headerSize + tileCount * 8;
    const zonesEnd = tilesEnd + zoneCount * 4;
    const doorsEnd = zonesEnd + doorCount * 7;
    const closeDoorsEnd = doorsEnd + closeDoorCount * 7;

    // Allocate all zones first (includes walkable areas with no collision tiles)
    let offset = tilesEnd; // zones section starts after tiles
    for (let i = 0; i < zoneCount; i++) {
        const packed = view.getUint32(offset, true);
        const { level, x, z } = unpackCoord(packed);
        rsmod.allocateIfAbsent(x, z, level);
        offset += 4;
    }

    // Set collision flags for tiles that have them (includes wall flags)
    // This must happen before mainland fill so we know which zones are real land.
    offset = headerSize; // tiles section starts after header
    for (let i = 0; i < tileCount; i++) {
        const packed = view.getUint32(offset, true);
        const flags = view.getInt32(offset + 4, true); // SIGNED — bit 31 used
        const { level, x, z } = unpackCoord(packed);
        rsmod.__set(x, z, level, flags);
        populatedZones.add(`${level},${x & ~7},${z & ~7}`);
        offset += 8;
    }

    // Allocate mainland zones so the 2048x2048 BFS grid can traverse
    // open land between cities. Unallocated zones return NULL (blocked),
    // so without this the pathfinder can't cross gaps in the collision data.
    const MAINLAND_BOUNDS = { xMin: 2304, xMax: 3392, zMin: 2944, zMax: 3584 };
    let mainlandZones = 0;
    for (let x = MAINLAND_BOUNDS.xMin; x <= MAINLAND_BOUNDS.xMax; x += 8) {
        for (let z = MAINLAND_BOUNDS.zMin; z <= MAINLAND_BOUNDS.zMax; z += 8) {
            if (!rsmod.isZoneAllocated(x, z, 0)) {
                rsmod.allocateIfAbsent(x, z, 0);
                mainlandZones++;
            }
        }
    }

    // Block void/ocean zones at the map edges. Strategy: reverse flood fill from
    // the rectangle boundary inward through non-populated zones. Populated zones
    // (which have collision data — coastlines, trees, objects) act as barriers.
    // Empty zones reachable from the boundary without crossing populated land = void.
    let voidZonesBlocked = 0;
    const voidQueue: Array<{ x: number; z: number }> = [];
    const voidVisited = new Set<string>();

    // Seed: non-populated zones on the rectangle boundary
    for (let x = MAINLAND_BOUNDS.xMin; x <= MAINLAND_BOUNDS.xMax; x += 8) {
        for (const z of [MAINLAND_BOUNDS.zMin, MAINLAND_BOUNDS.zMax]) {
            if (!populatedZones.has(`0,${x},${z}`)) {
                const k = `${x},${z}`;
                if (!voidVisited.has(k)) { voidVisited.add(k); voidQueue.push({ x, z }); }
            }
        }
    }
    for (let z = MAINLAND_BOUNDS.zMin; z <= MAINLAND_BOUNDS.zMax; z += 8) {
        for (const x of [MAINLAND_BOUNDS.xMin, MAINLAND_BOUNDS.xMax]) {
            if (!populatedZones.has(`0,${x},${z}`)) {
                const k = `${x},${z}`;
                if (!voidVisited.has(k)) { voidVisited.add(k); voidQueue.push({ x, z }); }
            }
        }
    }

    // BFS inward: expand through non-populated zones, stop at populated (real land)
    while (voidQueue.length > 0) {
        const { x: cx, z: cz } = voidQueue.shift()!;
        for (const [dx, dz] of [[8, 0], [-8, 0], [0, 8], [0, -8]] as const) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < MAINLAND_BOUNDS.xMin || nx > MAINLAND_BOUNDS.xMax ||
                nz < MAINLAND_BOUNDS.zMin || nz > MAINLAND_BOUNDS.zMax) continue;
            const nk = `${nx},${nz}`;
            if (voidVisited.has(nk)) continue;
            if (populatedZones.has(`0,${nx},${nz}`)) continue; // Real land stops void
            voidVisited.add(nk);
            voidQueue.push({ x: nx, z: nz });
        }
    }

    // Block all void zones by setting FLOOR on every tile
    for (const key of voidVisited) {
        const [vx, vz] = key.split(',').map(Number);
        for (let tx = 0; tx < 8; tx++) {
            for (let tz = 0; tz < 8; tz++) {
                rsmod.__set(vx + tx, vz + tz, 0, CollisionFlag.FLOOR);
            }
        }
        voidZonesBlocked++;
    }

    // Remove wall collision at door/gate positions so the pathfinder
    // routes through doorways while still respecting permanent walls.
    let doorsMasked = 0;
    let skippedOneWay = 0;
    offset = zonesEnd; // doors section starts after zones
    for (let i = 0; i < doorCount; i++) {
        const packed = view.getUint32(offset, true);
        const shape = view.getUint8(offset + 4);
        const angle = view.getUint8(offset + 5);
        const blockrange = view.getUint8(offset + 6);
        const { level, x, z } = unpackCoord(packed);
        offset += 7;

        const key = doorKey(level, x, z);

        // Skip one-way doors — keep their wall collision so the pathfinder
        // won't route through them (entering traps the bot).
        if (ONE_WAY_DOORS.has(key)) {
            skippedOneWay++;
            continue;
        }

        // Conditional doors (toll gates etc.) — keep wall collision but store
        // their info so they can be unblocked at runtime when requirements are met.
        if (CONDITIONAL_DOORS.has(key)) {
            conditionalDoorInfo.set(key, {
                level, x, z, shape, angle, blockrange: !!blockrange
            });
            skippedOneWay++;
            continue;
        }

        // Unmask door wall collision so pathfinder routes through doorways
        rsmod.changeWall(x, z, level, angle, shape, !!blockrange, false, false);
        doorIndex.set(key, {
            level, x, z, shape, angle, blockrange: !!blockrange
        });
        doorsMasked++;
    }

    // Add wall collision for default-open doors (closeDoors).
    // These doors have no wall collision in the static map data because they
    // spawn open. We add walls so the pathfinder treats them as closed,
    // preventing routes through doorways that may be closed at runtime.
    offset = doorsEnd;
    let closeDoorsAdded = 0;
    for (let i = 0; i < closeDoorCount; i++) {
        const packed = view.getUint32(offset, true);
        const shape = view.getUint8(offset + 4);
        const angle = view.getUint8(offset + 5);
        const blockrange = view.getUint8(offset + 6);
        const { level, x, z } = unpackCoord(packed);
        offset += 7;

        // Add wall collision (add=true) then immediately unmask it.
        // This ensures the static collision flags include the wall (for correctness)
        // but the pathfinder can still route through (same as regular doors).
        rsmod.changeWall(x, z, level, angle, shape, !!blockrange, false, true);
        rsmod.changeWall(x, z, level, angle, shape, !!blockrange, false, false);
        // Also add to doorIndex so findDoorsAlongPath detects them
        const key = doorKey(level, x, z);
        doorIndex.set(key, {
            level, x, z, shape, angle, blockrange: !!blockrange
        });
        closeDoorsAdded++;
    }

    // Skip loc gates, close loc gates, searchables, close searchables — these
    // sections exist in binary v3+ but are not used by the pathfinder yet.
    // Advance offset past them so we don't misread binary data.
    offset = closeDoorsEnd;
    offset += locGateCount * 8;        // loc gates
    offset += closeLocGateCount * 8;   // close loc gates
    offset += searchableCount * 8;     // searchables
    offset += closeSearchableCount * 8; // close searchables

    initialized = true;
    console.log(`Pathfinding initialized in ${Date.now() - start}ms (load: ${loadMs}ms) (${zoneCount} zones + ${mainlandZones} mainland fill - ${voidZonesBlocked} void blocked, ${tileCount} tiles, ${doorsMasked} doors masked, ${skippedOneWay} one-way/conditional skipped, ${closeDoorsAdded} close-doors walled)`);
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
 * For a given wall shape + angle, return which tile edges the wall blocks.
 * Edge conventions (matching rsmod):
 *   'W' = west edge of tile  (boundary between x-1 and x)
 *   'N' = north edge of tile (boundary between z and z+1)
 *   'E' = east edge of tile  (boundary between x and x+1)
 *   'S' = south edge of tile (boundary between z-1 and z)
 *   'NW','NE','SE','SW' = diagonal corners
 */
function getBlockedEdges(shape: number, angle: number): string[] {
    // Shape 0: WALL_STRAIGHT — single edge
    if (shape === 0) {
        if (angle === 0) return ['W'];
        if (angle === 1) return ['N'];
        if (angle === 2) return ['E'];
        if (angle === 3) return ['S'];
    }
    // Shape 2: WALL_L — L-shaped corner, two edges
    if (shape === 2) {
        if (angle === 0) return ['W', 'N'];
        if (angle === 1) return ['N', 'E'];
        if (angle === 2) return ['E', 'S'];
        if (angle === 3) return ['S', 'W'];
    }
    // Shape 3: WALL_SQUARE_CORNER — diagonal corner
    if (shape === 3) {
        if (angle === 0) return ['NW'];
        if (angle === 1) return ['NE'];
        if (angle === 2) return ['SE'];
        if (angle === 3) return ['SW'];
    }
    // Shape 1: WALL_DIAGONAL_CORNER — diagonal corner (rare)
    if (shape === 1) {
        if (angle === 0) return ['NW'];
        if (angle === 1) return ['NE'];
        if (angle === 2) return ['SE'];
        if (angle === 3) return ['SW'];
    }
    // Shape 9: WALL_DIAGONAL — full diagonal wall (rare, conservative fallback)
    if (shape === 9) {
        return ['N', 'S', 'E', 'W', 'NW', 'NE', 'SE', 'SW'];
    }
    // Unknown shape — conservative fallback
    return ['N', 'S', 'E', 'W'];
}

/**
 * Check if a single tile-to-tile step crosses through a door's wall.
 *
 * Wall edges sit on tile boundaries:
 *   W edge of door (dx,dz): blocks movement between (dx-1, dz) ↔ (dx, dz)
 *   E edge of door (dx,dz): blocks movement between (dx, dz) ↔ (dx+1, dz)
 *   N edge of door (dx,dz): blocks movement between (dx, dz) ↔ (dx, dz+1)
 *   S edge of door (dx,dz): blocks movement between (dx, dz-1) ↔ (dx, dz)
 *   NW corner:              blocks diagonal (dx-1, dz+1) ↔ (dx, dz) etc.
 */
function doesStepCrossDoorWall(
    fromX: number, fromZ: number,
    toX: number, toZ: number,
    door: DoorInfo
): boolean {
    const edges = getBlockedEdges(door.shape, door.angle);
    const dx = door.x;
    const dz = door.z;

    for (const edge of edges) {
        switch (edge) {
            case 'W':
                if ((fromX === dx - 1 && fromZ === dz && toX === dx && toZ === dz) ||
                    (fromX === dx && fromZ === dz && toX === dx - 1 && toZ === dz))
                    return true;
                break;
            case 'E':
                if ((fromX === dx && fromZ === dz && toX === dx + 1 && toZ === dz) ||
                    (fromX === dx + 1 && fromZ === dz && toX === dx && toZ === dz))
                    return true;
                break;
            case 'N':
                if ((fromX === dx && fromZ === dz && toX === dx && toZ === dz + 1) ||
                    (fromX === dx && fromZ === dz + 1 && toX === dx && toZ === dz))
                    return true;
                break;
            case 'S':
                if ((fromX === dx && fromZ === dz - 1 && toX === dx && toZ === dz) ||
                    (fromX === dx && fromZ === dz && toX === dx && toZ === dz - 1))
                    return true;
                break;
            case 'NW':
                if ((fromX === dx - 1 && fromZ === dz + 1 && toX === dx && toZ === dz) ||
                    (fromX === dx && fromZ === dz && toX === dx - 1 && toZ === dz + 1))
                    return true;
                break;
            case 'NE':
                if ((fromX === dx + 1 && fromZ === dz + 1 && toX === dx && toZ === dz) ||
                    (fromX === dx && fromZ === dz && toX === dx + 1 && toZ === dz + 1))
                    return true;
                break;
            case 'SE':
                if ((fromX === dx + 1 && fromZ === dz - 1 && toX === dx && toZ === dz) ||
                    (fromX === dx && fromZ === dz && toX === dx + 1 && toZ === dz - 1))
                    return true;
                break;
            case 'SW':
                if ((fromX === dx - 1 && fromZ === dz - 1 && toX === dx && toZ === dz) ||
                    (fromX === dx && fromZ === dz && toX === dx - 1 && toZ === dz - 1))
                    return true;
                break;
        }
    }
    return false;
}

/**
 * Given a list of waypoints, return the doors the path actually crosses
 * through. Uses direction-aware wall crossing detection — a door is only
 * included if the path steps across one of its wall edges.
 *
 * Waypoints are inflection points, not every tile. We interpolate every
 * tile-to-tile step between consecutive waypoints and check each step
 * against the door index for wall crossings.
 *
 * Results are in path order (first door encountered first).
 */
export function findDoorsAlongPath(
    waypoints: Array<{ x: number; z: number; level: number }>
): DoorInfo[] {
    if (waypoints.length < 2) return [];

    const doors: DoorInfo[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < waypoints.length - 1; i++) {
        const from = waypoints[i]!;
        const to = waypoints[i + 1]!;

        let cx = from.x;
        let cz = from.z;

        while (cx !== to.x || cz !== to.z) {
            const prevX = cx;
            const prevZ = cz;

            if (cx < to.x) cx++;
            else if (cx > to.x) cx--;
            if (cz < to.z) cz++;
            else if (cz > to.z) cz--;

            const isDiagonal = (prevX !== cx) && (prevZ !== cz);
            const candidateTiles: Array<{ x: number; z: number }> = [
                { x: prevX, z: prevZ },
                { x: cx, z: cz },
            ];
            if (isDiagonal) {
                candidateTiles.push(
                    { x: prevX, z: cz },
                    { x: cx, z: prevZ },
                );
            }

            for (const tile of candidateTiles) {
                const key = doorKey(from.level, tile.x, tile.z);
                if (seen.has(key) || !doorIndex.has(key)) continue;
                const door = doorIndex.get(key)!;
                if (doesStepCrossDoorWall(prevX, prevZ, cx, cz, door)) {
                    seen.add(key);
                    doors.push(door);
                }
            }
        }
    }

    return doors;
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

/**
 * Remove wall collision for a conditional door (e.g. toll gate) so the
 * pathfinder can route through it. Also adds it to the door index so
 * findDoorsAlongPath will detect it. Call this when the runtime requirement
 * is satisfied (e.g. player has 10 coins for Al Kharid toll gate).
 */
export function unblockDoor(level: number, x: number, z: number): boolean {
    if (!initialized) initPathfinding();
    const key = doorKey(level, x, z);
    const door = conditionalDoorInfo.get(key);
    if (!door) return false;
    if (doorIndex.has(key)) return true;
    rsmod.changeWall(x, z, level, door.angle, door.shape, door.blockrange, false, false);
    doorIndex.set(key, door);
    return true;
}

/**
 * Re-block a conditional door (restore wall collision).
 * Used when the runtime requirement is no longer met.
 */
export function reblockConditionalDoor(level: number, x: number, z: number): boolean {
    if (!initialized) initPathfinding();
    const key = doorKey(level, x, z);
    const door = conditionalDoorInfo.get(key);
    if (!door) return false;
    if (!doorIndex.has(key)) return true;
    rsmod.changeWall(x, z, level, door.angle, door.shape, door.blockrange, false, true);
    doorIndex.delete(key);
    return true;
}

/**
 * Get all conditional doors and their requirements.
 * Used by walkTo to check inventory before pathfinding.
 */
export function getConditionalDoors(): Map<string, { item: string; amount: number; description: string }> {
    return CONDITIONAL_DOORS;
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
