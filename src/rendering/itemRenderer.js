// ===============================
// Item Rendering (bullets, hearts, trees)
// ===============================
"use strict";

// Cache for image pixel data at fixed base resolution
var imageDataCache = {};
var BASE_SIZE = 64; // single cached size per image

function getImagePixelData(img) {
    var key = img.src;
    if (imageDataCache[key]) return imageDataCache[key];

    var canvas = document.createElement('canvas');
    canvas.width = BASE_SIZE;
    canvas.height = BASE_SIZE;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, BASE_SIZE, BASE_SIZE);
    var data = ctx.getImageData(0, 0, BASE_SIZE, BASE_SIZE);
    imageDataCache[key] = data;
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

function RenderItems(extraItems){
    var sw = screendata.canvas.width,
        sh = screendata.canvas.height,
        depth = screendata.depthBuffer,
        buf32 = screendata.buf32,
        sinYaw = Math.sin(camera.angle),
        cosYaw = Math.cos(camera.angle),
        rx = cosYaw, ry = -sinYaw,
        focal = camera.focalLength;

    // Project items using ground-plane distance (consistent with terrain rendering)
    var allItems = extraItems ? items.concat(extraItems) : items;
    let projected = allItems.map(it => {
        var dx = it.x - camera.x,
            dy = it.y - camera.y;
        var groundForward = -dx*sinYaw - dy*cosYaw;
        return {it, dx, dy, groundForward};
    });

    // Filter valid + sort back-to-front (far items first)
    projected = projected
        .filter(obj => obj.groundForward > 0.1 && obj.groundForward < camera.distance)
        .filter(obj => !(isAdmin && obj.it.type === 'tree'))
        .sort((a,b) => b.groundForward - a.groundForward);

    // Draw each item pixel-by-pixel with depth testing
    projected.forEach(obj => {
        let it = obj.it;
        let dx = obj.dx, dy = obj.dy;
        let groundForward = obj.groundForward;

        var right = dx*rx + dy*ry;
        var screenX = right * (sw / 2) / groundForward + sw/2;
        var screenY = (camera.height - it.z) * focal / groundForward + camera.horizon;

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

        // Destination size and position using actual scale
        var destW = Math.max(1, Math.ceil(scaleX));
        var destH = Math.max(1, Math.ceil(scaleY));
        var destX = Math.floor(screenX - destW/2);
        // Bullets + enemies: center-align vertically (sphere center at z).
        // Trees/hearts: bottom-align so the base sits on the ground.
        var destY = (it.type === "bullet" || it.type === "enemy")
            ? Math.floor(screenY - destH / 2)
            : Math.floor(screenY - destH);

        // Draw each destination pixel, sampling from source
        for (var py = 0; py < destH; py++) {
            var sy = destY + py;
            if (sy < 0 || sy >= sh) continue;

            // Map destination Y to source Y (within frame region)
            var sampY = Math.floor(py * srcH / destH) + srcOffY;

            for (var px = 0; px < destW; px++) {
                var sx = destX + px;
                if (sx < 0 || sx >= sw) continue;

                var bufIdx = sy * sw + sx;

                // Depth test - only draw if in front of terrain
                if (groundForward >= depth[bufIdx]) continue;

                // Map destination X to source X (within frame region)
                var sampX = Math.floor(px * srcW / destW) + srcOffX;
                var srcIdx = (sampY * srcStride + sampX) * 4;

                var a = pixels[srcIdx + 3];
                if (a < 128) continue; // skip transparent pixels

                var r = pixels[srcIdx];
                var g = pixels[srcIdx + 1];
                var b = pixels[srcIdx + 2];

                // Write to buffer (ABGR format for Uint32Array on little-endian)
                buf32[bufIdx] = 0xFF000000 | (b << 16) | (g << 8) | r;
            }
        }
    });
}
