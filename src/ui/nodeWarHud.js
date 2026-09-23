// ===============================
// Node War: HUD — objective status, Key, OP buff, countdown, win screen
// ===============================
// Pure display. Reads nakamaState.nw every frame; never writes it (writes
// belong to multiplayer.js's opcode handlers and nodeWarInteract.js). Gated
// on gameMode === 'nodewar' throughout, so this is a no-op in freeplay.
"use strict";

var NW_HUD_FACTION_COLOR = {
    clan1:   '#4488cc',
    clan2:   '#cc5544',
    guest:   '#c9a86a',
    neutral: 'rgba(200,200,210,0.45)'
};

// Shared by the HUD panel and both map views (minimap.js, inGameMenu.js) --
// the Key's current world position, or null when there is none to show.
// key.groundPos is set while it's lying dropped; otherwise it's wherever its
// holder is standing right now (self or a remote player).
function nwKeyWorldPos() {
    if (typeof nakamaState === 'undefined' || !nakamaState.nw || !nakamaState.nw.key) return null;
    var key = nakamaState.nw.key;
    if (key.groundPos) return { x: key.groundPos.x, y: key.groundPos.y };
    if (key.holderUserId) {
        var myId = (typeof NakamaClient !== 'undefined') ? NakamaClient.getUserId() : null;
        if (key.holderUserId === myId) return { x: camera.x, y: camera.y };
        var rp = nakamaState.remotePlayers[key.holderUserId];
        if (rp) return { x: rp.x, y: rp.y };
    }
    return null;
}

function _nwHudUserName(userId) {
    if (!userId) return null;
    var myId = (typeof NakamaClient !== 'undefined') ? NakamaClient.getUserId() : null;
    if (userId === myId) {
        return (typeof NakamaClient !== 'undefined' && NakamaClient.getUsername()) || 'You';
    }
    var rp = (typeof nakamaState !== 'undefined') ? nakamaState.remotePlayers[userId] : null;
    return (rp && rp.username) || 'Unknown';
}

function _nwHudCountdownStr(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
}

// Called each frame from main.js's Draw loop, after DrawMinimap(). No-op
// outside Node War, and skipped while the admin debug minimap legend
// (DrawMinimapLegend) occupies the same top-left corner.
function DrawNodeWarHud() {
    if (gameMode !== 'nodewar' || typeof nakamaState === 'undefined' || !nakamaState.nw) return;
    if (typeof isAdmin !== 'undefined' && isAdmin && showMinimaps) return;

    var ctx = screendata.context;
    if (!ctx) return;
    var nw = nakamaState.nw;

    ctx.save();
    ctx.textBaseline = 'top';

    // ── Countdown (top-center, only while the Mainframe is active) ──
    if (nw.mainframe && nw.mainframe.active) {
        var cd = _nwHudCountdownStr(nw.mainframe.countdownSeconds || 0);
        var cw = screendata.canvas.width;
        var urgent = (nw.mainframe.countdownSeconds || 0) <= 30;
        ctx.textAlign = 'center';
        ctx.font = 'bold 22px monospace';
        ctx.fillStyle = urgent ? '#ff5544' : '#ffd700';
        ctx.fillText(cd, cw / 2, 10);
        ctx.font = '10px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText('MAINFRAME COUNTDOWN', cw / 2, 36);
    }

    // ── Objective panel (top-left) ──
    var x = 12, y = 12, panelW = 190, rowH = 16;
    var rows = 2 + (nw.opBuffHolder ? 1 : 0);
    var panelH = 14 + rows * rowH;

    ctx.fillStyle = 'rgba(8,15,22,0.72)';
    ctx.fillRect(x, y, panelW, panelH);
    ctx.strokeStyle = 'rgba(80,160,220,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, panelW, panelH);

    var tx = x + 10, ty = y + 8;
    ctx.textAlign = 'left';

    // Node pips -- one per facility, coloured by status/team (same palette
    // as the in-world cubes in nodeWarObjects.js).
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(138,176,200,0.55)';
    ctx.fillText('NODES', tx, ty);
    var pipX = tx + 44, pip = 10, pipGap = 4;
    for (var i = 0; i < nw.nodes.length; i++) {
        var node = nw.nodes[i];
        var color = (node.status === 'active')
            ? (NW_HUD_FACTION_COLOR[node.team] || NW_HUD_FACTION_COLOR.neutral)
            : NW_HUD_FACTION_COLOR.neutral;
        var px = pipX + i * (pip + pipGap);
        ctx.fillStyle = color;
        ctx.fillRect(px, ty, pip, pip);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.strokeRect(px, ty, pip, pip);
    }
    ty += rowH;

    // Key
    ctx.font = '10px monospace';
    var keyStr, keyColor;
    if (!nw.key) {
        keyStr = 'KEY: unclaimed';
        keyColor = 'rgba(138,176,200,0.5)';
    } else {
        keyColor = NW_HUD_FACTION_COLOR[nw.key.teamOwner] || '#ffd700';
        keyStr = nw.key.holderUserId
            ? 'KEY: ' + (_nwHudUserName(nw.key.holderUserId) || 'held')
            : 'KEY: on ground';
    }
    ctx.fillStyle = keyColor;
    ctx.fillText(keyStr, tx, ty);
    ty += rowH;

    // OP buff (only shown once someone actually has it)
    if (nw.opBuffHolder) {
        var myId = (typeof NakamaClient !== 'undefined') ? NakamaClient.getUserId() : null;
        var mine = nw.opBuffHolder === myId;
        ctx.fillStyle = mine ? '#ffd700' : 'rgba(255,215,0,0.55)';
        ctx.fillText('OP BUFF: ' + (mine ? 'YOU' : _nwHudUserName(nw.opBuffHolder)), tx, ty);
    }

    ctx.restore();
}

// ── Win screen ──────────────────────────────────────────
// nakamaState.nw.winningTeam is set once by NW_MATCH_WIN and then never
// cleared by any server message -- match_loop in nw_match.lua broadcasts the
// win and immediately `return nil`s, which terminates the Nakama match
// outright, so no further FULL_RESET ever arrives to clean the flag up.
// Left alone, that stale value would show this screen again the instant a
// player's NEXT Node War session received it, so hide() below is the one
// place that clears it -- Continue is the only dismiss path by design.
var NodeWarWin = (function () {
    var _shown = false;

    function _label(team) {
        return team === 'clan1' ? 'Clan 1' : team === 'clan2' ? 'Clan 2' : 'Unknown';
    }

    function update() {
        if (gameMode !== 'nodewar' || typeof nakamaState === 'undefined' || !nakamaState.nw) return;
        var team = nakamaState.nw.winningTeam;
        if (!team) { _shown = false; return; }
        if (_shown) return;
        _shown = true;
        _show(team);
    }

    function _show(team) {
        var el = document.getElementById('nw-win-screen');
        if (!el) return;

        var myFaction = (typeof NW_CLAN_TO_FACTION !== 'undefined')
            ? (NW_CLAN_TO_FACTION[nakamaState.myClan] || 'guest') : 'guest';
        var won = myFaction === team;

        var iconEl  = document.getElementById('nw-win-icon');
        var titleEl = document.getElementById('nw-win-title');
        var subEl   = document.getElementById('nw-win-sub');
        if (iconEl)  iconEl.textContent  = won ? '★' : '✕';
        if (titleEl) {
            titleEl.textContent = won ? 'VICTORY' : 'DEFEAT';
            titleEl.style.color = won ? '#6abf8a' : '#e05050';
        }
        if (subEl) subEl.textContent = _label(team) + ' held the Mainframe for 5 minutes.';

        if (document.exitPointerLock) document.exitPointerLock();
        el.style.display = 'flex';
    }

    function hide() {
        _shown = false;
        var el = document.getElementById('nw-win-screen');
        if (el) el.style.display = 'none';
        if (typeof nakamaState !== 'undefined' && nakamaState.nw) nakamaState.nw.winningTeam = null;
    }

    function init() {
        var btn = document.getElementById('nw-win-continue');
        if (btn) btn.addEventListener('click', function () {
            hide();
            if (typeof exitGame === 'function') exitGame();
        });
    }

    return { update: update, init: init };
}());
