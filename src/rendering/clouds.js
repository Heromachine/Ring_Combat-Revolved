// ===============================
// Clouds -- a drifting cloud layer, weather, rain
// ===============================
// The clouds are a layer at a fixed altitude (cfg.altitude). For each sky
// block the view ray is intersected with that plane; the hit point reads a
// tileable noise texture (two layers drifting with the wind) and a slowly
// moving weather field decides how much of the sky is covered and how
// stormy it is. Near clouds are large overhead, far ones shrink toward the
// horizon and fade out by cfg.fadeTo.
//
// Weather varies around the ring: clear stretches, scattered white/grey
// cumulus, and dark storm areas that bring rain (screen-space streaks) when
// the player is under one. It is a function of position and the clock, so
// everyone sees the same weather.
//
// Cost: sky pixels only, in 2x2 blocks like the sky and the ring backdrop.
// Blocks the clouds make fully opaque are skipped by RenderRingBackdrop()
// (the far side of the ring overhead, one of the dearer passes), so a
// cloudy sky can cost less than a clear one.
//
// Frame order (main.js): Render() -> Clouds.prepare() -> RenderRingBackdrop()
// -> Clouds.blend() -> sprites -> Clouds.rain() -> Flip().
// ?clouds=0 turns them off.
"use strict";

var Clouds = (function () {
    var cfg = {
        enabled: true,
        altitude: 1400,          // cloud plane height (units; eye ~ ground + 7, peaks up to ~900)
        fadeFrom: 4500, fadeTo: 11000,   // distance fade toward the horizon (WU)
        texWU: 32,               // world units per cloud texel: 256 x 32 = 8192, divides the ring (7x)
        windA: [5, 22], windB: [-9, 34],   // WU/s for the two drifting layers
        stormRain: 0.45          // storm level at the player where rain starts
    };
    try {
        if (new URLSearchParams(location.search).get('clouds') === '0') cfg.enabled = false;
    } catch (e) { /* headless */ }

    var N = 256, MASK = 255, tex = null;
    var frameStorm = 0;          // storm level at the camera this frame

    function _ringL() { return (typeof ringWorld !== 'undefined' && ringWorld.ringLength) ? ringWorld.ringLength : 57344; }
    function _hash(a, b, salt) {
        var h = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(salt | 0, 2246822519) ^ 0x5eed) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
        h = Math.imul(h ^ (h >>> 16), 0x2545f491) | 0;
        return ((h >>> 8) & 0xFFFFFF) / 0x1000000;
    }
    function _sstep(a, b, v) { var t = (v - a) / (b - a); if (t < 0) t = 0; else if (t > 1) t = 1; return t * t * (3 - 2 * t); }

    // Tileable fbm value noise, N x N, periods that divide N so it wraps.
    function _buildTexture() {
        tex = new Float32Array(N * N);
        var octs = [[8, 0.5], [16, 0.27], [32, 0.15], [64, 0.08]];   // cells per tile, weight
        for (var o = 0; o < octs.length; o++) {
            var P = octs[o][0], wgt = octs[o][1], cell = N / P;
            for (var y = 0; y < N; y++) {
                var fy = y / cell, iy = Math.floor(fy), ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
                for (var x = 0; x < N; x++) {
                    var fx = x / cell, ix = Math.floor(fx), tx = fx - ix; tx = tx * tx * (3 - 2 * tx);
                    var x0 = ix % P, x1 = (ix + 1) % P, y0 = iy % P, y1 = (iy + 1) % P;
                    var a = _hash(x0, y0, o), b = _hash(x1, y0, o), c = _hash(x0, y1, o), d = _hash(x1, y1, o);
                    var top = a + (b - a) * tx;
                    tex[y * N + x] += (top + ((c + (d - c) * tx) - top) * ty) * wgt;
                }
            }
        }
        // normalise to 0..1
        var lo = 1e9, hi = -1e9, i;
        for (i = 0; i < tex.length; i++) { if (tex[i] < lo) lo = tex[i]; if (tex[i] > hi) hi = tex[i]; }
        for (i = 0; i < tex.length; i++) tex[i] = (tex[i] - lo) / (hi - lo);
    }
    function _texAt(u, v) {             // bilinear, u/v in texels, wraps
        var iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
        var u0 = iu & MASK, v0 = iv & MASK, u1 = (u0 + 1) & MASK, v1 = (v0 + 1) & MASK;
        var a = tex[v0 * N + u0], b = tex[v0 * N + u1], c = tex[v1 * N + u0], d = tex[v1 * N + u1];
        var top = a + (b - a) * fu;
        return top + ((c + (d - c) * fu) - top) * fv;
    }

    // Weather along the ring: periodic value noise in Y (8 cells per lap),
    // plus a weak X term, drifting slowly with time. Returns coverage 0..1
    // (share of sky that is cloud) and storm 0..1.
    var _wxCells = 8;
    function _wxNoise(y, t, salt) {
        var L = _ringL(), f = (((y / L) % 1) + 1) % 1 * _wxCells + t * 0.0009, i = Math.floor(f), ft = f - i;
        ft = ft * ft * (3 - 2 * ft);
        var a = _hash(((i % _wxCells) + _wxCells) % _wxCells, 0, salt), b = _hash((((i + 1) % _wxCells) + _wxCells) % _wxCells, 0, salt);
        return a + (b - a) * ft;
    }
    function weatherAt(x, y, tSec) {
        var n = _wxNoise(y, tSec, 101) * 0.75 + _wxNoise(y * 3.0 + x * 1.7, tSec * 1.3, 202) * 0.25;
        var coverage = 0.15 + 0.8 * n;                  // 0.15 .. 0.95
        var storm = _sstep(0.68, 0.9, n);
        return { coverage: coverage, storm: storm };
    }

    function _now() { return Date.now() / 1000; }

    // ---- Per-frame passes ----
    // Cloud cover is evaluated on a CS x CS pixel grid (grid POINTS at
    // multiples of CS) and blended with bilinear interpolation between them:
    // a quarter of the samples of the 2x2 backdrop grid, and softer edges.
    var CS = 4;
    var gw = 0, gh = 0, gA = null, gR = null, gG = null, gB = null, gD = null, gDirty = false;
    var LT_STEP = 512, lightTab = null;      // day/night brightness along the ring, per frame

    function prepare() {
        gDirty = false;
        if (!cfg.enabled || (typeof underwaterState !== 'undefined' && underwaterState.active)) { frameStorm = 0; return; }
        if (!tex) _buildTexture();
        var sw = screendata.canvas.width, sh = screendata.canvas.height;
        var ngw = Math.ceil(sw / CS) + 1, ngh = Math.ceil(sh / CS) + 1;
        if (!gA || ngw !== gw || ngh !== gh) {           // reused every frame
            gw = ngw; gh = ngh; var n = gw * gh;
            gA = new Float32Array(n); gR = new Float32Array(n); gG = new Float32Array(n); gB = new Float32Array(n); gD = new Float32Array(n);
        }
        gA.fill(0);

        var H = cfg.altitude, camH = camera.height, tSec = _now();
        var wxC = weatherAt(camera.x, camera.y, tSec);
        frameStorm = wxC.storm;
        if (camH >= H) return;

        var L = _ringL(), nL = Math.ceil(L / LT_STEP);
        if (!lightTab || lightTab.length !== nL) lightTab = new Float32Array(nL);
        var dayN = (typeof DayNight !== 'undefined');
        for (var li = 0; li < nL; li++) lightTab[li] = dayN ? 0.1 + 0.9 * DayNight.intensityAtY(li * LT_STEP + LT_STEP / 2) : 1;

        var sinA = Math.sin(camera.angle), cosA = Math.cos(camera.angle);
        var Fx = -sinA, Fy = -cosA, Rx = cosA, Ry = -sinA;
        var focal = camera.focalLength, hCy = sh / 2;
        var elevC = Math.atan((camera.horizon - hCy) / focal), cE = Math.cos(elevC), sE = Math.sin(elevC);
        var f3x = Fx * cE, f3y = Fy * cE, f3z = sE, u3x = -Ry * sE, u3y = Rx * sE, u3z = cE;

        var invTex = 1 / cfg.texWU, dH = H - camH;
        var aOffU = cfg.windA[0] * tSec * invTex, aOffV = cfg.windA[1] * tSec * invTex;
        var bOffU = cfg.windB[0] * tSec * invTex * 2, bOffV = cfg.windB[1] * tSec * invTex * 2;
        var fadeFrom = cfg.fadeFrom, fadeSpan = cfg.fadeTo - cfg.fadeFrom;

        for (var gx = 0; gx < gw; gx++) {
            var x = gx * CS, xc = x < sw ? x : sw - 1;
            // grid points down to one cell below the terrain edge of this
            // column and its neighbour, so interpolation has both corners
            var top = hiddeny[xc]; var xn = xc + CS < sw ? xc + CS : sw - 1; if (hiddeny[xn] > top) top = hiddeny[xn];
            if (top > sh) top = sh;
            if (top <= 0) continue;
            var sx = 2 * x / sw - 1, colWx = null;
            var ymax = top + CS;
            for (var gy = 0; gy * CS <= ymax && gy < gh; gy++) {
                var y = gy * CS, sy = (hCy - y) / focal;
                var rz = f3z + sy * u3z;
                if (rz <= 0.02) break;                            // at/below the horizon: rest of column too
                var rx = f3x + sx * Rx + sy * u3x, ry = f3y + sx * Ry + sy * u3y;
                var t = dH / rz;
                var hx = camera.x + rx * t, hy = camera.y + ry * t;
                var dist = t * Math.sqrt(rx * rx + ry * ry + rz * rz);
                if (dist > cfg.fadeTo) continue;
                if (!colWx) colWx = weatherAt(hx, hy, tSec);
                var edge = 1 - colWx.coverage;
                var u = hx * invTex, v = hy * invTex;
                var d = _texAt(u + aOffU, v + aOffV) * 0.7 + _texAt(u * 2 + bOffU, v * 2 + bOffV) * 0.3;
                var a = _sstep(edge, edge + 0.22, d);
                if (a <= 0.004) continue;
                if (dist > fadeFrom) a *= 1 - (dist - fadeFrom) / fadeSpan;
                var thick = _sstep(edge + 0.1, edge + 0.5, d);
                var r = 244 - 90 * thick, g = 246 - 88 * thick, b = 250 - 80 * thick;
                var st = colWx.storm * (0.65 + 0.35 * thick);          // storms: near-black cloud bases
                r += (30 - r) * st; g += (32 - g) * st; b += (40 - b) * st;
                var wy = ((hy % L) + L) % L, k = lightTab[(wy / LT_STEP) | 0];
                var gi = gy * gw + gx;
                gA[gi] = a > 1 ? 1 : a; gR[gi] = r * k; gG[gi] = g * k; gB[gi] = b * k; gD[gi] = dist;
                gDirty = true;
            }
        }
    }

    // RenderRingBackdrop asks this per 2x2 block: a block inside a grid cell
    // whose four corners are all opaque needs no far-ring sample.
    function opaqueAt(x, y) {
        if (!gDirty) return false;
        var cx = (x / CS) | 0, cy = (y / CS) | 0, i = cy * gw + cx;
        return gA[i] > 0.985 && gA[i + 1] > 0.985 && gA[i + gw] > 0.985 && gA[i + gw + 1] > 0.985;
    }

    function blend() {
        if (!gDirty) return;
        var sw = screendata.canvas.width, sh = screendata.canvas.height;
        var buf = screendata.buf32, depth = screendata.depthBuffer, inv = 1 / CS;
        for (var cy = 0; cy < gh - 1; cy++) {
            for (var cx = 0; cx < gw - 1; cx++) {
                var i00 = cy * gw + cx, i10 = i00 + 1, i01 = i00 + gw, i11 = i01 + 1;
                var a00 = gA[i00], a10 = gA[i10], a01 = gA[i01], a11 = gA[i11];
                if (a00 + a10 + a01 + a11 <= 0.016) continue;        // no cloud in this cell
                // nearest-corner distance is plenty for the depth test
                var dist = Math.max(gD[i00], gD[i10], gD[i01], gD[i11]);
                if (a00 > 0.985 && a10 > 0.985 && a01 > 0.985 && a11 > 0.985) {
                    // Fully opaque cell (most of an overcast/storm sky): no
                    // alpha maths, just the colour interpolated down each row.
                    for (var qy = 0; qy < CS; qy++) {
                        var y2 = cy * CS + qy; if (y2 >= sh) break;
                        var f = qy * inv, row2 = y2 * sw;
                        var lr = gR[i00] + (gR[i01] - gR[i00]) * f, rr = gR[i10] + (gR[i11] - gR[i10]) * f;
                        var lg = gG[i00] + (gG[i01] - gG[i00]) * f, rg = gG[i10] + (gG[i11] - gG[i10]) * f;
                        var lb = gB[i00] + (gB[i01] - gB[i00]) * f, rb = gB[i10] + (gB[i11] - gB[i10]) * f;
                        var dr = (rr - lr) * inv, dg = (rg - lg) * inv, db = (rb - lb) * inv;
                        for (var qx = 0; qx < CS; qx++) {
                            var x2 = cx * CS + qx; if (x2 >= sw) break;
                            if (y2 < hiddeny[x2] && depth[row2 + x2] > dist)
                                buf[row2 + x2] = (0xFF000000 | ((lb + db * qx) << 16) | ((lg + dg * qx) << 8) | (lr + dr * qx)) >>> 0;
                        }
                    }
                    continue;
                }
                for (var py = 0; py < CS; py++) {
                    var yy = cy * CS + py; if (yy >= sh) break;
                    var fy = py * inv, row = yy * sw;
                    for (var px = 0; px < CS; px++) {
                        var xx = cx * CS + px; if (xx >= sw) break;
                        if (yy >= hiddeny[xx]) continue;           // terrain in front
                        var di = row + xx;
                        if (depth[di] <= dist) continue;            // something nearer than the cloud
                        var fx = px * inv;
                        var w00 = (1 - fx) * (1 - fy) * a00, w10 = fx * (1 - fy) * a10, w01 = (1 - fx) * fy * a01, w11 = fx * fy * a11;
                        var a = w00 + w10 + w01 + w11;
                        if (a <= 0.004) continue;
                        var ia = 1 / a;
                        var cr = (gR[i00] * w00 + gR[i10] * w10 + gR[i01] * w01 + gR[i11] * w11) * ia;
                        var cg = (gG[i00] * w00 + gG[i10] * w10 + gG[i01] * w01 + gG[i11] * w11) * ia;
                        var cb = (gB[i00] * w00 + gB[i10] * w10 + gB[i01] * w01 + gB[i11] * w11) * ia;
                        if (a > 1) a = 1;
                        var o = buf[di], r = o & 255, g = (o >> 8) & 255, b = (o >> 16) & 255;
                        buf[di] = (0xFF000000 | ((b + (cb - b) * a) << 16) | ((g + (cg - g) * a) << 8) | (r + (cr - r) * a)) >>> 0;
                    }
                }
            }
        }
    }

    // Rain: screen-space streaks while the player is under a storm.
    var _seed = 1;
    function _rnd() { _seed = (Math.imul(_seed, 1103515245) + 12345) | 0; return ((_seed >>> 8) & 0xFFFFFF) / 0x1000000; }
    function rain() {
        if (!cfg.enabled || (typeof underwaterState !== 'undefined' && underwaterState.active)) return;
        var level = _sstep(cfg.stormRain, 1, frameStorm);
        if (level <= 0 || camera.height >= cfg.altitude) return;
        var sw = screendata.canvas.width, sh = screendata.canvas.height, buf = screendata.buf32;
        var n = Math.round(700 * level), slant = 0.25;
        _seed = (Date.now() / 16) | 0;
        for (var i = 0; i < n; i++) {
            var x0 = _rnd() * sw, y0 = _rnd() * sh, len = 6 + _rnd() * 10;
            for (var s = 0; s < len; s++) {
                var yy = (y0 + s) | 0, xx = (x0 + s * slant) | 0;
                if (yy < 0 || yy >= sh || xx < 0 || xx >= sw) break;
                var di = yy * sw + xx, o = buf[di];
                var r = o & 255, g = (o >> 8) & 255, b = (o >> 16) & 255;
                buf[di] = (0xFF000000 | ((b + (205 - b) * 0.35) << 16) | ((g + (195 - g) * 0.35) << 8) | (r + (185 - r) * 0.35)) >>> 0;
            }
        }
    }

    return { config: cfg, prepare: prepare, opaqueAt: opaqueAt, blend: blend, rain: rain,
             weatherAt: weatherAt, stormAtCamera: function () { return frameStorm; } };
})();
