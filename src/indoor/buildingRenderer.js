// ===============================
// Building Renderer — multi-instance
// ===============================
// A software-rasterised interior/exterior shell (walls, floor, roof, doors),
// ported from VoxelMaster-Minimal/src/indoor/buildingRenderer.js and
// generalised: VoxelMaster hardcoded ONE global buildingConfig per file
// (duplicating the whole file again for a second building). This renders an
// ARRAY of instances instead, so "buildings placed around" the ring is one
// render loop over N configs rather than N copies of this file.
//
// Reuses this game's OWN projectPoint()/edgeFunction()/cubeSinYaw/cubeCosYaw
// (src/rendering/cubeRenderer.js, src/core/globals.js) rather than
// redefining them -- this game already carries the same cube rasteriser
// VoxelMaster's building renderer was built on top of, since both share
// ancestry. Nothing here is duplicated that already exists.
//
// Self-contained: remove the <script> tag for this file (and buildingPlacer.js)
// to disable entirely. The few hook lines elsewhere (camera.js, terrain.js,
// chunkTerrain.js, main.js) are all guarded with typeof checks.
"use strict";

var buildings = [];   // registered building configs, rendered AND collided

var buildingTextures = {};   // keyed by texture path, loaded once, shared across instances

function _loadBuildingTex(src) {
    if (buildingTextures[src]) return buildingTextures[src];
    var tex = { data: null, width: 0, height: 0, loaded: false };
    buildingTextures[src] = tex;
    var img = new Image();
    img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var id = ctx.getImageData(0, 0, img.width, img.height);
        tex.data = id.data; tex.width = img.width; tex.height = img.height; tex.loaded = true;
    };
    img.onerror = function () { console.warn('[building] failed to load texture:', src); };
    img.src = src;
    return tex;
}

// Called once a building's siting is decided (buildingPlacer.js). Loads its
// three textures (shared instances if two buildings use the same file) and
// registers it for both rendering and collision.
function registerBuilding(cfg) {
    cfg._wallTex    = _loadBuildingTex(cfg.wallTexture);
    cfg._ceilingTex = _loadBuildingTex(cfg.ceilingTexture);
    cfg._floorTex   = _loadBuildingTex(cfg.floorTexture);
    buildings.push(cfg);
}

function _sampleBuildingTex(tex, u, v) {
    // Flat-colour "texture": a plain object {solid: 0xAABBGGRR} rather than a
    // loaded image. Lets any caller of the quad/triangle rasteriser below
    // (facility cubes, the mainframe pyramid -- src/entities/nodeWarObjects.js)
    // draw solid, dynamically-recolourable geometry through the SAME
    // clip/project/depth-test pipeline as real textures, with no second
    // rasteriser to maintain.
    if (tex.solid !== undefined) return tex.solid;
    if (!tex.loaded) return 0xFF888888;
    u = u - Math.floor(u); v = v - Math.floor(v);
    var tx = Math.min(tex.width - 1, Math.floor(u * tex.width));
    var ty = Math.min(tex.height - 1, Math.floor(v * tex.height));
    var i = (ty * tex.width + tx) * 4;
    return 0xFF000000 | (tex.data[i+2] << 16) | (tex.data[i+1] << 8) | tex.data[i];
}

// ABGR packed colour from separate 0-255 channels, for solidTex() callers.
function packColor(r, g, b) { return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0; }
function solidTex(abgr) { return { loaded: true, solid: abgr }; }

// Identical rasteriser to cubeRenderer.js's triangle fill, parameterised by
// texture so walls/floor/ceiling can each sample their own.
function _drawBuildingTri(p0, p1, p2, shade, tex) {
    var sw = screendata.canvas.width, sh = screendata.canvas.height,
        buf = screendata.buf32, dep = screendata.depthBuffer;

    var mnX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    var mxX = Math.min(sw-1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    var mnY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    var mxY = Math.min(sh-1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
    if (mnX > mxX || mnY > mxY) return;

    var area = edgeFunction(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
    if (Math.abs(area) < 0.001) return;
    var inv = 1.0 / area;

    var u0z = p0.u * p0.invZ, v0z = p0.v * p0.invZ;
    var u1z = p1.u * p1.invZ, v1z = p1.v * p1.invZ;
    var u2z = p2.u * p2.invZ, v2z = p2.v * p2.invZ;

    for (var py = mnY; py <= mxY; py++) {
        for (var px = mnX; px <= mxX; px++) {
            var cx = px + 0.5, cy = py + 0.5;
            var w0 = edgeFunction(p1.x, p1.y, p2.x, p2.y, cx, cy);
            var w1 = edgeFunction(p2.x, p2.y, p0.x, p0.y, cx, cy);
            var w2 = edgeFunction(p0.x, p0.y, p1.x, p1.y, cx, cy);
            var ok = (area > 0) ? (w0 >= 0 && w1 >= 0 && w2 >= 0)
                                 : (w0 <= 0 && w1 <= 0 && w2 <= 0);
            if (!ok) continue;

            var b0 = w0*inv, b1 = w1*inv, b2 = w2*inv;
            var iZ = b0*p0.invZ + b1*p1.invZ + b2*p2.invZ;
            var pd = (1.0/iZ) - 0.5;
            var bi = py*sw + px;
            if (pd >= dep[bi]) continue;

            var u = (b0*u0z + b1*u1z + b2*u2z) / iZ;
            var v = (b0*v0z + b1*v1z + b2*v2z) / iZ;
            var tc = _sampleBuildingTex(tex, u, v);

            var r = Math.min(255, ((tc)&0xFF)*shade|0);
            var g = Math.min(255, ((tc>>8)&0xFF)*shade|0);
            var b = Math.min(255, ((tc>>16)&0xFF)*shade|0);
            buf[bi] = 0xFF000000 | (b<<16) | (g<<8) | r;
            dep[bi] = pd;
        }
    }
}

var _BUILDING_NEAR = 2.0;

function _clipAndDraw(verts, shade, tex) {
    var NEAR = _BUILDING_NEAR, out = [], n = verts.length;
    for (var i = 0; i < n; i++) {
        var a = verts[i], b = verts[(i+1) % n];
        var fa = -(a.x-camera.x)*cubeSinYaw - (a.y-camera.y)*cubeCosYaw;
        var fb = -(b.x-camera.x)*cubeSinYaw - (b.y-camera.y)*cubeCosYaw;
        var aIn = fa >= NEAR, bIn = fb >= NEAR;
        if (aIn) out.push(a);
        if (aIn !== bIn) {
            var t = (NEAR-fa)/(fb-fa);
            out.push({x:a.x+t*(b.x-a.x), y:a.y+t*(b.y-a.y), z:a.z+t*(b.z-a.z),
                       u:a.u+t*(b.u-a.u), v:a.v+t*(b.v-a.v)});
        }
    }
    if (out.length < 3) return;
    var proj = [];
    for (var i = 0; i < out.length; i++) {
        var p = projectPoint(out[i]); p.u = out[i].u; p.v = out[i].v; proj.push(p);
    }
    for (var i = 1; i < proj.length - 1; i++) _drawBuildingTri(proj[0], proj[i], proj[i+1], shade, tex);
}

function _drawBuildingQuad(v0, v1, v2, v3, shade, tex, uRep, vRep) {
    uRep = uRep || 1; vRep = vRep || 1;
    if (typeof dayNight !== 'undefined') shade *= dayNight.ambient;
    _clipAndDraw([
        {x:v0.x,y:v0.y,z:v0.z,u:0,v:vRep}, {x:v1.x,y:v1.y,z:v1.z,u:uRep,v:vRep},
        {x:v2.x,y:v2.y,z:v2.z,u:uRep,v:0}, {x:v3.x,y:v3.y,z:v3.z,u:0,v:0}
    ], shade, tex);
}

// Renders ONE building (was the whole of VoxelMaster's RenderBuilding()).
function _renderOneBuilding(cfg) {
    var hw = cfg.width/2, hd = cfg.depth/2, wH = cfg.wallHeight, dH = cfg.doorHeight,
        dW = cfg.doorWidth, dOff = cfg.doorOffsetX || 0;
    var ox1 = cfg.x-hw, ox2 = cfg.x+hw, oy1 = cfg.y-hd, oy2 = cfg.y+hd;
    var baseZ = cfg.baseZ, topZ = baseZ + wH;

    var fdx = cfg.x-camera.x, fdy = cfg.y-camera.y;
    var fwd = -fdx*cubeSinYaw - fdy*cubeCosYaw;
    if (fwd < -(Math.max(hw,hd)+300)) return;   // broad frustum reject

    var wTex = cfg._wallTex, cTex = cfg._ceilingTex, fTex = cfg._floorTex;

    function hWall(wy,ax,bx,shade){var len=bx-ax; if(len<=0)return;
        _drawBuildingQuad({x:ax,y:wy,z:baseZ},{x:bx,y:wy,z:baseZ},{x:bx,y:wy,z:topZ},{x:ax,y:wy,z:topZ},shade,wTex,len/wH,1);}
    function hHeader(wy,ax,bx,fromZ,shade){var len=bx-ax,hh=topZ-fromZ; if(len<=0||hh<=0)return;
        _drawBuildingQuad({x:ax,y:wy,z:fromZ},{x:bx,y:wy,z:fromZ},{x:bx,y:wy,z:topZ},{x:ax,y:wy,z:topZ},shade,wTex,len/wH,hh/wH);}
    function vWall(wx,ay,by,shade){var len=by-ay; if(len<=0)return;
        _drawBuildingQuad({x:wx,y:ay,z:baseZ},{x:wx,y:by,z:baseZ},{x:wx,y:by,z:topZ},{x:wx,y:ay,z:topZ},shade,wTex,len/wH,1);}
    function vHeader(wx,ay,by,fromZ,shade){var len=by-ay,hh=topZ-fromZ; if(len<=0||hh<=0)return;
        _drawBuildingQuad({x:wx,y:ay,z:fromZ},{x:wx,y:by,z:fromZ},{x:wx,y:by,z:topZ},{x:wx,y:ay,z:topZ},shade,wTex,len/wH,hh/wH);}

    hWall(oy1, ox1, ox2, 0.65);       // north
    vWall(ox2, oy1, oy2, 0.80);       // east
    vWall(ox1, oy1, oy2, 0.80);       // west

    var dCX = cfg.x+dOff, dl = dCX-dW/2, dr = dCX+dW/2;
    hWall(oy2, ox1, dl, 1.0); hWall(oy2, dr, ox2, 1.0); hHeader(oy2, dl, dr, baseZ+dH, 1.0);  // south + door

    var iWalls = cfg.interiorWalls;
    if (iWalls) for (var i = 0; i < iWalls.length; i++) {
        var w = iWalls[i], shade = 0.75, cur, j, g, gH;
        if (w.type === 'h') {
            cur = w.x1;
            for (j = 0; j < w.gaps.length; j++) { g = w.gaps[j]; gH = g.height || dH;
                hWall(w.y, cur, g.x1, shade); hHeader(w.y, g.x1, g.x2, baseZ+gH, shade); cur = g.x2; }
            hWall(w.y, cur, w.x2, shade);
        } else if (w.type === 'v') {
            cur = w.y1;
            for (j = 0; j < w.gaps.length; j++) { g = w.gaps[j]; gH = g.height || dH;
                vWall(w.x, cur, g.y1, shade); vHeader(w.x, g.y1, g.y2, baseZ+gH, shade); cur = g.y2; }
            vWall(w.x, cur, w.y2, shade);
        }
    }

    var rU = cfg.width/64, rV2 = cfg.depth/64;
    _drawBuildingQuad({x:ox1,y:oy1,z:baseZ},{x:ox2,y:oy1,z:baseZ},{x:ox2,y:oy2,z:baseZ},{x:ox1,y:oy2,z:baseZ}, 0.90, fTex, rU, rV2);
    _drawBuildingQuad({x:ox1,y:oy2,z:topZ},{x:ox2,y:oy2,z:topZ},{x:ox2,y:oy1,z:topZ},{x:ox1,y:oy1,z:topZ}, 0.85, cTex, rU, rV2);
}

// Called each frame from main.js, once, for ALL registered buildings.
function RenderBuilding() {
    cubeSinYaw = Math.sin(camera.angle);
    cubeCosYaw = Math.cos(camera.angle);
    for (var i = 0; i < buildings.length; i++) _renderOneBuilding(buildings[i]);
}

// =====================================================
// Collision -- unchanged in shape from VoxelMaster, already array-based
// there (registerBuildingCollider), now sharing the same `buildings` array
// the renderer uses rather than a second parallel list.
// =====================================================

function _checkColliderWall(cfg, x, y) {
    var hw = cfg.width/2, hd = cfg.depth/2, r = PLAYER_RADIUS;
    if (x < cfg.x-hw-r || x > cfg.x+hw+r) return false;
    if (y < cfg.y-hd-r || y > cfg.y+hd+r) return false;
    var feetZ = camera.height - playerHeightOffset;
    var topZ = cfg.baseZ + cfg.wallHeight;
    if (feetZ >= topZ) return false;
    if (x > cfg.x-hw+r && x < cfg.x+hw-r && y > cfg.y-hd+r && y < cfg.y+hd-r) return false;
    var dw = (cfg.doorWidth||0)/2;
    if (dw > 0 && y > cfg.y+hd-r) {
        var doorCX = cfg.x + (cfg.doorOffsetX||0);
        var inDoorX = Math.abs(x-doorCX) < dw-r;
        var doorTopZ = cfg.baseZ + cfg.doorHeight;
        if (inDoorX && feetZ < doorTopZ) return false;
    }
    return true;
}

function _checkInteriorWalls(cfg, nx, ny) {
    if (!cfg.interiorWalls) return false;
    var topZ = cfg.baseZ + cfg.wallHeight, feetZ = camera.height - playerHeightOffset;
    if (feetZ >= topZ) return false;
    for (var i = 0; i < cfg.interiorWalls.length; i++) {
        var w = cfg.interiorWalls[i];
        if (w.type === 'h') {
            var oldSide = camera.y - w.y, newSide = ny - w.y;
            if (oldSide*newSide >= 0) continue;
            if (nx < w.x1 || nx > w.x2) continue;
            var blocked = true;
            for (var j = 0; j < w.gaps.length; j++) { var g = w.gaps[j], gH = g.height || cfg.doorHeight;
                if (nx >= g.x1 && nx <= g.x2 && feetZ < cfg.baseZ+gH) { blocked = false; break; } }
            if (blocked) return true;
        } else if (w.type === 'v') {
            var oldSide = camera.x - w.x, newSide = nx - w.x;
            if (oldSide*newSide >= 0) continue;
            if (ny < w.y1 || ny > w.y2) continue;
            var blocked = true;
            for (var j = 0; j < w.gaps.length; j++) { var g = w.gaps[j], gH = g.height || cfg.doorHeight;
                if (ny >= g.y1 && ny <= g.y2 && feetZ < cfg.baseZ+gH) { blocked = false; break; } }
            if (blocked) return true;
        }
    }
    return false;
}

// Called from camera.js canMoveTo -- true = blocked.
function getBuildingCollision(x, y) {
    for (var i = 0; i < buildings.length; i++) {
        var cfg = buildings[i];
        if (_checkColliderWall(cfg, x, y)) return true;
        if (_checkInteriorWalls(cfg, x, y)) return true;
    }
    return false;
}

// Called from camera.js UpdateCamera -- lowest ceiling above the player, or
// Infinity. checkH (last frame's height, BEFORE this frame's physics) is
// what decides "inside" -- it prevents a fast upward jump from tunnelling
// through the roof in one step (this frame's post-physics height could
// already be above topZ), and prevents a player who flew OVER the roof
// from being clamped back down inside it.
function getBuildingCeiling(x, y) {
    var checkH = (typeof _cameraHeightPrev !== 'undefined') ? _cameraHeightPrev : camera.height;
    var lowest = Infinity;
    for (var i = 0; i < buildings.length; i++) {
        var cfg = buildings[i], hw = cfg.width/2, hd = cfg.depth/2;
        if (x > cfg.x-hw && x < cfg.x+hw && y > cfg.y-hd && y < cfg.y+hd) {
            var topZ = cfg.baseZ + cfg.wallHeight;
            if (checkH <= topZ) { var ceilH = topZ - playerHeightOffset; if (ceilH < lowest) lowest = ceilH; }
        }
    }
    return lowest;
}

// Called from terrain.js groundAt -- roof acts as solid ground when standing
// on top, same as a cube top surface. Reads _cameraHeightPrev (camera.js)
// rather than taking a parameter, so groundAt's many other callers (minimap,
// item placement, mapLoader) don't need to know this exists.
function getBuildingRoofGround(x, y) {
    var prevH = (typeof _cameraHeightPrev !== 'undefined') ? _cameraHeightPrev : camera.height;
    var highest = 0;
    for (var i = 0; i < buildings.length; i++) {
        var cfg = buildings[i], hw = cfg.width/2, hd = cfg.depth/2;
        if (x > cfg.x-hw && x < cfg.x+hw && y > cfg.y-hd && y < cfg.y+hd) {
            var topZ = cfg.baseZ + cfg.wallHeight, roofGnd = topZ + playerHeightOffset;
            // Only snap to roof-as-ground if the player was above it last
            // frame OR is above it now -- otherwise a player standing just
            // under the ceiling from inside (camera.height approaching topZ)
            // would get this snap fire and launch them through the roof.
            var wasAbove = prevH >= topZ, isAbove = camera.height >= topZ;
            if ((wasAbove || isAbove) && roofGnd > highest) highest = roofGnd;
        }
    }
    return highest;
}

// Called from terrain.js groundAt -- raises ground to the building's floor
// plane while inside its footprint. The chunk terrain under and around each
// building is ALSO flattened to this same baseZ at generation time
// (chunkTerrain.js), so this is a safety net for the edge case where a
// building sits over the tiled PNG map (flattenTerrainUnderCube-style
// blending is chunk-only) rather than the mechanism that makes it agree.
function getBuildingFloorGround(x, y) {
    var highest = 0;
    for (var i = 0; i < buildings.length; i++) {
        var cfg = buildings[i], hw = cfg.width/2, hd = cfg.depth/2;
        if (x > cfg.x-hw && x < cfg.x+hw && y > cfg.y-hd && y < cfg.y+hd) {
            var floorGnd = cfg.baseZ + playerHeightOffset;
            if (floorGnd > highest) highest = floorGnd;
        }
    }
    return highest;
}
