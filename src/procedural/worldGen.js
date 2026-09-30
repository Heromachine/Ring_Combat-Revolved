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
        // Magnifies the whole noise field (elevation AND lake mask) by this
        // factor, both around the loop and across the band. 1 is the original
        // 921025e look -- each biome broken into dozens of small islands
        // (Coastal Hills 79, Archipelago 109, Wetlands 64 land blobs). 3 gives
        // each biome a few large landmasses (12 / 25 / 8). Kept as a knob so
        // the old look is one number away; ?terrainZoom=1 in the URL
        // overrides it for side-by-side comparison.
        terrainZoom: 3,
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

    try {
        var _qz = parseFloat(new URLSearchParams(location.search).get('terrainZoom'));
        if (_qz > 0) cfg.terrainZoom = _qz;
    } catch (e) { /* no URL (headless test run) -- keep the default */ }

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
        _hm = null;   // a baked heightmap's relief pass depends on the ring length
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
    // terrainZoom shrinks the circle and the cross axis together, so features
    // grow larger without stretching in either direction.
    function _coords(x, y) {
        var theta = (2 * Math.PI * y) / _L;
        var z = cfg.terrainZoom > 0 ? cfg.terrainZoom : 1;
        return {
            nx: Math.cos(theta) * cfg.loopRadius / z,
            ny: Math.sin(theta) * cfg.loopRadius / z,
            nz: x * cfg.crossScale / z
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
        var h;
        if (_hmSrc) { if (!_hm) _buildHm(); h = _bakedHeight(x, yy); }
        else h = _proceduralHeight(x, y, yy, detail);

        // Rim wall: the band has edges across X, orthogonal to biomes/moat
        // (which are Y-only), so this composes safely on top of either --
        // and on top of a baked heightmap too.
        if (cfg.edgeWall) {
            var ax = Math.abs(x);
            var inner = cfg.bandHalfWidth - cfg.wallRamp;
            if (ax > inner) {
                var wt = (ax - inner) / cfg.wallRamp;
                if (wt > 1) wt = 1;
                wt = wt * wt * (3 - 2 * wt);
                h = h + ((_hm ? _hm.wallTop : cfg.wallTop) - h) * wt;
            }
        }
        return h;
    }

    // The noise + biomes + lakes + moat field. Untouched by the baked
    // heightmap path; it is what runs whenever no heightmap is loaded.
    function _proceduralHeight(x, y, yy, detail) {
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
        return h;
    }

    // ---- Baked heightmap ----
    //
    // An externally generated strip of real elevations (metres) -- e.g. a
    // Terrain Diffusion export -- stretched over the whole band: rows span X
    // from -bandHalfWidth to +bandHalfWidth, columns span one lap of Y and
    // wrap. When one is loaded it REPLACES the procedural field above (no
    // biomes, lakes or moats -- the heightmap carries its own water); the rim
    // wall still applies. clearHeightmap() returns to the procedural world.
    //
    // Metres -> height units: sea level (0 m) sits at cfg.seaLevel, the
    // strip's 99th-percentile land elevation maps to landTop through the land
    // curve (hmKnee), local relief is then exaggerated (hmDetail), and real
    // sea depth goes through seabedDepth() (shelf, drop-off, deep floor).
    // Upper (rock) bands follow VoxelMaster-Minimal's mountainColor
    // (src/procedural/biomeGen.js): dark brown rock, brown-grey, grey,
    // light grey. Snow is a material, not a band -- see MAT_SNOW.
    var HM_COLORS = [
        { t: 0.10, r: 118, g: 150, b: 74  },
        { t: 0.28, r: 84,  g: 124, b: 56  },
        { t: 0.46, r: 102, g: 112, b: 70  },
        { t: 0.58, r: 92,  g: 80,  b: 58  },
        { t: 0.70, r: 120, g: 110, b: 90  },
        { t: 0.84, r: 122, g: 120, b: 124 },
        { t: 1.00, r: 170, g: 170, b: 178 }
    ];
    // ---- Rock speckle (after VoxelMaster-Minimal's ridge tiles) ----
    // Colour, not geometry: on rocky ground each texel takes its colour from
    // its height PLUS a three-octave noise offset, so neighbouring texels
    // cross the rock bands in mottled patches instead of clean height
    // stripes. VoxelMaster uses +-42 on a 0-255 scale; hmSpeckle is the same
    // idea as a fraction of the land range. It fades in by REAL elevation,
    // speckleFromM to speckleFullM (the rock bands start at ~925 m on the
    // unboosted curve) -- not by game height, which hmDetail inflates: keyed
    // on game height it put rock patches on boosted 300 m hills. The snow
    // edge uses the same field, so snow breaks up over the light rock.
    // ?speckle=N overrides (0 = off).
    cfg.hmSpeckle = 0.16;
    cfg.speckleFromM = 900;
    cfg.speckleFullM = 1400;
    var _hm = null;

    // ---- Materials ----
    // Colour is height-keyed, but snow must not be: the relief pass
    // exaggerates hills in GAME height, so a height-keyed snow band put ice
    // caps on 600 m hills. Snow is instead a per-texel material decided by
    // the strip's REAL elevation in metres (above cfg.snowlineM, with a
    // ragged edge), so hmDetail can raise hills without whitening them.
    // Material 0 = the normal height palette, 1 = snow. Only a baked
    // heightmap has materials; the procedural world is always 0.
    var MAT_SNOW = 1;
    var MAT_WALL = 2;   // baked heightmap only: the rim wall, by position
    var MAT_WATER = 3;  // baked heightmap only: water surface; colour row = depth

    // ---- Water (baked heightmap) ----
    // The sea is a flat surface at seaLevel over a real floor. Chunks store
    // the SURFACE height for water texels (so the renderer draws a flat
    // plane with no per-pixel cost) and the depth in the colour row; the
    // floor is surface - depth (physics, the underwater view).
    //
    // Floor shape from real depth: a wet-sand shelf that plateaus at
    // shelfUnits below the surface (wading depth) out to shelfM of real
    // depth -- ~150-250 WU from shore on this strip -- then a drop-off to
    // deepUnits by dropM, deeper than eye height so a player sinks out of
    // sight there. Swimming is not modelled yet.
    cfg.shelfM = 25;
    cfg.dropM = 80;
    cfg.shelfUnits = 4;
    cfg.deepUnits = 110;
    function seabedDepth(mDeep) {           // real depth (m, > 0) -> units below surface
        if (mDeep <= cfg.shelfM) {
            var t = mDeep / (cfg.shelfM * 0.3); if (t > 1) t = 1;
            return 1 + (cfg.shelfUnits - 1) * t;           // quick slope, then the plateau
        }
        if (mDeep <= cfg.dropM) {
            var d = (mDeep - cfg.shelfM) / (cfg.dropM - cfg.shelfM);
            d = d * d * (3 - 2 * d);
            return cfg.shelfUnits + (cfg.deepUnits - cfg.shelfUnits) * d;
        }
        return cfg.deepUnits + Math.min(20, (mDeep - cfg.dropM) / 100);   // gentle abyss
    }
    // Surface colour by depth (units): wet sand at the edge, teal over the
    // shelf, navy over deep water. Two falloffs: the sand fades within a
    // few units, the blue deepens over tens.
    var WET_SAND = { r: 148, g: 128, b: 98 };   // VoxelMaster-Minimal beachColor, wet end
    var SHALLOW = { r: 58, g: 112, b: 118 };
    var DEEP = { r: 16, g: 38, b: 72 };
    function waterColor(d) {
        var a1 = 1 - Math.exp(-d / 2.5), a2 = 1 - Math.exp(-d / 14);
        var r = WET_SAND.r + (SHALLOW.r - WET_SAND.r) * a1;
        var g = WET_SAND.g + (SHALLOW.g - WET_SAND.g) * a1;
        var b = WET_SAND.b + (SHALLOW.b - WET_SAND.b) * a1;
        r += (DEEP.r - r) * a2; g += (DEEP.g - g) * a2; b += (DEEP.b - b) * a2;
        var v = ((d * 7919) % 5) - 2;          // faint banding, like the land LUT
        r = Math.max(0, Math.min(255, r + v)) | 0;
        g = Math.max(0, Math.min(255, g + v)) | 0;
        b = Math.max(0, Math.min(255, b + v)) | 0;
        return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
    }
    // The floor as seen from underwater: wet sand, darkening a little with depth.
    function seabedColor(d) {
        var k = Math.max(0.35, 1 - d / 160);
        return (0xFF000000 | ((WET_SAND.b * k) << 16) | ((WET_SAND.g * k) << 8) | (WET_SAND.r * k)) >>> 0;
    }
    var SNOW_COLOR = { r: 236, g: 238, b: 242 };

    // ---- Height ceiling (option B) ----
    // Chunk texels hold a 16-bit height, so a baked heightmap is not bound
    // to 0-255. hmTop is where the strip's P99 land elevation lands; peaks
    // above it ease ~12% higher, and the rim wall is raised above that.
    // 200 reproduces the original 0-255 layout. ?hmTop=N overrides.
    cfg.hmTop = 800;

    // Colour index. Colour LUTs stay 256 entries per material, so heights
    // above 255 are quantised: exact below 64 (water, beaches and the coast
    // stay precise), compressed linearly from 64 to the wall top above that.
    // When the wall top fits in 255 the mapping is the identity -- which is
    // always the case for the procedural world.
    var Q_EXACT = 64;
    function _makeQuant(topH) {
        if (topH <= 255) return null;
        var tbl = new Uint8Array(topH + 1);
        for (var h = 0; h <= topH; h++) {
            tbl[h] = h < Q_EXACT ? h : Math.min(255, Q_EXACT + Math.round((h - Q_EXACT) * (255 - Q_EXACT) / (topH - Q_EXACT)));
        }
        return { table: tbl, top: topH };
    }
    // Quantised colour row for an integer height (0-255).
    function colorRowForHeight(h) {
        var q = _hmSrc ? (_hm || (_buildHm(), _hm)).quant : null;
        if (h < 0) h = 0;
        if (!q) return h > 255 ? 255 : h | 0;
        return q.table[h > q.top ? q.top : h | 0];
    }
    // Representative height for a colour row (inverse of the above).
    function heightForColorRow(r) {
        var q = _hmSrc ? (_hm || (_buildHm(), _hm)).quant : null;
        if (!q || r < Q_EXACT) return r;
        return Q_EXACT + (r - Q_EXACT) * (q.top - Q_EXACT) / (255 - Q_EXACT);
    }
    // Whole LUT index for a height + material.
    function colorIndex(h, mat) { return (mat << 8) | colorRowForHeight(h); }
    // Table form for per-texel use in chunk generation (null = identity).
    function colorRowTable() {
        var q = _hmSrc ? (_hm || (_buildHm(), _hm)).quant : null;
        return q ? q.table : null;
    }
    cfg.snowlineM = 2800;
    cfg.snowEdgeM = 200;   // +- patchy edge around the snowline (speckle field)
    try {
        var _qs = parseFloat(new URLSearchParams(location.search).get('snowline'));
        if (_qs > 0) cfg.snowlineM = _qs;
        var _qp = new URLSearchParams(location.search).get('speckle');
        if (_qp !== null && parseFloat(_qp) >= 0) cfg.hmSpeckle = parseFloat(_qp);
    } catch (e) { /* headless */ }

    // Land curve: log(1 + m/knee), scaled so the strip's P99 lands on
    // landTop. A straight metres->units line squashes relief ~10x against the
    // horizontal scale (the height store tops out at 255 while real peaks are
    // thousands of metres), so most ground reads as flat. The log gives low
    // and mid elevations far more of the range; the knee keeps the first few
    // metres above sea gentle so coasts stay beaches, not cliffs. Smaller
    // knee = hillier lowlands. 0 = the old straight line. ?hmKnee=N overrides.
    cfg.hmKnee = 800;
    // Local relief gain. Even with the log curve, a strip spanning ~7 km of
    // real elevation leaves each individual hill only a few height units
    // tall. So the land is split into its broad shape (a land-only blur,
    // hmDetailRadius px -- ~1.4 km of real terrain) and the local detail on
    // top of it, and only the detail is multiplied. Coastlines, valleys and
    // the mountain range stay where the generator put them; hills get tall.
    // Hills (detail above the broad shape) get hmDetail; valleys get the
    // much gentler hmDetailDown. Deepening valleys by the full gain drove
    // them onto the waterline -- at 6x, 12.6% of all land sat within 1.5
    // units of sea level, reading as sand plains on the map and as a
    // water/sand speckle in the chunks. At 1 it is 2.2% (unexaggerated: 1%).
    // 1 = no exaggeration. ?hmDetail=N and ?hmDown=N override.
    cfg.hmDetail = 4;
    cfg.hmDetailDown = 2;
    cfg.hmDetailRadiusWU = 384;   // broad-shape blur radius, world units
    try {
        var _q = new URLSearchParams(location.search);
        var _qk = _q.get('hmKnee'), _qd = _q.get('hmDetail'), _qn = _q.get('hmDown'), _qt = _q.get('hmTop');
        if (_qt !== null && parseFloat(_qt) >= 60) cfg.hmTop = Math.min(4000, parseFloat(_qt));
        if (_qn !== null && parseFloat(_qn) > 0) cfg.hmDetailDown = parseFloat(_qn);
        if (_qk !== null && parseFloat(_qk) >= 0) cfg.hmKnee = parseFloat(_qk);
        if (_qd !== null && parseFloat(_qd) > 0) cfg.hmDetail = parseFloat(_qd);
    } catch (e) { /* headless */ }

    // Two passes of a box blur along each axis (close to a Gaussian), in
    // place in `buf`, using `tmp` (same size) as scratch. Wraps along the
    // strip's length (it loops), clamps across its width.
    function _blurWrapRows(buf, tmp, w, h, r) {
        var n = 2 * r + 1, inv = 1 / n, x, y, s, row, add, sub, pass;
        var colSum = new Float64Array(w);
        for (pass = 0; pass < 2; pass++) {
            for (y = 0; y < h; y++) {           // along length: wraps
                row = y * w; s = 0;
                for (x = w - r; x < w; x++) s += buf[row + ((x % w) + w) % w];
                for (x = 0; x <= r; x++) s += buf[row + (x % w)];
                add = (r + 1) % w; sub = ((w - r) % w + w) % w;
                for (x = 0; x < w; x++) {
                    tmp[row + x] = s * inv;
                    s += buf[row + add] - buf[row + sub];
                    if (++add === w) add = 0;
                    if (++sub === w) sub = 0;
                }
            }
            for (x = 0; x < w; x++) colSum[x] = tmp[x] * (r + 1);   // across width: clamps
            for (y = 1; y <= r; y++) { row = Math.min(h - 1, y) * w; for (x = 0; x < w; x++) colSum[x] += tmp[row + x]; }
            for (y = 0; y < h; y++) {
                row = y * w;
                var ra = Math.min(h - 1, y + r + 1) * w, rs = Math.max(0, y - r) * w;
                for (x = 0; x < w; x++) {
                    buf[row + x] = colSum[x] * inv;
                    colSum[x] += tmp[ra + x] - tmp[rs + x];
                }
            }
        }
    }

    // Store the strip; it is processed into heights lazily (_buildHm) on
    // first use, because the relief pass needs the ring length, which may
    // not be configured yet when the download lands.
    var _hmSrc = null;
    function useHeightmap(meta, elev, opts) {
        _hmSrc = { meta: meta, elev: elev, opts: opts || {} };
        _hm = null;
    }

    function _buildHm() {
        var meta = _hmSrc.meta, elev = _hmSrc.elev, opts = _hmSrc.opts;
        var st = meta.stats || {};
        var landTop = opts.landTop || cfg.hmTop;
        var knee = opts.knee !== undefined ? opts.knee : cfg.hmKnee;
        var gain = opts.detail !== undefined ? opts.detail : cfg.hmDetail;
        var gainDown = opts.detailDown !== undefined ? opts.detailDown : cfg.hmDetailDown;
        var p99 = Math.max(1, st.landP99 || 1);
        // Headroom the top 1% of peaks ease into. At the default ceiling this
        // is the gap under the old 225 wall-colour band (the wall is a
        // material now, so height no longer has to stay below it); above
        // that it scales with the ceiling.
        var room = Math.max(24, Math.round(landTop * 0.12));
        var w = meta.length, hgt = meta.width, N = w * hgt, s = cfg.seaLevel;
        var denom = knee > 0 ? Math.log(1 + p99 / knee) : p99;

        // 1. metres -> height units (land curve, sea depth)
        var u = new Float32Array(N), i;
        for (i = 0; i < N; i++) {
            var m = elev[i];
            u[i] = m >= 0
                ? s + (knee > 0 ? Math.log(1 + m / knee) : m) / denom * (landTop - s)
                : s - seabedDepth(-m);
        }

        // 2. amplify local land relief around a land-only broad shape, so the
        //    sea never drags a coast's baseline down into a cliff. The broad
        //    shape is smooth by definition, so it is computed on a grid k
        //    times coarser (k divides the length so the wrap stays exact) and
        //    sampled back bilinearly -- k^2 less memory and time at load.
        if (gain !== 1) {
            var wuPerPx = _L / w;
            var rPx = Math.max(1, Math.round(cfg.hmDetailRadiusWU / wuPerPx));
            var k = Math.max(1, Math.floor(rPx / 12));
            while (k > 1 && w % k) k--;
            var cw = w / k, ch = Math.ceil(hgt / k), CN = cw * ch;
            var num = new Float32Array(CN), den = new Float32Array(CN), tmp = new Float32Array(CN);
            for (var yy = 0; yy < hgt; yy++) {
                var crow = ((yy / k) | 0) * cw, row = yy * w;
                for (var xx = 0; xx < w; xx++) {
                    if (elev[row + xx] < 0) continue;
                    var ci = crow + ((xx / k) | 0);
                    num[ci] += u[row + xx]; den[ci] += 1;
                }
            }
            var cr = Math.max(1, Math.round(rPx / k));
            _blurWrapRows(num, tmp, cw, ch, cr);
            _blurWrapRows(den, tmp, cw, ch, cr);
            for (i = 0; i < CN; i++) num[i] = den[i] > 1e-6 ? num[i] / den[i] : s;

            for (yy = 0; yy < hgt; yy++) {
                var fy = (yy + 0.5) / k - 0.5; if (fy < 0) fy = 0; if (fy > ch - 1) fy = ch - 1;
                var y0 = fy | 0, y1 = y0 + 1 < ch ? y0 + 1 : y0, ty = fy - y0;
                row = yy * w;
                for (xx = 0; xx < w; xx++) {
                    i = row + xx;
                    if (elev[i] < 0) continue;
                    var fx = (xx + 0.5) / k - 0.5; if (fx < 0) fx += cw;
                    var x0 = fx | 0, tx = fx - x0, x1 = x0 + 1; if (x1 >= cw) x1 -= cw;
                    var a0 = num[y0 * cw + x0], a1 = num[y0 * cw + x1];
                    var b0 = num[y1 * cw + x0], b1 = num[y1 * cw + x1];
                    var base = (a0 + (a1 - a0) * tx) + ((b0 + (b1 - b0) * tx) - (a0 + (a1 - a0) * tx)) * ty;
                    var d = u[i] - base;
                    var h2 = base + d * (d > 0 ? gain : Math.min(gain, gainDown));
                    u[i] = h2 > s + 0.5 ? h2 : s + 0.5;   // land stays land
                }
            }
        }

        // 3. peaks above landTop ease into the headroom instead of clipping
        //    into flat-topped mesas
        for (i = 0; i < N; i++) {
            if (u[i] > landTop) u[i] = landTop + room * Math.tanh((u[i] - landTop) / room);
        }
        var maxH = landTop + room;
        var wallTop = Math.max(cfg.wallTop, Math.round(maxH + 26));
        _hm = { len: w, wid: hgt, h: u, landTop: landTop, wallTop: wallTop,
                quant: _makeQuant(wallTop) };
    }
    function clearHeightmap() { _hmSrc = null; _hm = null; _clim = null; }
    function heightmapMeta() { return _hmSrc ? _hmSrc.meta : null; }

    // Climate that came with the strip (strip_export.py): temperature (C,
    // elevation-adjusted) and annual precipitation (mm) on a grid every
    // meta.climate.step pixels, same wrap as the elevation. Used by tree
    // placement (terrainTrees.js).
    var _clim = null;
    function useClimate(meta, data) {
        var c = meta.climate;
        if (!c || data.length !== 2 * c.width * c.length) { _clim = null; return false; }
        _clim = { w: c.width, len: c.length, data: data };
        return true;
    }
    function climateAtWorld(x, y) {
        if (!_clim) return null;
        var c = _clim, yy = ((y % _L) + _L) % _L;
        var fr = (x + cfg.bandHalfWidth) / (2 * cfg.bandHalfWidth) * (c.w - 1);
        if (fr < 0) fr = 0; else if (fr > c.w - 1) fr = c.w - 1;
        var fc = yy / _L * c.len;
        var r0 = fr | 0, c0 = (fc | 0) % c.len, tr = fr - (fr | 0), tc = fc - (fc | 0);
        var r1 = r0 + 1 < c.w ? r0 + 1 : r0, c1 = (c0 + 1) % c.len, n = c.w * c.len, d = c.data;
        function at(off) {
            var a = d[off + r0 * c.len + c0], b = d[off + r0 * c.len + c1];
            var e = d[off + r1 * c.len + c0], f = d[off + r1 * c.len + c1];
            var top = a + (b - a) * tc;
            return top + ((e + (f - e) * tc) - top) * tr;
        }
        return { temp: at(0) / 100, precip: at(n) };
    }
    function usingHeightmap() { return !!_hmSrc; }

    function _hmAt(r, c) {
        return _hm.h[r * _hm.len + c];
    }

    // Highest processed height over a world rectangle (wraps along Y), read
    // straight from the strip, or null without a heightmap. For coarse
    // occluders: a single point sample under-estimates a mountain LOD cell by
    // a median 25 / p90 94 height units, which let buildings show over
    // ridges until the real chunks streamed in.
    function maxHeightInRect(x0, y0, x1, y1) {
        if (!_hmSrc) return null;
        if (!_hm) _buildHm();
        var m = _hm, H = m.h, len = m.len, wid = m.wid, top = -Infinity;
        var span = 2 * cfg.bandHalfWidth;
        var r0 = Math.floor((x0 + cfg.bandHalfWidth) / span * (wid - 1));
        var r1 = Math.ceil((x1 + cfg.bandHalfWidth) / span * (wid - 1));
        if (r0 < 0) r0 = 0; if (r1 > wid - 1) r1 = wid - 1;
        var c0 = Math.floor(y0 / _L * len), c1 = Math.ceil(y1 / _L * len);
        for (var c = c0; c <= c1; c++) {
            var cc = ((c % len) + len) % len;
            for (var r = r0; r <= r1; r++) { var v = H[r * len + cc]; if (v > top) top = v; }
        }
        return top;
    }

    function _bakedHeight(x, yy) {
        var m = _hm;
        var fr = (x + cfg.bandHalfWidth) / (2 * cfg.bandHalfWidth) * (m.wid - 1);
        if (fr < 0) fr = 0; else if (fr > m.wid - 1) fr = m.wid - 1;
        var fc = yy / _L * m.len;
        var r0 = fr | 0, c0 = fc | 0;
        var tr = fr - r0, tc = fc - c0;
        var r1 = r0 + 1 < m.wid ? r0 + 1 : r0;
        c0 = c0 % m.len;
        var c1 = (c0 + 1) % m.len;   // wraps: the strip loops along Y
        var a = _hmAt(r0, c0), b = _hmAt(r0, c1);
        var c = _hmAt(r1, c0), d = _hmAt(r1, c1);
        var top = a + (b - a) * tc, bot = c + (d - c) * tc;
        return top + (bot - top) * tr;
    }

    // Real elevation in metres at a world position (bilinear over the raw
    // strip, wraps along Y), or null when no heightmap is loaded.
    function metresAtWorld(x, y) {
        if (!_hmSrc) return null;
        var meta = _hmSrc.meta, e = _hmSrc.elev, len = meta.length, wid = meta.width;
        var yy = ((y % _L) + _L) % _L;
        var fr = (x + cfg.bandHalfWidth) / (2 * cfg.bandHalfWidth) * (wid - 1);
        if (fr < 0) fr = 0; else if (fr > wid - 1) fr = wid - 1;
        var fc = yy / _L * len;
        var r0 = fr | 0, c0 = (fc | 0) % len, tr = fr - (fr | 0), tc = fc - (fc | 0);
        var r1 = r0 + 1 < wid ? r0 + 1 : r0, c1 = (c0 + 1) % len;
        var a = e[r0 * len + c0], b = e[r0 * len + c1], c = e[r1 * len + c0], d = e[r1 * len + c1];
        var top = a + (b - a) * tc, bot = c + (d - c) * tc;
        return top + (bot - top) * tr;
    }

    // Snowline edge: smooth value noise, roughly [-0.5, 0.5), two octaves
    // (48 and 12 WU). Per-texel hashing read as salt-and-pepper speckle;
    // a coherent field gives a wavy, patchy edge instead. Only evaluated
    // near the snowline (chunkTerrain skips cells clear of it).
    function _cellHash(ix, iy) {
        var h = (Math.imul(ix, 668265263) ^ Math.imul(iy, 374761393) ^ Math.imul(cfg.seed | 0, 2246822519)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
        return ((h >>> 8) & 0xFFFF) / 0x10000 - 0.5;
    }
    function _valueNoise(x, y, cell) {
        var fx = x / cell, fy = y / cell;
        var ix = Math.floor(fx), iy = Math.floor(fy);
        var tx = fx - ix, ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        var a = _cellHash(ix, iy), b = _cellHash(ix + 1, iy);
        var c = _cellHash(ix, iy + 1), d = _cellHash(ix + 1, iy + 1);
        var top = a + (b - a) * tx;
        return top + ((c + (d - c) * tx) - top) * ty;
    }
    // Speckle field: three octaves of value noise at 56 / 28 / 14 WU (the
    // scale of VoxelMaster's 18-cycles-per-tile fbm), stretched for contrast
    // and clamped to [-1, 1].
    function speckleAt(x, y) {
        var n = (_valueNoise(x, y, 56) * 0.57 + _valueNoise(x, y, 28) * 0.29 + _valueNoise(x, y, 14) * 0.14) * 3.2;
        return n < -1 ? -1 : (n > 1 ? 1 : n);
    }
    function _edgeHash(x, y) {
        // Clamped to [-0.5, 0.5] -- chunkTerrain's early-outs assume the
        // edge never reaches past snowline +- snowEdgeM.
        return speckleAt(x, y) * 0.5;
    }

    // Speckle parameters for the current heightmap, or null when there is
    // none or it is switched off. loM/fullM: real elevation (metres) where it
    // fades in; amp: max colour-height offset (height units); floor: lowest
    // colour height it may pull to (stays clear of beach and water colours).
    function speckleParams() {
        if (!_hmSrc || !(cfg.hmSpeckle > 0)) return null;
        var top = _hmSrc.opts.landTop || cfg.hmTop, s = cfg.seaLevel;
        return { loM: cfg.speckleFromM, fullM: cfg.speckleFullM,
                 amp: cfg.hmSpeckle * (top - s), floor: s + 6 };
    }
    // Speckle weight 0..1 from real elevation.
    function speckleWeight(sp, m) {
        if (m === null || m <= sp.loM) return 0;
        return m >= sp.fullM ? 1 : (m - sp.loM) / (sp.fullM - sp.loM);
    }
    // Height to pick a COLOUR by at a position: the real height, offset by
    // speckle on rocky ground. Geometry never uses this.
    function colorHeightAt(h, x, y) {
        var sp = speckleParams();
        if (!sp) return h;
        var w = speckleWeight(sp, metresAtWorld(x, y));
        if (!w) return h;
        var hc = h + speckleAt(x, y) * sp.amp * w;
        return hc < sp.floor ? sp.floor : hc;
    }

    // Material from real elevation in metres (see MAT_SNOW). Callers that
    // already have the metres (chunk generation, interpolating a lattice)
    // use this directly; materialAtWorld samples them itself.
    // Mid-ramp of the rim wall: beyond this X a baked heightmap paints wall.
    function wallMaterialX() { return cfg.bandHalfWidth - cfg.wallRamp * 0.5; }

    function materialForMetres(m, x, y) {
        if (_hmSrc && cfg.edgeWall && (x > wallMaterialX() || -x > wallMaterialX())) return MAT_WALL;
        if (m === null || m <= 0) return 0;
        return (m + _edgeHash(x, y) * 2 * cfg.snowEdgeM > cfg.snowlineM) ? MAT_SNOW : 0;
    }
    // Same test with the speckle value already known (chunk generation
    // interpolates it from a coarse grid instead of evaluating per texel).
    function snowForMetres(m, spv) {
        if (m === null || m <= 0) return 0;
        var e = spv * 0.5; e = e < -0.5 ? -0.5 : (e > 0.5 ? 0.5 : e);
        return (m + e * 2 * cfg.snowEdgeM > cfg.snowlineM) ? MAT_SNOW : 0;
    }
    function materialAtWorld(x, y) {
        return _hmSrc ? materialForMetres(metresAtWorld(x, y), x, y) : 0;
    }

    // True where the player can actually stand -- inside the rim wall.
    function insideBand(x) {
        return Math.abs(x) <= cfg.bandHalfWidth - cfg.wallRamp;
    }

    // Packed ABGR colour for a height IN A GIVEN BIOME. Water bands (below
    // and just above seaLevel) are shared across every biome so moats and
    // lakes read as "water" everywhere; only the land bands are per-biome.
    function colorForHeightBiome(h, bidx, mat) {
        var s = cfg.seaLevel;
        var r, g, b;

        // Baked heightmap: anything below sea level is water, coloured by depth.
        if (mat === MAT_WATER) return waterColor(h);            // h is the depth row here
        if (mat === 6) {                                        // forest floor under a canopy: darker, greener
            var fc0 = colorForHeightBiome(h, bidx, 0);
            var fr0 = fc0 & 255, fg0 = (fc0 >> 8) & 255, fb0 = (fc0 >> 16) & 255;
            return (0xFF000000 | ((fb0 * 0.62) << 16) | ((fg0 * 0.72) << 8) | (fr0 * 0.60)) >>> 0;
        }
        if (mat === 4 || mat === 5) {                           // tree trunk core / edge (terrainTrees.js)
            var tv = ((h * 7919) % 7) - 3, tk = mat === 5 ? 0.72 : 1;
            return (0xFF000000 | (((34 + tv) * tk) << 16) | (((52 + tv) * tk) << 8) | ((78 + tv) * tk)) >>> 0;
        }
        if (_hmSrc && h < s && mat !== MAT_WALL) return waterColor(s - h);

        if (cfg.edgeWall && (_hmSrc ? mat === MAT_WALL : h >= cfg.wallColorFrom)) {
            var band = Math.floor(h) % 3;
            var v = 138 + band * 6;
            return (0xFF000000 | (v << 16) | (v << 8) | v) >>> 0;
        }

        // With a baked heightmap, water texels never reach here (see above),
        // so land at sea level is beach, not the procedural water bands --
        // those painted shoreline land blue and speckled the coast.
        if (_hmSrc && h < s + 4) { r = 186; g = 176; b = 128; }
        else if (h <= s - 12) { r = 18;  g = 42;  b = 78;  }
        else if (h <= s - 5)  { r = 26;  g = 58;  b = 99;  }
        else if (h <= s)      { r = 40;  g = 84;  b = 128; }
        else if (mat === MAT_SNOW) { r = SNOW_COLOR.r; g = SNOW_COLOR.g; b = SNOW_COLOR.b; }
        else if (h < s + 4)   { r = 186; g = 176; b = 128; }
        else {
            // A baked heightmap has no biomes: one palette over its own range.
            var bd = BIOME_DEFS[bidx] || BIOME_DEFS[0];
            var top = _hmSrc ? (_hmSrc.opts.landTop || cfg.hmTop) : bd.maxHeight;
            var t = (top - s) > 0 ? (h - (s + 4)) / (top - (s + 4)) : 0;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            var bands = _hmSrc ? HM_COLORS : bd.colors, picked = bands[bands.length - 1];
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
        useHeightmap:        useHeightmap,
        heightmapMeta:       heightmapMeta,
        useClimate:          useClimate,
        climateAtWorld:      climateAtWorld,
        metresAtWorld:       metresAtWorld,
        materialForMetres:   materialForMetres,
        materialAtWorld:     materialAtWorld,
        colorIndex:          colorIndex,
        maxHeightInRect:     maxHeightInRect,
        speckleAt:           speckleAt,
        waterColor:          waterColor,
        seabedColor:         seabedColor,
        MAT_WATER:           MAT_WATER,
        snowForMetres:       snowForMetres,
        speckleParams:       speckleParams,
        colorHeightAt:       colorHeightAt,
        colorRowTable:       colorRowTable,
        heightForColorRow:   heightForColorRow,
        wallMaterialX:       wallMaterialX,
        clearHeightmap:      clearHeightmap,
        usingHeightmap:      usingHeightmap,
        config:              cfg
    };

})();
