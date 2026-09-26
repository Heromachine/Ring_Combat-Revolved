// ===============================
// Screen Buffer Operations
// ===============================
"use strict";

// Sky 77 supplies six square cubemap faces. Its layout identifies PX as
// front, NX as back, PZ/NZ as the horizontal sides, and PY/NY as up/down.
// The side assignment below follows the matching image edges, keeping the
// stars and horizon continuous when the camera turns.
var NightSkybox = (function () {
    var faces = {}, loaded = 0;
    if (typeof Image !== 'undefined') {
        ['px', 'nx', 'py', 'ny', 'pz', 'nz'].forEach(function (name) {
            var image = new Image();
            image.onload = function () {
                var canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                var ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) return;
                ctx.drawImage(image, 0, 0);
                try {
                    faces[name] = { pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
                                    width: canvas.width, height: canvas.height };
                    loaded++;
                } catch (e) { console.warn('Night skybox face could not be read: ' + name, e); }
            };
            image.onerror = function () { console.warn('Night skybox face failed to load: ' + name); };
            image.src = 'images/sky77/' + name + '.png';
        });
    }

    function draw(buffer, sw, sh, dayColor, nightMix) {
        if (loaded !== 6 || nightMix <= 0) return false;

        var dayR = dayColor & 255, dayG = (dayColor >>> 8) & 255, dayB = (dayColor >>> 16) & 255;
        var dayMix = 1 - nightMix;

        // Match the pitched camera basis used by RenderRingBackdrop, so the
        // sky stays registered to the visible far side of the ring.
        var angle = camera.angle, sinA = Math.sin(angle), cosA = Math.cos(angle);
        var elev = Math.atan((camera.horizon - sh / 2) / camera.focalLength);
        var cosE = Math.cos(elev), sinE = Math.sin(elev);
        var fx = -sinA * cosE, fy = -cosA * cosE, fz = sinE;
        var rx = cosA, ry = -sinA;
        var ux = sinA * sinE, uy = cosA * sinE, uz = cosE;

        // Bound sky work for high render resolutions. The game already uses
        // a pixelated terrain renderer; sky samples fill small blocks too.
        var step = Math.max(2, Math.ceil(Math.sqrt(sw * sh / 90000)));
        for (var y = 0; y < sh; y += step) {
            var sy = (sh / 2 - y) / camera.focalLength;
            for (var x = 0; x < sw; x += step) {
                var sx = 2 * x / sw - 1;
                var dx = fx + sx * rx + sy * ux;
                var dy = fy + sx * ry + sy * uy;
                var dz = fz + sy * uz;
                var ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
                var face, u, v;

                if (az >= ax && az >= ay) {
                    face = dz > 0 ? 'py' : 'ny';
                    u = (1 - dy / az) * 0.5;
                    v = (1 + (dz > 0 ? -dx : dx) / az) * 0.5;
                } else if (ax >= ay) {
                    if (dx > 0) { face = 'nz'; u = (1 + dy / ax) * 0.5; }
                    else { face = 'pz'; u = (1 - dy / ax) * 0.5; }
                    v = (1 - dz / ax) * 0.5;
                } else {
                    if (dy < 0) { face = 'px'; u = (1 + dx / ay) * 0.5; }
                    else { face = 'nx'; u = (1 - dx / ay) * 0.5; }
                    v = (1 - dz / ay) * 0.5;
                }

                var image = faces[face];
                var px = Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width)));
                var py = Math.min(image.height - 1, Math.max(0, Math.floor(v * image.height)));
                var src = (py * image.width + px) * 4;
                var r = (image.pixels[src] * nightMix + dayR * dayMix) | 0;
                var g = (image.pixels[src + 1] * nightMix + dayG * dayMix) | 0;
                var b = (image.pixels[src + 2] * nightMix + dayB * dayMix) | 0;
                var color = (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
                for (var yy = y; yy < y + step && yy < sh; yy++) {
                    var row = yy * sw;
                    for (var xx = x; xx < x + step && xx < sw; xx++) buffer[row + xx] = color;
                }
            }
        }
        return true;
    }

    return { draw: draw };
}());

function DrawBackground(){
    var buf32=screendata.buf32,bg=screendata.backgroundcolor;
    // Sky lighting follows the player's position on the ring. Blend the
    // cubemap away through dawn, leaving the original blue day sky.
    var intensity = 1;
    if (typeof DayNight !== 'undefined' && typeof ringWorld !== 'undefined' && ringWorld.enabled)
        intensity = DayNight.intensityAtY(camera.y);
    if (intensity < 1) bg = DayNight.scaleColor(bg, intensity);
    screendata.depthBuffer.fill(Infinity);
    albedoBuffer().fill(0);
    var dawn = Math.max(0, Math.min(1, (intensity - 0.12) / 0.6));
    var nightMix = 1 - dawn * dawn * (3 - 2 * dawn);
    if (!NightSkybox.draw(buf32, screendata.canvas.width, screendata.canvas.height, bg, nightMix))
        buf32.fill(bg);
}

// Per-pixel UNLIT colour, parallel to buf32. Day/night darkening destroys
// colour information (at full night a pixel is literally 0,0,0), so the
// flashlight can't recover what a surface looks like from buf32 alone.
// Renderers that apply day/night lighting write the pre-lighting colour
// here alongside the lit one; 0 (alpha 0) means "nothing recorded" and
// the flashlight falls back to buf32 for that pixel.
function albedoBuffer(){
    var n = screendata.buf32.length;
    if (!screendata.albedo || screendata.albedo.length !== n) screendata.albedo = new Uint32Array(n);
    return screendata.albedo;
}

function Flip(){
    screendata.imagedata.data.set(screendata.buf8);
    screendata.context.putImageData(screendata.imagedata,0,0);
}
