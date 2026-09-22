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
        buf = screendata.buf32;

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

            // Intersect the ring cylinder (axis along X) via its Y,Z components
            var A = ryv * ryv + rzv * rzv;
            if (A < 1e-9) continue;
            var B = 2 * rzv * Cc;
            var disc = B * B - 4 * A * Cconst;
            if (disc < 0) continue;                 // ray misses the ring
            var t = (-B + Math.sqrt(disc)) / (2 * A);
            if (t <= 0) continue;

            var Yr  = ryv * t;
            var Zs  = camH + rzv * t;
            var psi = Math.atan2(Yr, R - Zs);       // angle around the loop

            if (Math.abs(R * psi) <= ownedArc) continue;  // perspective pass owns it

            var tx = camera.x + rxv * t;
            if (!ringInsideWidth(tx)) continue;     // outside the band -> open void

            // Single-map spike: sample the real heightmap instead of a LOD
            // average. It is one array index here, so there is nothing to gain
            // from precomputing averages the way VoxelMaster has to.
            var col = Terrain.colorAt(tx, ringWrapY(camera.y + R * psi));
            if (!col) continue;

            for (var yy = y; yy < y + S && yy < sh; yy++) {
                var row = yy * sw;
                for (var xx = x; xx < x + S && xx < sw; xx++) {
                    if (yy < hiddeny[xx]) buf[row + xx] = col;  // keep near terrain crisp
                }
            }
        }
    }
}
