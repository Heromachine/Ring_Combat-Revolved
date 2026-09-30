// ===============================
// Terrain trees -- trunk in the heightmap, canopy as a billboard
// ===============================
// A trunk is stamped into the terrain chunks at generation time
// (chunkTerrain.js), so the voxel renderer draws it as solid columns that
// hills occlude and day/night lights like the ground. It uses the same
// trick as water: the texel stores the trunk TOP for drawing, and the
// trunk's height in the colour row, so heightAt() -- physics, bullets,
// the minimap -- still sees the real ground underneath. Walking into a
// trunk is blocked by collides(), not by the ground slope.
//
// The canopy is a billboard (the top of images/tree.png) drawn by the
// item renderer at the trunk top, with a small depth bias so it covers
// its own trunk (the trunk's front face is a few WU nearer the camera
// than the tree's centre).
//
// First step: ONE tree near spawn, to judge the look. Placement rules and
// forests come later.
"use strict";

var TerrainTrees = (function () {
    var MAT_TRUNK = 4, MAT_TRUNK_EDGE = 5;   // chunk materials (see worldGen.js)

    // x, y: trunk centre. r: trunk radius (WU). trunkH: trunk height above
    // the ground at the centre. canopyBase: where the canopy's bottom sits
    // above the ground. canopyW / canopyH: billboard size (WU / height units).
    // Scale: the player's eye is 7 units above the ground (settings), so
    // units read as roughly feet. Both to the LEFT of spawn (turn ~70 deg
    // left): straight ahead the 100-unit box blocks everything within
    // ~59 deg. Side by side for comparison:
    //   small pine -- ~85 ft overall, 4 ft trunk, branches from 16 ft;
    //   large pine -- 50 ft of bare trunk before the branches, 8 ft trunk,
    //                 ~160 ft overall. The trunk runs up into the canopy.
    //   giant pine -- 200 ft overall, 12 ft trunk, 70 ft bare trunk.
    var TREES = [
        { x: -330, y: -120, r: 2, trunkH: 55,  canopyBase: 16, canopyW: 30, canopyH: 70 },
        { x: -440, y: -190, r: 4, trunkH: 105, canopyBase: 50, canopyW: 62, canopyH: 110 },
        { x: -600, y: -280, r: 6, trunkH: 140, canopyBase: 70, canopyW: 90, canopyH: 130 }
    ];

    // The old random billboard trees (items type 'tree', images/tree.png)
    // are hidden while the terrain trees are being tried; ?oldtrees=1 shows
    // them again. spawnRandomItems() checks this.
    function scatterTreesOn() {
        try { return new URLSearchParams(location.search).get('oldtrees') === '1'; }
        catch (e) { return false; }
    }

    var _canopyImg = null;
    function canopyImage() {
        if (_canopyImg) return _canopyImg;
        var src = (typeof textures !== 'undefined') ? textures.tree : null;
        if (!src || !src.complete || !src.naturalWidth) return null;
        // Keep the top 86% of tree.png: drop its painted trunk and grass tuft.
        var w = src.naturalWidth, h = Math.round(src.naturalHeight * 0.86);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(src, 0, 0, w, h, 0, 0, w, h);
        var img = new Image();
        img.src = c.toDataURL('image/png');
        _canopyImg = img;
        return img;
    }

    // Ground height at a trunk's centre, rounded so every texel of the
    // trunk shares one flat top.
    function baseZ(t) { return Math.round(WorldGen.heightAtWorld(t.x, t.y, 1)); }

    // Trees whose trunk overlaps a chunk, with their top resolved -- called
    // once per chunk generation.
    function touching(ox, oy, size) {
        var out = null;
        for (var i = 0; i < TREES.length; i++) {
            var t = TREES[i];
            if (t.x + t.r < ox || t.x - t.r > ox + size || t.y + t.r < oy || t.y - t.r > oy + size) continue;
            (out || (out = [])).push({ x: t.x, y: t.y, r: t.r, top: baseZ(t) + t.trunkH });
        }
        return out;
    }

    // True if a body of radius pad at (x, y) would overlap a trunk.
    function collides(x, y, pad) {
        for (var i = 0; i < TREES.length; i++) {
            var t = TREES[i], dx = x - t.x, dy = y - t.y, rr = t.r + (pad || 0);
            if (dx * dx + dy * dy < rr * rr) return true;
        }
        return false;
    }

    // (Re)place the canopy billboards against the current world. Call after
    // the terrain is configured (Init) and whenever it changes.
    function refresh() {
        if (typeof items === 'undefined') return;
        for (var i = items.length - 1; i >= 0; i--) if (items[i] && items[i].type === 'canopy') items.splice(i, 1);
        var img = canopyImage();
        if (!img) {                        // tree.png not decoded yet: try again shortly
            setTimeout(refresh, 250);
            return;
        }
        for (var k = 0; k < TREES.length; k++) {
            var t = TREES[k];
            items.push({ type: 'canopy', x: t.x, y: t.y, z: baseZ(t) + t.canopyBase,
                         w: t.canopyW, h: t.canopyH, depthBias: t.r + 1,
                         dx: 0, dy: 0, dz: 0, image: img });
        }
    }

    return {
        MAT_TRUNK: MAT_TRUNK, MAT_TRUNK_EDGE: MAT_TRUNK_EDGE,
        list: function () { return TREES; },
        scatterTreesOn: scatterTreesOn,
        touching: touching,
        collides: collides,
        refresh: refresh
    };
})();
