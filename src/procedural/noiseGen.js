// ===============================
// Noise Generation
// ===============================
// Seeded 3D Perlin noise plus fBm. 3D specifically because the ring needs
// terrain that wraps seamlessly around a 57,344 WU loop: sampling a CIRCLE
// through a 3D noise field gives a field that is periodic by construction,
// with no seam to hide. See worldGen.js.
"use strict";

var NoiseGen = (function () {

    var _perm = null, _seed = 0;

    // xorshift32 -- small, fast, and deterministic across browsers, which
    // matters because the world must regenerate identically from a seed.
    function _rng(state) {
        return function () {
            state ^= state << 13; state |= 0;
            state ^= state >>> 17;
            state ^= state << 5;  state |= 0;
            return (state >>> 0) / 4294967296;
        };
    }

    function seed(s) {
        _seed = s | 0 || 1;
        var rnd = _rng(_seed);
        var p = new Uint8Array(256);
        for (var i = 0; i < 256; i++) p[i] = i;
        for (var j = 255; j > 0; j--) {            // Fisher-Yates
            var k = (rnd() * (j + 1)) | 0;
            var t = p[j]; p[j] = p[k]; p[k] = t;
        }
        _perm = new Uint8Array(512);
        for (var m = 0; m < 512; m++) _perm[m] = p[m & 255];
    }

    function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function _lerp(a, b, t) { return a + t * (b - a); }

    function _grad(h, x, y, z) {
        switch (h & 15) {
            case 0:  return  x + y; case 1:  return -x + y; case 2:  return  x - y;
            case 3:  return -x - y; case 4:  return  x + z; case 5:  return -x + z;
            case 6:  return  x - z; case 7:  return -x - z; case 8:  return  y + z;
            case 9:  return -y + z; case 10: return  y - z; case 11: return -y - z;
            case 12: return  y + x; case 13: return -y + z; case 14: return  y - x;
            default: return -y - z;
        }
    }

    // Classic Perlin, range roughly [-1, 1].
    function perlin3(x, y, z) {
        if (!_perm) seed(1);
        var X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
        x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
        var u = _fade(x), v = _fade(y), w = _fade(z);
        var p = _perm;
        var A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
        var B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
        return _lerp(
            _lerp(_lerp(_grad(p[AA],   x,   y,   z),   _grad(p[BA],   x-1, y,   z),   u),
                  _lerp(_grad(p[AB],   x,   y-1, z),   _grad(p[BB],   x-1, y-1, z),   u), v),
            _lerp(_lerp(_grad(p[AA+1], x,   y,   z-1), _grad(p[BA+1], x-1, y,   z-1), u),
                  _lerp(_grad(p[AB+1], x,   y-1, z-1), _grad(p[BB+1], x-1, y-1, z-1), u), v),
            w);
    }

    // Fractal Brownian motion. Returns roughly [-1, 1]; normalised by the
    // amplitude sum so octave count does not change the overall range.
    function fbm3(x, y, z, octaves, lacunarity, gain) {
        octaves    = octaves    || 4;
        lacunarity = lacunarity || 2.0;
        gain       = gain       || 0.5;
        var sum = 0, amp = 1, freq = 1, norm = 0;
        for (var i = 0; i < octaves; i++) {
            sum  += amp * perlin3(x * freq, y * freq, z * freq);
            norm += amp;
            amp  *= gain;
            freq *= lacunarity;
        }
        return sum / norm;
    }

    // Ridged variant -- gives mountain spines rather than rolling hills.
    function ridged3(x, y, z, octaves, lacunarity, gain) {
        octaves    = octaves    || 4;
        lacunarity = lacunarity || 2.0;
        gain       = gain       || 0.5;
        var sum = 0, amp = 1, freq = 1, norm = 0;
        for (var i = 0; i < octaves; i++) {
            var n = 1 - Math.abs(perlin3(x * freq, y * freq, z * freq));
            sum  += amp * (n * n);
            norm += amp;
            amp  *= gain;
            freq *= lacunarity;
        }
        return (sum / norm) * 2 - 1;
    }

    return {
        seed:    seed,
        getSeed: function () { return _seed; },
        perlin3: perlin3,
        fbm3:    fbm3,
        ridged3: ridged3
    };

})();
