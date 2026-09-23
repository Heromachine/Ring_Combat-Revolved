// ===============================
// Flashlight
// ===============================
// A screen-space light cone centred on the crosshair, drawn as a
// post-process pass over the already-rendered frame (after RenderItems(),
// before Flip() -- see main.js's Draw loop) rather than as a genuinely new
// raycast. It doesn't need to be: the depth buffer the real terrain/item
// raycaster already filled this frame tells this pass exactly how far away
// whatever is visible at each pixel actually is, including occlusion (a
// wall blocking the beam simply has no depth value beyond it to touch) --
// so distance falloff and "can't shine through solid ground" both fall out
// of information that already exists, for the cost of one more read per
// pixel touched, not a second raycast.
//
// REVEALS TRUE COLOUR: at full night a pixel is literally (0,0,0), so
// nothing about buf32 alone says what the surface looks like -- scaling it
// stays black, and blending toward a fixed light colour (the first version
// of this file) just paints a flat beige disc. Instead each lit renderer
// records the pixel's UNLIT colour in screendata.albedo (see
// screenBuffer.js albedoBuffer()), and the beam blends the lit pixel back
// toward that, slightly warm-tinted. It never darkens anything (per
// channel it only moves up), so in daylight -- where lit already equals
// unlit -- it is effectively a no-op, like a real flashlight at noon.
"use strict";

var flashlightOn = false;

var FLASHLIGHT_RADIUS_FRAC   = 0.42;   // cone radius, as a fraction of screen height.
                                        // 0.35 -> 0.70 (doubled) read as too big; user asked
                                        // for roughly a 20% increase over the ORIGINAL 0.35
                                        // instead, so 0.35 * 1.2 = 0.42.
var FLASHLIGHT_MAX_WORLD_DIST = 700;   // world units -- no effect at all beyond this
var FLASHLIGHT_MAX_BOOST      = 1.0;   // centre, point-blank: the surface's full true colour.
                                        // (Was 0.6 while the beam blended toward a flat light
                                        // colour and could white out; blending toward the
                                        // surface's own colour can't exceed it, so no cap needed.)
var FLASHLIGHT_COLOR = { r: 255, g: 235, b: 190 };  // warm tint applied to the revealed colour

function ToggleFlashlight() {
    flashlightOn = !flashlightOn;
}

function RenderFlashlight() {
    if (!flashlightOn) return;

    var sw = screendata.canvas.width, sh = screendata.canvas.height;
    var buf32 = screendata.buf32, depth = screendata.depthBuffer;
    var albedo = (screendata.albedo && screendata.albedo.length === buf32.length) ? screendata.albedo : null;
    var cx = sw / 2, cy = sh / 2;   // the crosshair is CSS-pinned to 50%/50%
    var R = sh * FLASHLIGHT_RADIUS_FRAC;
    var R2 = R * R;
    var lr = FLASHLIGHT_COLOR.r, lg = FLASHLIGHT_COLOR.g, lb = FLASHLIGHT_COLOR.b;

    // Bounded to the cone's own screen-space bounding box -- this is a
    // small circle near the crosshair, not a full-screen pass, so it stays
    // cheap regardless of how expensive the main terrain loop already is.
    var minX = Math.max(0, Math.floor(cx - R)), maxX = Math.min(sw - 1, Math.ceil(cx + R));
    var minY = Math.max(0, Math.floor(cy - R)), maxY = Math.min(sh - 1, Math.ceil(cy + R));

    for (var y = minY; y <= maxY; y++) {
        var dy = y - cy;
        var row = y * sw;
        for (var x = minX; x <= maxX; x++) {
            var dx = x - cx;
            var d2 = dx * dx + dy * dy;
            if (d2 > R2) continue;              // outside the circular cone

            var idx = row + x;
            var z = depth[idx];
            if (!(z < FLASHLIGHT_MAX_WORLD_DIST)) continue;   // sky (Infinity) or out of range

            // Linear, not squared -- a squared falloff stays near full
            // strength for most of the radius and then drops sharply near
            // the edge, which reads as a small hot, concentrated spot even
            // at a large radius. Linear spreads the brightening gradually
            // across the whole cone instead.
            var screenFalloff = 1 - Math.sqrt(d2) / R;        // 1 at centre, 0 at the cone's edge
            var distFalloff    = 1 - z / FLASHLIGHT_MAX_WORLD_DIST;  // 1 close, 0 at max range
            var boost = screenFalloff * distFalloff * FLASHLIGHT_MAX_BOOST; // 0..FLASHLIGHT_MAX_BOOST

            var c = buf32[idx];
            var r = c & 0xFF, g = (c >>> 8) & 0xFF, b = (c >>> 16) & 0xFF;
            // Unlit colour if a renderer recorded one; alpha 0 = none (e.g.
            // unlit Node War cubes), in which case the lit pixel IS the
            // true colour already.
            var a = albedo ? albedo[idx] : 0;
            if (!(a >>> 24)) a = c;
            var tr = (a & 0xFF) * lr / 255, tg = ((a >>> 8) & 0xFF) * lg / 255, tb = ((a >>> 16) & 0xFF) * lb / 255;
            if (tr > r) r = r + (tr - r) * boost;
            if (tg > g) g = g + (tg - g) * boost;
            if (tb > b) b = b + (tb - b) * boost;
            buf32[idx] = (0xFF000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
        }
    }
}
