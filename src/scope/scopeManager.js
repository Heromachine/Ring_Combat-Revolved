// ===============================
// Scope Manager - handles scope rendering modes
// ===============================
"use strict";

// Render sniper scope - uses modular scope system
function RenderSniperScope() {
    if (!activeScope) return;

    // Store main hiddeny reference for scope to restore
    var mainHiddeny = hiddeny;

    // Render functions to pass to scope module
    var renderFuncs = {
        DrawBackground: DrawBackground,
        RenderCube: RenderCube,
        RenderGreenCube: RenderGreenCube,
        RenderShadowCube: RenderShadowCube,
        Render: Render,
        RenderItems: function() {
            var sprites = [];

            // Remote players in multiplayer
            if (Multiplayer.isConnected()) {
                var _now = Date.now();
                var _myId = NakamaClient.getUserId();
                for (var _uid in nakamaState.remotePlayers) {
                    if (_uid === _myId) continue;
                    var _rp = nakamaState.remotePlayers[_uid];
                    if (_now - _rp.lastSeen > 10000) continue;
                    sprites.push({ x: _rp.x, y: _rp.y, z: _rp.height - playerHeightOffset, type: 'player', image: textures.player, spriteFrame: _rp.spriteFrame || 0, spriteRow: _rp.spriteRow || 0 });
                }
            } else {
                // Enemies in single-player
                enemies
                    .filter(function(e) { return e.state !== 'dead'; })
                    .forEach(function(e) {
                        sprites.push({ type: 'enemy', x: e.x, y: e.y, z: e.z + e.hitRadius, image: e.texture });
                    });
            }

            RenderItems(sprites.concat(GroundWeaponSprites()));
        },
        RenderGroundWeapons: RenderGroundWeapons,
        RenderTestTarget: RenderTestTarget
    };

    // Call the active scope's render method
    activeScope.render(screendata, camera, renderFuncs, mainHiddeny);
}

// Switch between scope modes
function setScopeMode(mode) {
    scopeMode = mode;
    if (mode === 'forward') {
        activeScope = ScopeForwardPosition;
        document.getElementById('scopeModeForward').style.background = '#4CAF50';
        document.getElementById('scopeModeFocal').style.background = '#555';
        document.getElementById('scopeModeDesc').textContent = 'Camera moves forward (may clip through walls)';
    } else {
        activeScope = ScopeFocalLength;
        document.getElementById('scopeModeForward').style.background = '#555';
        document.getElementById('scopeModeFocal').style.background = '#4CAF50';
        document.getElementById('scopeModeDesc').textContent = 'Same position, focal length zoom (no wall clipping)';
    }
}
