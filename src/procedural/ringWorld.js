// =====================================================
// Ring World  —  PHASE 1 SPIKE, THROWAWAY
// =====================================================
// Ported from VoxelMaster-Minimal/src/procedural/ringWorld.js, which in turn
// ports the Halo-ring trick from Ringscape. Read that file's header for the
// full design rationale; this is a deliberately reduced version.
//
// WHAT IS REDUCED, AND WHY IT IS FINE FOR A SPIKE
//
// VoxelMaster needs a tile system because its world is assembled from ~29
// generated maps spread over a 512x8 logical grid. This game has ONE
// 1024x1024 heightmap that already wraps bitwise on both axes, and the ring
// length was chosen so that:
//
//     ringLength = 64 tiles * 896 = 57,344 = 56 * 1024   (exact)
//
// so the map tiles the loop a whole number of times and the ring seam lands
// exactly on a map boundary. No tile system, no tileMap, no LOD averages --
// the far side is sampled straight from the same heightmap. Terrain therefore
// REPEATS 56 times around the loop. That is expected and is what Phase 4's
// tile pool exists to fix.
//
// Everything here is behind ringWorld.enabled, default OFF, so flat mode is
// untouched and shippable.
//
// NOT FOR KEEPING: this file is a feel-check for ring size and curvature.
// Phase 3 onward replaces it with the real tile-backed port.
"use strict";

var ringWorld = {
    enabled: false,

    // ---- Phase 0 decision (HeroLab 8c6866b6), verified numerically ----
    ringLengthTiles:     64,    // 57,344 WU around (~10.9 miles)
    ringWidthTiles:      8,     //  7,168 WU across (~1.36 miles)
    // flatRadiusTiles MUST scale with the ring. The bend is
    // R*(1-cos((s-flatRadius)/R)), so the flat zone eats arc that would
    // otherwise curve, and the far side only reaches PI - 2*PI*flatRadius/L.
    // Leaving VoxelMaster's 4 here would reach 158 deg instead of 177 and
    // leave a visible GAP at the zenith where the ring should close.
    flatRadiusTiles:     0.5,
    detailDistanceTiles: 4,     // absolute render-quality budget, not a ring fraction

    tileAdvance: 896,           // VoxelMaster's tileWidth(1024) - overlapSize(128)

    // ---- Outer-ring relief ----
    // VoxelMaster's backdrop (and Ringscape's) samples COLOUR only and
    // intersects a perfectly smooth cylinder, so the far side of the loop has
    // no mountains and a clean circular silhouette. With relief on, the
    // surface radius is perturbed by the terrain height at the hit point,
    // which makes the intersection iterative instead of one closed-form
    // solve -- the height depends on where you hit, which depends on the
    // height. Two refinements are plenty at this distance.
    // Tuned 2026-09-22 against the real C21/D21 terrain, by measuring image
    // churn per 1.5 WU of walking (one step) -- the far side is ~28,000 WU
    // away, so it should barely move.
    //
    //   mip off, no relief   35.4% churn   boiling
    //   mip 32,  no relief    5.9%
    //   mip 32,  relief x4    6.2%   <- chosen
    //   mip 32,  relief x8    3.6%   but colour variety collapses (277 -> 96)
    //
    // x4 keeps more distinct colour in the band than the smooth cylinder had
    // (277 vs 250) while giving a silhouette 2.4x rougher than smooth.
    //
    // HONEST LIMIT: the refinement does NOT converge -- 2 vs 3 iterations
    // still differs by ~17% of the band, because displacing the hit point
    // lands on unrelated terrain. It is a fixed two-step approximation that
    // is deterministic and temporally stable, not a solved intersection.
    // Raising reliefIterations will not improve it.
    relief: true,
    reliefIterations: 2,
    reliefScale: 4.0,   // raise to exaggerate distant mountains; 8 is the practical max

    // ---- Far-side mip ----
    // The far side of the loop is ~28,000 WU away, so one screen pixel spans
    // dozens of heightmap texels. Sampling the full-resolution map picks one
    // of them essentially at random, and the choice changes every time the
    // camera moves -- the whole band boils. This is why VoxelMaster averages
    // each map down to a single LOD value: not for speed, for ANTI-ALIASING.
    // We keep more detail than a single average by mipping to mipSize^2
    // cells, which is the smallest stable unit that still shows structure.
    mipSize: 32,

    // ---- computed by initRingWorld() ----
    ringLength: 0, ringRadius: 0, flatRadius: 0, detailDistance: 0, halfWidth: 0,
    _invR: 0, _halfLen: 0
};

var _ringFlatCameraDistance = null;

function initRingWorld() {
    if (_ringFlatCameraDistance === null) _ringFlatCameraDistance = camera.distance;

    if (!ringWorld.enabled) {
        camera.distance = _ringFlatCameraDistance;
        return;
    }

    var ta = ringWorld.tileAdvance;
    ringWorld.ringLength     = ringWorld.ringLengthTiles * ta;
    ringWorld.ringRadius     = ringWorld.ringLength / (2 * Math.PI);
    ringWorld.flatRadius     = ringWorld.flatRadiusTiles * ta;
    ringWorld.detailDistance = ringWorld.detailDistanceTiles * ta;
    ringWorld.halfWidth      = (ringWorld.ringWidthTiles * ta) / 2;
    ringWorld._invR          = 1 / ringWorld.ringRadius;
    ringWorld._halfLen       = ringWorld.ringLength / 2;

    // The perspective pass only covers flat + detail; RenderRingBackdrop()
    // draws everything beyond, so there is no point marching further.
    camera.distance = ringWorld.flatRadius + ringWorld.detailDistance;

    buildRingMip();
}

// Averaged colour+height grid used ONLY by the backdrop. Rebuilt whenever the
// ring is (re)initialised, which includes every map change.
var ringMip = null;

function buildRingMip() {
    var N = ringWorld.mipSize | 0;
    if (N <= 0) { ringMip = null; return; }
    var m = Terrain.rawMap();
    var step = (m.width / N) | 0;
    if (step < 1) { ringMip = null; return; }

    var col = new Uint32Array(N * N);
    var hgt = new Float32Array(N * N);

    for (var cy = 0; cy < N; cy++) {
        for (var cx = 0; cx < N; cx++) {
            var r = 0, g = 0, b = 0, h = 0, n = 0;
            for (var yy = 0; yy < step; yy++) {
                var sy = cy * step + yy;
                for (var xx = 0; xx < step; xx++) {
                    var sx = cx * step + xx;
                    var idx = (sy << m.shift) + sx;
                    var c = m.color[idx];
                    r += (c) & 0xFF; g += (c >> 8) & 0xFF; b += (c >> 16) & 0xFF;
                    h += m.altitude[idx];
                    n++;
                }
            }
            var o = cy * N + cx;
            col[o] = (0xFF000000 | (((b / n) | 0) << 16) | (((g / n) | 0) << 8) | ((r / n) | 0)) >>> 0;
            hgt[o] = h / n;
        }
    }
    ringMip = { size: N, cellWU: m.width / N, color: col, height: hgt };
}

// Mip lookup in world space, wrapping like the heightmap does.
function ringMipIndex(x, y) {
    var N = ringMip.size, c = ringMip.cellWU;
    var cx = Math.floor(x / c) % N; if (cx < 0) cx += N;
    var cy = Math.floor(y / c) % N; if (cy < 0) cy += N;
    return cy * N + cx;
}

// Wrap a Y coordinate into [-ringLength/2, +ringLength/2), centred on zero so
// it lines up with a world whose origin is the spawn area.
function ringWrapY(y) {
    var L = ringWorld.ringLength, h = ringWorld._halfLen;
    return ((((y + h) % L) + L) % L) - h;
}

// Shortest wrapped distance along the loop -- never more than half of it.
function ringArcDistance(y1, y2) {
    return Math.abs(ringWrapY(y1 - y2));
}

// THE BEND. Height added to a terrain sample so the distance curves upward.
// Visual only: collision and the heightmap itself are untouched, exactly as
// in VoxelMaster. The world's TOPOLOGY is what makes it walkable (ringWrapY
// applied to camera.y), not this.
function ringApply(height, y) {
    if (!ringWorld.enabled) return height;
    var s = ringArcDistance(camera.y, y);
    if (s <= ringWorld.flatRadius) return height;
    var R = ringWorld.ringRadius;
    return height + R * (1 - Math.cos((s - ringWorld.flatRadius) * ringWorld._invR));
}

// Is this X inside the ring's walkable band? Outside is open void, the same
// as stepping off the edge in VoxelMaster.
function ringInsideWidth(x) {
    return Math.abs(x) <= ringWorld.halfWidth;
}

// -----------------------------------------------------------------------
// Ring backdrop -- the loop arcing across the sky.
// Ported from VoxelMaster's RenderRingBackdrop (itself from Ringscape).
// NOT optional: ringApply() is a flat-projection approximation, so without
// this pass the ring is a hill that curves up and stops.
// -----------------------------------------------------------------------
function RenderRingBackdrop() {
    if (!ringWorld.enabled) return;

    var R = ringWorld.ringRadius;
    if (R <= 0) return;

    var sw  = screendata.canvas.width,
        sh  = screendata.canvas.height,
        buf = screendata.buf32,
        depth = screendata.depthBuffer;

    var sinang = Math.sin(camera.angle), cosang = Math.cos(camera.angle);
    var Fx = -sinang, Fy = -cosang;   // camera forward (world XY)
    var Rx =  cosang, Ry = -sinang;   // camera right   (world XY)

    var camH   = camera.height;
    var Cc     = camH - R;             // camera offset from the cylinder axis
    var Cconst = Cc * Cc - R * R;      // quadratic constant term
    var focal  = camera.focalLength;
    var horizon = camera.horizon;

    // The perspective pass owns everything inside this arc distance.
    var ownedArc = ringWorld.flatRadius + ringWorld.detailDistance;

    var S = 2;   // sample in SxS blocks, same as Ringscape

    var reliefIters = ringWorld.relief ? (ringWorld.reliefIterations | 0) : 0;
    var reliefScale = ringWorld.reliefScale;

    // Sampling helpers: the mip when we have one, the raw map otherwise.
    var mipColor  = ringMip ? function (x, y) { return ringMip.color[ringMipIndex(x, y)]; }
                            : Terrain.colorAt;
    var mipHeight = ringMip ? function (x, y) { return ringMip.height[ringMipIndex(x, y)]; }
                            : Terrain.heightAt;

    // Pitched camera basis chosen to AGREE WITH THE TERRAIN PASS. The terrain
    // pass is a shear projection putting the horizon at row camera.horizon and
    // mapping a row to (horizon - row)/focalLength. Picking pitch =
    // atan((horizon - sh/2)/focal) makes both models agree at the horizon,
    // which is exactly where the backdrop hands off. Getting this wrong leaves
    // a visible kink at the handoff.
    var hCy  = sh / 2;
    var elevC = Math.atan((horizon - hCy) / focal);
    var cE = Math.cos(elevC), sE = Math.sin(elevC);

    var f3x = Fx * cE, f3y = Fy * cE, f3z = sE;   // pitched forward
    var r3x = Rx,      r3y = Ry;                  // right stays horizontal
    var u3x = -Ry * sE, u3y = Rx * sE, u3z = cE;  // up = forward x right

    var tanH = 1;   // half horizontal FOV: tan(45 deg) in this engine

    for (var x = 0; x < sw; x += S) {
        var top = hiddeny[x];
        if (top > sh) top = sh;
        if (top <= 0) continue;   // terrain fills this column to the top

        var sx = (2 * x / sw - 1) * tanH;

        for (var y = 0; y < top; y += S) {
            var sy = (hCy - y) / focal;

            var rxv = f3x + sx * r3x + sy * u3x;
            var ryv = f3y + sx * r3y + sy * u3y;
            var rzv = f3z              + sy * u3z;
            var rl = Math.sqrt(rxv * rxv + ryv * ryv + rzv * rzv);
            rxv /= rl; ryv /= rl; rzv /= rl;

            // Intersect the ring cylinder (axis along X) via its Y,Z components.
            // A and B do not depend on the surface radius, so they are solved
            // once even when relief re-solves for t below.
            var A = ryv * ryv + rzv * rzv;
            if (A < 1e-9) continue;
            var B = 2 * rzv * Cc;

            var Rq = R;            // surface radius at the hit point
            var t = 0, psi = 0, tx = 0, ty = 0, ok = false;

            for (var it = 0; it <= reliefIters; it++) {
                var disc = B * B - 4 * A * (Cc * Cc - Rq * Rq);
                if (disc < 0) break;                       // ray misses the ring
                t = (-B + Math.sqrt(disc)) / (2 * A);
                if (t <= 0) break;

                var Zs = camH + rzv * t;
                psi = Math.atan2(ryv * t, R - Zs);         // angle around the loop
                tx  = camera.x + rxv * t;
                if (!ringInsideWidth(tx)) break;           // outside the band -> void

                ty = ringWrapY(camera.y + R * psi);        // arc uses the NOMINAL radius
                ok = true;
                if (it === reliefIters) break;

                // Terrain on the inside of a ring rises toward the axis, so a
                // taller sample means a SMALLER surface radius. Feed it back
                // and re-solve.
                Rq = R - mipHeight(tx, ty) * reliefScale;
                ok = false;
            }
            if (!ok) continue;

            if (Math.abs(R * psi) <= ownedArc) continue;   // perspective pass owns it

            // Single-map spike: sample the real heightmap instead of a LOD
            // average. It is one array index here, so there is nothing to gain
            // from precomputing averages the way VoxelMaster has to.
            var col = mipColor(tx, ty);
            if (!col) continue;

            for (var yy = y; yy < y + S && yy < sh; yy++) {
                var row = yy * sw;
                for (var xx = x; xx < x + S && xx < sw; xx++) {
                    var di = row + xx;
                    // hiddeny keeps near terrain crisp; the depth test stops the
                    // far side of the loop painting over anything already drawn
                    // in front of it -- cubes are rendered BEFORE Render() and
                    // were being overwritten.
                    if (yy < hiddeny[xx] && t < depth[di]) {
                        buf[di] = col;
                        depth[di] = t;
                    }
                }
            }
        }
    }
}
