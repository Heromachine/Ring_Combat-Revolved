// ===============================
// Terrain Access Layer
// ===============================
// THE single place the game reads terrain. Nothing outside this file should
// touch map.altitude or map.color directly.
//
// Why it exists: the world is currently one flat 1024x1024 heightmap wrapped
// bitwise on both axes, and ~43 reads across a dozen files each re-derived
// that index themselves, in three different styles. Routing them through here
// means the world's SHAPE can change -- to a tile pool, and then to a ring --
// by editing this file rather than every caller.
//
// ── Two coordinate spaces, deliberately kept separate ──
//
//   WORLD space  (heightAt / colorAt / groundAt)
//       Continuous, unbounded, wraps. What the player, camera, bullets,
//       entities and the minimap use. On a ring world this is the space that
//       gains a seam, so these are the functions that will change shape.
//
//   CELL space   (heightAtCell / colorAtCell / mapWidth / mapHeight)
//       Discrete indices into ONE heightmap, 0..width-1. Does not wrap and is
//       not a position in the world. Used for authoring and whole-map views:
//       scattering items across a map, drawing the full-map overview. On a
//       ring these become "iterate the tile pool", not "iterate the world".
//
// Mixing them up is the easiest way to get subtly wrong results later, which
// is why they are named differently rather than overloaded.
"use strict";

var Terrain = (function () {

    // World position -> index into the current heightmap.
    // The bitwise AND is the wrap, and is only valid because width/height are
    // powers of two. It also handles negative coordinates correctly (in two's
    // complement, -1 & 1023 === 1023), which is why world space can be
    // unbounded while the array is not.
    //
    // NOTE: the original inline version in voxelEngine.js masked Y with
    // (width-1) and X with (height-1) -- transposed. Harmless while the map is
    // square (both 1024), but corrected here so a non-square map would not
    // silently misread.
    function indexAt(worldX, worldY) {
        return ((Math.floor(worldY) & (map.height - 1)) << map.shift)
             +  (Math.floor(worldX) & (map.width  - 1));
    }

    // ── WORLD space ──────────────────────────────────────────

    // Raw terrain height, without the player height offset.
    function heightAt(worldX, worldY) {
        return map.altitude[indexAt(worldX, worldY)];
    }

    // Packed ABGR colour of the terrain surface.
    function colorAt(worldX, worldY) {
        return map.color[indexAt(worldX, worldY)];
    }

    // Walkable ground height: terrain plus the player offset, raised to the
    // cube top where the position is inside the cube's footprint.
    function groundAt(worldX, worldY) {
        var terrainHeight = heightAt(worldX, worldY) + playerHeightOffset;

        var halfSize = cube.size / 2;
        if (worldX >= cube.x - halfSize && worldX <= cube.x + halfSize &&
            worldY >= cube.y - halfSize && worldY <= cube.y + halfSize) {
            var cubeTopZ = heightAt(cube.x, cube.y) + cube.size + playerHeightOffset;
            return Math.max(terrainHeight, cubeTopZ);
        }
        return terrainHeight;
    }

    // ── CELL space ───────────────────────────────────────────
    // Direct, unwrapped indices into one heightmap. Callers iterating a whole
    // map (item scatter, full-map overview) use these.

    function heightAtCell(cellX, cellY) {
        return map.altitude[(cellY << map.shift) + cellX];
    }

    function colorAtCell(cellX, cellY) {
        return map.color[(cellY << map.shift) + cellX];
    }

    function mapWidth()  { return map.width;  }
    function mapHeight() { return map.height; }

    // ── Authoring escape hatch ───────────────────────────────
    // The loader and the flat-fill in main.js WRITE whole arrays. That is map
    // authoring, not sampling, and it stays raw for now -- but it goes through
    // a named door so it is greppable when the tile pool lands.
    function rawMap() { return map; }

    return {
        indexAt:      indexAt,
        heightAt:     heightAt,
        colorAt:      colorAt,
        groundAt:     groundAt,
        heightAtCell: heightAtCell,
        colorAtCell:  colorAtCell,
        mapWidth:     mapWidth,
        mapHeight:    mapHeight,
        rawMap:       rawMap
    };

})();
