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
    var _biomes  = new Uint8Array(DIM * DIM);   // one biome id per resident chunk
    var _pending = [];
    var _colorLUTs = null;   // array of Uint32Array(256), one per biome
    // Day/night lit variants of _colorLUTs, keyed [biome][chunkY wrapped to
    // the loop] -- see litLUT() below. Rebuilt lazily per entry, wholesale
    // invalidated when DayNight.epoch() advances (at most every 15s -- see
    // dayNightCycle.js), never per frame and never inside the render hot
    // loop's per-pixel path.
    var _litLUTs   = null;
    var _litEpoch  = -1;
    var _stats   = { generated: 0, lastMs: 0, misses: 0 };

    // Colour is DERIVED from height through a 256-entry lookup rather than
    // stored -- 4 bytes per texel saved, same cost to read. One LUT per
    // BIOME rather than one global LUT: land colour differs by biome, so a
    // single table cannot represent it. The chunk's biome is decided ONCE at
    // generation (its centre position), not per texel -- see _generate --
    // which is what keeps this a per-CHUNK array lookup rather than a
    // per-pixel biome computation in the render hot loop.
    //
    // Texels are Uint32: height in the low 16 bits (a baked heightmap can
    // exceed 255 -- see worldGen.js hmTop), colour index in the high 16.
    // The colour index is material (worldGen.js MAT_*) << 8 | colour row,
    // where the row is the height itself below 256, quantised above it
    // (WorldGen.colorRowTable). The LUT is 768 entries -- material 0, snow,
    // wall -- and the render loop indexes it with (texel >>> 16), still one
    // read. Height alone is (texel & 0xFFFF).
    // Material 3 (water, baked heightmap only) is indexed by depth, not
    // height: its row is units below the surface. Materials 4/5 are tree
    // trunk core/edge (terrainTrees.js): row = trunk height above ground.
    // Material 6 is forest floor under a canopy: ordinary ground, darker.
    var LUT_SIZE = 1792;
    function _buildColorLUTs() {
        var n = WorldGen.biomeCount();
        _colorLUTs = [];
        for (var b = 0; b < n; b++) {
            var arr = new Uint32Array(LUT_SIZE);
            for (var v = 0; v < LUT_SIZE; v++) {
                arr[v] = (v >> 8) === 3 && WorldGen.waterColor
                    ? WorldGen.waterColor(v & 255)
                    : WorldGen.colorForHeightBiome(WorldGen.heightForColorRow(v & 255), b, v >> 8);
            }
            _colorLUTs.push(arr);
        }
    }

    // A day/night-lit variant of _colorLUTs[biome], darkened for whichever
    // point on the loop worldY falls in. Cached per (biome, chunk-Y wrapped
    // to the loop) so repeat lookups for the same chunk cost one array
    // index, not 256 multiplies -- the render hot loop only calls this from
    // its already-hoisted "chunk changed" branch (see voxelEngine.js), never
    // per pixel. The whole cache is dropped (not rebuilt) when
    // DayNight.epoch() ticks, so entries are regenerated lazily as chunks
    // are actually revisited rather than all at once.
    function litLUT(biome, worldY) {
        if (!_colorLUTs) _buildColorLUTs();
        if (typeof DayNight === 'undefined') return _colorLUTs[biome];

        var ep = DayNight.epoch();
        if (ep !== _litEpoch) { _litLUTs = null; _litEpoch = ep; }
        if (!_litLUTs) _litLUTs = [];
        if (!_litLUTs[biome]) _litLUTs[biome] = [];

        var ringChunks = Math.max(1, Math.round((typeof ringWorld !== 'undefined' ? ringWorld.ringLength : 0) / CHUNK));
        var cy = Math.floor(worldY / CHUNK);
        var cyWrapped = ((cy % ringChunks) + ringChunks) % ringChunks;

        var cached = _litLUTs[biome][cyWrapped];
        if (cached) return cached;

        var base = _colorLUTs[biome];
        var intensity = DayNight.intensityAtY(cyWrapped * CHUNK + CHUNK / 2);
        var out = new Uint32Array(LUT_SIZE);
        for (var h = 0; h < LUT_SIZE; h++) out[h] = DayNight.scaleColor(base[h], intensity);
        _litLUTs[biome][cyWrapped] = out;
        return out;
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

        // Real elevation (metres) on the same lattice, for materials. Only a
        // baked heightmap has it; without one every texel is material 0.
        var hmOn = !!(WorldGen.usingHeightmap && WorldGen.usingHeightmap());
        var mlat = hmOn ? new Float32Array(N * N) : null;
        var mlatAll = mlat;   // kept for the rock speckle after the snow early-out
        var seaOn = hmOn && !!WorldGen.waterColor, seaH = WorldGen.config.seaLevel;
        // Baked lakes (lake_bake.py) have their own surface; only chunks that
        // overlap a lake pay the per-texel lookup.
        var lakeHere = seaOn && WorldGen.lakesInRect && WorldGen.lakesInRect(ox, oy, ox + CHUNK, oy + CHUNK);
        // Water surface on the same 8 WU lattice (one lookup per lattice
        // point, not per texel); a texel takes the highest of its 4 corners.
        var wlat = null;
        if (lakeHere) {
            wlat = new Float32Array(N * N);
            for (var wj = 0; wj < N; wj++) for (var wi = 0; wi < N; wi++)
                wlat[wj * N + wi] = Math.round(WorldGen.waterSurfaceAt(ox + wi * NOISE_STEP, oy + wj * NOISE_STEP));
        }
        for (var j = 0; j < N; j++) {
            var wy = oy + j * NOISE_STEP;
            for (var i = 0; i < N; i++) {
                lat[j * N + i] = WorldGen.heightAtWorld(ox + i * NOISE_STEP, wy, 1);
                if (mlat) mlat[j * N + i] = WorldGen.metresAtWorld(ox + i * NOISE_STEP, wy);
            }
        }
        // Most chunks never reach the snowline; skip per-texel material work
        // for the whole chunk when its lattice is clearly below it, and fill
        // snow outright when clearly above. Only chunks straddling it pay.
        var snowAll = false, snowLo = 0, snowHi = 0;
        if (mlat) {
            var snowCfg = WorldGen.config;
            snowLo = snowCfg.snowlineM - snowCfg.snowEdgeM;   // below: never snow
            snowHi = snowCfg.snowlineM + snowCfg.snowEdgeM;   // above: always snow
            var mMin = Infinity, mMax = -Infinity;
            for (var q = 0; q < mlat.length; q++) { var mv = mlat[q]; if (mv < mMin) mMin = mv; if (mv > mMax) mMax = mv; }
            if (mMax <= snowLo) mlat = null;
            else if (mMin > snowHi) { snowAll = true; mlat = null; }
        }

        var out = new Uint32Array(CHUNK * CHUNK);
        // Height -> colour row (null: identity, heights all fit in 255) and
        // the X beyond which a baked heightmap paints the rim wall.
        var rowTbl = WorldGen.colorRowTable ? WorldGen.colorRowTable() : null;
        var rowTop = rowTbl ? rowTbl.length - 1 : 255;
        var wallX = (hmOn && WorldGen.config.edgeWall) ? WorldGen.wallMaterialX() : Infinity;

        // Rock speckle (WorldGen.colorHeightAt, after VoxelMaster-Minimal):
        // colour-only, and only on rocky ground, so skip it for the whole
        // chunk when no lattice point reaches the rock bands.
        var spk = (hmOn && WorldGen.speckleParams) ? WorldGen.speckleParams() : null;
        if (spk) {
            var mAllMax = -Infinity;
            for (var q2 = 0; q2 < mlatAll.length; q2++) if (mlatAll[q2] > mAllMax) mAllMax = mlatAll[q2];
            if (mAllMax <= spk.loM) spk = null;   // no rocky real ground in this chunk
        }
        // One colour row, in height units, for the per-texel jitter.
        var rowUnits = rowTbl ? (rowTbl.length - 1 - 64) / (255 - 64) : 1;
        // The speckle field (rock colour and the snow edge) is smooth below
        // 14 WU, so it is evaluated on a 4 WU grid and interpolated per
        // texel -- 1/16 of the noise calls of doing it per texel.
        var SG = 4, SGN = CHUNK / SG + 1, sg = null;
        if (spk || mlat) {
            sg = new Float32Array(SGN * SGN);
            for (var gj = 0; gj < SGN; gj++) {
                for (var gi = 0; gi < SGN; gi++) sg[gj * SGN + gi] = WorldGen.speckleAt(ox + gi * SG, oy + gj * SG);
            }
        }
        var inv = 1 / NOISE_STEP;

        // Buildings (src/indoor/buildingPlacer.js) are sited by WorldGen
        // height and rendered at a fixed baseZ, but the SURROUNDING ground
        // generated here goes through a coarse lattice + bilinear + hash
        // detail approximation of that same field -- not identical to it.
        // Without flattening, the building's floor plane and the chunked
        // ground around it disagree by a texel or two, which reads as the
        // building floating or sinking slightly relative to its own
        // doorstep. So: any registered building whose footprint (+ a blend
        // apron) overlaps THIS chunk gets its ground forced to that
        // building's baseZ here, once, at generation time -- not per frame.
        // Cheap early-out: at most a handful of buildings exist, and this
        // chunk almost always overlaps none of them (buildings are one per
        // biome sector, biome sectors are ~8-11k WU wide, chunks are 512).
        var touching = null;
        if (typeof buildings !== 'undefined' && buildings.length) {
            var APRON = 24;
            for (var bi = 0; bi < buildings.length; bi++) {
                var bcfg = buildings[bi];
                var bx0 = bcfg.x - bcfg.width/2 - APRON, bx1 = bcfg.x + bcfg.width/2 + APRON;
                var by0 = bcfg.y - bcfg.depth/2 - APRON, by1 = bcfg.y + bcfg.depth/2 + APRON;
                if (ox+CHUNK < bx0 || ox > bx1 || oy+CHUNK < by0 || oy > by1) continue;
                (touching || (touching = [])).push(bcfg);
            }
        }

        for (var y = 0; y < CHUNK; y++) {
            var fy = y * inv, j0 = fy | 0, ty = fy - j0, j1 = j0 + 1;
            var r0 = j0 * N, r1 = j1 * N;
            var rowBase = y * CHUNK, wy2 = oy + y;
            for (var x = 0; x < CHUNK; x++) {
                var fx = x * inv, i0 = fx | 0, tx = fx - i0, i1 = i0 + 1;
                var a = lat[r0 + i0], b = lat[r0 + i1];
                var c = lat[r1 + i0], d = lat[r1 + i1];
                var top = a + (b - a) * tx, bot = c + (d - c) * tx;
                var h = top + (bot - top) * ty;
                // Per-texel roughness, except within 2 units of the sea surface
                // (baked heightmap): there it flipped neighbouring texels between
                // beach and water, a salt-and-pepper shoreline. Without it the
                // waterline follows the smooth terrain contour.
                var ws = seaH;                                                   // water surface here
                if (wlat) {
                    var wa = wlat[r0 + i0], wb = wlat[r0 + i1], wc = wlat[r1 + i0], wd = wlat[r1 + i1];
                    ws = wa > wb ? wa : wb; if (wc > ws) ws = wc; if (wd > ws) ws = wd;
                }
                if (!(seaOn && h > ws - 2 && h < ws + 2)) h += _detail(ox + x, wy2) * 2.0;

                if (touching) {
                    var wx2 = ox + x;
                    for (var ti = 0; ti < touching.length; ti++) {
                        var t = touching[ti];
                        var dxIn = Math.max(0, Math.abs(wx2 - t.x) - t.width/2);
                        var dyIn = Math.max(0, Math.abs(wy2 - t.y) - t.depth/2);
                        var d2 = Math.sqrt(dxIn*dxIn + dyIn*dyIn);
                        if (d2 >= APRON) continue;
                        var bt = 1 - (d2 / APRON);
                        bt = bt*bt*(3-2*bt);          // smoothstep: no hard rim at the apron edge
                        h = h + (t.baseZ - h) * bt;
                    }
                }
                var wx3 = ox + x;
                // Water (baked heightmap): store the flat SURFACE with the
                // depth in the colour row; heightAt() recovers the floor.
                if (seaOn && h < ws && wx3 <= wallX && -wx3 <= wallX) {
                    var dep = Math.round(ws - h);
                    out[rowBase + x] = (ws | (((3 << 8) | (dep > 255 ? 255 : dep)) << 16)) >>> 0;
                    continue;
                }
                var hv = h < 0 ? 0 : (h > 65535 ? 65535 : h) | 0;
                var mat = 0, spv = 0;
                if (sg) {
                    var sgx = x >> 2, sgy = y >> 2, sfx = (x & 3) * 0.25, sfy = (y & 3) * 0.25;
                    var s00 = sg[sgy * SGN + sgx], s10 = sg[sgy * SGN + sgx + 1];
                    var s01 = sg[(sgy + 1) * SGN + sgx], s11 = sg[(sgy + 1) * SGN + sgx + 1];
                    var s0 = s00 + (s10 - s00) * sfx;
                    spv = s0 + ((s01 + (s11 - s01) * sfx) - s0) * sfy;
                }
                if (wx3 > wallX || -wx3 > wallX) mat = 2;   // worldGen.js MAT_WALL
                else if (snowAll) mat = 1;                   // MAT_SNOW
                else if (mlat) {
                    var ma = mlat[r0 + i0], mb = mlat[r1 + i0], mc = mlat[r0 + i1], md = mlat[r1 + i1];
                    // per 8x8 lattice cell: all four corners clear of the
                    // ragged edge band decides the whole cell without a call
                    if (ma > snowHi && mb > snowHi && mc > snowHi && md > snowHi) mat = 1;
                    else if (ma > snowLo || mb > snowLo || mc > snowLo || md > snowLo) {
                        var mt = ma + (mc - ma) * tx;
                        var m = mt + ((mb + (md - mb) * tx) - mt) * ty;
                        mat = WorldGen.snowForMetres(m, spv);
                    }
                }
                var hc = hv;
                if (spk && mat === 0) {
                    var am = mlatAll[r0 + i0], bm = mlatAll[r0 + i1];
                    var mtop = am + (bm - am) * tx;
                    var mr = mtop + ((mlatAll[r1 + i0] + (mlatAll[r1 + i1] - mlatAll[r1 + i0]) * tx) - mtop) * ty;
                    if (mr > spk.loM) {
                        // speckle plus a +-1 colour-row jitter per texel (the
                        // equivalent of VoxelMaster's per-pixel variation)
                        var sw8 = mr >= spk.fullM ? 1 : (mr - spk.loM) / (spk.fullM - spk.loM);
                        hc = hv + (spv * spk.amp + _detail(wx3 + 7919, wy2) * 2 * rowUnits) * sw8;
                        if (hc < spk.floor) hc = spk.floor;
                        hc = hc | 0;
                    }
                }
                var hr = hc > rowTop ? rowTop : hc;
                var crow = rowTbl ? rowTbl[hr] : hr;
                out[rowBase + x] = (hv | (((mat << 8) | crow) << 16)) >>> 0;
            }
        }

        // Trees (terrainTrees.js), stamped after the ground so each touches
        // only its own texels. Forest floor first -- plain ground (material
        // 0) under the inner part of a canopy turns darker (material 6),
        // which is also what makes forests read from a distance -- then the
        // trunk: its flat TOP is stored for drawing and its height above
        // this texel's ground goes in the row (heightAt subtracts it), core
        // vs darker edge ring as materials 4 / 5. Water texels are skipped.
        if (hmOn && typeof TerrainTrees !== 'undefined') {
            var trees = TerrainTrees.touching(ox, oy, CHUNK);
            for (var tk = 0; tk < trees.length; tk++) {
                var tr = trees[tk], fr = tr.canopyW * 0.32;
                _stampDisc(out, ox, oy, tr.x, tr.y, fr, function (v) {
                    if (((v >>> 16) >> 8) !== 0) return v;
                    return ((v & 0xFFFF) | ((((6 << 8) | ((v >>> 16) & 255))) << 16)) >>> 0;
                });
            }
            for (tk = 0; tk < trees.length; tk++) {
                var tt = trees[tk], rr1 = (tt.r - 1) * (tt.r - 1);
                _stampDisc(out, ox, oy, tt.x, tt.y, tt.r, function (v, d2) {
                    var m0 = (v >>> 16) >> 8;
                    if (m0 === 3) return v;                              // no trunks in water
                    var g = (m0 === 4 || m0 === 5) ? (v & 0xFFFF) - ((v >>> 16) & 255) : (v & 0xFFFF);
                    var row = tt.top - g; if (row < 0) row = 0; else if (row > 255) row = 255;
                    return ((g + row) | ((((d2 > rr1 ? 5 : 4) << 8) | row) << 16)) >>> 0;
                });
            }
        }

        _stats.generated++;
        _stats.lastMs = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0;

        // Biome is decided by the CHUNK'S CENTRE, once, not per texel. A
        // chunk (512 WU) is far smaller than a biome sector (thousands of
        // WU), so this is right for the vast majority of a chunk's area. The
        // only place it could be "wrong" is a chunk that straddles a sector
        // boundary -- but the moat (350 WU either side, see worldGen.js)
        // forces that whole area to water, and water colour is the same in
        // every biome's LUT, so a mismatched land-colour choice there is
        // never actually visible.
        var bio = (typeof WorldGen !== 'undefined')
            ? WorldGen.biomeIndexAt(oy + CHUNK / 2) : 0;

        return { height: out, biome: bio };
    }

    // Apply fn(texel, d2) to every texel of this chunk within radius r of
    // (cx, cy) in world units.
    function _stampDisc(out, ox, oy, cx, cy, r, fn) {
        var x0 = Math.max(0, Math.floor(cx - r - ox)), x1 = Math.min(CHUNK - 1, Math.ceil(cx + r - ox));
        var y0 = Math.max(0, Math.floor(cy - r - oy)), y1 = Math.min(CHUNK - 1, Math.ceil(cy + r - oy));
        var r2 = r * r;
        for (var y = y0; y <= y1; y++) {
            var dy = oy + y - cy;
            for (var x = x0; x <= x1; x++) {
                var dx = ox + x - cx, d2 = dx * dx + dy * dy;
                if (d2 <= r2) out[y * CHUNK + x] = fn(out[y * CHUNK + x], d2);
            }
        }
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
        var gen = _generate(cx, cy);
        _slots[s] = gen.height;
        _biomes[s] = gen.biome;
        _coords[s * 2] = cx; _coords[s * 2 + 1] = cy;
        _live[s] = 1;
        return _slots[s];
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
        var v = ch[ly * CHUNK + lx], ci = v >>> 16;
        // Low 16 bits: height. For water texels that is the surface and for
        // tree trunks the trunk top; the ground -- what heightAt means -- is
        // that minus the row (depth / trunk height). Materials 3, 4, 5.
        var mt = ci >> 8;
        return (mt >= 3 && mt <= 5) ? (v & 0xFFFF) - (ci & 255) : (v & 0xFFFF);
    }

    // Walkable-or-floatable top: the water surface over water, else the
    // ground. What a hover vehicle rides on.
    function surfaceAt(wx, wy) {
        var fx = Math.floor(wx), fy = Math.floor(wy);
        var cx = Math.floor(fx / CHUNK), cy = Math.floor(fy / CHUNK);
        var ch = chunkAt(cx, cy);
        if (!ch) {
            var h = heightAt(wx, wy);
            if (WorldGen.usingHeightmap && WorldGen.usingHeightmap()) {
                var wsm = WorldGen.waterSurfaceAt ? WorldGen.waterSurfaceAt(wx, wy) : WorldGen.config.seaLevel;
                if (h < wsm) h = wsm;
            }
            return h;
        }
        var v = ch[(fy - cy * CHUNK) * CHUNK + (fx - cx * CHUNK)], m = (v >>> 16) >> 8;
        // Water: the surface. Trunks: the ground under them (vehicles are
        // blocked by the trunk, they do not ride up it).
        return (m === 4 || m === 5) ? (v & 0xFFFF) - ((v >>> 16) & 255) : (v & 0xFFFF);
    }

    // Deliberately UNLIT (raw _colorLUTs, not litLUT()) -- callers that want
    // day/night lighting apply DayNight.litColor()/litLUT() explicitly at
    // their own sample point (voxelEngine.js's hot loop, ringWorld.js's
    // backdrop). Keeping this one raw avoids double-lighting wherever a
    // caller falls back to colorAt() from a path that will light it itself,
    // and avoids ever baking a lighting snapshot into anything cached longer
    // than DayNight's own epoch (a precomputed ring mip, for instance).
    function colorAt(wx, wy) {
        if (!_colorLUTs) _buildColorLUTs();
        var fx = Math.floor(wx), fy = Math.floor(wy);
        var cx = Math.floor(fx / CHUNK), cy = Math.floor(fy / CHUNK);
        var s = _slotOf(cx, cy);
        var hit = _live[s] && _coords[s * 2] === cx && _coords[s * 2 + 1] === cy;
        if (hit) {
            var lx = fx - cx * CHUNK, ly = fy - cy * CHUNK;
            return _colorLUTs[_biomes[s]][_slots[s][ly * CHUNK + lx] >>> 16];   // colour index
        }
        var h = heightAt(wx, wy);
        return _colorLUTs[WorldGen.biomeIndexAt(wy)][WorldGen.colorIndex(h, WorldGen.materialAtWorld(wx, wy))];
    }

    function reset() {
        _slots = new Array(DIM * DIM).fill(null);
        _live = new Uint8Array(DIM * DIM);
        _biomes = new Uint8Array(DIM * DIM);
        _litLUTs = null;
        _litEpoch = -1;
        _pending.length = 0;
        _colorLUTs = null;
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
        biomes:         function () { return _biomes; },
        requestAround:  requestAround,
        pump:           pump,
        ensure:         ensure,
        chunkAt:        chunkAt,
        heightAt:       heightAt,
        surfaceAt:      surfaceAt,
        colorAt:        colorAt,
        colorLUTs:      function () { if (!_colorLUTs) _buildColorLUTs(); return _colorLUTs; },
        litLUT:         litLUT,
        reset:          reset,
        stats:          _stats,
        residency:      DIM
    };

})();
