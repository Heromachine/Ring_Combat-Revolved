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
// ADDITIVE, NOT MULTIPLICATIVE, ON PURPOSE: the day/night system can make a
// pixel literally (0,0,0) at full night (see dayNightCycle.js). Multiplying
// an already-black pixel by any boost factor is still exactly black --
// 0 * anything is 0 -- so a flashlight that just scaled existing colour up
// would be invisible on the one kind of terrain a flashlight actually
// matters for. Blending toward a light colour instead works on any input,
// including pure black.
"use strict";

var flashlightOn = false;

var FLASHLIGHT_RADIUS_FRAC   = 0.35;   // cone radius, as a fraction of screen height
var FLASHLIGHT_MAX_WORLD_DIST = 700;   // world units -- no effect at all beyond this
var FLASHLIGHT_COLOR = { r: 255, g: 235, b: 190 };  // warm white

function ToggleFlashlight() {
    flashlightOn = !flashlightOn;
}

function RenderFlashlight() {
    if (!flashlightOn) return;

    var sw = screendata.canvas.width, sh = screendata.canvas.height;
    var buf32 = screendata.buf32, depth = screendata.depthBuffer;
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

            var screenFalloff = 1 - Math.sqrt(d2) / R;        // 1 at centre, 0 at the cone's edge
            var distFalloff    = 1 - z / FLASHLIGHT_MAX_WORLD_DIST;  // 1 close, 0 at max range
            var boost = screenFalloff * screenFalloff * distFalloff; // 0..1, squared for a tighter hot spot

            var c = buf32[idx];
            var r = c & 0xFF, g = (c >>> 8) & 0xFF, b = (c >>> 16) & 0xFF;
            r = r + (lr - r) * boost;
            g = g + (lg - g) * boost;
            b = b + (lb - b) * boost;
            buf32[idx] = (0xFF000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
        }
    }
}
