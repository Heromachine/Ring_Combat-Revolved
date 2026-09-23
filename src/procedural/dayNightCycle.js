// ===============================
// Day/Night Cycle
// ===============================
// A single directional "sun" lighting the ring from a fixed elevation angle
// while the ring's own slow rotation sweeps the lit side around the loop
// (world Y). Two things this deliberately is NOT: a real 3D light (this is
// a 2D function of loop-position, nothing else), and something recomputed
// every frame for the terrain LUTs (see epoch() below) -- the cycle is
// minutes long, so per-frame precision buys nothing and chunk color LUTs
// are comparatively expensive to rebuild.
//
// THE ELEVATION FORMULA
// intensity(relAngle) = cos(theta) + 0.5*sin(2*theta)*cos(relAngle)
// where theta is the sun's elevation out of the ring's own plane and
// relAngle is how far around the loop a point is from the sub-solar point.
// This satisfies three fixed reference points by construction:
//   theta =  0 deg -> intensity = 1 everywhere (sun edge-on to the ring's
//            plane grazes the whole loop uniformly -- no day/night split)
//   theta = 90 deg -> intensity = 0 everywhere (sun on the rotation axis,
//            blocked by the ring's own structure -- dark all the way round)
//   theta =  45 deg -> the actual day/night split: bright side clamped to
//            1, dark side resting near NIGHT_FLOOR, half and half around
//            the loop. This is the recommended/default setting.
"use strict";

var DayNight = (function () {

    var SUN_ELEVATION_DEG = 45;
    var CYCLE_MS           = 24 * 60 * 1000;  // 24 min, full lap of the loop
    var NIGHT_FLOOR         = 0.18;            // dim, not black
    var EPOCH_INTERVAL_MS   = 15000;           // how often lit LUTs may rebuild

    var _theta    = SUN_ELEVATION_DEG * Math.PI / 180;
    var _cosTheta = Math.cos(_theta);
    var _ampTheta = 0.5 * Math.sin(2 * _theta);

    var _epoch        = 0;
    var _lastEpochAtMs = 0;

    function sunPhase() {
        var t = (Date.now() % CYCLE_MS) / CYCLE_MS;
        return t * Math.PI * 2;
    }

    // Intensity in [NIGHT_FLOOR, 1] for a world Y position around the loop.
    // Off (or a degenerate ring) reads as full daylight -- flat/tiled maps
    // and any map with ringLength <= 0 are untouched by this feature.
    function intensityAtY(worldY) {
        if (typeof ringWorld === 'undefined' || !ringWorld.enabled || !(ringWorld.ringLength > 0)) return 1;
        var loopAngle = (worldY / ringWorld.ringLength) * Math.PI * 2;
        var rel = loopAngle - sunPhase();
        var raw = _cosTheta + _ampTheta * Math.cos(rel);
        return raw < NIGHT_FLOOR ? NIGHT_FLOOR : (raw > 1 ? 1 : raw);
    }

    // Scales a packed ABGR colour's RGB channels by intensity, alpha
    // untouched. Shared by the backdrop (per-sample) and ChunkTerrain's lit
    // LUT bake (per LUT entry, 256 calls per biome per chunk-Y bucket).
    function scaleColor(abgr, intensity) {
        var r = abgr & 0xFF, g = (abgr >>> 8) & 0xFF, b = (abgr >>> 16) & 0xFF;
        r = (r * intensity) | 0; g = (g * intensity) | 0; b = (b * intensity) | 0;
        return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
    }

    function litColor(abgr, worldY) {
        return scaleColor(abgr, intensityAtY(worldY));
    }

    // Self-throttling counter: bumps at most once every EPOCH_INTERVAL_MS,
    // on whichever call happens to land after the interval has elapsed.
    // ChunkTerrain's lit-LUT cache is keyed by this -- callers never need to
    // push a tick anywhere, and the terrain pass never rebuilds a LUT more
    // often than this, no matter how many frames render in between.
    function epoch() {
        var now = Date.now();
        if (now - _lastEpochAtMs >= EPOCH_INTERVAL_MS) {
            _lastEpochAtMs = now;
            _epoch++;
        }
        return _epoch;
    }

    return {
        intensityAtY: intensityAtY,
        scaleColor:   scaleColor,
        litColor:     litColor,
        sunPhase:     sunPhase,
        epoch:        epoch
    };

}());
