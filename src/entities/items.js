// ===============================
// Items Management (bullets, hearts, trees, ground weapons)
// ===============================
"use strict";

function spawnRandomItems(type, texture, options) {
    options = options || {};
    let step = options.step || 8;               // spacing (avoid too many)
    let chance = options.chance || 0.01;        // probability per tile
    let colorCheck = options.colorCheck || (()=>true); // which terrain allowed

    // CELL space: item scatter walks the heightmap grid, not world positions.
    // When the world becomes a tile pool this loop iterates the pool instead.
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
