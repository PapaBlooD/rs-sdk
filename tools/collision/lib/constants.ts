// Shared constants for collision overlay tools

export const OVERWORLD_BOUNDS = {
    MIN_X: 2300, MAX_X: 3600,
    MIN_Z: 2800, MAX_Z: 3600,
};

export const COLORS = {
    FLOOR:     { r: 50, g: 50, b: 55 },
    ROOF:      { r: 80, g: 30, b: 100 },
    WALL_N:    { r: 255, g: 70, b: 70 },
    WALL_E:    { r: 70, g: 255, b: 70 },
    WALL_S:    { r: 100, g: 140, b: 255 },
    WALL_W:    { r: 255, g: 255, b: 70 },
    WALL_NW:   { r: 255, g: 120, b: 50 },
    WALL_NE:   { r: 50, g: 255, b: 120 },
    WALL_SE:   { r: 120, g: 50, b: 255 },
    WALL_SW:   { r: 255, g: 180, b: 50 },
    DOOR:      { r: 255, g: 165, b: 0 },
    CLOSE_DOOR:{ r: 0, g: 220, b: 220 },
    LOC_GATE:  { r: 255, g: 50, b: 200 },
    CLOSE_LOC_GATE: { r: 200, g: 50, b: 255 },
    SEARCHABLE:{ r: 180, g: 130, b: 50 },
};

export const BG_COLOR = { r: 15, g: 15, b: 20 };
