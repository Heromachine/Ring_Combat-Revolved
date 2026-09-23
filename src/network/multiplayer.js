// ===============================
// Multiplayer Manager
// Handles: position sync, chat, hit reporting, damage receiving
// ===============================
"use strict";

var Multiplayer = (function () {

    // Opcodes (must match match_handler.lua)
    // ── Existing opcodes (freeplay match) ────────────────────
    var OP_POSITION      = 1;
    var OP_CHAT          = 2;
    var OP_HIT           = 3;
    var OP_PLAYER_LIST   = 4;
    var OP_PLAYER_JOIN   = 5;
    var OP_PLAYER_LEAVE  = 6;
    var OP_PLAYER_KICKED = 7;
    var OP_DAMAGE        = 8;
    var OP_RADAR_REVEAL  = 9;
    var OP_KILL          = 10;
    var OP_PING          = 11;
    var OP_PONG          = 12;
    var OP_SHOOT         = 13;

    // ── Node War opcodes — Client → Server ───────────────────
    var NW_NODE_ACTIVATE_START       = 14;
    var NW_NODE_ACTIVATE_COMPLETE    = 15;
    var NW_NODE_DEACTIVATE_START     = 16;
    var NW_NODE_DEACTIVATE_COMPLETE  = 17;
    var NW_MAINFRAME_ACTIVATE_START  = 18;
    var NW_MAINFRAME_ACTIVATE_COMPLETE = 19;
    var NW_MAINFRAME_DEACTIVATE_START  = 20;
    var NW_MAINFRAME_DEACTIVATE_COMPLETE = 21;
    var NW_KEY_PICKUP_REQUEST        = 22;

    // ── Node War opcodes — Server → All Clients ──────────────
    var NW_NODE_STATE_UPDATE   = 23;
    var NW_KEY_ISSUED          = 24;
    var NW_KEY_HOLDER_UPDATE   = 25;
    var NW_KEY_DESTROYED       = 26;
    var NW_MAINFRAME_ACTIVATED = 27;
    var NW_MAINFRAME_DEACTIVATED = 28;
    var NW_COUNTDOWN_UPDATE    = 29;
    var NW_FULL_RESET          = 30;
    var NW_OP_BUFF_UPDATE      = 31;
    var NW_FACTION_KICK        = 32;
    var NW_MATCH_WIN           = 33;

    var _matchId          = null;
    var _connected        = false;
    var _isAnonymous      = false;
    var _respawnInterval  = null;
    var _intentionalExit  = false;
    var _lastError        = null;  // human-readable reason init() last failed for

    // Position broadcast throttle
    var POSITION_INTERVAL_MS = 100;  // 10 Hz
    var _lastPositionSend    = 0;

    var PING_INTERVAL_MS = 4000;
    var _lastPingSend    = 0;
    var _pingTs          = 0;

    // ── Init ─────────────────────────────────────────────────

    // Best-effort extraction of a human-readable reason from whatever shape
    // the Nakama JS SDK rejected with -- a plain Error (network failure) or
    // the server's own {error:{message}} envelope (e.g. match_join_attempt
    // returning false, such as nw_match.lua's "no active nodes -- guests
    // cannot join yet").
    function _describeError(e) {
        if (!e) return 'Unknown error';
        if (typeof e === 'string') return e;
        if (e.message) return e.message;
        if (e.error && e.error.message) return e.error.message;
        try { return JSON.stringify(e); } catch (_e2) { return String(e); }
    }

    // Returns true/false rather than throwing -- callers decide what a
    // failed connection means for them. Freeplay treats it as a soft
    // "run offline" fallback; Node War (see beginNodeWarGame() in main.js)
    // cannot function without a real match and must not silently continue,
    // so it checks this return value and shows an error instead.
    async function init(isAnonymous, matchType) {
        _intentionalExit = false;
        _isAnonymous = isAnonymous;
        _lastError = null;

        try {
            await NakamaClient.connect(onMessage, onDisconnect);
            var match = (matchType === 'nodewar')
                ? await NakamaClient.joinOrCreateNodeWarMatch()
                : await NakamaClient.joinOrCreateMatch();
            _matchId   = match.match_id;
            _connected = true;
            console.log("Multiplayer connected, match:", _matchId);

            // Load clan from storage (or set after clan selection)
            if (!isAnonymous) {
                var saved = await NakamaClient.readPlayerData();
                if (saved && saved.clan) {
                    nakamaState.myClan = saved.clan;
                }
            }
            return true;
        } catch (e) {
            console.error("Multiplayer init failed:", e);
            _connected = false;
            _lastError = _describeError(e);
            return false;
        }
    }

    function getLastError() { return _lastError; }

    // ── Disconnect ────────────────────────────────────────────

    function disconnect() {
        _intentionalExit = true;
        _connected = false;
        _matchId   = null;
        NakamaClient.disconnect();
        nakamaState.remotePlayers = {};
    }

    // ── Per-frame update (call from game loop) ────────────────

    function update() {
        if (!_connected || !_matchId) return;

        var now = Date.now();
        if (now - _lastPositionSend >= POSITION_INTERVAL_MS) {
            _lastPositionSend = now;
            sendPosition();
        }

        if (now - _lastPingSend >= PING_INTERVAL_MS) {
            _lastPingSend = now;
            _pingTs = now;
            NakamaClient.sendMatchData(_matchId, OP_PING, { ts: now });
        }

        // Tick down radar reveals
        var revealIds = Object.keys(nakamaState.radarReveals);
        for (var i = 0; i < revealIds.length; i++) {
            var uid = revealIds[i];
            if (now >= nakamaState.radarReveals[uid].expiry) {
                delete nakamaState.radarReveals[uid];
            }
        }
    }

    // ── Send position ─────────────────────────────────────────

    function sendPosition() {
        NakamaClient.sendMatchData(_matchId, OP_POSITION, {
            x:      camera.x,
            y:      camera.y,
            height: camera.height,
            angle:  camera.angle,
            // health is NOT sent. The server owns it; reporting our own
            // health here is what used to make a tampered client unkillable.
            ping:   nakamaState.myPing
        });
    }

    // ── Send chat emoji ───────────────────────────────────────

    function sendChat(emoji, shout) {
        if (!_connected || !_matchId) return;
        NakamaClient.sendMatchData(_matchId, OP_CHAT, {
            emoji: emoji,
            shout: shout === true
        });
    }

    // ── Broadcast a shot fired (visual only for other clients) ───

    function sendShoot(x, y, z, dx, dy, dz) {
        if (!_connected || !_matchId) return;
        NakamaClient.sendMatchData(_matchId, OP_SHOOT, {
            x: x, y: y, z: z,
            dx: dx, dy: dy, dz: dz
        });
    }

    // ── Report a hit on a remote player ──────────────────────

    // Reports WHICH WEAPON hit, never how much damage it did. The server
    // looks the damage up in its own table, so editing weapons in the
    // console no longer changes what a shot is worth.
    function reportHit(targetUserId, weaponType) {
        if (!_connected || !_matchId) return;
        if (!weaponType) return;
        NakamaClient.sendMatchData(_matchId, OP_HIT, {
            targetId:   targetUserId,
            weaponType: weaponType
        });
    }

    // ── Node War — Client → Server sends ─────────────────────

    function nwNodeActivateStart(facilityId) {
        if (!_connected || !_matchId) return;
        NakamaClient.sendMatchData(_matchId, NW_NODE_ACTIVATE_START, { facilityId: facilityId });
    }

    function nwNodeActivateComplete(facilityId) {
        if (!_connected || !_matchId) return;
        NakamaClient.sendMatchData(_matchId, NW_NODE_ACTIVATE_COMPLETE, { facilityId: facilityId });
    }

    function nwNodeDeactivateStart(facilityId) {
        if (!_connected || !_matchId) return;
        NakamaClient.sendMatchData(_matchId, NW_NODE_DEACTIVATE_START, { facilityId: facilityId });
    }

    function nwNodeDeactivateComplete(facilityId) {
        if (!_connected || !_matchId) return;
        NakamaClient.sendMatchData(_matchId, NW_NODE_DEACTIVATE_COMPLETE, { facilityId: facilityId });
    }

    function nwMainframeActivateStart() {
        if (!_connected || !_matchId) return;
        NakamaClient.sendMatchData(_matchId, NW_MAINFRAME_ACTIVATE_START, {});
    }

    function nwMainframeActivateComplete() {
        if (!_connected || !_matchId) return;
        NakamaClient.sendMatchData(_matchId, NW_MAINFRAME_ACTIVATE_COMPLETE, {});
    }

    function nwMainframeDeactivateStart() {
        if (!_connected || !_matchId) return;
        NakamaClient.sendMatchData(_matchId, NW_MAINFRAME_DEACTIVATE_START, {});
    }

    function nwMainframeDeactivateComplete() {
        if (!_connected || !_matchId) return;
        NakamaClient.sendMatchData(_matchId, NW_MAINFRAME_DEACTIVATE_COMPLETE, {});
    }

    function nwKeyPickupRequest(groundPos) {
        if (!_connected || !_matchId) return;
        NakamaClient.sendMatchData(_matchId, NW_KEY_PICKUP_REQUEST, { groundPos: groundPos });
    }

    // ── Message handler ───────────────────────────────────────

    function onMessage(opCode, data) {
        var myId = NakamaClient.getUserId();

        if (opCode === OP_PLAYER_LIST) {
            // Initial list of players already in match
            if (data.players) {
                for (var i = 0; i < data.players.length; i++) {
                    var p = data.players[i];
                    nakamaState.remotePlayers[p.userId] = {
                        userId:   p.userId,
                        username: p.username,
                        x:        p.x,
                        y:        p.y,
                        height:   p.height,
                        angle:    p.angle,
                        health:   p.health,
                        kills:    p.kills || 0,
                        ping:     null,
                        lastSeen: Date.now(),
                        // Per-player sprite animation
                        spriteFrame: 0,
                        spriteRow: 0,
                        spriteDistAccum: 0,
                        prevX: p.x,
                        prevY: p.y
                    };
                }
            }

        } else if (opCode === OP_PLAYER_JOIN) {
            if (data.userId === myId) {
                // Teleport our camera to the server-assigned spawn position (initial join or respawn)
                camera.x      = data.x;
                camera.y      = data.y;
                player.health = data.health || 100;
                player.shield = player.maxShield;
                hideDeathScreen();
                return;
            }
            nakamaState.remotePlayers[data.userId] = {
                userId:   data.userId,
                username: data.username,
                x:        data.x,
                y:        data.y,
                height:   data.height,
                angle:    data.angle,
                health:   data.health,
                kills:    0,
                ping:     null,
                lastSeen: Date.now(),
                // Per-player sprite animation
                spriteFrame: 0,
                spriteRow: 0,
                spriteDistAccum: 0,
                prevX: data.x,
                prevY: data.y
            };
            showChatNotification(data.username + " joined");

        } else if (opCode === OP_PLAYER_LEAVE) {
            delete nakamaState.remotePlayers[data.userId];

        } else if (opCode === OP_POSITION) {
            if (data.userId === myId) return;
            var rp = nakamaState.remotePlayers[data.userId];
            if (rp) {
                // Advance sprite animation based on remote player's movement
                var rpDx = data.x - rp.prevX;
                var rpDy = data.y - rp.prevY;
                var rpDist = Math.sqrt(rpDx * rpDx + rpDy * rpDy);
                if (rpDist > 0.5) {
                    rp.spriteDistAccum += rpDist;
                    while (rp.spriteDistAccum >= playerSprite.animSpeed) {
                        var nf = rp.spriteFrame + 1;
                        if (nf < playerSprite.walkStart || nf > playerSprite.walkEnd) nf = playerSprite.walkStart;
                        rp.spriteFrame = nf;
                        rp.spriteDistAccum -= playerSprite.animSpeed;
                    }
                } else {
                    // Remote player stopped
                    rp.spriteFrame = playerSprite.idleFrame;
                    rp.spriteDistAccum = 0;
                }
                rp.prevX = data.x;
                rp.prevY = data.y;

                rp.x        = data.x;
                rp.y        = data.y;
                rp.height   = data.height;
                rp.angle    = data.angle;
                rp.health   = data.health;
                rp.lastSeen = Date.now();
                if (data.ping != null) rp.ping = data.ping;
            }

        } else if (opCode === OP_CHAT) {
            showEmojiChat(data.senderId, data.x, data.y, data.emoji, data.shout);

        } else if (opCode === OP_PLAYER_KICKED) {
            if (data.reason === "friendly_fire") {
                showKickScreen("Friendly Fire — You shot a clanmate.");
            } else {
                showKickScreen("You were kicked: " + (data.reason || "unknown"));
            }
            disconnect();

        } else if (opCode === OP_DAMAGE) {
            // The server applies shield-then-health and sends both pools.
            // We just adopt them — no local absorption maths, because that
            // is what used to be echoed back as authoritative health.
            player.health = Math.max(0, data.health);
            if (typeof data.shield === "number") {
                player.shield = Math.max(0, data.shield);
            }
            player.lastDamageTime = Date.now();
            if (player.health <= 0) showDeathScreen();

        } else if (opCode === OP_RADAR_REVEAL) {
            // A player shouted — reveal on radar for 5 seconds
            nakamaState.radarReveals[data.userId] = {
                x:      data.x,
                y:      data.y,
                expiry: Date.now() + 5000
            };

        } else if (opCode === OP_KILL) {
            if (data.killerId === myId) {
                nakamaState.myKills++;
            } else {
                var killer = nakamaState.remotePlayers[data.killerId];
                if (killer) killer.kills = data.kills;
            }

        } else if (opCode === OP_PONG) {
            nakamaState.myPing = Date.now() - _pingTs;

        } else if (opCode === OP_SHOOT) {
            if (data.userId === myId) return;
            items.push({
                type: "bullet",
                x: data.x, y: data.y, z: data.z,
                prevX: data.x, prevY: data.y, prevZ: data.z,
                dx: data.dx, dy: data.dy, dz: data.dz,
                distance: 0,
                image: textures.bullet,
                damage: 0,
                hitscanHit: null,
                stopDistance: null,
                remote: true
            });

        // ── Node War — Server → Client handlers ──────────────

        } else if (opCode === NW_NODE_STATE_UPDATE) {
            // { facilityId, status, team } — update local node state
            var node = nakamaState.nw.nodes.find(function(n) { return n.facilityId === data.facilityId; });
            if (node) {
                node.status = data.status;
                node.team   = data.team;
            }

        } else if (opCode === NW_KEY_ISSUED) {
            // { teamOwner, holderUserId } — a team earned the Key
            nakamaState.nw.key = { exists: true, teamOwner: data.teamOwner, holderUserId: data.holderUserId, groundPos: null };

        } else if (opCode === NW_KEY_HOLDER_UPDATE) {
            // { holderUserId, team, groundPos } — Key changed hands or was dropped
            if (nakamaState.nw.key) {
                nakamaState.nw.key.holderUserId = data.holderUserId || null;
                nakamaState.nw.key.groundPos    = data.groundPos || null;
            }

        } else if (opCode === NW_KEY_DESTROYED) {
            // { cause } — Key trashed, full reset incoming
            nakamaState.nw.key = null;

        } else if (opCode === NW_MAINFRAME_ACTIVATED) {
            // { countdownSeconds, opBuffUserId } — Mainframe on, countdown started
            nakamaState.nw.mainframe    = { active: true, countdownSeconds: data.countdownSeconds };
            nakamaState.nw.opBuffHolder = data.opBuffUserId;

        } else if (opCode === NW_MAINFRAME_DEACTIVATED) {
            // {} — Mainframe cancelled, full reset incoming
            if (nakamaState.nw.mainframe) nakamaState.nw.mainframe.active = false;

        } else if (opCode === NW_COUNTDOWN_UPDATE) {
            // { secondsRemaining } — periodic tick from server
            if (nakamaState.nw.mainframe) nakamaState.nw.mainframe.countdownSeconds = data.secondsRemaining;

        } else if (opCode === NW_FULL_RESET) {
            // joinSync=true: sent to new joiners to sync current state — don't wipe ongoing game
            // joinSync=false (or absent): actual reset — clear everything
            if (!data.joinSync) {
                nakamaState.nw.nodes.forEach(function(n) { n.status = 'neutral'; n.team = null; });
                nakamaState.nw.key          = null;
                nakamaState.nw.mainframe    = null;
                nakamaState.nw.opBuffHolder = null;
            }
            nakamaState.nw.npcPositions = {};
            if (data.npcPositions) {
                data.npcPositions.forEach(function(p) {
                    nakamaState.nw.npcPositions[p.facilityId] = p.hasNpc;
                });
            }
            // Apply node states sent in join sync
            if (data.nodes) {
                data.nodes.forEach(function(n) {
                    var node = nakamaState.nw.nodes.find(function(x) { return x.facilityId === n.facilityId; });
                    if (node) { node.status = n.status; node.team = n.team; }
                });
            }
            if (data.key !== undefined)       nakamaState.nw.key          = data.key;
            if (data.mainframe !== undefined)  nakamaState.nw.mainframe    = data.mainframe;
            if (data.opBuffHolder !== undefined) nakamaState.nw.opBuffHolder = data.opBuffHolder;

        } else if (opCode === NW_OP_BUFF_UPDATE) {
            // { userId, active } — OP buff granted or removed
            nakamaState.nw.opBuffHolder = data.active ? data.userId : null;

        } else if (opCode === NW_FACTION_KICK) {
            // {} — this client's Guest player was killed (permadeath)
            showKickScreen("You were eliminated.");
            disconnect();

        } else if (opCode === NW_MATCH_WIN) {
            // { winningTeam } — countdown reached zero
            nakamaState.nw.winningTeam = data.winningTeam;
        }
    }

    function onDisconnect() {
        _connected = false;
        if (_isAnonymous) {
            nakamaState.remotePlayers = {};
        }
        if (_intentionalExit) {
            return;
        }
        showKickScreen("Disconnected from server.");
    }

    // ── UI helpers ────────────────────────────────────────────

    function showChatNotification(text) {
        var el = document.getElementById("mp-notification");
        if (!el) return;
        el.textContent = text;
        el.style.opacity = "1";
        clearTimeout(el._timeout);
        el._timeout = setTimeout(function () { el.style.opacity = "0"; }, 3000);
    }

    function showEmojiChat(senderId, sx, sy, emoji, shout) {
        // Add to chat log array for renderer to display in world space
        nakamaState.chatBubbles.push({
            senderId: senderId,
            x:        sx,
            y:        sy,
            emoji:    emoji,
            shout:    shout,
            expiry:   Date.now() + 4000
        });
        // Prune old bubbles
        nakamaState.chatBubbles = nakamaState.chatBubbles.filter(function (b) {
            return Date.now() < b.expiry;
        });
    }

    function showKickScreen(reason) {
        var el = document.getElementById("kick-screen");
        if (!el) return;
        var msg = el.querySelector(".kick-reason");
        if (msg) msg.textContent = reason;
        el.style.display = "flex";
    }

    // ── Death screen ──────────────────────────────────────────

    function showDeathScreen() {
        var el = document.getElementById('death-screen');
        if (!el) return;
        el.style.display = 'flex';
        var secs = 5;
        var countEl = document.getElementById('respawn-countdown');
        if (countEl) countEl.textContent = secs;
        clearInterval(_respawnInterval);
        _respawnInterval = setInterval(function () {
            secs--;
            if (countEl) countEl.textContent = Math.max(0, secs);
            if (secs <= 0) clearInterval(_respawnInterval);
        }, 1000);
    }

    function hideDeathScreen() {
        clearInterval(_respawnInterval);
        var el = document.getElementById('death-screen');
        if (el) el.style.display = 'none';
    }

    // ── Public API ─────────────────────────────────────────────

    return {
        init:       init,
        update:     update,
        disconnect: disconnect,
        sendChat:   sendChat,
        sendShoot:  sendShoot,
        reportHit:  reportHit,
        isConnected: function () { return _connected; },
        getLastError: getLastError,

        // Node War — Client → Server
        nwNodeActivateStart:         nwNodeActivateStart,
        nwNodeActivateComplete:      nwNodeActivateComplete,
        nwNodeDeactivateStart:       nwNodeDeactivateStart,
        nwNodeDeactivateComplete:    nwNodeDeactivateComplete,
        nwMainframeActivateStart:    nwMainframeActivateStart,
        nwMainframeActivateComplete: nwMainframeActivateComplete,
        nwMainframeDeactivateStart:  nwMainframeDeactivateStart,
        nwMainframeDeactivateComplete: nwMainframeDeactivateComplete,
        nwKeyPickupRequest:          nwKeyPickupRequest,
    };

})();
