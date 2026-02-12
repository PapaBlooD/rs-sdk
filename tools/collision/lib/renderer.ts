// Shared pixel rendering helpers for collision overlays
// Parameterized by scale, bounds offset, and pixel buffer dimensions

export interface RenderContext {
    pixels: Uint8Array;
    width: number;
    height: number;
    scale: number;
    /** X offset in pixels (for multi-section layouts) */
    xOff: number;
    /** Y offset in pixels (for multi-section layouts) */
    yOff: number;
    /** Tile coordinate bounds */
    minX: number;
    maxZ: number;
}

export function setPixel(ctx: RenderContext, px: number, py: number, r: number, g: number, b: number) {
    if (px < 0 || px >= ctx.width || py < 0 || py >= ctx.height) return;
    const idx = (py * ctx.width + px) * 3;
    ctx.pixels[idx] = r; ctx.pixels[idx + 1] = g; ctx.pixels[idx + 2] = b;
}

export function fillTile(ctx: RenderContext, tileX: number, tileZ: number, r: number, g: number, b: number, a: number) {
    const basePX = ctx.xOff + (tileX - ctx.minX) * ctx.scale;
    const basePY = ctx.yOff + ((ctx.maxZ - 1) - tileZ) * ctx.scale;
    const srcA = a / 255;
    for (let dy = 0; dy < ctx.scale; dy++) {
        for (let dx = 0; dx < ctx.scale; dx++) {
            const px = basePX + dx;
            const py = basePY + dy;
            if (px < 0 || px >= ctx.width || py < 0 || py >= ctx.height) continue;
            const idx = (py * ctx.width + px) * 3;
            ctx.pixels[idx + 0] = Math.min(255, ((r * srcA) + ctx.pixels[idx + 0] * (1 - srcA)) | 0);
            ctx.pixels[idx + 1] = Math.min(255, ((g * srcA) + ctx.pixels[idx + 1] * (1 - srcA)) | 0);
            ctx.pixels[idx + 2] = Math.min(255, ((b * srcA) + ctx.pixels[idx + 2] * (1 - srcA)) | 0);
        }
    }
}

export function drawWallEdge(ctx: RenderContext, tileX: number, tileZ: number, side: 'n' | 'e' | 's' | 'w', r: number, g: number, b: number) {
    const basePX = ctx.xOff + (tileX - ctx.minX) * ctx.scale;
    const basePY = ctx.yOff + ((ctx.maxZ - 1) - tileZ) * ctx.scale;
    const coords: [number, number][] = [];
    switch (side) {
        case 'n': for (let dx = 0; dx < ctx.scale; dx++) coords.push([basePX + dx, basePY]); break;
        case 's': for (let dx = 0; dx < ctx.scale; dx++) coords.push([basePX + dx, basePY + ctx.scale - 1]); break;
        case 'w': for (let dy = 0; dy < ctx.scale; dy++) coords.push([basePX, basePY + dy]); break;
        case 'e': for (let dy = 0; dy < ctx.scale; dy++) coords.push([basePX + ctx.scale - 1, basePY + dy]); break;
    }
    for (const [px, py] of coords) {
        if (px < 0 || px >= ctx.width || py < 0 || py >= ctx.height) continue;
        const idx = (py * ctx.width + px) * 3;
        ctx.pixels[idx] = r; ctx.pixels[idx + 1] = g; ctx.pixels[idx + 2] = b;
    }
}

/** Draw a thick wall edge (for higher-scale crops) */
export function drawWallEdgeThick(ctx: RenderContext, tileX: number, tileZ: number, side: 'n' | 'e' | 's' | 'w', r: number, g: number, b: number, thickness: number) {
    const basePX = ctx.xOff + (tileX - ctx.minX) * ctx.scale;
    const basePY = ctx.yOff + ((ctx.maxZ - 1) - tileZ) * ctx.scale;
    const coords: [number, number][] = [];
    switch (side) {
        case 'n':
            for (let t = 0; t < thickness; t++)
                for (let dx = 0; dx < ctx.scale; dx++) coords.push([basePX + dx, basePY + t]);
            break;
        case 's':
            for (let t = 0; t < thickness; t++)
                for (let dx = 0; dx < ctx.scale; dx++) coords.push([basePX + dx, basePY + ctx.scale - 1 - t]);
            break;
        case 'w':
            for (let t = 0; t < thickness; t++)
                for (let dy = 0; dy < ctx.scale; dy++) coords.push([basePX + t, basePY + dy]);
            break;
        case 'e':
            for (let t = 0; t < thickness; t++)
                for (let dy = 0; dy < ctx.scale; dy++) coords.push([basePX + ctx.scale - 1 - t, basePY + dy]);
            break;
    }
    for (const [px, py] of coords) {
        if (px < 0 || px >= ctx.width || py < 0 || py >= ctx.height) continue;
        const idx = (py * ctx.width + px) * 3;
        ctx.pixels[idx] = r; ctx.pixels[idx + 1] = g; ctx.pixels[idx + 2] = b;
    }
}

export function drawDiagonalWall(ctx: RenderContext, tileX: number, tileZ: number, corner: 'nw' | 'ne' | 'se' | 'sw', r: number, g: number, b: number) {
    const basePX = ctx.xOff + (tileX - ctx.minX) * ctx.scale;
    const basePY = ctx.yOff + ((ctx.maxZ - 1) - tileZ) * ctx.scale;
    for (let i = 0; i < ctx.scale; i++) {
        let cx: number, cy: number;
        switch (corner) {
            case 'nw': cx = basePX + i; cy = basePY + i; break;
            case 'ne': cx = basePX + ctx.scale - 1 - i; cy = basePY + i; break;
            case 'se': cx = basePX + ctx.scale - 1 - i; cy = basePY + ctx.scale - 1 - i; break;
            case 'sw': cx = basePX + i; cy = basePY + ctx.scale - 1 - i; break;
        }
        for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]] as [number, number][]) {
            const px = cx! + ox, py = cy! + oy;
            if (px >= 0 && px < ctx.width && py >= 0 && py < ctx.height) {
                const idx = (py * ctx.width + px) * 3;
                ctx.pixels[idx] = r; ctx.pixels[idx + 1] = g; ctx.pixels[idx + 2] = b;
            }
        }
    }
}

/** Initialize a pixel buffer with a solid background color */
export function createPixelBuffer(width: number, height: number, r: number, g: number, b: number): Uint8Array {
    const pixels = new Uint8Array(width * height * 3);
    for (let i = 0; i < pixels.length; i += 3) {
        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b;
    }
    return pixels;
}

/** Render all collision flags for a tile using standard colors */
export function renderTileFlags(
    ctx: RenderContext, x: number, z: number, flags: number,
    CF: { LOC: number; FLOOR: number; ROOF: number; WALL_NORTH: number; WALL_EAST: number; WALL_SOUTH: number; WALL_WEST: number; WALL_NORTH_WEST?: number; WALL_NORTH_EAST?: number; WALL_SOUTH_EAST?: number; WALL_SOUTH_WEST?: number },
    colors: typeof import('./constants').COLORS,
) {
    if (flags & (CF.LOC | CF.FLOOR)) fillTile(ctx, x, z, colors.FLOOR.r, colors.FLOOR.g, colors.FLOOR.b, 200);
    if (flags & CF.ROOF) fillTile(ctx, x, z, colors.ROOF.r, colors.ROOF.g, colors.ROOF.b, 100);
    if (flags & CF.WALL_NORTH) drawWallEdge(ctx, x, z, 'n', colors.WALL_N.r, colors.WALL_N.g, colors.WALL_N.b);
    if (flags & CF.WALL_EAST) drawWallEdge(ctx, x, z, 'e', colors.WALL_E.r, colors.WALL_E.g, colors.WALL_E.b);
    if (flags & CF.WALL_SOUTH) drawWallEdge(ctx, x, z, 's', colors.WALL_S.r, colors.WALL_S.g, colors.WALL_S.b);
    if (flags & CF.WALL_WEST) drawWallEdge(ctx, x, z, 'w', colors.WALL_W.r, colors.WALL_W.g, colors.WALL_W.b);
    if (CF.WALL_NORTH_WEST && (flags & CF.WALL_NORTH_WEST)) drawDiagonalWall(ctx, x, z, 'nw', colors.WALL_NW.r, colors.WALL_NW.g, colors.WALL_NW.b);
    if (CF.WALL_NORTH_EAST && (flags & CF.WALL_NORTH_EAST)) drawDiagonalWall(ctx, x, z, 'ne', colors.WALL_NE.r, colors.WALL_NE.g, colors.WALL_NE.b);
    if (CF.WALL_SOUTH_EAST && (flags & CF.WALL_SOUTH_EAST)) drawDiagonalWall(ctx, x, z, 'se', colors.WALL_SE.r, colors.WALL_SE.g, colors.WALL_SE.b);
    if (CF.WALL_SOUTH_WEST && (flags & CF.WALL_SOUTH_WEST)) drawDiagonalWall(ctx, x, z, 'sw', colors.WALL_SW.r, colors.WALL_SW.g, colors.WALL_SW.b);
}
