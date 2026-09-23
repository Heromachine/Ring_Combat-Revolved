// ===============================
// Node War: facility/Mainframe interaction
// ===============================
// The server (nakama-modules/nw_match.lua) is fully authoritative and
// re-validates everything this module does client-side -- range, faction,
// Key ownership, activation duration. This module exists purely for the UX
// layer the server has no notion of: the prompt, the confirm question, and
// the progress bar. Nothing here can grant an activation the server would
// otherwise refuse; at worst a wrong client-side guess shows a prompt that
// then does nothing when the server's own check silently rejects it.
//
// A separate, dedicated dialog (#nw-confirm) rather than reusing
// QuestManager's #dialog-box: Node War's questions are single-line and
// status-dependent (Activate vs Deactivate vs not-eligible), not a branching
// dialog tree with quest-phase state, and QuestManager's own click handlers
// are already permanently bound to the shared dialog's buttons -- a second,
// isolated element avoids any chance of the two systems firing on each
// other's clicks.
"use strict";

// Matches nakama-modules/nw_match.lua's MIN_ACTIVATION_TICKS = 3 * TICK_RATE
// (TICK_RATE 20) = 3000 ms. The +200 ms margin is slack against clock drift
// between the client's local timer and the server's tick count -- firing
// *_COMPLETE a hair early gets silently rejected (node.activating survives,
// nothing breaks), but padding removes the retry entirely in the normal case.
var NW_ACTIVATION_MS = 3000 + 200;

// Matches ACTIVATION_RANGE/MAINFRAME_RANGE (60 WU) in nw_match.lua, with a
// safety margin so the prompt never shows for a position the server would
// then refuse.
var NW_INTERACT_RANGE_SQ = 55 * 55;

// Matches KEY_PICKUP_RANGE (40 WU) in nw_match.lua, same safety-margin
// reasoning as NW_INTERACT_RANGE_SQ above.
var NW_KEY_PICKUP_RANGE_SQ = 35 * 35;

var NW_CLAN_TO_FACTION = { iron_ravens: 'clan1', ember_tide: 'clan2', silent_root: 'clan2' };

var NodeWarInteract = (function () {

    var _mode          = 'idle';   // 'idle' | 'confirming' | 'active'
    var _targetKind     = null;    // 'node' | 'mainframe'
    var _targetId       = null;    // facilityId, or null for the mainframe
    var _pendingAction   = null;   // 'activate' | 'deactivate'
    var _channelStartMs = 0;
    var _bound          = false;

    function _myFaction() {
        return NW_CLAN_TO_FACTION[nakamaState.myClan] || 'guest';
    }

    function _myUserId() {
        return (typeof NakamaClient !== 'undefined') ? NakamaClient.getUserId() : null;
    }

    function _iHoldKey() {
        var key = nakamaState.nw.key;
        return !!(key && key.holderUserId && key.holderUserId === _myUserId());
    }

    // Mirrors the server's own eligibility checks (nw_match.lua's
    // NW_NODE_ACTIVATE_START/NW_NODE_DEACTIVATE_START handlers) so the
    // prompt only ever offers something the server will actually accept.
    function _eligibleForNode(node) {
        if (!nakamaState.nw.npcPositions[node.facilityId]) return null;   // no NPC here this round
        var faction = _myFaction();
        var key     = nakamaState.nw.key;

        if (node.status === 'neutral') {
            if (faction === 'guest') return null;   // guests cannot activate
            return { action: 'activate', text: 'Activate this Node?' };
        }
        if (node.status === 'active') {
            if (!key || !_iHoldKey()) return null;
            if (key.teamOwner === faction && faction !== 'guest') return null;   // own team can't "deactivate" their own key's nodes
            return { action: 'deactivate', text: 'Deactivate this Node?' };
        }
        return null;
    }

    // The server's own check (nw_match.lua's NW_KEY_PICKUP_REQUEST handler)
    // is just "is it on the ground and in range" -- no faction restriction,
    // matching the design doc: any faction, including guests, can pick up
    // a dropped Key.
    function _eligibleForKey() {
        var key = nakamaState.nw.key;
        if (!key || !key.groundPos) return null;
        return { action: 'pickup', text: 'Pick up the Key?' };
    }

    function _eligibleForMainframe() {
        var mf  = nakamaState.nw.mainframe;
        var key = nakamaState.nw.key;
        if (!key || !_iHoldKey()) return null;
        var faction = _myFaction();

        if (!mf || !mf.active) {
            if (key.teamOwner !== faction) return null;   // team-locked activation
            return { action: 'activate', text: 'Activate the Mainframe?' };
        }
        if (key.teamOwner === faction && faction !== 'guest') return null;
        return { action: 'deactivate', text: 'Deactivate the Mainframe?' };
    }

    function _distSq(x, y) {
        var dx = x - camera.x, dy = y - camera.y;
        return dx * dx + dy * dy;
    }

    function _setPrompt(text) {
        var el = document.getElementById('nw-prompt');
        if (!el) return;
        if (text) { el.textContent = '[F]  ' + text; el.style.display = 'block'; }
        else { el.style.display = 'none'; }
    }

    // ---- idle: proximity scan, one target at a time (nearest wins) ----
    function _scanProximity() {
        var best = null, bestDistSq = NW_INTERACT_RANGE_SQ;

        for (var i = 0; i < nakamaState.nw.nodes.length; i++) {
            var node = nakamaState.nw.nodes[i];
            var d = _distSq(node.x, node.y);
            if (d > bestDistSq) continue;
            var elig = _eligibleForNode(node);
            if (!elig) continue;
            best = { kind: 'node', id: node.facilityId, action: elig.action, text: elig.text };
            bestDistSq = d;
        }

        var mfDistSq = _distSq(0, 0);
        if (mfDistSq <= bestDistSq) {
            var mfElig = _eligibleForMainframe();
            if (mfElig) best = { kind: 'mainframe', id: null, action: mfElig.action, text: mfElig.text };
        }

        // Key pickup has its own, tighter range (matching the server's
        // KEY_PICKUP_RANGE) -- capped independently of bestDistSq's current
        // value so a key just outside pickup range but inside a node's
        // wider activation range can't wrongly win the "nearest" comparison.
        var keyElig = _eligibleForKey();
        if (keyElig) {
            var keyDistSq = _distSq(nakamaState.nw.key.groundPos.x, nakamaState.nw.key.groundPos.y);
            if (keyDistSq <= NW_KEY_PICKUP_RANGE_SQ && keyDistSq <= bestDistSq) {
                best = { kind: 'key', id: null, action: keyElig.action, text: keyElig.text };
                bestDistSq = keyDistSq;
            }
        }

        if (best) {
            _targetKind = best.kind; _targetId = best.id; _pendingAction = best.action;
            _setPrompt(best.text);
        } else {
            _targetKind = null; _targetId = null; _pendingAction = null;
            _setPrompt(null);
        }
    }

    // ---- confirm dialog ----
    function _openConfirm() {
        if (!_targetKind) return;
        var textEl = document.getElementById('nw-confirm-text');
        var box    = document.getElementById('nw-confirm');
        if (!textEl || !box) return;
        var elig = _targetKind === 'node'
            ? _eligibleForNode(nakamaState.nw.nodes.find(function (n) { return n.facilityId === _targetId; }))
            : _targetKind === 'key'
            ? _eligibleForKey()
            : _eligibleForMainframe();
        if (!elig) { _mode = 'idle'; return; }   // state changed between prompt and keypress
        textEl.textContent = elig.text;
        box.style.display = 'flex';
        _setPrompt(null);
        _mode = 'confirming';
        if (document.pointerLockElement) document.exitPointerLock();
    }

    function _closeConfirm() {
        var box = document.getElementById('nw-confirm');
        if (box) box.style.display = 'none';
        _mode = 'idle';
        // Also clear the stale target, not just the mode: update() returns
        // right after a leash-triggered auto-close (_tickConfirming) without
        // falling through to _scanProximity() in that same tick, so without
        // this a keydown landing in the gap between that frame and the next
        // could re-open a confirm for a target that's no longer valid (e.g.
        // a node array index, or a key that's already gone) instead of
        // just doing nothing until the next scan picks a real target.
        _targetKind = null; _targetId = null; _pendingAction = null;
    }

    function _onAccept() {
        if (_mode !== 'confirming' || !_targetKind) return;
        var box = document.getElementById('nw-confirm');
        if (box) box.style.display = 'none';

        if (_targetKind === 'key') {
            // Pickup is a single instant request/response server-side (see
            // nw_match.lua's NW_KEY_PICKUP_REQUEST handler) -- unlike node/
            // Mainframe activation there is no START/COMPLETE pair, so no
            // channel, no movement lock, no progress bar; just send it and
            // go straight back to idle.
            Multiplayer.nwKeyPickupRequest(nakamaState.nw.key && nakamaState.nw.key.groundPos);
            _mode = 'idle';
            return;
        }

        if (_targetKind === 'node') {
            if (_pendingAction === 'activate') Multiplayer.nwNodeActivateStart(_targetId);
            else Multiplayer.nwNodeDeactivateStart(_targetId);
        } else {
            if (_pendingAction === 'activate') Multiplayer.nwMainframeActivateStart();
            else Multiplayer.nwMainframeDeactivateStart();
        }

        _mode = 'active';
        _channelStartMs = Date.now();
        nwActivationLocked = true;
        var label = document.getElementById('nw-activation-label');
        var fill  = document.getElementById('nw-activation-fill');
        var bar   = document.getElementById('nw-activation-bar');
        if (label) label.textContent = (_pendingAction === 'activate' ? 'Activating' : 'Deactivating') + '…';
        if (fill)  fill.style.width = '0%';
        if (bar)   bar.style.display = 'block';
    }

    // Cancels the current channel WITHOUT sending *_COMPLETE. The server
    // independently expires an abandoned activation once the player leaves
    // range (nw_match.lua match_loop's "Expire stale activations"), and
    // clears it entirely on death -- this only has to reset the CLIENT's own
    // UI/lock state, never the server's.
    function _cancelChannel() {
        _mode = 'idle';
        nwActivationLocked = false;
        var bar = document.getElementById('nw-activation-bar');
        if (bar) bar.style.display = 'none';
        // Same reasoning as _closeConfirm(): update() returns right after
        // this without falling through to a fresh _scanProximity() in the
        // same tick, so a keydown landing in that gap could otherwise
        // reopen a confirm for a target that just finished or was
        // abandoned (e.g. a node that's no longer neutral).
        _targetKind = null; _targetId = null; _pendingAction = null;
    }

    function _tickChannel() {
        var facPos = _targetKind === 'node'
            ? nakamaState.nw.nodes.find(function (n) { return n.facilityId === _targetId; })
            : { x: 0, y: 0 };

        // Left range, or died -- proactively cancel rather than waiting for
        // a *_COMPLETE the server would silently drop.
        if (player.health <= 0 || !facPos || _distSq(facPos.x, facPos.y) > NW_INTERACT_RANGE_SQ * 1.4) {
            _cancelChannel();
            return;
        }

        var elapsed = Date.now() - _channelStartMs;
        var pct = Math.min(100, (elapsed / NW_ACTIVATION_MS) * 100);
        var fill = document.getElementById('nw-activation-fill');
        if (fill) fill.style.width = pct + '%';

        if (elapsed >= NW_ACTIVATION_MS) {
            if (_targetKind === 'node') {
                if (_pendingAction === 'activate') Multiplayer.nwNodeActivateComplete(_targetId);
                else Multiplayer.nwNodeDeactivateComplete(_targetId);
            } else {
                if (_pendingAction === 'activate') Multiplayer.nwMainframeActivateComplete();
                else Multiplayer.nwMainframeDeactivateComplete();
            }
            _cancelChannel();
        }
    }

    // While the confirm dialog is open, walking too far away closes it
    // automatically -- the same behaviour QuestManager's NPC dialog already
    // has (its DIALOG_LEASH_SQ check). There is no dedicated Cancel button
    // for the same reason quest dialogs don't have one either: walking away
    // (or Escape) is the dismissal, not a click.
    function _tickConfirming() {
        var pos = _targetKind === 'node'
            ? nakamaState.nw.nodes.find(function (n) { return n.facilityId === _targetId; })
            : _targetKind === 'key'
            ? (nakamaState.nw.key && nakamaState.nw.key.groundPos)
            : { x: 0, y: 0 };
        var rangeSq = (_targetKind === 'key' ? NW_KEY_PICKUP_RANGE_SQ : NW_INTERACT_RANGE_SQ) * 1.4;
        if (player.health <= 0 || !pos || _distSq(pos.x, pos.y) > rangeSq) {
            _closeConfirm();
        }
    }

    function update() {
        if (gameMode !== 'nodewar' || typeof nakamaState === 'undefined' || !nakamaState.nw) return;

        if (_mode === 'active') { _tickChannel(); return; }
        if (_mode === 'confirming') { _tickConfirming(); return; }
        _scanProximity();
    }

    function init() {
        if (_bound) return;
        _bound = true;

        var acceptBtn = document.getElementById('nw-confirm-accept');
        if (acceptBtn) acceptBtn.addEventListener('click', _onAccept);

        document.addEventListener('keydown', function (e) {
            if (e.repeat) return;
            if (gameMode !== 'nodewar') return;
            if (e.key === 'f' || e.key === 'F') {
                if (_mode === 'idle' && _targetKind) { e.preventDefault(); _openConfirm(); }
                // F/A doubles as Accept once the dialog is already open --
                // matches QuestManager's own F handling (open, then advance/
                // accept on the next press) and is the only way a gamepad
                // (A dispatches this same synthetic KeyF) can ever accept,
                // since the on-screen Accept button is mouse-only.
                else if (_mode === 'confirming') { e.preventDefault(); _onAccept(); }
            } else if (e.key === 'Escape') {
                if (_mode === 'confirming') { e.preventDefault(); _closeConfirm(); }
            }
        });
    }

    return { init: init, update: update };

})();
