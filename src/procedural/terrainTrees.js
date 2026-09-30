// ===============================
// Terrain trees -- procedural forests
// ===============================
// Trunks are stamped into the terrain chunks (chunkTerrain.js), so the voxel
// renderer draws them as solid columns that hills occlude and day/night
// lights like the ground. Same encoding as water: the texel stores the trunk
// TOP for drawing and the trunk height in the colour row, so heightAt() --
// physics, bullets, the minimap -- still sees the real ground. collides()
// blocks walking and the hover bike. Canopies are billboards (the top of
// images/tree.png) handed to the item renderer each frame, nearest first,
// with a depth bias so each covers its own trunk.
//
// PLACEMENT is a pure function of position, so every client sees the same
// trees without storing or sending anything. The world is cut into CELL x
// CELL cells (32 divides the ring length, so the pattern loops); each cell
// may hold one tree, jittered by a hash of the cell. Whether it does comes
// from where it would stand (baked heightmap only):
//   - real elevation: none on beaches, thinning from 1400 m, none above a
//     2200 m treeline (the snowline is 2800 m, rock starts ~900-1400 m)
//   - real slope: none on steep faces
//   - rainfall (the strip's climate data): dense in wet ground, sparse in dry
//   - temperature: none where it is freezing
//   - a large-scale noise field, so there are forests and clearings rather
//     than an even sprinkle
//   - keep-clear zones: spawn and the Node War site, buildings
// Sizes: mostly small, some large, rare giants (giants only in wet lowland;
// forest edges and the treeline get small ones), each +-15%.
//
// ?trees=N scales the density (0 = none). ?oldtrees=1 brings back the old
// random billboard trees, which are hidden while these are in use.
"use strict";

var TerrainTrees = (function () {
    var MAT_TRUNK = 4, MAT_TRUNK_EDGE = 5, MAT_FOREST_FLOOR = 6;   // chunk materials
    var CELL = 32, MARGIN = 8;

    // Size presets (units ~ feet: the player's eye is 7 above the ground).
    var SIZES = [
        { r: 2, trunkH: 55,  canopyBase: 16, canopyW: 30, canopyH: 70  },   // small, ~85 ft
        { r: 4, trunkH: 105, canopyBase: 50, canopyW: 62, canopyH: 110 },   // large, ~160 ft
        { r: 6, trunkH: 140, canopyBase: 70, canopyW: 90, canopyH: 130 }    // giant, 200 ft
    ];

    var cfg = {
        density: 1,
        beachM: 3, treelineLoM: 1400, treelineHiM: 2200,
        slopeLo: 0.5, slopeHi: 0.75,          // real metres per metre
        dryMm: 300, wetMm: 750,                // annual precipitation
        coldLoC: -4, coldHiC: 2,
        forestLo: 0.545, forestHi: 0.585,      // forest-mask ramp: centred on the 65th percentile of the
                                               // noise at suitable sites -> ~35% of that land is forest
        clearR: 380, clearFade: 460,           // around spawn / Node War site (0,0)
        buildingPad: 50,
        canopyDist: 1500, canopyMax: 350       // canopies drawn per frame
    };
    try {
        var _q = parseFloat(new URLSearchParams(location.search).get('trees'));
        if (_q >= 0) cfg.density = _q;
    } catch (e) { /* headless */ }

    function scatterTreesOn() {
        try { return new URLSearchParams(location.search).get('oldtrees') === '1'; }
        catch (e) { return false; }
    }

    function _ringL() {
        return (typeof ringWorld !== 'undefined' && ringWorld.ringLength) ? ringWorld.ringLength : 57344;
    }
    function _seed() { return (WorldGen.config.seed | 0) ^ 0x7ee5; }

    // Deterministic [0,1) from integers.
    function _hash(a, b, salt) {
        var h = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(salt | 0, 2246822519) ^ _seed()) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
        h = Math.imul(h ^ (h >>> 16), 0x2545f491) | 0;
        return ((h >>> 8) & 0xFFFFFF) / 0x1000000;
    }
    function _sstep(a, b, v) {
        var t = (v - a) / (b - a); if (t < 0) t = 0; else if (t > 1) t = 1;
        return t * t * (3 - 2 * t);
    }
    // Smooth value noise in [0,1), wrapping along Y with the ring.
    function _vnoise(x, y, cell, salt) {
        var ny = Math.round(_ringL() / cell);
        var fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
        var tx = fx - ix, ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        var y0 = ((iy % ny) + ny) % ny, y1 = (y0 + 1) % ny;
        var a = _hash(ix, y0, salt), b = _hash(ix + 1, y0, salt);
        var c = _hash(ix, y1, salt), d = _hash(ix + 1, y1, salt);
        var top = a + (b - a) * tx;
        return top + ((c + (d - c) * tx) - top) * ty;
    }
    function _forestNoise(x, y) { return _vnoise(x, y, 720, 11) * 0.65 + _vnoise(x, y, 240, 23) * 0.35; }
    function _forestMask(x, y) { return _sstep(cfg.forestLo, cfg.forestHi, _forestNoise(x, y)); }

    function _metresPerWU() {
        var m = WorldGen.heightmapMeta ? WorldGen.heightmapMeta() : null;
        return m ? m.metresPerPixel * m.length / _ringL() : 3.75;
    }

    // How well a tree would grow here, 0..1, excluding the forest mask.
    // Also returns the pieces the size choice needs.
    function _site(x, y) {
        var m = WorldGen.metresAtWorld(x, y);
        if (m === null || m < cfg.beachM || m > cfg.treelineHiM) return null;
        if (WorldGen.config.edgeWall && Math.abs(x) > WorldGen.wallMaterialX() - 12) return null;
        // Not in or right at the edge of a lake (lakes sit above sea level,
        // so the elevation test alone does not catch them).
        if (WorldGen.lakesInRect && WorldGen.lakesInRect(x - 12, y - 12, x + 12, y + 12)) {
            for (var q = 0; q < 5; q++) {
                var qx = x + (q === 1 ? 10 : q === 2 ? -10 : 0), qy = y + (q === 3 ? 10 : q === 4 ? -10 : 0);
                if (WorldGen.heightAtWorld(qx, qy, 1) < WorldGen.waterSurfaceAt(qx, qy) + 1) return null;
            }
        }
        var elevF = 1 - _sstep(cfg.treelineLoM, cfg.treelineHiM, m);
        var mpw = _metresPerWU(), d = 12;
        var gx = (WorldGen.metresAtWorld(x + d, y) - WorldGen.metresAtWorld(x - d, y)) / (2 * d * mpw);
        var gy = (WorldGen.metresAtWorld(x, y + d) - WorldGen.metresAtWorld(x, y - d)) / (2 * d * mpw);
        var slopeF = 1 - _sstep(cfg.slopeLo, cfg.slopeHi, Math.sqrt(gx * gx + gy * gy));
        var cl = WorldGen.climateAtWorld ? WorldGen.climateAtWorld(x, y) : null;
        var moist = cl ? _sstep(cfg.dryMm, cfg.wetMm, cl.precip) : 1;
        var warm = cl ? _sstep(cfg.coldLoC, cfg.coldHiC, cl.temp) : 1;
        // Keep-clear: spawn and the Node War site around (0,0) -- distance
        // wraps with the ring so the zone is not split at the seam.
        var L = _ringL(), wy = ((y % L) + L) % L; if (wy > L / 2) wy -= L;
        var clearF = _sstep(cfg.clearR, cfg.clearFade, Math.sqrt(x * x + wy * wy));
        if (typeof buildings !== 'undefined') {
            for (var i = 0; i < buildings.length; i++) {
                var b = buildings[i];
                if (Math.abs(x - b.x) < b.width / 2 + cfg.buildingPad && Math.abs(y - b.y) < b.depth / 2 + cfg.buildingPad) return null;
            }
        }
        var s = elevF * slopeF * (0.25 + 0.75 * moist) * warm * clearF;
        return s > 0 ? { s: s, m: m, moist: moist, elevF: elevF } : null;
    }

    // Tree for one cell, or null. Memoised: every consumer (chunk stamping,
    // collision, canopies) asks for the same cells repeatedly.
    var _memo = new Map(), NONE = { none: true };
    function _cellTree(i, jj) {
        var nj = Math.round(_ringL() / CELL), j = ((jj % nj) + nj) % nj;
        var key = i * 131072 + j;
        var t = _memo.get(key);
        if (t === undefined) {
            t = _evalCell(i, j) || NONE;
            if (_memo.size > 200000) _memo.clear();
            _memo.set(key, t);
        }
        if (t === NONE) return null;
        // Same tree on every lap: shift it to the lap the caller asked about.
        var lap = Math.floor(jj / nj) * nj * CELL;
        if (!lap) return t;
        if (!t._laps) t._laps = {};
        return t._laps[lap] || (t._laps[lap] = _shift(t, lap));
    }
    function _shift(t, dy) {
        var c = {}; for (var k in t) if (k !== '_laps' && k !== 'item') c[k] = t[k];
        c.y = t.y + dy; return c;
    }
    function _evalCell(i, j) {
        if (!(cfg.density > 0) || !WorldGen.usingHeightmap || !WorldGen.usingHeightmap()) return null;
        var x = i * CELL + MARGIN + _hash(i, j, 1) * (CELL - 2 * MARGIN);
        var y = j * CELL + MARGIN + _hash(i, j, 2) * (CELL - 2 * MARGIN);
        var site = _site(x, y);
        if (!site) return null;
        var fm = _forestMask(x, y);
        var p = cfg.density * 0.85 * site.s * fm;
        if (_hash(i, j, 3) >= p) return null;
        // Size, ~70 / 25 / 5 overall. Giants only on moist lowland (27% of
        // suitable land, and denser forest), so there the mix is 60 / 30 / 10; elsewhere 72 / 28
        // / 0. Forest edges and the treeline always get small trees.
        var giantOk = site.moist > 0.4 && site.m < 1200;
        var h = _hash(i, j, 4), k = giantOk ? (h < 0.60 ? 0 : (h < 0.90 ? 1 : 2)) : (h < 0.72 ? 0 : 1);
        if (fm < 0.5 || site.elevF < 0.6) k = 0;
        var sz = SIZES[k], f = 0.85 + _hash(i, j, 5) * 0.30;
        var base = Math.round(WorldGen.heightAtWorld(x, y, 1));
        return {
            x: x, y: y, size: k, base: base,
            r: Math.max(1, Math.round(sz.r * f)),
            top: base + Math.round(sz.trunkH * f),
            canopyZ: base + sz.canopyBase * f, canopyW: sz.canopyW * f, canopyH: sz.canopyH * f
        };
    }

    // Trees whose cells overlap a world rectangle.
    function treesInRect(x0, y0, x1, y1) {
        var out = [];
        var i0 = Math.floor((x0 - CELL) / CELL), i1 = Math.floor((x1 + CELL) / CELL);
        var j0 = Math.floor((y0 - CELL) / CELL), j1 = Math.floor((y1 + CELL) / CELL);
        for (var jj = j0; jj <= j1; jj++) for (var i = i0; i <= i1; i++) {
            var t = _cellTree(i, jj); if (t) out.push(t);
        }
        return out;
    }

    // For chunk generation: trees that can touch the chunk (trunk or the
    // darker forest floor under the canopy).
    function touching(ox, oy, size) { return treesInRect(ox - 40, oy - 40, ox + size + 40, oy + size + 40); }

    function collides(x, y, pad) {
        var near = treesInRect(x - 8, y - 8, x + 8, y + 8);
        for (var k = 0; k < near.length; k++) {
            var t = near[k], dx = x - t.x, dy = y - t.y, rr = t.r + (pad || 0);
            if (dx * dx + dy * dy < rr * rr) return true;
        }
        return false;
    }

    // ---- Canopies ----
    var _canopyImg = null;
    function canopyImage() {
        if (_canopyImg) return _canopyImg.complete ? _canopyImg : null;
        var src = (typeof textures !== 'undefined') ? textures.tree : null;
        if (!src || !src.complete || !src.naturalWidth) return null;
        var w = src.naturalWidth, h = Math.round(src.naturalHeight * 0.86);   // drop the painted trunk
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(src, 0, 0, w, h, 0, 0, w, h);
        _canopyImg = new Image();
        _canopyImg.src = c.toDataURL('image/png');
        return null;
    }
    // Canopy items for this frame: within canopyDist, inside the view
    // frustum, nearest canopyMax. Two caches: the distance-sorted trees
    // around the camera are rebuilt only when it moves a cell (scanning
    // ~9000 cells), and the frustum pick from that list only when it turns
    // noticeably -- so turning on the spot never rescans the cells, and the
    // canopyMax budget goes to trees on screen, not the ones beside you.
    var _vis = [], _visKey = '', _near = [], _nearKey = '';
    function visibleCanopies() {
        var img = canopyImage();
        if (!img || !(cfg.density > 0) || typeof camera === 'undefined') return [];
        var R = cfg.canopyDist;
        var posKey = Math.round(camera.x / CELL) + ',' + Math.round(camera.y / CELL);
        if (posKey !== _nearKey) {
            _nearKey = posKey; _visKey = '';
            var all = treesInRect(camera.x - R, camera.y - R, camera.x + R, camera.y + R);
            _near = [];
            for (var k = 0; k < all.length; k++) {
                var t = all[k], dx = t.x - camera.x, dy = t.y - camera.y, d2 = dx * dx + dy * dy;
                if (d2 > R * R) continue;
                t._d2 = d2; _near.push(t);
            }
            _near.sort(function (a, b) { return a._d2 - b._d2; });
        }
        var key = posKey + ',' + Math.round(camera.angle * 20);
        if (key === _visKey) return _vis;
        _visKey = key;
        // Items project with |right| < forward on screen (90 deg across,
        // itemRenderer.js). The 1.12 slack covers the 1/20 rad the angle key
        // rounds away, so nothing pops in at the screen edge while turning.
        var fx = -Math.sin(camera.angle), fy = -Math.cos(camera.angle);
        var rx = Math.cos(camera.angle), ry = -Math.sin(camera.angle);
        _vis = [];
        for (var n = 0; n < _near.length && _vis.length < cfg.canopyMax; n++) {
            var c = _near[n], cx = c.x - camera.x, cy = c.y - camera.y;
            var fwd = cx * fx + cy * fy, side = cx * rx + cy * ry;
            if (fwd < -c.canopyW) continue;                              // behind the camera
            if (Math.abs(side) > fwd * 1.12 + c.canopyW) continue;       // off the side of the screen
            _vis.push(c.item || (c.item = { type: 'canopy', x: c.x, y: c.y, z: c.canopyZ,
                w: c.canopyW, h: c.canopyH, depthBias: c.r + 1, dx: 0, dy: 0, dz: 0, image: img }));
        }
        return _vis;
    }

    // 0..1 how forested the ground is here, without the per-cell dice --
    // for far views (ring LOD, menu map) that cannot draw every tree.
    function forestDensityAt(x, y) {
        if (!(cfg.density > 0) || !WorldGen.usingHeightmap || !WorldGen.usingHeightmap()) return 0;
        var site = _site(x, y);
        return site ? Math.min(1, cfg.density * 0.85 * site.s * _forestMask(x, y)) : 0;
    }
    // Darken a packed ABGR colour toward forest green by density.
    function tintForest(col, x, y) {
        var f = forestDensityAt(x, y) * 0.55;
        if (!(f > 0)) return col;
        var r = col & 255, g = (col >> 8) & 255, b = (col >> 16) & 255;
        r += (34 - r) * f; g += (62 - g) * f; b += (30 - b) * f;
        return (0xFF000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
    }

    // Forget cached placement (the world or the buildings changed) and drop
    // any canopy items left over from the old test trees.
    function refresh() {
        _memo.clear(); _vis = []; _visKey = ''; _near = []; _nearKey = '';
        if (typeof items !== 'undefined') {
            for (var i = items.length - 1; i >= 0; i--) if (items[i] && items[i].type === 'canopy') items.splice(i, 1);
        }
        canopyImage();
    }

    return {
        MAT_TRUNK: MAT_TRUNK, MAT_TRUNK_EDGE: MAT_TRUNK_EDGE, MAT_FOREST_FLOOR: MAT_FOREST_FLOOR,
        config: cfg,
        scatterTreesOn: scatterTreesOn,
        treesInRect: treesInRect,
        touching: touching,
        collides: collides,
        visibleCanopies: visibleCanopies,
        forestDensityAt: forestDensityAt,
        tintForest: tintForest,
        refresh: refresh,
        _debug: { site: function (x, y) { return _site(x, y); }, forestNoise: _forestNoise }   // tuning/tests
    };
})();
