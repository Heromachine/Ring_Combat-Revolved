// ===============================
// Keyboard Input Handlers
// ===============================
"use strict";

// PHASE 1 SPIKE: map pairs with real terrain, for judging the ring.
// Format is "colour;height". CE;DE (the default) is deliberately first so
// nothing changes until M is pressed.
// Ordered by measured terrain variation (height std over a 1024x1024 sample):
//   C21 33.5 | C14 31.8 | C15 24.2 | C13 15.1 | C3/C4 have 512x512 height
//   maps that get upscaled to 1024, so they read softer. CE;DE is last: it
//   is the flat featureless grey arena, kept only for comparison.
// PHASE 1 SPIKE: paint the current experimental mode state on screen, so
// which world you are looking at is never a guess.
function spikeStatus() {
    var el = document.getElementById('spike-status');
    if (!el) return;
    var chunks = (typeof Terrain !== 'undefined') && Terrain.getSource
                 && Terrain.getSource() === 'chunk';
    var ring   = (typeof ringWorld !== 'undefined') && ringWorld.enabled;
    var lines = [
        'N  near terrain : ' + (chunks ? 'PROCEDURAL CHUNKS (no repeat)' : 'tiled map (repeats every 1024)'),
        'O  ring world   : ' + (ring ? 'ON  ' + Math.round(ringWorld.ringLength).toLocaleString() + ' WU around' : 'off (flat)')
    ];
    if (ring) {
        lines.push('P  far side     : ' + (ringWorld.procedural ? 'procedural' : 'tiled mip'));
        lines.push('K  ring relief  : ' + (ringWorld.relief ? 'on x' + ringWorld.reliefScale : 'off'));
    }
    if (chunks && typeof ChunkTerrain !== 'undefined') {
        lines.push('   chunks built : ' + ChunkTerrain.stats.generated +
                   '  misses ' + ChunkTerrain.stats.misses);
    }
    if (typeof WorldGen !== 'undefined' && typeof camera !== 'undefined' && WorldGen.biomeIndexAt) {
        var _bi = WorldGen.biomeIndexAt(camera.y);
        lines.push('   biome        : ' + WorldGen.biomeName(_bi) +
                   '  (' + (_bi + 1) + '/' + WorldGen.biomeCount() + ')');
    }
    el.textContent = lines.join('\n');
}

var _spikeMaps = ["C21;D21", "C14;D14", "C15;D15", "C13;D13", "C3;D3", "C4;D4", "CE;DE"];
var _spikeMapIndex = 0;

function DetectKeysDown(e){
    switch(e.keyCode){
        case 87:input.forward=true;break;
        case 83:input.backward=true;break;
        case 65:input.left=true;break;
        case 68:input.right=true;break;
        case 32:input.jump=true;break;
        case 16:input.sprint=true;break;
        case 67:input.crouch=true;break;
        case 82:input.reload=true;break;
        case 81:input.swapWeapon=true;break;
        case 69:input.pickupWeapon=true;break;
        case 70:input.interact=true;break;  // F — interact / talk to NPC
        case 76: // L — toggle flashlight
            if (!e.repeat && typeof ToggleFlashlight === 'function') ToggleFlashlight();
            break;
        case 90: // Z - cycle zoom presets (admin only)
            if(!isAdmin) break;
            var zoomPresets=[20,50,100,200,300];
            var idx=zoomPresets.indexOf(minimapZoomRange);
            if(idx===-1) idx=0;
            var nextIdx=(idx+1)%zoomPresets.length;
            minimapZoomRange=zoomPresets[nextIdx];
            sideViewZoomRange=zoomPresets[nextIdx];
            document.getElementById('minimapZoomRange').value=minimapZoomRange;
            document.getElementById('minimapZoomRange-value').innerText=minimapZoomRange;
            document.getElementById('sideViewZoomRange').value=sideViewZoomRange;
            document.getElementById('sideViewZoomRange-value').innerText=sideViewZoomRange;
            break;
        case 84:if(isAdmin)positionTestTarget();break; // T - reposition target (admin only)
        case 71:if(isAdmin)testTarget.enabled=!testTarget.enabled;break; // G - toggle target (admin only)
        case 27: // ESC - toggle settings panel (admin only)
            if(!isAdmin) break;
            var ctrl=document.getElementById('controls');
            ctrl.style.display=ctrl.style.display==='none'?'block':'none';
            break;
        case 78: // N — PHASE 3/4: near terrain source, chunks vs the tiled map
            if (typeof Terrain !== 'undefined') {
                var _next = Terrain.getSource() === 'chunk' ? 'map' : 'chunk';
                if (_next === 'chunk' && typeof WorldGen !== 'undefined') {
                    WorldGen.configure(
                        (typeof ringWorld !== 'undefined' && ringWorld.ringLength)
                            ? ringWorld.ringLength : 57344);
                    ChunkTerrain.reset();
                    ChunkTerrain.requestAround(camera.x, camera.y, camera.distance);
                    ChunkTerrain.pump(9);   // seed enough to stand on
                }
                Terrain.setSource(_next);
                camera.height = Math.max(camera.height, getGroundHeight(camera.x, camera.y));

                // Scenery was placed against the OLD world, so it is now
                // floating over, or buried in, terrain that has changed
                // underneath it. Drop the trees and re-scatter against
                // whichever world is now live.
                if (typeof items !== 'undefined') {
                    for (var _i = items.length - 1; _i >= 0; _i--) {
                        if (items[_i] && items[_i].type === 'tree') items.splice(_i, 1);
                    }
                    if (typeof spawnRandomItems === 'function' && typeof textures !== 'undefined') {
                        spawnRandomItems('tree', textures.tree, {
                            step: 8, chance: 0.01,
                            colorCheck: function (col) { return (col & 0x00FF00) > 0x004000; }
                        });
                    }
                }
                // Enemies re-ground themselves each frame, but nudge them now
                // so they are not left inside a hill for a moment.
                if (typeof enemies !== 'undefined') {
                    for (var _e = 0; _e < enemies.length; _e++) {
                        if (enemies[_e]) enemies[_e].z = getRawTerrainHeight(enemies[_e].x, enemies[_e].y);
                    }
                }
                // The menu map caches its terrain image; the world just changed.
                if (typeof InGameMenu !== 'undefined' && InGameMenu.invalidateMapCache) {
                    InGameMenu.invalidateMapCache();
                }
                console.log("Near terrain:", _next === 'chunk'
                    ? "PROCEDURAL CHUNKS (never repeats)"
                    : "TILED MAP (repeats every 1024 WU)");
                spikeStatus();
            }
            break;
        case 80: // P — PHASE 1 SPIKE: procedural far side vs the tiled mip
            if (typeof ringWorld !== 'undefined') {
                ringWorld.procedural = !ringWorld.procedural;
                initRingWorld();
                console.log("Far side:", ringWorld.procedural
                    ? "PROCEDURAL (ring-extent noise, nothing repeats)"
                    : "TILED MIP (one heightmap repeated 56x)");
                spikeStatus();
            }
            break;
        case 75: // K — PHASE 1 SPIKE: toggle relief on the outer ring
            if (typeof ringWorld !== 'undefined') {
                ringWorld.relief = !ringWorld.relief;
                console.log("Outer-ring relief:", ringWorld.relief ? "ON" : "OFF (smooth cylinder)");
                spikeStatus();
            }
            break;
        case 77: // M — PHASE 1 SPIKE: cycle terrain maps
            // The default CE;DE is a flat featureless light-grey test arena
            // (its whole palette is rgb(193,193,192)), which makes the ring
            // impossible to judge -- no landmarks, so no sense of motion,
            // distance or curvature. These pairs have real terrain.
            if (typeof _spikeMaps !== 'undefined') {
                _spikeMapIndex = (_spikeMapIndex + 1) % _spikeMaps.length;
                var _mp = _spikeMaps[_spikeMapIndex];
                LoadMap(_mp);
                console.log("Map:", _mp, "(press M to cycle)");
            }
            break;
        case 79: // O — PHASE 1 SPIKE: toggle ring world on/off
            if (typeof ringWorld !== 'undefined') {
                ringWorld.enabled = !ringWorld.enabled;
                initRingWorld();
                if (ringWorld.enabled) camera.y = ringWrapY(camera.y);
                console.log("Ring world:", ringWorld.enabled ? "ON" : "OFF",
                    ringWorld.enabled
                        ? "| circumference " + ringWorld.ringLength.toLocaleString() +
                          " WU, radius " + Math.round(ringWorld.ringRadius).toLocaleString()
                        : "");
                spikeStatus();
            }
            break;
        case 9: // Tab — toggle in-game menu
            e.preventDefault();
            if (!e.repeat && typeof InGameMenu !== 'undefined') InGameMenu.toggle();
            break;
    }
    if(!updaterunning){time=Date.now();Draw();}
}

function DetectKeysUp(e){
    switch(e.keyCode){
        case 87:input.forward=false;break;
        case 83:input.backward=false;break;
        case 65:input.left=false;break;
        case 68:input.right=false;break;
        case 32:input.jump=false;break;
        case 16:input.sprint=false;break;
        case 67:input.crouch=false;break;
        case 82:input.reload=false;break;
        case 81:input.swapWeapon=false;break;
        case 69:input.pickupWeapon=false;break;
        case 70:input.interact=false;break;
        case 9: // Tab keyup — no action needed (menu is toggle, not hold)
            break;
    }
}
