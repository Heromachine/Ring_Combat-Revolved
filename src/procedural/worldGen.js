// ===============================
// World Generation — biomes on the ring
// ===============================
// Defines the ring's terrain as a pure FUNCTION of world position, so nothing
// repeats and nothing needs storing: heightAtWorld(x, y) is the single source
// of truth, and every consumer (near-field chunks, the far-side LOD, the map
// overview) samples the same function at a different resolution.
//
// THE SEAM PROBLEM, AND WHY THE NOISE IS 3D
//
// The ring loops every ringLength WU along Y. Sampling 2D noise over that span
// would put a hard discontinuity at the wrap point. Instead the loop's Y axis
// is mapped to an ANGLE and traced as a CIRCLE through a 3D noise field:
//
//     theta = 2*PI * y / ringLength
//     nx    = cos(theta) * loopRadius
//     ny    = sin(theta) * loopRadius
//     nz    = x * crossScale        (position across the band)
//
// Going once around the loop traces a closed circle and returns to exactly
// the same noise coordinates, so the field is periodic BY CONSTRUCTION.
//
// ---- BIOMES ----
//
// One noise field with one contrast/gamma setting gives one KIND of land --
// tuning it is choosing a single island's character, not a ring's. Real
// installations (this is the Halo reference: CE's ring reads as distinct
// zones -- snow peaks, a swamp, a desert canyon, forested lowlands -- crossed
// by water, not blended into each other) need several distinct terrain
// characters arranged around the loop.
//
// So the loop is cut into BIOME_DEFS.length sectors along Y, each with its
// own contrast, gamma, ridge mix, land fraction and colour palette. Sector
// order is fixed (a deliberate "journey" around the ring); the SEED still
// varies each sector's width and the shape of the terrain within it.
//
// ---- WHY BIOMES DON'T NEED TO BLEND INTO EACH OTHER ----
//
// A moat: every sector boundary forces the ground down to water within
// moatWidth of the boundary, regardless of which biome is on either side.
// That is also literally why the ring's own wrap seam (y = +-L/2, which is
// boundary[last]) is safe -- it is a moat too. Two unrelated terrain styles
// meeting at a hard style-switch would look like a seam; two terrain styles
// meeting at a strip of open water looks like a strait.
//
// ---- LAKES: CARVING DOWN, NOT JUST BEING LOW ----
//
// The land/water split above only ever comes from ONE mechanism: how much of
// the shaped noise range counts as "above the shoreline". That gives coastal
// water, but never an inland lake sitting in the middle of high ground.
// Lakes are a SECOND, independent mask (decorrelated noise coordinates) that
// carves down into whatever the primary field already decided was land, per
// biome (lakeThreshold controls how lake-prone a biome is; Wetlands is soaked
// with them, Highlands has none to speak of).
"use strict";

var WorldGen = (function () {

    // ---- Shared, structural -- not per-biome ----
    var cfg = {
        seed:        1337,
        loopRadius:  18,      // noise-space radius of the loop circle
        crossScale:  1 / 700, // noise units per WU across the band
        lacunarity:  2.0,
        gain:        0.5,
        octaves:     5,
        seaLevel:    26,

        // ---- Moat: forces water at every biome/seam boundary ----
        moatWidth:   350,     // WU each side of a boundary that is forced to water
        moatDepth:   9,       // below seaLevel at the boundary itself

        // ---- Rim wall (X-based, orthogonal to biomes/moat which are Y-based) ----
        bandHalfWidth: 3584,  // set from ringWorld.halfWidth by configure()
        edgeWall:      true,
        wallRamp:      20,
        wallTop:       250,   // absolute height of the wall top (Uint8 store, stay under 255)
        // No biome may reach this -- it is how the colour LUT tells wall
        // (structural, position-based) apart from tall terrain (biome,
        // height-based) despite the LUT only ever seeing a height. Every
        // BIOME_DEFS maxHeight below is checked against this at configure().
        wallColorFrom: 225
    };

    // ---- Per-biome character ----
    // targetLandFraction is ENFORCED per biome (see _calibrateBiome), not
    // hoped for -- a fixed contrast/gamma does not survive a chosen fraction
    // by itself, so each biome's own shoreline is calibrated by sampling.
    //
    // colors: bands over the LAND range (seaLevel..maxHeight), t = fraction
    // of that range, ascending. Water bands are shared across all biomes
    // (colorForHeight below) so moats and lakes read as "water" everywhere,
    // not as a biome-tinted puddle.
    var BIOME_DEFS = [
        {
            name: "Coastal Hills",
            targetLandFraction: 0.32, landGamma: 1.8, contrast: 2.8, ridgeMix: 0.22,
            maxHeight: 108, seaDepth: 12,
            lakeThreshold: 0.70, lakeEdge: 0.08, lakeDepth: 9,
            colors: [
                { t: 0.30, r: 150, g: 168, b: 110 },
                { t: 0.60, r: 96,  g: 126, b: 68  },
                { t: 0.85, r: 118, g: 112, b: 96  },
                { t: 1.00, r: 200, g: 198, b: 180 }
            ]
        },
        {
            name: "Plains",
            targetLandFraction: 0.40, landGamma: 2.3, contrast: 2.0, ridgeMix: 0.05,
            maxHeight: 85, seaDepth: 10,
            lakeThreshold: 0.72, lakeEdge: 0.07, lakeDepth: 8,
            colors: [
                { t: 0.35, r: 86,  g: 138, b: 58  },
                { t: 0.65, r: 104, g: 140, b: 62  },
                { t: 0.90, r: 132, g: 132, b: 90  },
                { t: 1.00, r: 180, g: 178, b: 150 }
            ]
        },
        {
            name: "Archipelago",
            targetLandFraction: 0.10, landGamma: 1.9, contrast: 3.0, ridgeMix: 0.15,
            maxHeight: 120, seaDepth: 24,
            lakeThreshold: 0.80, lakeEdge: 0.08, lakeDepth: 10,
            colors: [
                { t: 0.30, r: 214, g: 200, b: 150 },
                { t: 0.60, r: 96,  g: 140, b: 64  },
                { t: 1.00, r: 118, g: 112, b: 96  }
            ]
        },
        {
            name: "Wetlands",
            targetLandFraction: 0.14, landGamma: 2.5, contrast: 1.6, ridgeMix: 0.0,
            maxHeight: 46, seaDepth: 6,
            lakeThreshold: 0.50, lakeEdge: 0.10, lakeDepth: 5,
            colors: [
                { t: 0.40, r: 70,  g: 92,  b: 48 },
                { t: 0.75, r: 92,  g: 100, b: 56 },
                { t: 1.00, r: 120, g: 112, b: 74 }
            ]
        },
        {
            name: "Badlands",
            targetLandFraction: 0.42, landGamma: 1.6, contrast: 4.2, ridgeMix: 0.82,
            maxHeight: 165, seaDepth: 20,
            lakeThreshold: 0.88, lakeEdge: 0.05, lakeDepth: 14,
            colors: [
                { t: 0.25, r: 168, g: 112, b: 66  },
                { t: 0.55, r: 184, g: 96,  b: 56  },
                { t: 0.82, r: 150, g: 80,  b: 56  },
                { t: 1.00, r: 226, g: 196, b: 150 }
            ]
        },
        {
            name: "Highlands",
            targetLandFraction: 0.55, landGamma: 1.3, contrast: 3.6, ridgeMix: 0.55,
            maxHeight: 200, seaDepth: 16,
            lakeThreshold: 0.82, lakeEdge: 0.06, lakeDepth: 18,
            colors: [
                { t: 0.22, r: 70,  g: 96,  b: 56  },
                { t: 0.48, r: 90,  g: 92,  b: 70  },
                { t: 0.75, r: 120, g: 118, b: 112 },
                { t: 1.00, r: 238, g: 240, b: 245 }
            ]
        }
    ];

    var _L = 1;          // ring length in WU, set by configure()
    var _bounds = null;  // cumulative sector-end Y positions, in [0, _L]

    function configure(ringLength, overrides) {
        _L = ringLength > 0 ? ringLength : 1;
        if (overrides) for (var k in overrides) if (k in cfg) cfg[k] = overrides[k];
        NoiseGen.seed(cfg.seed);

        for (var b = 0; b < BIOME_DEFS.length; b++) {
            if (BIOME_DEFS[b].maxHeight >= cfg.wallColorFrom) {
                throw new Error("WorldGen: biome '" + BIOME_DEFS[b].name +
                    "' maxHeight " + BIOME_DEFS[b].maxHeight +
                    " reaches wallColorFrom " + cfg.wallColorFrom +
                    " -- it would be painted as rim wall");
            }
        }

        _computeSectors();
        for (var i = 0; i < BIOME_DEFS.length; i++) _calibrateBiome(BIOME_DEFS[i], i);
    }

    // Deterministic float in [0,1) from an integer and the seed -- same
    // imul-hash pattern as ChunkTerrain's per-texel detail, used here so
    // sector widths vary with the seed without a second RNG implementation.
    function _hash01(i) {
        var h = (Math.imul(i | 0, 374761393) ^ Math.imul(cfg.seed | 0, 2654435761)) | 0;
        h = Math.imul(h ^ (h >>> 15), 0x2545f491) | 0;
        return ((h >>> 8) & 0xFFFFFF) / 0x1000000;
    }

    // Cumulative sector-end positions in [0, _L]. Sector i occupies
    // (_bounds[i-1], _bounds[i]] (with _bounds[-1] == 0), and biome i is
    // BIOME_DEFS[i] -- fixed order, so the same ring always reads the same
    // sequence of zones; the seed only perturbs each sector's WIDTH.
    function _computeSectors() {
        var n = BIOME_DEFS.length, weights = new Array(n), total = 0;
        for (var i = 0; i < n; i++) { weights[i] = 0.7 + _hash01(i) * 0.8; total += weights[i]; }
        _bounds = new Array(n);
        var acc = 0;
        for (i = 0; i < n; i++) { acc += (weights[i] / total) * _L; _bounds[i] = acc; }
        _bounds[n - 1] = _L;   // exact, so the wrap point is unambiguous
    }

    function _sectorIndex(yy) {
        // Guard against a call before configure() has ever run -- spikeStatus
        // (the on-screen mode readout) can fire from the draw loop, and an
        // uncaught throw there kills the whole frame rather than just this
        // one line. Fall back to biome 0 until the world exists.
        if (!_bounds) return 0;
        for (var i = 0; i < _bounds.length; i++) if (yy < _bounds[i]) return i;
        return _bounds.length - 1;
    }

    function biomeIndexAt(y) {
        var yy = ((y % _L) + _L) % _L;
        return _sectorIndex(yy);
    }

    function biomeCount() { return BIOME_DEFS.length; }
    function biomeName(i) { return BIOME_DEFS[i] ? BIOME_DEFS[i].name : "?"; }

    // Wrapped distance from yy to the nearest sector boundary (which includes
    // the ring's own wrap seam, since _bounds[last] == _L == the seam).
    function _minBoundaryDist(yy) {
        var m = Infinity;
        for (var i = 0; i < _bounds.length; i++) {
            var d = Math.abs(yy - _bounds[i]);
            if (d > _L - d) d = _L - d;
            if (d < m) m = d;
        }
        return m;
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

    // Raw shaped noise in [0,1], using ONE biome's contrast/ridgeMix.
    //
    // Saturates with tanh rather than a hard clamp. This matters more than it
    // looks: a hard Math.min/max(-1,1) turns every sample whose magnitude
    // exceeds 1/contrast into an EXACTLY EQUAL value. At high contrast * high
    // ridgeMix (Badlands: 4.2 * 0.82) that plateau covered 49% of the
    // distribution -- and _calibrateBiome's target quantile landed entirely
    // inside it, so _waterU locked to exactly 1.0. That zeroed out
    // (1 - waterU) in the land-height formula below and flattened the whole
    // biome to sea level. tanh saturates smoothly instead: it approaches but
    // does not hit 1.0 for any value in this field's actual range, so there
    // is no tied plateau for the quantile to land inside, at any contrast.
    function _rawU(x, y, oct, bd) {
        var c = _coords(x, y);
        var base  = NoiseGen.fbm3(c.nx, c.ny, c.nz, oct, cfg.lacunarity, cfg.gain);
        var ridge = bd.ridgeMix > 0
            ? NoiseGen.ridged3(c.nx, c.ny, c.nz, oct, cfg.lacunarity, cfg.gain)
            : 0;
        var n = base * (1 - bd.ridgeMix) + ridge * bd.ridgeMix;
        n = Math.tanh(n * bd.contrast);
        return (n + 1) * 0.5;
    }

    // Independent large-scale mask for inland lakes. Offset well clear of the
    // elevation field's coordinate range so the two are not visibly
    // correlated (a lake sitting exactly on every ridge would look wrong).
    function _lakeMask01(x, y) {
        var c = _coords(x, y);
        var n = NoiseGen.fbm3(c.nx + 500, c.ny + 500, c.nz + 500, 3, 2.0, 0.5);
        if (n < -1) n = -1; else if (n > 1) n = 1;
        return (n + 1) * 0.5;
    }

    // Find the threshold that gives EXACTLY biome def's targetLandFraction,
    // sampled only from that biome's own sector (so the calibration matches
    // where it will actually render) using that biome's own contrast/ridge.
    function _calibrateBiome(bd, idx) {
        var lo = idx === 0 ? 0 : _bounds[idx - 1], hi = _bounds[idx];
        var span = hi - lo;
        var N = 1500, vals = new Array(N);
        for (var i = 0; i < N; i++) {
            var y = lo + span * (i / N);
            var x = ((i * 3571) % 7000) - 3500;
            vals[i] = _rawU(x, y, cfg.octaves, bd);
        }
        vals.sort(function (a, b) { return a - b; });
        var qi = Math.floor((1 - bd.targetLandFraction) * (N - 1));
        var wu = vals[qi];
        // Defence in depth alongside the tanh fix above: never let the
        // threshold sit close enough to 0 or 1 to collapse a branch's
        // normalisation denominator, whatever future contrast/ridgeMix/
        // targetLandFraction combination gets tried.
        if (wu > 0.98) wu = 0.98; else if (wu < 0.02) wu = 0.02;
        bd._waterU = wu;
    }

    // Terrain height at a world position, in the same units as map.altitude.
    // `detail` scales the octave count down for cheap low-resolution sampling
    // (the far-side LOD, chunk lattice), without changing the large-scale shape.
    function heightAtWorld(x, y, detail) {
        var yy = ((y % _L) + _L) % _L;
        var bidx = _sectorIndex(yy);
        var bd = BIOME_DEFS[bidx];
        var oct = Math.max(1, Math.round((detail === undefined ? 1 : detail) * cfg.octaves));
        var u = _rawU(x, y, oct, bd);
        var h;

        if (u < bd._waterU) {
            var d = bd._waterU > 0 ? (bd._waterU - u) / bd._waterU : 0;
            h = cfg.seaLevel - bd.seaDepth * d;
        } else {
            var t = (1 - bd._waterU) > 0 ? (u - bd._waterU) / (1 - bd._waterU) : 0;
            h = cfg.seaLevel + Math.pow(t, bd.landGamma) * (bd.maxHeight - cfg.seaLevel);
        }

        // Inland lakes: carve DOWN into whatever the field above decided was
        // land. Independent of the height curve -- this is the mechanism
        // that makes some ground deep rather than just low.
        if (h > cfg.seaLevel && bd.lakeThreshold < 1) {
            var lm = _lakeMask01(x, y);
            if (lm > bd.lakeThreshold) {
                var lt = (lm - bd.lakeThreshold) / Math.max(0.001, bd.lakeEdge);
                if (lt > 1) lt = 1;
                lt = lt * lt * (3 - 2 * lt);
                var lakeH = cfg.seaLevel - bd.lakeDepth;
                h = h + (lakeH - h) * lt;
            }
        }

        // Moat: force water at every sector boundary (including the ring's
        // own wrap seam), regardless of which biome is on either side.
        if (cfg.moatWidth > 0) {
            var bdist = _minBoundaryDist(yy);
            if (bdist < cfg.moatWidth) {
                var mt = 1 - (bdist / cfg.moatWidth);
                mt = mt * mt * (3 - 2 * mt);
                var moatH = cfg.seaLevel - cfg.moatDepth;
                h = h + (moatH - h) * mt;
            }
        }

        // Rim wall: the band has edges across X, orthogonal to biomes/moat
        // (which are Y-only), so this composes safely on top of either.
        if (cfg.edgeWall) {
            var ax = Math.abs(x);
            var inner = cfg.bandHalfWidth - cfg.wallRamp;
            if (ax > inner) {
                var wt = (ax - inner) / cfg.wallRamp;
                if (wt > 1) wt = 1;
                wt = wt * wt * (3 - 2 * wt);
                h = h + (cfg.wallTop - h) * wt;
            }
        }
        return h;
    }

    // True where the player can actually stand -- inside the rim wall.
    function insideBand(x) {
        return Math.abs(x) <= cfg.bandHalfWidth - cfg.wallRamp;
    }

    // Packed ABGR colour for a height IN A GIVEN BIOME. Water bands (below
    // and just above seaLevel) are shared across every biome so moats and
    // lakes read as "water" everywhere; only the land bands are per-biome.
    function colorForHeightBiome(h, bidx) {
        var s = cfg.seaLevel;
        var r, g, b;

        if (cfg.edgeWall && h >= cfg.wallColorFrom) {
            var band = Math.floor(h) % 3;
            var v = 138 + band * 6;
            return (0xFF000000 | (v << 16) | (v << 8) | v) >>> 0;
        }

        if (h <= s - 12)      { r = 18;  g = 42;  b = 78;  }
        else if (h <= s - 5)  { r = 26;  g = 58;  b = 99;  }
        else if (h <= s)      { r = 40;  g = 84;  b = 128; }
        else if (h < s + 4)   { r = 186; g = 176; b = 128; }
        else {
            var bd = BIOME_DEFS[bidx] || BIOME_DEFS[0];
            var t = (bd.maxHeight - s) > 0 ? (h - (s + 4)) / (bd.maxHeight - (s + 4)) : 0;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            var bands = bd.colors, picked = bands[bands.length - 1];
            for (var i = 0; i < bands.length; i++) { if (t <= bands[i].t) { picked = bands[i]; break; } }
            r = picked.r; g = picked.g; b = picked.b;
        }

        var v2 = ((h * 7919) % 11) - 5;
        r = Math.max(0, Math.min(255, r + v2));
        g = Math.max(0, Math.min(255, g + v2));
        b = Math.max(0, Math.min(255, b + v2));
        return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
    }

    // Back-compat for any caller with no biome context. Uses biome 0.
    function colorForHeight(h) { return colorForHeightBiome(h, 0); }

    return {
        configure:          configure,
        insideBand:         insideBand,
        heightAtWorld:       heightAtWorld,
        colorForHeight:      colorForHeight,
        colorForHeightBiome: colorForHeightBiome,
        biomeIndexAt:        biomeIndexAt,
        biomeCount:          biomeCount,
        biomeName:           biomeName,
        config:              cfg
    };

})();
