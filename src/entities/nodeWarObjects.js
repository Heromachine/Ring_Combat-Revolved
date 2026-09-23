// ===============================
// Node War: world objects — facility cubes, the Mainframe pyramid
// ===============================
// Reuses src/indoor/buildingRenderer.js's rasteriser (_drawBuildingQuad,
// _clipAndDraw, projectPoint/edgeFunction from cubeRenderer.js) rather than
// building a second one. solidTex()/packColor() (added there) let this draw
// flat, dynamically-recolourable geometry through the exact same
// clip/project/depth-test pipeline real textures use -- correct, because
// facility colour has to change live with server-pushed node state
// (neutral/clan1/clan2), which a static image texture cannot do cheaply.
//
// Gated on gameMode === 'nodewar' throughout, so this is a true no-op in
// freeplay -- it never touches nakamaState.nw or the shared rasteriser state
// unless a Node War match is actually running.
"use strict";

var NW_FACILITY_SIZE   = 50;   // cube edge, world units
var NW_MAINFRAME_SIZE  = 70;   // pyramid base width
var NW_MAINFRAME_HEIGHT = 90;

// Packed colours, reused every frame rather than rebuilt.
var NW_COLOR_NEUTRAL  = packColor(140, 140, 150);   // grey
var NW_COLOR_CLAN1    = packColor(70,  140, 230);   // blue
var NW_COLOR_CLAN2    = packColor(220, 90,  70);    // red
var NW_COLOR_MAINFRAME_OFF = packColor(120, 120, 130);
var NW_COLOR_MAINFRAME_ON  = packColor(250, 210, 60);

function _nwColorForNode(node) {
    if (node.status === 'active') {
        return node.team === 'clan1' ? NW_COLOR_CLAN1
             : node.team === 'clan2' ? NW_COLOR_CLAN2
             : NW_COLOR_NEUTRAL;
    }
    return NW_COLOR_NEUTRAL;
}

// Six quads, world-axis-aligned box -- same geometry cubeRenderer.js's
// single global `cube` uses, generalised to an arbitrary centre/size/colour
// instead of the one hardcoded instance.
function _drawFacilityCube(cx, cy, size, colour) {
    var baseZ = getRawTerrainHeight(cx, cy);
    var topZ  = baseZ + size;
    var h = size / 2;
    var tex = solidTex(colour);
    var rep = size / 32;

    // north / south / east / west walls, then the roof. No floor face --
    // never seen from outside or above, not worth the fill cost.
    _drawBuildingQuad({x:cx-h,y:cy-h,z:baseZ},{x:cx+h,y:cy-h,z:baseZ},{x:cx+h,y:cy-h,z:topZ},{x:cx-h,y:cy-h,z:topZ}, 0.75, tex, rep, rep);
    _drawBuildingQuad({x:cx+h,y:cy+h,z:baseZ},{x:cx-h,y:cy+h,z:baseZ},{x:cx-h,y:cy+h,z:topZ},{x:cx+h,y:cy+h,z:topZ}, 0.75, tex, rep, rep);
    _drawBuildingQuad({x:cx+h,y:cy-h,z:baseZ},{x:cx+h,y:cy+h,z:baseZ},{x:cx+h,y:cy+h,z:topZ},{x:cx+h,y:cy-h,z:topZ}, 0.85, tex, rep, rep);
    _drawBuildingQuad({x:cx-h,y:cy+h,z:baseZ},{x:cx-h,y:cy-h,z:baseZ},{x:cx-h,y:cy-h,z:topZ},{x:cx-h,y:cy+h,z:topZ}, 0.85, tex, rep, rep);
    _drawBuildingQuad({x:cx-h,y:cy+h,z:topZ},{x:cx+h,y:cy+h,z:topZ},{x:cx+h,y:cy-h,z:topZ},{x:cx-h,y:cy-h,z:topZ}, 0.95, tex, rep, rep);
    return topZ;
}

// NPC placeholder -- a flat billboard sprite (same rendering technique
// src/entities/enemy.js used for the now-removed AI enemies: a small canvas
// drawn once, cached, and rendered through the ordinary sprite pipeline in
// itemRenderer.js/RenderItems -- not the triangle rasteriser the cubes
// above use). Deliberately primitive: two filled shapes, no art asset,
// smaller than an enemy sprite was ("npc" type in itemRenderer.js scales at
// 2.6 vs enemy's 4). Marks whichever facilities currently carry an NPC
// (NPCS_PER_RESET of the 6; see nakama-modules/nw_match.lua
// assign_npc_positions) -- the same ones nodeWarInteract.js's dialog
// ("Activate this Node?") already only offers at.
var _nwNpcTexture = null;
function _getNwNpcTexture() {
    if (_nwNpcTexture) return _nwNpcTexture;
    var c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#2a3a44';
    ctx.beginPath(); ctx.arc(32, 16, 12, 0, Math.PI * 2); ctx.fill();   // head
    ctx.fillRect(16, 26, 32, 34);                                       // body
    ctx.fillStyle = '#ffd700';
    ctx.beginPath(); ctx.arc(32, 12, 4, 0, Math.PI * 2); ctx.fill();    // "has something to say"
    var img = new Image();
    img.src = c.toDataURL();
    return (_nwNpcTexture = img);
}

// Sprite list for the NPC-bearing facilities, in the same {x,y,z,type,image}
// shape main.js already builds player/enemy sprites in -- concat it onto
// theirs before calling RenderItems(). No-op outside Node War.
function NodeWarNpcSprites() {
    if (gameMode !== 'nodewar' || typeof nakamaState === 'undefined' || !nakamaState.nw) return [];
    var tex = _getNwNpcTexture();
    var sprites = [];
    for (var i = 0; i < nakamaState.nw.nodes.length; i++) {
        var node = nakamaState.nw.nodes[i];
        if (!nakamaState.nw.npcPositions[node.facilityId]) continue;
        sprites.push({ x: node.x, y: node.y, z: getRawTerrainHeight(node.x, node.y), type: 'npc', image: tex });
    }
    return sprites;
}

// Apex + 4 triangular sides. No base face (sits on/in the ground, never
// seen from below).
function _drawMainframePyramid(cx, cy) {
    var baseZ = getRawTerrainHeight(cx, cy);
    var apexZ = baseZ + NW_MAINFRAME_HEIGHT;
    var h = NW_MAINFRAME_SIZE / 2;
    var active = nakamaState.nw.mainframe && nakamaState.nw.mainframe.active;
    var tex = solidTex(active ? NW_COLOR_MAINFRAME_ON : NW_COLOR_MAINFRAME_OFF);
    var apex = {x:cx, y:cy, z:apexZ, u:0.5, v:0};

    var corners = [
        {x:cx-h,y:cy-h,z:baseZ}, {x:cx+h,y:cy-h,z:baseZ},
        {x:cx+h,y:cy+h,z:baseZ}, {x:cx-h,y:cy+h,z:baseZ}
    ];
    var shades = [0.75, 0.85, 0.75, 0.85];
    for (var i = 0; i < 4; i++) {
        var a = corners[i], b = corners[(i + 1) % 4];
        _clipAndDraw([
            apex,
            {x:a.x, y:a.y, z:a.z, u:0, v:1},
            {x:b.x, y:b.y, z:b.z, u:1, v:1}
        ], shades[i], tex);
    }
}

// Called each frame from main.js's Draw loop. No-op outside Node War.
function RenderNodeWarObjects() {
    if (gameMode !== 'nodewar' || typeof nakamaState === 'undefined' || !nakamaState.nw) return;

    cubeSinYaw = Math.sin(camera.angle);
    cubeCosYaw = Math.cos(camera.angle);

    for (var i = 0; i < nakamaState.nw.nodes.length; i++) {
        var node = nakamaState.nw.nodes[i];
        _drawFacilityCube(node.x, node.y, NW_FACILITY_SIZE, _nwColorForNode(node));
    }

    _drawMainframePyramid(0, 0);
}
