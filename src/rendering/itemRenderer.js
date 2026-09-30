// ===============================
// Item Rendering (bullets, hearts, trees)
// ===============================
"use strict";

// Cache for image pixel data at fixed base resolution
var imageDataCache = {};
var BASE_SIZE = 64; // single cached size per image

function getImagePixelData(img) {
    // Cached on the image itself first: the tree canopy's src is a data: URL
    // hundreds of KB long, and looking that up by string for every canopy
    // every frame cost more than drawing the far ones.
    if (img._rcPixels) return img._rcPixels;
    var key = img.src;
    if (imageDataCache[key]) return (img._rcPixels = imageDataCache[key]);

    var canvas = document.createElement('canvas');
    canvas.width = BASE_SIZE;
    canvas.height = BASE_SIZE;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, BASE_SIZE, BASE_SIZE);
    var data = ctx.getImageData(0, 0, BASE_SIZE, BASE_SIZE);
    imageDataCache[key] = data;
    img._rcPixels = data;
    return data;
}

// Cache for sprite sheet pixel data at native resolution
var spriteSheetCache = null;

function getSpriteSheetData(img) {
    if (spriteSheetCache) return spriteSheetCache;
    if (!img.complete || !img.naturalWidth) return null;
    var c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    spriteSheetCache = ctx.getImageData(0, 0, c.width, c.height);
    return spriteSheetCache;
}

// Coarse occlusion buffer: the FARTHEST depth in each 8x8 screen tile,
// taken from the depth buffer as the terrain pass left it. A sprite whose
// depth is behind a tile's farthest pixel cannot show anywhere in that tile,
// so the whole tile is skipped -- trees behind a hill, or behind the tree in
// front of them, cost almost nothing. Items drawn later only bring depth
// closer, and a tile a sprite draws into is re-taken afterwards
// (refreshHiZTile), so it stays conservative -- it never hides anything that
// should show. Built lazily, only once a large sprite needs it.
var HIZ_SHIFT = 3, HIZ = 1 << HIZ_SHIFT;
var _hiz = null, _hizTW = 0;
function buildHiZ(depth, sw, sh) {
    var tw = (sw + HIZ - 1) >> HIZ_SHIFT, th = (sh + HIZ - 1) >> HIZ_SHIFT;
    if (!_hiz || _hiz.length !== tw * th) _hiz = new Float32Array(tw * th);
    _hiz.fill(0);
    _hizTW = tw;
    for (var y = 0; y < sh; y++) {
        var row = (y >> HIZ_SHIFT) * tw, p = y * sw;
        for (var x = 0; x < sw; x += HIZ) {
            var t = row + (x >> HIZ_SHIFT), m = _hiz[t], e = Math.min(sw, x + HIZ);
            for (var q = p + x, qe = p + e; q < qe; q++) if (depth[q] > m) m = depth[q];
            _hiz[t] = m;
        }
    }
}

// Re-take one tile's farthest depth after a sprite drew into it, so a
// near canopy that covers a whole tile hides that tile from the trees
// behind it (items are drawn nearest-first).
function refreshHiZTile(depth, sw, sh, tx, ty) {
    var xa = tx << HIZ_SHIFT, xb = Math.min(sw, xa + HIZ);
    var ya = ty << HIZ_SHIFT, yb = Math.min(sh, ya + HIZ), m = 0;
    for (var y = ya; y < yb; y++) {
        for (var q = y * sw + xa, qe = y * sw + xb; q < qe; q++) {
            var d = depth[q];
            if (d > m) { m = d; if (m === Infinity) { _hiz[ty * _hizTW + tx] = m; return; } }
        }
    }
    _hiz[ty * _hizTW + tx] = m;
}

var _colMap = new Int32Array(1024);

function RenderItems(extraItems){
    var sw = screendata.canvas.width,
        sh = screendata.canvas.height,
        depth = screendata.depthBuffer,
        buf32 = screendata.buf32,
        sinYaw = Math.sin(camera.angle),
        cosYaw = Math.cos(camera.angle),
        rx = cosYaw, ry = -sinYaw,
        focal = camera.focalLength,
        albedo = (typeof albedoBuffer === 'function') ? albedoBuffer() : null,
        hizBuilt = false;

    // Project items using ground-plane distance (consistent with terrain rendering)
    var allItems = extraItems ? items.concat(extraItems) : items;
    let projected = allItems.map(it => {
        var dx = it.x - camera.x,
            dy = it.y - camera.y;
        var groundForward = -dx*sinYaw - dy*cosYaw;
        return {it, dx, dy, groundForward};
    });

    // Filter valid + sort FRONT-to-back. Every item is alpha-tested (no
    // blending) and writes depth, so the depth test gives the same picture in
    // either order -- but nearest-first lets the depth test reject the
    // hidden parts of everything behind before touching its texture, instead
    // of painting far canopies only to paint over them again.
    projected = projected
        .filter(obj => obj.groundForward > 0.1 && obj.groundForward < camera.distance)
        .filter(obj => !(isAdmin && obj.it.type === 'tree'))
        .sort((a,b) => (a.groundForward - (a.it.depthBias || 0)) - (b.groundForward - (b.it.depthBias || 0)));

    // Draw each item pixel-by-pixel with depth testing
    projected.forEach(obj => {
        let it = obj.it;
        let dx = obj.dx, dy = obj.dy;
        let groundForward = obj.groundForward;

        var right = dx*rx + dy*ry;
        var screenX = right * (sw / 2) / groundForward + sw/2;
        var screenY = (camera.height - it.z) * focal / groundForward + camera.horizon;

        // Day/night: computed ONCE per item (not per pixel) from the
        // item's own world Y -- trees, players, bullets etc. previously
        // never darkened at all, regardless of time of day, since this
        // whole file was untouched by the original day/night work.
        var _itemLight = (typeof DayNight !== 'undefined') ? DayNight.intensityAtY(it.y) : 1;

        var scale = 12 * focal / groundForward;
        var scaleX = scale;
        var scaleY = scale;
        if (it.type === "tree") {
            scaleX *= 6;   // wider trees
            scaleY *= 12;  // much taller trees (stretched)
        }
        if (it.type === "player") {
            scaleX *= playerHeightOffset * (2 / 70);    // proportional width
            scaleY *= playerHeightOffset * (6.5 / 70);  // proportional height
        }
        if (it.type === "enemy") {
            // Vertical: 6.5 × (20/32.3) ≈ 4.0 → 62% of player height (enemy diameter = 2×hitRadius)
            scaleY *= 4;
            // Horizontal: correct for horizontal vs vertical projection mismatch.
            // Horizontal pixels-per-WU = (sw/2)/gf, vertical = focal/gf.
            // To appear circular: scaleX = scaleY × (sw/2) / focal
            scaleX *= 4 * (sw / 2) / focal;
        }
        if (it.type === "npc") {
            // Node War facility NPCs -- same billboard technique as "enemy"
            // above, deliberately smaller (design ask: "make their cube
            // smaller"). 2.6 vs enemy's 4 -> about 65% of an enemy's size.
            scaleY *= 2.6;
            scaleX *= 2.6 * (sw / 2) / focal;
        }
        if (it.type === "canopy") {
            // Tree canopy billboard (terrainTrees.js): sized in world units.
            scaleX = it.w * (sw / 2) / groundForward;
            scaleY = it.h * focal / groundForward;
        }
        if (it.type === "bullet") {
            scaleX *= bulletSize;
            scaleY *= bulletSize;
            // Track screen position for debugging
            lastBulletScreen = {x: screenX, y: screenY, z: it.z, camH: camera.height, gf: groundForward};
        }
        // Quick bounds check
        if (screenX < -scaleX || screenX >= sw + scaleX || screenY < -scaleY || screenY >= sh + scaleY) return;
        if (!it.image || !it.image.complete) return;

        // Determine source pixel data and sampling region
        var isSpriteSheet = (it.type === "player" && playerSprite.frameRects);
        var pixels, srcW, srcH, srcOffX, srcOffY, srcStride;

        if (isSpriteSheet) {
            var sheetData = getSpriteSheetData(it.image);
            if (!sheetData) return;
            pixels    = sheetData.data;
            srcStride = sheetData.width;  // full sheet width for row indexing
            // Use per-item frame if available, otherwise fall back to global
            var itemFrame = (it.spriteFrame != null) ? it.spriteFrame : playerSprite.currentFrame;
            var itemRow   = (it.spriteRow   != null) ? it.spriteRow   : playerSprite.currentRow;
            // Look up explicit frame rectangle
            var rowFrames = playerSprite.frameRects[itemRow];
            var rect = rowFrames ? rowFrames[Math.min(itemFrame, rowFrames.length - 1)] : null;
            if (rect) {
                srcOffX = rect.x;
                srcOffY = rect.y;
                srcW    = rect.w;
                srcH    = rect.h;
            } else {
                // Fallback to uniform grid
                srcW    = Math.floor(sheetData.width  / playerSprite.frameCount);
                srcH    = Math.floor(sheetData.height / playerSprite.rows);
                srcOffX = itemFrame * srcW;
                srcOffY = itemRow   * srcH;
            }
        } else {
            var imgData = getImagePixelData(it.image);
            pixels    = imgData.data;
            srcStride = imgData.width;    // BASE_SIZE
            srcW      = imgData.width;
            srcH      = imgData.height;
            srcOffX   = 0;
            srcOffY   = 0;
        }

        // Canopies sit slightly in front of their own trunk (see terrainTrees.js).
        var _bias = it.depthBias || 0;

        // Destination size and position using actual scale
        var destW = Math.max(1, Math.ceil(scaleX));
        var destH = Math.max(1, Math.ceil(scaleY));
        var destX = Math.floor(screenX - destW/2);
        // Bullets + enemies: center-align vertically (sphere center at z).
        // Trees/hearts: bottom-align so the base sits on the ground.
        var destY = (it.type === "bullet" || it.type === "enemy")
            ? Math.floor(screenY - destH / 2)
            : Math.floor(screenY - destH);

        // Clip to the screen once, rather than testing every pixel.
        var x0 = destX < 0 ? 0 : destX, x1 = Math.min(sw, destX + destW);
        var y0 = destY < 0 ? 0 : destY, y1 = Math.min(sh, destY + destH);
        if (x0 >= x1 || y0 >= y1) return;
        var zTest = groundForward - _bias;

        // Source byte offset for each visible destination column.
        if (_colMap.length < x1 - x0) _colMap = new Int32Array((x1 - x0) * 2);
        for (var cx = x0; cx < x1; cx++) {
            _colMap[cx - x0] = (Math.floor((cx - destX) * srcW / destW) + srcOffX) * 4;
        }

        function span(ya, yb, xa, xb) {
            for (var sy = ya; sy < yb; sy++) {
                // Map destination Y to source Y (within frame region)
                var srcRow = (Math.floor((sy - destY) * srcH / destH) + srcOffY) * srcStride * 4;
                for (var sx = xa, bufIdx = sy * sw + xa; sx < xb; sx++, bufIdx++) {
                    // Depth test - only draw if in front of terrain
                    if (zTest >= depth[bufIdx]) continue;
                    var srcIdx = srcRow + _colMap[sx - x0];
                    if (pixels[srcIdx + 3] < 128) continue; // skip transparent pixels

                    var r = pixels[srcIdx];
                    var g = pixels[srcIdx + 1];
                    var b = pixels[srcIdx + 2];
                    if (albedo) albedo[bufIdx] = (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
                    if (_itemLight !== 1) {
                        r = (r * _itemLight) | 0;
                        g = (g * _itemLight) | 0;
                        b = (b * _itemLight) | 0;
                    }

                    // Write to buffer (ABGR format for Uint32Array on little-endian)
                    buf32[bufIdx] = 0xFF000000 | (b << 16) | (g << 8) | r;
                    // Items never wrote depth before -- occlusion between items
                    // (sorted back-to-front already, so painter's algorithm
                    // handled that fine) worked without it, but nothing drawn
                    // AFTER items (the flashlight's post-process pass) could
                    // tell an item was there: depth[bufIdx] still held whatever
                    // the terrain pass left at that pixel, or Infinity (sky) for
                    // any part of a tall sprite reaching above the terrain
                    // silhouette -- exactly where a tree's canopy usually is.
                    // Now items are drawn nearest-first, this is also what
                    // hides the items behind.
                    depth[bufIdx] = zTest;
                }
            }
        }

        // Small sprites: just draw. Large ones: walk the occlusion tiles and
        // skip every tile the terrain already hides.
        if ((x1 - x0) * (y1 - y0) < HIZ * HIZ * 4) { span(y0, y1, x0, x1); return; }
        if (!hizBuilt) { buildHiZ(depth, sw, sh); hizBuilt = true; }
        var tx0 = x0 >> HIZ_SHIFT, tx1 = (x1 - 1) >> HIZ_SHIFT;
        var ty0 = y0 >> HIZ_SHIFT, ty1 = (y1 - 1) >> HIZ_SHIFT;
        for (var ty = ty0; ty <= ty1; ty++) {
            var ya = Math.max(y0, ty << HIZ_SHIFT), yb = Math.min(y1, (ty + 1) << HIZ_SHIFT);
            var trow = ty * _hizTW;
            for (var tx = tx0; tx <= tx1; tx++) {
                if (zTest >= _hiz[trow + tx]) continue;   // tile fully hidden
                span(ya, yb, Math.max(x0, tx << HIZ_SHIFT), Math.min(x1, (tx + 1) << HIZ_SHIFT));
                refreshHiZTile(depth, sw, sh, tx, ty);
            }
        }
    });
}
