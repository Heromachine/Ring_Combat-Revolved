// ===============================
// Baked terrain -- load an externally generated heightmap strip
// ===============================
// Fetches a strip's JSON (data/terrain/ring8.json by default) + its int16
// elevation file (produced by
// ~/terrain-diffusion-work/strip_export.py, a generic Terrain Diffusion strip
// exporter) and hands it to WorldGen.useHeightmap(), which then replaces the
// procedural biome field. Nothing else needs to know: every terrain consumer
// already samples WorldGen.heightAtWorld.
//
// ?terrain=noise in the URL skips this and keeps the procedural biomes. If
// the files are missing or fail to load, the procedural world stays too.
//
// The fetch starts at page load and usually finishes before Init() runs. If
// the game is already running when it lands, refreshWorld() rebuilds
// everything that was built from the old field: far-side LOD, buildings,
// resident chunks, scenery, and the player's footing.
"use strict";

var BakedTerrain = (function () {
    var BASE = 'data/terrain/';
    // Strips by resolution (world units per heightmap pixel). ?terrainRes=16
    // picks the original coarser strip for comparison.
    var STRIPS = { 8: 'ring8.json', 16: 'ring.json' };
    var DEFAULT_RES = 8;
    var _state = 'idle';   // idle | loading | ready | off | failed

    function _param(name) {
        try { return new URLSearchParams(location.search).get(name); }
        catch (e) { return null; }
    }

    function _wanted() { return _param('terrain') !== 'noise'; }

    function load() {
        if (!_wanted()) { _state = 'off'; return; }
        _state = 'loading';
        var file = STRIPS[_param('terrainRes')] || STRIPS[DEFAULT_RES];
        fetch(BASE + file).then(function (r) {
            if (!r.ok) throw new Error(file + ' ' + r.status);
            return r.json();
        }).then(function (meta) {
            return fetch(BASE + meta.elev.file).then(function (r) {
                if (!r.ok) throw new Error(meta.elev.file + ' ' + r.status);
                return r.arrayBuffer();
            }).then(function (buf) {
                var elev = new Int16Array(buf);
                if (elev.length !== meta.length * meta.width) throw new Error('size mismatch');
                // Lakes (lake_bake.py) are part of the terrain build, so they are
                // fetched first; a missing file just means no lakes.
                var lakesFile = meta.lakes && meta.lakes.file;
                return (lakesFile ? fetch(BASE + lakesFile).then(function (r) { return r.ok ? r.arrayBuffer() : null; })
                                              .catch(function () { return null; })
                                  : Promise.resolve(null)).then(function (lb) {
                var lakeOpts = {};
                try {
                    if (lb && new URLSearchParams(location.search).get('lakes') !== '0') lakeOpts.lakes = new Uint8Array(lb);
                } catch (e) { if (lb) lakeOpts.lakes = new Uint8Array(lb); }
                WorldGen.useHeightmap(meta, elev, lakeOpts);
                _state = 'ready';
                // Climate (tree placement) is optional: without it forests
                // fall back to elevation/slope/noise only.
                if (meta.climate && meta.climate.file) {
                    fetch(BASE + meta.climate.file).then(function (r) { return r.ok ? r.arrayBuffer() : null; })
                        .then(function (cb) {
                            if (cb && WorldGen.useClimate(meta, new Int16Array(cb)) &&
                                typeof _loopActive !== 'undefined' && _loopActive) refreshWorld();
                        }).catch(function () { /* keep going without climate */ });
                }
                console.log('Baked terrain:', meta.generator, meta.length + 'x' + meta.width,
                    'land ' + Math.round(meta.stats.landFraction * 100) + '%');
                if (typeof _loopActive !== 'undefined' && _loopActive) refreshWorld();
                });
            });
        }).catch(function (e) {
            _state = 'failed';
            console.warn('Baked terrain not loaded, keeping procedural biomes:', e.message);
        });
    }

    function refreshWorld() {
        if (typeof ringWorld !== 'undefined' && ringWorld.enabled && ringWorld.procedural &&
            typeof buildRingNoiseLOD === 'function') buildRingNoiseLOD();
        if (typeof placeBuildings === 'function') placeBuildings();
        if (typeof TerrainTrees !== 'undefined') TerrainTrees.refresh();
        if (typeof Terrain !== 'undefined' && Terrain.usingChunks && Terrain.usingChunks()) {
            ChunkTerrain.reset();
            ChunkTerrain.requestAround(camera.x, camera.y, camera.distance);
            ChunkTerrain.pump(25);
            camera.height = Math.max(camera.height, getGroundHeight(camera.x, camera.y));
        }
        if (typeof items !== 'undefined' && typeof spawnRandomItems === 'function' && typeof textures !== 'undefined') {
            for (var i = items.length - 1; i >= 0; i--) {
                if (items[i] && items[i].type === 'tree') items.splice(i, 1);
            }
            spawnRandomItems('tree', textures.tree, {
                step: 8, chance: 0.01,
                colorCheck: function (col) { return (col & 0x00FF00) > 0x004000; }
            });
        }
        if (typeof enemies !== 'undefined' && typeof getRawTerrainHeight === 'function') {
            for (var e = 0; e < enemies.length; e++) {
                if (enemies[e]) enemies[e].z = getRawTerrainHeight(enemies[e].x, enemies[e].y);
            }
        }
        if (typeof InGameMenu !== 'undefined' && InGameMenu.invalidateMapCache) {
            InGameMenu.invalidateMapCache();
        }
    }

    function state() { return _state; }

    load();
    return { state: state, refreshWorld: refreshWorld };
})();
