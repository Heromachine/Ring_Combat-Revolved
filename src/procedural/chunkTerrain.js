// ===============================
// Chunked Procedural Terrain
// ===============================
// Near-field terrain that never repeats, generated on demand from
// WorldGen.heightAtWorld.
//
// WHY IT IS NOT JUST "CALL THE NOISE PER TEXEL"
//
// Measured: WorldGen.heightAtWorld runs at ~0.62M samples/sec at full detail.
// A 1024x1024 chunk is 1.05M texels, so filling one that way takes ~1.7
// SECONDS. Only about 100x100 texels fit in a 16 ms frame.
//
// So the noise is sampled on a COARSE LATTICE (every NOISE_STEP world units)
// and bilinearly interpolated to fill the chunk, which is 64x fewer noise
// evaluations. A cheap hash-based detail term is added per texel to put the
// high-frequency roughness back -- interpolation alone looks like melted wax.
//
// Chunk size is chosen so one chunk generates inside a single frame:
//   512x512 WU  ->  65x65 = 4,225 noise samples  ~7 ms
//
// Chunks live in a small direct-indexed ring of slots rather than a hash map,
// because the renderer looks terrain up per PIXEL and a Map lookup per sample
// is not affordable. Slot = (cy & MASK) * DIM + (cx & MASK), then the stored
// chunk coords are checked -- arithmetic and one array index.
"use strict";

var ChunkTerrain = (function () {

    var CHUNK      = 512;   // world units per chunk edge (also texels: 1 WU/texel)
    var NOISE_STEP = 8;     // world units between noise lattice samples
    var DIM        = 8;     // slots per axis in the residency ring
    var MASK       = DIM - 1;

    var _slots   = new Array(DIM * DIM).fill(null);
    var _coords  = new Int32Array(DIM * DIM * 2);
    var _live    = new Uint8Array(DIM * DIM);
    var _pending = [];
    var _colorLUT = null;
    var _stats   = { generated: 0, lastMs: 0, misses: 0 };

    // Colour is DERIVED from height through a 256-entry lookup rather than
    // stored. That removes 4 bytes per texel -- a 4x memory saving -- and is
    // as fast as reading a colour array.
    function _buildColorLUT() {
        _colorLUT = new Uint32Array(256);
        for (var h = 0; h < 256; h++) _colorLUT[h] = WorldGen.colorForHeight(h);
    }

    // Cheap deterministic per-texel detail. Restores roughness the lattice
    // interpolation smooths away, without touching Perlin again.
    function _detail(wx, wy) {
        var h = (Math.imul(wx | 0, 374761393) ^ Math.imul(wy | 0, 1013904223)) | 0;
        h = Math.imul(h ^ (h >>> 15), 0x2545f491) | 0;
        return (((h >>> 8) & 0xFF) / 255 - 0.5);   // [-0.5, 0.5]
    }

    function _generate(cx, cy) {
        var t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        var N = (CHUNK / NOISE_STEP) + 1;          // lattice points per axis
        var lat = new Float32Array(N * N);
        var ox = cx * CHUNK, oy = cy * CHUNK;

        for (var j = 0; j < N; j++) {
            var wy = oy + j * NOISE_STEP;
            for (var i = 0; i < N; i++) {
                lat[j * N + i] = WorldGen.heightAtWorld(ox + i * NOISE_STEP, wy, 1);
            }
        }

        var out = new Uint8Array(CHUNK * CHUNK);
        var inv = 1 / NOISE_STEP;
        for (var y = 0; y < CHUNK; y++) {
            var fy = y * inv, j0 = fy | 0, ty = fy - j0, j1 = j0 + 1;
            var r0 = j0 * N, r1 = j1 * N;
            var rowBase = y * CHUNK, wy2 = oy + y;
            for (var x = 0; x < CHUNK; x++) {
                var fx = x * inv, i0 = fx | 0, tx = fx - i0, i1 = i0 + 1;
                var a = lat[r0 + i0], b = lat[r0 + i1];
                var c = lat[r1 + i0], d = lat[r1 + i1];
                var top = a + (b - a) * tx, bot = c + (d - c) * tx;
                var h = top + (bot - top) * ty + _detail(ox + x, wy2) * 2.0;
                out[rowBase + x] = h < 0 ? 0 : (h > 255 ? 255 : h) | 0;
            }
        }

        _stats.generated++;
        _stats.lastMs = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0;
        return out;
    }

    function _slotOf(cx, cy) { return ((cy & MASK) * DIM) + (cx & MASK); }

    // The chunk covering this world position, or null if it is not resident.
    function chunkAt(cx, cy) {
        var s = _slotOf(cx, cy);
        if (_live[s] && _coords[s * 2] === cx && _coords[s * 2 + 1] === cy) return _slots[s];
        return null;
    }

    function ensure(cx, cy) {
        var s = _slotOf(cx, cy);
        if (_live[s] && _coords[s * 2] === cx && _coords[s * 2 + 1] === cy) return _slots[s];
        var data = _generate(cx, cy);
        _slots[s] = data;
        _coords[s * 2] = cx; _coords[s * 2 + 1] = cy;
        _live[s] = 1;
        return data;
    }

    // Queue the chunks around a position, nearest first. Call once per frame;
    // generation itself is drip-fed by pump() so a boundary crossing does not
    // stall the frame.
    function requestAround(wx, wy, radiusWU) {
        var ccx = Math.floor(wx / CHUNK), ccy = Math.floor(wy / CHUNK);
        var r = Math.ceil(radiusWU / CHUNK);
        if (r > (DIM >> 1) - 1) r = (DIM >> 1) - 1;   // never exceed residency
        _pending.length = 0;
        for (var dy = -r; dy <= r; dy++) {
            for (var dx = -r; dx <= r; dx++) {
                var cx = ccx + dx, cy = ccy + dy;
                if (chunkAt(cx, cy)) continue;
                _pending.push({ cx: cx, cy: cy, d: dx * dx + dy * dy });
            }
        }
        _pending.sort(function (a, b) { return a.d - b.d; });
    }

    // Generate at most `budget` chunks. Returns how many were made.
    function pump(budget) {
        var n = 0;
        while (_pending.length && n < (budget || 1)) {
            var c = _pending.shift();
            ensure(c.cx, c.cy);
            n++;
        }
        return n;
    }

    function heightAt(wx, wy) {
        var fx = Math.floor(wx), fy = Math.floor(wy);
        var cx = Math.floor(fx / CHUNK), cy = Math.floor(fy / CHUNK);
        var ch = chunkAt(cx, cy);
        if (!ch) {
            // Not resident. Returning 0 would drop the player through the
            // world, but evaluating Perlin here is ruinous: when the draw
            // distance outran residency this path ran PER PIXEL and the
            // terrain pass measured 174 ms/frame against 29 ms.
            // So prefer the ring's LOD grid, which is a plain array read,
            // and only fall back to the field itself when there is no LOD.
            _stats.misses++;
            if (typeof ringMip !== 'undefined' && ringMip && ringMip.procedural) {
                return ringMip.height[ringMipIndex(wx, wy)];
            }
            return WorldGen.heightAtWorld(wx, wy, 0.4);
        }
        var lx = fx - cx * CHUNK, ly = fy - cy * CHUNK;
        return ch[ly * CHUNK + lx];
    }

    function colorAt(wx, wy) {
        if (!_colorLUT) _buildColorLUT();
        return _colorLUT[heightAt(wx, wy)];
    }

    function reset() {
        _slots = new Array(DIM * DIM).fill(null);
        _live = new Uint8Array(DIM * DIM);
        _pending.length = 0;
        _colorLUT = null;
        _stats.generated = 0;
        _stats.misses = 0;
    }

    return {
        CHUNK:          CHUNK,
        // Exposed so the render hot loop can inline the lookup. CHUNK is 512,
        // a power of two, so world -> chunk is (fx >> SHIFT) and world ->
        // texel is (fx & LOCAL_MASK) -- both valid for negative coordinates
        // in two's complement, which Math.floor/division are not free at.
        SHIFT:          9,
        LOCAL_MASK:     511,
        RING_DIM:       DIM,
        RING_MASK:      MASK,
        slots:          function () { return _slots; },
        coords:         function () { return _coords; },
        liveFlags:      function () { return _live; },
        requestAround:  requestAround,
        pump:           pump,
        ensure:         ensure,
        chunkAt:        chunkAt,
        heightAt:       heightAt,
        colorAt:        colorAt,
        colorLUT:       function () { if (!_colorLUT) _buildColorLUT(); return _colorLUT; },
        reset:          reset,
        stats:          _stats,
        residency:      DIM
    };

})();
