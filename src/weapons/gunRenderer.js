// ===============================
// Gun Viewmodel Rendering
// ===============================
"use strict";

// Load OBJ file
function loadGunModel() {
    fetch('3D_models/Gun _obj/Gun.obj')
        .then(response => response.text())
        .then(text => {
            var lines = text.split('\n');
            var vertices = [];
            var uvs = [];
            var faces = [];

            lines.forEach(line => {
                var parts = line.trim().split(/\s+/);
                if (parts[0] === 'v') {
                    vertices.push({
                        x: parseFloat(parts[1]),
                        y: parseFloat(parts[2]),
                        z: parseFloat(parts[3])
                    });
                } else if (parts[0] === 'vt') {
                    uvs.push({
                        u: parseFloat(parts[1]),
                        v: parseFloat(parts[2])
                    });
                } else if (parts[0] === 'f') {
                    var faceVerts = [];
                    var faceUVs = [];
                    for (var i = 1; i < parts.length; i++) {
                        var indices = parts[i].split('/');
                        faceVerts.push(parseInt(indices[0]) - 1);
                        if (indices[1]) {
                            faceUVs.push(parseInt(indices[1]) - 1);
                        }
                    }
                    if (faceVerts.length === 3) {
                        faces.push({ verts: faceVerts, uvs: faceUVs });
                    } else if (faceVerts.length === 4) {
                        faces.push({ verts: [faceVerts[0], faceVerts[1], faceVerts[2]], uvs: [faceUVs[0], faceUVs[1], faceUVs[2]] });
                        faces.push({ verts: [faceVerts[0], faceVerts[2], faceVerts[3]], uvs: [faceUVs[0], faceUVs[2], faceUVs[3]] });
                    }
                }
            });

            gunModel.vertices = vertices;
            gunModel.uvs = uvs;
            gunModel.faces = faces;
            gunModel.loaded = true;
            console.log('Gun model loaded:', vertices.length, 'vertices,', uvs.length, 'UVs,', faces.length, 'faces');
        })
        .catch(err => console.error('Failed to load gun model:', err));

    // Load gun texture
    gunModel.texture = new Image();
    gunModel.textureLoaded = false;
    gunModel.texture.onload = function() {
        gunModel.textureCanvas = document.createElement('canvas');
        gunModel.textureCanvas.width = gunModel.texture.width;
        gunModel.textureCanvas.height = gunModel.texture.height;
        var tctx = gunModel.textureCanvas.getContext('2d');
        tctx.drawImage(gunModel.texture, 0, 0);
        gunModel.textureData = tctx.getImageData(0, 0, gunModel.texture.width, gunModel.texture.height);
        gunModel.textureLoaded = true;
        console.log('Gun texture loaded:', gunModel.texture.width, 'x', gunModel.texture.height);
    };
    gunModel.texture.onerror = function() {
        console.error('Failed to load gun texture');
    };
    gunModel.texture.src = '3D_models/Gun _obj/Gun.png';
}

// ===============================
// Per-weapon viewmodels
// ===============================
// Weapons listed here draw their own OBJ model instead of the placeholder
// Gun.obj (every other weapon keeps the placeholder). These models are
// flat-coloured from their .mtl (Kd, or Ke for glowing parts) rather than
// textured, and they are far denser than the placeholder (the raygun is
// ~9k triangles vs 237), so each one is drawn into an offscreen canvas and
// only redrawn when its rotation or size changes -- that is, during the
// hip <-> ADS transition. Otherwise a frame is one drawImage.
//
// +Y is up. The placeholder's muzzle points along -X; `flip` turns a model
// whose muzzle points along +X (Blender exports from Codex-and-Blender3D
// do) 180 degrees about Y to match. `scale` and `anchor` place the model
// where the placeholder sits in the hand: the model's vertex centroid is
// moved to `anchor` (the placeholder's centroid) after scaling.
var WEAPON_MODELS = {
    pistol: {
        obj: '3D_models/raygun_pistol/raygun_pistol_v001.obj',
        mtl: '3D_models/raygun_pistol/raygun_pistol_v001.mtl',
        flip: true,
        scale: 1.4,
        // y raised from the placeholder's centroid (0.007) so the top of the
        // rear fin reaches the placeholder's top edge (0.15), which is what
        // lines the sights up with the crosshair in ADS.
        anchor: { x: -0.035, y: 0.053 }
    },
    // The long guns are 0.85-1.0 m against the pistol's 0.30 m. At scale 1.0
    // their hip-fire footprint matches the placeholder's, which the hip pose
    // was tuned for. Each anchor y puts the gun's highest point at the same
    // 0.15 sight line as the pistol: y = 0.15 - (top - centroid y) * scale.
    sniper: {   // ivory and gold long rifle; its top is the cowl hook
        obj: '3D_models/raygun_rifle/raygun_rifle.obj',
        mtl: '3D_models/raygun_rifle/raygun_rifle.mtl',
        flip: true,
        scale: 1.0,
        anchor: { x: -0.035, y: 0.044 }
    },
    rifle: {    // full-auto rifle; its top is the carry handle
        obj: '3D_models/raygun_automatic_rifle/raygun_automatic_rifle.obj',
        mtl: '3D_models/raygun_automatic_rifle/raygun_automatic_rifle.mtl',
        flip: true,
        scale: 1.0,
        anchor: { x: -0.035, y: 0.029 }
    },
    shotgun: {  // its top is the receiver fin
        obj: '3D_models/raygun_shotgun/raygun_shotgun.obj',
        mtl: '3D_models/raygun_shotgun/raygun_shotgun.mtl',
        flip: true,
        scale: 1.0,
        anchor: { x: -0.035, y: 0.019 }
    }
};

function _srgb(c) {   // .mtl colours are linear
    return Math.round(255 * Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.2));
}

function _parseMtl(text) {
    var mats = {}, cur = null;
    text.split('\n').forEach(function (line) {
        var p = line.trim().split(/\s+/);
        if (p[0] === 'newmtl') { cur = mats[p.slice(1).join(' ')] = { kd: [0.8, 0.8, 0.8], ke: [0, 0, 0], ns: 0 }; }
        else if (!cur) return;
        else if (p[0] === 'Kd') cur.kd = [+p[1], +p[2], +p[3]];
        else if (p[0] === 'Ke') cur.ke = [+p[1], +p[2], +p[3]];
        else if (p[0] === 'Ns') cur.ns = +p[1];
    });
    var out = {};
    Object.keys(mats).forEach(function (k) {
        var m = mats[k], glow = m.ke[0] + m.ke[1] + m.ke[2] > 0.05;
        var c = glow ? m.ke : m.kd;
        out[k] = { r: _srgb(c[0]), g: _srgb(c[1]), b: _srgb(c[2]), glow: glow, shiny: m.ns > 400 };
    });
    return out;
}

function loadWeaponModel(type) {
    var def = WEAPON_MODELS[type];
    Promise.all([
        fetch(def.obj).then(function (r) { if (!r.ok) throw Error(def.obj + ' ' + r.status); return r.text(); }),
        fetch(def.mtl).then(function (r) { return r.ok ? r.text() : ''; })
    ]).then(function (res) {
        var mats = _parseMtl(res[1]);
        var plain = { r: 160, g: 160, b: 170, glow: false, shiny: false };
        var verts = [], tris = [], mat = plain;
        res[0].split('\n').forEach(function (line) {
            var p = line.trim().split(/\s+/);
            if (p[0] === 'v') verts.push(+p[1], +p[2], +p[3]);
            else if (p[0] === 'usemtl') mat = mats[p.slice(1).join(' ')] || plain;
            else if (p[0] === 'f') {
                var idx = [];
                for (var i = 1; i < p.length; i++) idx.push(parseInt(p[i], 10) - 1);
                for (var k = 1; k + 1 < idx.length; k++) tris.push({ a: idx[0], b: idx[k], c: idx[k + 1], m: mat });  // fan: any n-gon
            }
        });
        var n = verts.length / 3, cx = 0, cy = 0, cz = 0;
        for (var i = 0; i < n; i++) { cx += verts[i * 3]; cy += verts[i * 3 + 1]; cz += verts[i * 3 + 2]; }
        cx /= n; cy /= n; cz /= n;
        var f = def.flip ? -1 : 1;   // 180 degrees about Y: x and z both negate, winding is kept
        for (var j = 0; j < n; j++) {
            verts[j * 3]     = f * (verts[j * 3]     - cx) * def.scale + def.anchor.x;
            verts[j * 3 + 1] =     (verts[j * 3 + 1] - cy) * def.scale + def.anchor.y;
            verts[j * 3 + 2] = f * (verts[j * 3 + 2] - cz) * def.scale;
        }
        def.verts = new Float32Array(verts);
        def.tris = tris;
        def.cache = null;
        def.loaded = true;
        console.log('Weapon model loaded:', type, n, 'vertices,', tris.length, 'triangles');
    }).catch(function (err) { console.error('Failed to load weapon model ' + type + ':', err); });
}

function loadWeaponModels() {
    Object.keys(WEAPON_MODELS).forEach(loadWeaponModel);
}

function _activeWeaponModel() {
    var slot = playerWeapons[currentWeaponIndex];
    var def = slot && WEAPON_MODELS[slot.type];
    return def && def.loaded ? def : null;
}

// Light from upper left, slightly toward the viewer (+Z faces the viewer).
var _VM_LIGHT = (function () { var x = -0.45, y = 0.65, z = 0.62, l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; })();

function _renderWeaponModel(def, cosX, sinX, cosY, sinY, cosZ, sinZ, scale) {
    var V = def.verts, n = V.length / 3;
    var P = new Float32Array(n * 3);   // rotated: x right, y up, z toward viewer
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < n; i++) {
        var x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
        var y1 = y * cosX - z * sinX;
        var z1 = y * sinX + z * cosX;
        var x2 = x * cosY + z1 * sinY;
        var z2 = -x * sinY + z1 * cosY;
        var x3 = x2 * cosZ - y1 * sinZ;
        var y3 = x2 * sinZ + y1 * cosZ;
        P[i * 3] = x3; P[i * 3 + 1] = y3; P[i * 3 + 2] = z2;
        if (x3 < minX) minX = x3; if (x3 > maxX) maxX = x3;
        if (y3 < minY) minY = y3; if (y3 > maxY) maxY = y3;
    }
    var pad = 2;
    var ox = Math.ceil(-minX * scale) + pad, oy = Math.ceil(maxY * scale) + pad;   // model origin in the canvas
    var cw = Math.ceil((maxX - minX) * scale) + pad * 2, ch = Math.ceil((maxY - minY) * scale) + pad * 2;
    var cv = def.cache && def.cache.canvas || document.createElement('canvas');
    cv.width = Math.max(1, cw); cv.height = Math.max(1, ch);
    var c = cv.getContext('2d');

    // Front faces only, back to front.
    var L = _VM_LIGHT, list = [];
    for (var t = 0; t < def.tris.length; t++) {
        var tr = def.tris[t], a = tr.a * 3, b = tr.b * 3, d = tr.c * 3;
        var ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        var vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
        var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nz <= 0) continue;
        var nl = Math.hypot(nx, ny, nz) || 1;
        list.push({ tr: tr, z: P[a + 2] + P[b + 2] + P[d + 2],
                    dot: (nx * L[0] + ny * L[1] + nz * L[2]) / nl, nz: nz / nl });
    }
    list.sort(function (p, q) { return p.z - q.z; });
    c.lineJoin = 'round';
    c.lineWidth = 0.6;   // same-colour outline hides hairline seams between triangles
    for (var k = 0; k < list.length; k++) {
        var it = list[k], m = it.tr.m, r, g, bl;
        if (m.glow) { r = m.r; g = m.g; bl = m.b; }
        else {
            var lit = 0.32 + 0.68 * Math.max(0, it.dot);
            var spec = 0;
            if (m.shiny) {   // chrome: highlight where the normal splits light and view
                var hx = L[0], hy = L[1], hz = L[2] + 1, hl = Math.hypot(hx, hy, hz);
                var tr2 = it.tr, A = tr2.a * 3, B = tr2.b * 3, D = tr2.c * 3;
                var ux2 = P[B] - P[A], uy2 = P[B + 1] - P[A + 1], uz2 = P[B + 2] - P[A + 2];
                var vx2 = P[D] - P[A], vy2 = P[D + 1] - P[A + 1], vz2 = P[D + 2] - P[A + 2];
                var nx2 = uy2 * vz2 - uz2 * vy2, ny2 = uz2 * vx2 - ux2 * vz2, nz2 = ux2 * vy2 - uy2 * vx2;
                var h = (nx2 * hx + ny2 * hy + nz2 * hz) / ((Math.hypot(nx2, ny2, nz2) || 1) * hl);
                spec = Math.pow(Math.max(0, h), 24) * 110;
            }
            r = Math.min(255, m.r * lit + spec); g = Math.min(255, m.g * lit + spec); bl = Math.min(255, m.b * lit + spec);
        }
        var col = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (bl | 0) + ')';
        var ia = it.tr.a * 3, ib = it.tr.b * 3, ic = it.tr.c * 3;
        c.beginPath();
        c.moveTo(ox + P[ia] * scale, oy - P[ia + 1] * scale);
        c.lineTo(ox + P[ib] * scale, oy - P[ib + 1] * scale);
        c.lineTo(ox + P[ic] * scale, oy - P[ic + 1] * scale);
        c.closePath();
        c.fillStyle = col; c.strokeStyle = col;
        c.fill(); c.stroke();
    }
    return { canvas: cv, ox: ox, oy: oy };
}

function _drawWeaponModel(ctx, def, centerX, centerY, rotX, rotY, rotZ, scale) {
    var key = rotX.toFixed(4) + ',' + rotY.toFixed(4) + ',' + rotZ.toFixed(4) + ',' + scale.toFixed(2);
    if (!def.cache || def.cache.key !== key) {
        var r = _renderWeaponModel(def, Math.cos(rotX), Math.sin(rotX), Math.cos(rotY), Math.sin(rotY),
                                   Math.cos(rotZ), Math.sin(rotZ), scale);
        r.key = key;
        def.cache = r;
    }
    ctx.drawImage(def.cache.canvas, Math.round(centerX - def.cache.ox), Math.round(centerY - def.cache.oy));
}

// Reticle dot — only shown in ADS mode (hip-fire has no reticle)
function _drawAdsReticle(ctx) {
    if (gunModel.pivotMode !== 'barrel') return;
    var barrelScreen = getBarrelScreenPos();
    ctx.beginPath();
    ctx.arc(barrelScreen.x, barrelScreen.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'cyan';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    ctx.stroke();
}

// Render gun viewmodel (first-person weapon overlay)
// Visual position, rotation, and scale come from gunViewModel (independent from gun mechanics).
// Geometry (vertices, faces, uvs, texture) still read from gunModel.
// The cyan barrel dot shows the mechanics barrel position (where bullets actually fire from).
function RenderGunViewmodel(ctx) {
    var sw = screendata.canvas.width;
    var sh = screendata.canvas.height;

    var refWidth = 800;
    var refHeight = 600;
    var scaleX = Math.max(0.3, sw / refWidth);
    var scaleY = Math.max(0.3, sh / refHeight);
    var sizeScale = Math.max(0.3, Math.min(scaleX, scaleY));

    // Pitch parallax: shift gun Y with horizon deviation in hip fire, fade out in ADS.
    // This keeps the gun from looking disconnected when looking up or down.
    var horizonDeviation = camera.horizon - sh / 2;
    var pitchParallax = horizonDeviation * gunViewModel.hipPitchParallax * (1 - gunModel.adsLerp);

    // Visual gun center — driven purely by gunViewModel offsets from screen center
    var centerX = sw / 2 + gunViewModel.offsetX;
    var centerY = sh / 2 + gunViewModel.offsetY + pitchParallax;

    if (!gunModel.loaded) {
        ctx.fillStyle = 'rgba(100,100,100,0.5)';
        ctx.fillRect(centerX - 50, centerY - 30, 100, 60);
        ctx.strokeStyle = 'white';
        ctx.strokeRect(centerX - 50, centerY - 30, 100, 60);
        ctx.fillStyle = 'yellow';
        ctx.font = '12px Arial';
        ctx.fillText('Gun loading...', centerX - 35, centerY + 5);
        ctx.beginPath();
        ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'cyan';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
    }

    var rotX = gunViewModel.rotationX * Math.PI / 180;
    var rotY = gunViewModel.rotationY * Math.PI / 180;
    var rotZ = gunViewModel.rotationZ * Math.PI / 180;

    var cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    var cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    var cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);

    var depthScale = 1 - gunViewModel.offsetZ / 200;
    var scale = gunViewModel.scale * depthScale * sizeScale;

    var weaponModel = _activeWeaponModel();
    if (weaponModel) {
        _drawWeaponModel(ctx, weaponModel, centerX, centerY, rotX, rotY, rotZ, scale);
        _drawAdsReticle(ctx);
        return;
    }

    var projected = gunModel.vertices.map(v => {
        var x = v.x, y = v.y, z = v.z;
        var y1 = y * cosX - z * sinX;
        var z1 = y * sinX + z * cosX;
        var x2 = x * cosY + z1 * sinY;
        var z2 = -x * sinY + z1 * cosY;
        var x3 = x2 * cosZ - y1 * sinZ;
        var y3 = x2 * sinZ + y1 * cosZ;
        return {
            x: centerX + x3 * scale,
            y: centerY - y3 * scale,
            z: z2 + gunViewModel.offsetZ / 100
        };
    });

    var sortedFaces = gunModel.faces.map((faceData, i) => {
        var verts = faceData.verts;
        var avgZ = 0;
        verts.forEach(idx => avgZ += projected[idx].z);
        avgZ /= verts.length;
        return { faceData, avgZ, index: i };
    }).sort((a, b) => a.avgZ - b.avgZ);

    function sampleTexture(u, v) {
        if (!gunModel.textureLoaded || !gunModel.textureData) {
            return { r: 128, g: 128, b: 128 };
        }
        var tw = gunModel.texture.width;
        var th = gunModel.texture.height;
        u = u - Math.floor(u);
        v = 1 - (v - Math.floor(v));
        var px = Math.floor(u * (tw - 1));
        var py = Math.floor(v * (th - 1));
        var idx = (py * tw + px) * 4;
        var data = gunModel.textureData.data;
        return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
    }

    sortedFaces.forEach(item => {
        var verts = item.faceData.verts;
        var uvIndices = item.faceData.uvs;
        var p0 = projected[verts[0]];
        var p1 = projected[verts[1]];
        var p2 = projected[verts[2]];

        var ax = p1.x - p0.x, ay = p1.y - p0.y;
        var bx = p2.x - p0.x, by = p2.y - p0.y;
        var cross = ax * by - ay * bx;

        var shade = 0.5 + 0.5 * Math.abs(cross) / (Math.sqrt(ax*ax + ay*ay) * Math.sqrt(bx*bx + by*by) + 0.001);
        shade = Math.min(1, Math.max(0.3, shade));

        var r = 128, g = 128, b = 128;
        if (uvIndices && uvIndices.length >= 3 && gunModel.uvs && gunModel.uvs.length > 0) {
            var uv0 = gunModel.uvs[uvIndices[0]] || {u:0.5, v:0.5};
            var uv1 = gunModel.uvs[uvIndices[1]] || {u:0.5, v:0.5};
            var uv2 = gunModel.uvs[uvIndices[2]] || {u:0.5, v:0.5};
            var centerU = (uv0.u + uv1.u + uv2.u) / 3;
            var centerV = (uv0.v + uv1.v + uv2.v) / 3;
            var texColor = sampleTexture(centerU, centerV);
            r = texColor.r;
            g = texColor.g;
            b = texColor.b;
        }

        r = Math.floor(r * shade);
        g = Math.floor(g * shade);
        b = Math.floor(b * shade);

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.closePath();
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    });

    _drawAdsReticle(ctx);
}

// Render ground weapons (floating pickups)
function RenderGroundWeapons() {
    var ctx = screendata.context;
    var sw = screendata.canvas.width;
    var sinYaw = Math.sin(camera.angle);
    var cosYaw = Math.cos(camera.angle);
    var rx = cosYaw, ry = -sinYaw;
    var focal = camera.focalLength;

    groundWeapons.forEach(function(gw) {
        var dx = gw.x - camera.x;
        var dy = gw.y - camera.y;
        var groundForward = -dx * sinYaw - dy * cosYaw;

        if (groundForward < 1 || groundForward > 200) return;

        var right = dx * rx + dy * ry;
        var screenX = right * (sw / 2) / groundForward + sw / 2;
        var floatHeight = gw.z + 20 + Math.sin(Date.now() / 300) * 3;
        var screenY = (camera.height - floatHeight) * focal / groundForward + camera.horizon;

        var weaponDef = weapons[gw.type];
        var size = 30 * focal / groundForward;
        size = Math.max(10, Math.min(40, size));

        ctx.beginPath();
        ctx.arc(screenX, screenY, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = weaponDef.bgColor;
        ctx.fill();
        ctx.strokeStyle = weaponDef.color;
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = 'white';
        ctx.font = 'bold ' + Math.floor(size * 0.6) + 'px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(weaponDef.letter, screenX, screenY + size * 0.2);
        ctx.textAlign = 'left';
    });
}
