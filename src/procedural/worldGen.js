// ===============================
// World Generation — the ring's terrain field
// ===============================
// Defines the ring's terrain as a pure FUNCTION of world position, so nothing
// repeats and nothing needs storing: heightAtWorld(x, y) is the single source
// of truth, and every consumer (near-field chunks, the far-side LOD) samples
// the same function at a different resolution. That is what keeps the ground
// you walk on and the ring overhead showing the SAME world.
//
// THE SEAM PROBLEM, AND WHY THE NOISE IS 3D
//
// The ring loops every ringLength WU along Y. Sampling 2D noise over that span
// would put a hard discontinuity at the wrap point -- the terrain at +L/2 has
// nothing to do with the terrain at -L/2.
//
// Instead, the loop's Y axis is mapped to an ANGLE and traced as a CIRCLE
// through a 3D noise field:
//
//     theta = 2*PI * y / ringLength
//     nx    = cos(theta) * loopRadius
//     ny    = sin(theta) * loopRadius
//     nz    = x * crossScale        (position across the band)
//
// Going once around the loop traces a closed circle and returns to exactly
// the same noise coordinates, so the field is periodic BY CONSTRUCTION. There
// is no seam to hide and no blending required.
//
// loopRadius controls feature size around the loop: larger means the circle
// passes through more noise cells, so more distinct terrain per lap.
"use strict";

var WorldGen = (function () {

    var cfg = {
        seed:        1337,
        loopRadius:  18,     // noise-space radius of the loop circle
        crossScale:  1 / 700, // noise units per WU across the band
        octaves:     5,
        lacunarity:  2.0,
        gain:        0.5,
        maxHeight:   120,    // altitude is stored in a Uint8Array: keep under 255
        seaLevel:    26,
        ridgeMix:    0.35,   // 0 = rolling hills only, 1 = ridged mountains only
        // Measured: raw fbm3 spans only ~0.71 of its theoretical [-1,1]
        // (p1 -0.357, p99 +0.357), so terrain came out with sd 8.4 against
        // the 33.5 measured on the hand-made C21 map. This gain opens it out;
        // about 2% of samples clip, which reads as flat basins and plateaux.
        contrast:    2.6,

        // ---- Rim wall ----
        // The ring band is finite across X, but until now only the BACKDROP
        // knew that (ringWorld.js ringInsideWidth). The terrain function was
        // defined at every X, so walking west simply generated more ground
        // forever while the ring overhead correctly stopped.
        //
        // The band now ends in a wall. It blocks by SLOPE, not by height:
        // canMoveTo rejects any step steeper than MAX_SLOPE = 2, so a rise of
        // wallRise over wallRamp gives 130/40 = 3.25, comfortably past it.
        // Height alone would not be enough, and jumping cannot help -- max
        // charged jump is about 1 m.
        bandHalfWidth: 3584,   // set from ringWorld.halfWidth by configure()
        edgeWall:      true,
        wallRamp:      20,     // WU over which the wall rises -- short, so it reads as a face
        wallTop:       250,    // ABSOLUTE height of the wall top; chunk heights
                               // are Uint8, so stay under 255
        // Any height at or above this only ever occurs in the wall (terrain
        // tops out near maxHeight 120), so the colour lookup can key metal
        // off it. The LUT is indexed by HEIGHT ALONE, which is why the wall
        // has to be identifiable by height rather than by position.
        wallColorFrom: 170
    };

    var _L = 1;   // ring length in WU, set by configure()

    function configure(ringLength, overrides) {
        _L = ringLength > 0 ? ringLength : 1;
        if (overrides) for (var k in overrides) if (k in cfg) cfg[k] = overrides[k];
        NoiseGen.seed(cfg.seed);
    }

    // World position -> noise-space coordinates on the loop circle.
    function _coords(x, y) {
        var theta = (2 * Math.PI * y) / _L;
        return {
            nx: Math.cos(theta) * cfg.loopRadius,
            ny: Math.sin(theta) * cfg.loopRadius,
            nz: x * cfg.crossScale
        };
    }

    // Terrain height at a world position, in the same units as map.altitude.
    // `detail` scales the octave count down for cheap low-resolution sampling
    // (the far-side LOD), without changing the large-scale shape.
    function heightAtWorld(x, y, detail) {
        var c = _coords(x, y);
        var oct = Math.max(1, Math.round((detail === undefined ? 1 : detail) * cfg.octaves));

        var base  = NoiseGen.fbm3(c.nx, c.ny, c.nz, oct, cfg.lacunarity, cfg.gain);
        var ridge = cfg.ridgeMix > 0
            ? NoiseGen.ridged3(c.nx, c.ny, c.nz, oct, cfg.lacunarity, cfg.gain)
            : 0;

        var n = base * (1 - cfg.ridgeMix) + ridge * cfg.ridgeMix;
        n *= cfg.contrast;                                         // use the full range
        if (n < -1) n = -1; else if (n > 1) n = 1;
        var h = (n + 1) * 0.5 * cfg.maxHeight;                     // [0, maxHeight]
        if (h < cfg.seaLevel) h = cfg.seaLevel - (cfg.seaLevel - h) * 0.25;  // flatten basins

        // Rim wall: the band has edges, so the ground has to stop being
        // walkable at them. Smoothstepped so the join reads as terrain
        // rising into a lip rather than a step.
        if (cfg.edgeWall) {
            var ax = Math.abs(x);
            var inner = cfg.bandHalfWidth - cfg.wallRamp;
            if (ax > inner) {
                var t = (ax - inner) / cfg.wallRamp;
                if (t > 1) t = 1;
                t = t * t * (3 - 2 * t);
                // Lerp toward an ABSOLUTE top rather than adding to the local
                // ground: adding inherited the terrain's variation and left
                // the wall top rolling by ~20 WU instead of flat.
                h = h + (cfg.wallTop - h) * t;
            }
        }
        return h;
    }

    // True where the player can actually stand -- inside the rim wall.
    function insideBand(x) {
        return Math.abs(x) <= cfg.bandHalfWidth - cfg.wallRamp;
    }

    // Packed ABGR colour for a height, banded like a heightmap legend.
    function colorForHeight(h) {
        var s = cfg.seaLevel, mx = cfg.maxHeight;
        var r, g, b;

        // Rim wall: flat brushed metal, so the band edge reads as structure
        // rather than as a very tall mountain.
        if (cfg.edgeWall && h >= cfg.wallColorFrom) {
            var band = Math.floor(h) % 3;            // faint vertical banding
            var v = 138 + band * 6;
            return (0xFF000000 | (v << 16) | (v << 8) | v) >>> 0;
        }

        if (h <= s + 1)            { r = 38;  g = 78;  b = 120; }  // water
        else if (h < s + 10)       { r = 186; g = 176; b = 128; }  // sand
        else if (h < mx * 0.45)    { r = 62;  g = 104; b = 52;  }  // grass
        else if (h < mx * 0.68)    { r = 92;  g = 108; b = 74;  }  // scrub
        else if (h < mx * 0.86)    { r = 120; g = 116; b = 108; }  // rock
        else                       { r = 226; g = 228; b = 232; }  // snow

        // subtle per-sample variation so large bands are not flat
        var v = ((h * 7919) % 11) - 5;
        r = Math.max(0, Math.min(255, r + v));
        g = Math.max(0, Math.min(255, g + v));
        b = Math.max(0, Math.min(255, b + v));
        return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
    }

    return {
        configure:      configure,
        insideBand:     insideBand,
        heightAtWorld:  heightAtWorld,
        colorForHeight: colorForHeight,
        config:         cfg
    };

})();
