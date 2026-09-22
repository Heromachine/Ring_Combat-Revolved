// ===============================
// Building Placement — deterministic siting around the ring
// ===============================
// VoxelMaster-Minimal places exactly one building at a hand-picked spot near
// its hand-tuned spawn. This world has no hand-tuned spots -- it is
// procedural and 57,344 WU around -- so siting has to be a FUNCTION of the
// seed, same as everything else in worldGen.js: same seed, same buildings,
// every time, on every client.
//
// One building per biome sector, placed near its arc midpoint. Siting only
// has to avoid WATER and the band edges -- it does NOT need to hunt for
// naturally flat ground, because chunkTerrain.js flattens a pad under every
// registered building's footprint (with an apron blending into the
// surrounding terrain) at chunk-generation time. That is also what keeps a
// building from floating or sinking relative to procedurally generated
// ground, which VoxelMaster's single hand-placed building never had to solve.
"use strict";

// Per-biome size/texture variety. Sized off the game's OWN available texture
// assets (only wall-305 and wall-266 exist), not invented per-biome art.
var BUILDING_PRESETS = [
    // Coastal Hills
    { width: 260, depth: 220, wallHeight: 85,  wallTex: 'wall-305' },
    // Plains
    { width: 340, depth: 280, wallHeight: 95,  wallTex: 'wall-266' },
    // Archipelago
    { width: 220, depth: 200, wallHeight: 80,  wallTex: 'wall-305' },
    // Wetlands
    { width: 240, depth: 200, wallHeight: 80,  wallTex: 'wall-266' },
    // Badlands
    { width: 300, depth: 260, wallHeight: 100, wallTex: 'wall-305' },
    // Highlands
    { width: 380, depth: 320, wallHeight: 110, wallTex: 'wall-266' }
];

// A first version required every footprint CORNER to clear sea level by 15
// WU -- wrong: chunkTerrain.js flattens the WHOLE footprint to the centre's
// height regardless of what the untouched corners would have been, so only
// the CENTRE needs to be safely land. Measured why 15 WU broke 4 of 6
// biomes: landGamma (chosen for "flat land over tall land", the earlier
// terrain request) packs most of a gentle biome's land within a few WU of
// sea level -- Coastal Hills had 29.3% land sitting under a +15 clearance
// and only 0.16% clearing it. A few WU is enough headroom for the flatten's
// own blend; it does not need to out-climb the biome's whole relief.
var WATER_CLEARANCE = 3;
var SEARCH_TRIES     = 3000;  // see determinism note in _findSite: this only
                               // ever runs once, at Init(), not per frame.
                               // Wetlands measured a 0.3% hit rate at this
                               // clearance; 3000 tries keeps failure below
                               // ~0.01% instead of the ~2.7% 1200 gave.


function _placerHash01(a, b, seed) {
    var h = (Math.imul(a|0, 374761393) ^ Math.imul(b|0, 2246822519) ^ Math.imul(seed|0, 2654435761)) | 0;
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) | 0;
    return ((h >>> 8) & 0xFFFFFF) / 0x1000000;
}

// A simple 3-room floor plan (the same shape VoxelMaster's single building
// used) scaled to an arbitrary size and centred at an arbitrary (cx, cy),
// instead of VoxelMaster's hardcoded absolute coordinates around one spawn.
function _floorPlan(cx, cy, width, depth) {
    var hw = width/2, hd = depth/2;
    var northDepth = depth * 0.32;          // north room's share of the depth
    var splitY = cy - hd + northDepth;      // h-wall Y: separates north room from the south two
    var doorW = Math.max(56, Math.min(90, width * 0.22));
    var vDoorH = Math.max(56, Math.min(90, (hd - northDepth) * 0.9));
    return {
        doorOffsetX: width * 0.12,          // entry door off-centre, opens into the east room
        interiorWalls: [
            { type: 'h', y: splitY, x1: cx-hw, x2: cx+hw,
              gaps: [{ x1: cx-doorW/2, x2: cx+doorW/2 }] },
            { type: 'v', x: cx, y1: splitY, y2: cy+hd,
              gaps: [{ y1: cy - vDoorH/2, y2: cy + vDoorH/2 }] }
        ]
    };
}

// Try to find a dry, in-band site within a biome's OWN sector span (loY,
// hiY), not a fixed window around its midpoint -- sectors range from ~8,100
// to ~11,500 WU wide (see worldGen.js sector-width measurements), and a
// fixed +-1,600 WU window was leaving most of a sector unsearched. Measured
// hit rates before fixing this: Wetlands (8% land, most of it shore-band)
// only clears the centre-only/3-WU-margin test 0.3% of the time -- 1,200
// tries at that rate succeeds ~97% of the time (0.997^1200), which is why
// SEARCH_TRIES is high; this runs once at Init(), not per frame, so the
// cost (a few ms across all 6 biomes) is a one-off.
//
// Only the CENTRE point needs to clear sea level: chunkTerrain.js flattens
// the entire footprint to baseZ (the centre's height) regardless of what
// the untouched corners would have been, so the corners are irrelevant to
// whether the site is viable.
function _findSite(loY, hiY, halfW, seedTag) {
    var span = hiY - loY;
    var xRange = ringWorld.halfWidth - WorldGen.config.wallRamp - halfW - 60;
    if (xRange <= 0 || span <= 0) return null;

    for (var attempt = 0; attempt < SEARCH_TRIES; attempt++) {
        var ry = _placerHash01(seedTag, attempt*2,   cfgSeed());          // [0,1)
        var rx = _placerHash01(seedTag, attempt*2+1, cfgSeed()) * 2 - 1;  // [-1,1)
        var y = loY + ry * span;
        var x = rx * xRange;

        if (!WorldGen.insideBand(x - halfW) || !WorldGen.insideBand(x + halfW)) continue;

        var h = WorldGen.heightAtWorld(x, y, 1);
        if (h < WorldGen.config.seaLevel + WATER_CLEARANCE) continue;

        return { x: x, y: y, baseZ: h };
    }
    return null;
}

function cfgSeed() { return WorldGen.config.seed; }

// Called once from main.js after WorldGen/ringWorld are configured. Clears
// any previous siting (map/seed change) and re-places one building per
// biome sector.
function placeBuildings() {
    buildings.length = 0;   // single array backs both rendering and collision
    if (typeof WorldGen === 'undefined' || typeof ringWorld === 'undefined' || !ringWorld.enabled) return;

    var n = WorldGen.biomeCount();
    for (var b = 0; b < n; b++) {
        // Arc midpoint of this biome: scan for the first/last Y (over one
        // lap) that resolves to biome b, same technique used to verify
        // sector boundaries during this session's testing.
        var L = ringWorld.ringLength, first = -1, last = -1;
        var STEPS = 400;
        for (var i = 0; i < STEPS; i++) {
            var y = (i/STEPS) * L;
            if (WorldGen.biomeIndexAt(y) === b) { if (first < 0) first = y; last = y; }
        }
        if (first < 0) continue;   // should not happen; skip defensively

        var preset = BUILDING_PRESETS[b % BUILDING_PRESETS.length];
        var site = _findSite(first, last, preset.width/2, b + 1);
        if (!site) continue;   // no dry site found near this biome; skip it

        var plan = _floorPlan(site.x, site.y, preset.width, preset.depth);
        var cfg = {
            x: site.x, y: site.y, width: preset.width, depth: preset.depth,
            wallHeight: preset.wallHeight, doorHeight: preset.wallHeight * 0.82,
            doorWidth: Math.max(56, Math.min(90, preset.width * 0.22)),
            doorOffsetX: plan.doorOffsetX, interiorWalls: plan.interiorWalls,
            baseZ: site.baseZ, biome: b,
            wallTexture:    'images/textures/' + preset.wallTex + '.png',
            ceilingTexture: 'images/textures/ceiling-100.png',
            floorTexture:   'images/textures/floor-082.png'
        };
        registerBuilding(cfg);
    }
}
