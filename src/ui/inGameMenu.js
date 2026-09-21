// ===============================
// In-Game Menu
//
// Tab key toggles this overlay. Contains three UI tabs:
//   Menu        — Resume button + Quest Log (live quest states)
//   Leaderboard — Player list with kills and ping
//   Map         — Full world overview with player position
//
// To add items to the Menu tab, add HTML to #ingame-panel-menu in index.html
// and wire up any logic here.
// ===============================
"use strict";

var InGameMenu = (function () {

    var _open            = false;
    var _activeTab       = 'menu';
    var _mapTerrainCache = null;   // cached ImageData of the world terrain (rebuilt on map load)

    // ─────────────────────────────────────────────────────────
    // Open / close / toggle
    // ─────────────────────────────────────────────────────────
    function toggle() {
        if (_open) hide(); else show();
    }

    function show() {
        // Do not open over an active dialog
        var dlg = document.getElementById('dialog-box');
        if (dlg && dlg.style.display === 'flex') return;

        _open = true;
        _refresh();
        var el = document.getElementById('ingame-menu');
        if (el) el.classList.add('open');
        if (document.pointerLockElement) document.exitPointerLock();
        // The overlay swallows the mouseup, so anything held when the menu
        // opened would stay held. Release it here too -- exitPointerLock
        // covers the usual path, but not the case where the lock was
        // already gone.
        if (typeof releaseHeldInput === "function") releaseHeldInput();
    }

    function hide() {
        _open = false;
        var el = document.getElementById('ingame-menu');
        if (el) el.classList.remove('open');
    }

    function isOpen() { return _open; }

    // Call this after a new map is loaded so the terrain cache is rebuilt
    function invalidateMapCache() { _mapTerrainCache = null; }

    // ─────────────────────────────────────────────────────────
    // Tab switching
    // ─────────────────────────────────────────────────────────
    function _switchTab(tab) {
        _activeTab = tab;
        document.querySelectorAll('.ingame-tab').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        var menuPanel = document.getElementById('ingame-panel-menu');
        var lbPanel   = document.getElementById('ingame-panel-leaderboard');
        var mapPanel  = document.getElementById('ingame-panel-map');
        if (menuPanel) menuPanel.style.display = tab === 'menu'        ? 'block' : 'none';
        if (lbPanel)   lbPanel.style.display   = tab === 'leaderboard' ? 'block' : 'none';
        if (mapPanel)  mapPanel.style.display  = tab === 'map'         ? 'flex'  : 'none';
        if (tab === 'map') _refreshMap();
    }

    // ─────────────────────────────────────────────────────────
    // Refresh all panels
    // ─────────────────────────────────────────────────────────
    function _refresh() {
        _refreshQuestLog();
        _refreshLeaderboard();
        if (_activeTab === 'map') _refreshMap();
    }

    function _refreshQuestLog() {
        var el = document.getElementById('ingame-quest-log');
        if (!el) return;

        var quests = (typeof QuestManager !== 'undefined' && QuestManager.getAll)
            ? QuestManager.getAll() : [];

        if (!quests.length) {
            el.innerHTML = '<div style="color:rgba(138,176,200,0.3);font-size:0.75rem;padding:8px 0;">No quests registered.</div>';
            return;
        }

        var STATUS_LABEL = {
            not_started:      'Not Started',
            active:           'Active',
            ready_to_complete:'Ready to Turn In',
            complete:         'Complete',
            rejected:         'Declined'
        };
        var STATUS_COLOR = {
            not_started:      'rgba(138,176,200,0.35)',
            active:           '#8ab0c8',
            ready_to_complete:'#6abf8a',
            complete:         'rgba(106,191,138,0.45)',
            rejected:         'rgba(192,112,112,0.5)'
        };

        el.innerHTML = quests.map(function (q) {
            var phase  = q.state.phase;
            var color  = STATUS_COLOR[phase]  || '#8ab0c8';
            var label  = STATUS_LABEL[phase]  || phase;
            var desc   = q.description
                ? '<div class="ingame-quest-desc">' + q.description + '</div>'
                : '';
            return '<div class="ingame-quest-row">' +
                '<div class="ingame-quest-left">' +
                    '<span class="ingame-quest-name">' + q.npcName + '</span>' +
                    desc +
                '</div>' +
                '<span class="ingame-quest-status" style="color:' + color + '">' + label + '</span>' +
                '</div>';
        }).join('');
    }

    function _refreshLeaderboard() {
        var el = document.getElementById('ingame-leaderboard-body');
        if (!el) return;

        var now    = Date.now();
        var myName = (typeof NakamaClient !== 'undefined')
            ? (NakamaClient.getUsername() || 'You') : 'You';
        var myKills = (typeof nakamaState !== 'undefined') ? (nakamaState.myKills || 0) : 0;
        var myPing  = (typeof nakamaState !== 'undefined') ? nakamaState.myPing : null;

        var rows = [{ name: myName, kills: myKills, ping: myPing, isSelf: true }];

        if (typeof nakamaState !== 'undefined') {
            Object.keys(nakamaState.remotePlayers).forEach(function (uid) {
                var rp = nakamaState.remotePlayers[uid];
                if (!rp || now - rp.lastSeen > 5000) return;
                rows.push({
                    name:   rp.username || '?',
                    kills:  rp.kills  || 0,
                    ping:   rp.ping   != null ? rp.ping : null,
                    isSelf: false
                });
            });
        }

        rows.sort(function (a, b) {
            if (a.isSelf) return -1;
            if (b.isSelf) return  1;
            return (b.kills || 0) - (a.kills || 0);
        });

        function pingStr(p)   { return p == null ? '\u2014' : p + ' ms'; }
        function pingColor(p) {
            if (p == null) return 'rgba(138,176,200,0.3)';
            return p < 80 ? '#44cc44' : p < 160 ? '#ccaa22' : '#cc3333';
        }

        var html = '<div class="ingame-lb-header">' +
            '<span class="lb-name">Player</span>' +
            '<span class="lb-kills">Kills</span>' +
            '<span class="lb-ping">Ping</span>' +
            '</div>';

        rows.forEach(function (r) {
            html += '<div class="ingame-lb-row' + (r.isSelf ? ' self' : '') + '">' +
                '<span class="lb-name">' + (r.isSelf ? '\u25ba ' : '') + r.name + '</span>' +
                '<span class="lb-kills">' + r.kills + '</span>' +
                '<span class="lb-ping" style="color:' + pingColor(r.ping) + '">' + pingStr(r.ping) + '</span>' +
                '</div>';
        });

        el.innerHTML = html;
    }

    // ─────────────────────────────────────────────────────────
    // Map panel — full world overview
    // ─────────────────────────────────────────────────────────
    function _refreshMap() {
        var canvas = document.getElementById('ingame-map-canvas');
        if (!canvas) return;
        if (typeof map === 'undefined' || !map.color || !map.color.length) return;

        var ctx = canvas.getContext('2d');
        var cw  = canvas.width;   // 480
        var ch  = canvas.height;  // 480

        // Build terrain ImageData once and cache it (map data doesn't change at runtime)
        if (!_mapTerrainCache) {
            var imgData = ctx.createImageData(cw, ch);
            var data    = imgData.data;
            for (var py = 0; py < ch; py++) {
                for (var px = 0; px < cw; px++) {
                    var mx  = Math.floor(px * map.width  / cw);
                    var my  = Math.floor(py * map.height / ch);
                    var col = map.color[(my << map.shift) + mx];
                    var idx = (py * cw + px) << 2;
                    data[idx]     = col         & 0xFF;   // R
                    data[idx + 1] = (col >> 8)  & 0xFF;  // G
                    data[idx + 2] = (col >> 16) & 0xFF;  // B
                    data[idx + 3] = 255;                  // A
                }
            }
            _mapTerrainCache = imgData;
        }
        ctx.putImageData(_mapTerrainCache, 0, 0);

        // ── Dim overlay so markers read clearly ──────────────
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(0, 0, cw, ch);

        // ── Remote players (orange dots) ─────────────────────
        if (typeof nakamaState !== 'undefined') {
            var now = Date.now();
            Object.keys(nakamaState.remotePlayers).forEach(function (uid) {
                var rp = nakamaState.remotePlayers[uid];
                if (!rp || now - rp.lastSeen > 5000) return;
                var rpx = (rp.x / map.width)  * cw;
                var rpy = (rp.y / map.height) * ch;
                ctx.beginPath();
                ctx.arc(rpx, rpy, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#ff9900';
                ctx.fill();
            });
        }

        // ── Player marker (white arrow pointing in look direction) ──
        if (typeof camera !== 'undefined') {
            var ppx = (camera.x / map.width)  * cw;
            var ppy = (camera.y / map.height) * ch;

            ctx.save();
            ctx.translate(ppx, ppy);
            ctx.rotate(camera.angle);
            ctx.beginPath();
            ctx.moveTo(0, -7);   // tip (forward)
            ctx.lineTo(5, 5);
            ctx.lineTo(0, 2);
            ctx.lineTo(-5, 5);
            ctx.closePath();
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            // Update coordinate readout
            var coordsEl = document.getElementById('ingame-map-coords');
            if (coordsEl) {
                coordsEl.textContent =
                    'X\u2009' + Math.floor(camera.x) +
                    '\u2003Y\u2009' + Math.floor(camera.y);
            }
        }

        // ── NPC quest markers (only quests the player has spoken to) ──
        if (typeof QuestManager !== 'undefined' && QuestManager.getNpcMarkers) {
            var MARKER_COLOR = {
                active:           '#4499ff',
                ready_to_complete:'#ffd700',
                complete:         'rgba(138,176,200,0.35)',
                rejected:         'rgba(192,112,112,0.45)'
            };
            var markers = QuestManager.getNpcMarkers();
            markers.forEach(function (m) {
                var mx = (m.x / map.width)  * cw;
                var my = (m.y / map.height) * ch;
                var color = MARKER_COLOR[m.phase] || '#8ab0c8';

                // Outer ring
                ctx.beginPath();
                ctx.arc(mx, my, 5, 0, Math.PI * 2);
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Inner dot
                ctx.beginPath();
                ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();

                // Name label
                ctx.font = '9px monospace';
                ctx.fillStyle = color;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(m.npcName, mx + 9, my);
            });
        }

        // ── Cardinal direction labels ────────────────────────
        ctx.save();
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('N', cw / 2, 5);
        ctx.textBaseline = 'bottom';
        ctx.fillText('S', cw / 2, ch - 5);
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('W', 5, ch / 2);
        ctx.textAlign    = 'right';
        ctx.fillText('E', cw - 5, ch / 2);
        ctx.restore();
    }

    // ─────────────────────────────────────────────────────────
    // init — bind buttons and keys
    // ─────────────────────────────────────────────────────────
    function init() {
        document.querySelectorAll('.ingame-tab').forEach(function (btn) {
            btn.addEventListener('click', function () { _switchTab(btn.dataset.tab); });
        });

        var resumeBtn = document.getElementById('ingame-resume');
        if (resumeBtn) resumeBtn.addEventListener('click', hide);

        var exitBtn = document.getElementById('ingame-exit');
        if (exitBtn) exitBtn.addEventListener('click', function () {
            hide();
            if (typeof exitGame === 'function') exitGame();
        });

        // Escape closes the menu (independent of dialog Escape handler)
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && _open) hide();
        });
    }

    // ─────────────────────────────────────────────────────────
    return {
        toggle: toggle, show: show, hide: hide, isOpen: isOpen,
        init: init, invalidateMapCache: invalidateMapCache
    };

}());
