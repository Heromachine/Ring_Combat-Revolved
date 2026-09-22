// ===============================
// Items Management (bullets, hearts, trees, ground weapons)
// ===============================
"use strict";

function spawnRandomItems(type, texture, options) {
    options = options || {};
    let step = options.step || 8;               // spacing (avoid too many)
    let chance = options.chance || 0.01;        // probability per tile
    let colorCheck = options.colorCheck || (()=>true); // which terrain allowed

    if (typeof Terrain !== 'undefined' && Terrain.usingChunks && Terrain.usingChunks()) {
        _scatterWorld(type, texture, step, chance, colorCheck, options);
        return;
    }

    // CELL space: with a loaded heightmap the map IS the world, so walking
    // its grid and using cell coordinates as world coordinates is correct.
    for (let y = 0; y < Terrain.mapHeight(); y += step) {
        for (let x = 0; x < Terrain.mapWidth(); x += step) {
            let col = Terrain.colorAtCell(x, y) & 0xFFFFFF;  // strip alpha

            if (colorCheck(col)) {
                if (Math.random() < chance) {
                    let wx = x;
                    let wy = y;
                    // Use raw terrain for static items so they sit on actual ground
                    let wz = getRawTerrainHeight(wx, wy);
                    items.push({
                        type: type,
                        x: wx, y: wy, z: wz,
                        dx: 0, dy: 0, dz: 0,
                        image: texture
                    });
                }
            }
        }
    }
}

// WORLD space scatter, for the procedural world.
//
// The cell-space version above is wrong once terrain is generated: it would
// place items by the PNG's colours, at PNG coordinates, inside a 1,024 WU box
// -- while the actual world is 57,344 WU around the ring and has different
// ground underneath. Items would sit in mid-air over terrain that has nothing
// to do with where they were chosen.
//
// Sampling goes through WorldGen rather than Terrain so placement does not
// depend on which chunks happen to be resident at load time.
function _scatterWorld(type, texture, step, chance, colorCheck, options) {
    let span = options.worldSpan || 3072;              // WU covered, centred on the player
    let cx = (typeof camera !== 'undefined') ? camera.x : 0;
    let cy = (typeof camera !== 'undefined') ? camera.y : 0;
    let half = span / 2;
    let haveGen = (typeof WorldGen !== 'undefined');

    // The scatter area is ~9x the old 1,024 box, so at the same DENSITY it
    // yields ~10x the items (measured 1,542 trees against 154). Density is
    // right, but every item stays in the per-frame list whether or not it is
    // within draw distance, so cap the expected count and thin uniformly
    // rather than stopping early, which would bunch everything in one corner.
    let maxCount = options.maxCount || 600;
    let samples  = Math.pow(span / step, 2);
    let effChance = Math.min(chance, maxCount / Math.max(samples, 1));

    for (let wy = cy - half; wy < cy + half; wy += step) {
        let bio = haveGen ? WorldGen.biomeIndexAt(wy) : 0;
        for (let wx = cx - half; wx < cx + half; wx += step) {
            let h   = haveGen ? WorldGen.heightAtWorld(wx, wy, 1) : Terrain.heightAt(wx, wy);
            let col = (haveGen ? WorldGen.colorForHeightBiome(h, bio) : Terrain.colorAt(wx, wy)) & 0xFFFFFF;

            if (colorCheck(col) && Math.random() < effChance) {
                items.push({
                    type: type,
                    x: wx, y: wy, z: h,
                    dx: 0, dy: 0, dz: 0,
                    image: texture
                });
            }
        }
    }
}
