-- ============================================================
-- Node War Match Handler  (nw_match.lua)
-- Full rules: GAMEMODE_NODE_WAR.md
-- ============================================================

local nk = require("nakama")
local rcr_config = require("rcr.config")

-- ── Shared opcodes (must match multiplayer.js) ────────────────
local OP_POSITION      = 1
local OP_CHAT          = 2
local OP_HIT           = 3
local OP_PLAYER_LIST   = 4
local OP_PLAYER_JOIN   = 5
local OP_PLAYER_LEAVE  = 6
local OP_PLAYER_KICKED = 7
local OP_DAMAGE        = 8
local OP_RADAR_REVEAL  = 9
local OP_KILL          = 10
local OP_PING          = 11
local OP_PONG          = 12
local OP_SHOOT         = 13

-- ── Node War opcodes ─────────────────────────────────────────
local NW_NODE_ACTIVATE_START           = 14
local NW_NODE_ACTIVATE_COMPLETE        = 15
local NW_NODE_DEACTIVATE_START         = 16
local NW_NODE_DEACTIVATE_COMPLETE      = 17
local NW_MAINFRAME_ACTIVATE_START      = 18
local NW_MAINFRAME_ACTIVATE_COMPLETE   = 19
local NW_MAINFRAME_DEACTIVATE_START    = 20
local NW_MAINFRAME_DEACTIVATE_COMPLETE = 21
local NW_KEY_PICKUP_REQUEST            = 22
local NW_NODE_STATE_UPDATE             = 23
local NW_KEY_ISSUED                    = 24
local NW_KEY_HOLDER_UPDATE             = 25
local NW_KEY_DESTROYED                 = 26
local NW_MAINFRAME_ACTIVATED           = 27
local NW_MAINFRAME_DEACTIVATED         = 28
local NW_COUNTDOWN_UPDATE              = 29
local NW_FULL_RESET                    = 30
local NW_OP_BUFF_UPDATE                = 31
local NW_FACTION_KICK                  = 32
local NW_MATCH_WIN                     = 33

-- ── Constants ────────────────────────────────────────────────
local TICK_RATE             = 20
local MAX_HEALTH            = 100

-- Shields are server-authoritative here for the same reason as in
-- match_handler.lua: the client used to report its own health back, which
-- was both how shield absorption reached the server and how a tampered
-- client made itself unkillable. Values mirror src/core/globals.js.
local SHIELD_MAX            = 100
local SHIELD_REGEN_PER_SEC  = 5
local SHIELD_REGEN_DELAY_MS = 4000

-- Server-authoritative weapon table. Must stay in step with the copy in
-- match_handler.lua and with `weapons` in src/core/globals.js.
local WEAPONS = {
    testgun      = { damage = 50,  interval_ms = 100,  max_per_shot = 1 },
    rifle        = { damage = 15,  interval_ms = 100,  max_per_shot = 1 },
    pistol       = { damage = 25,  interval_ms = 200,  max_per_shot = 1 },
    sniper       = { damage = 100, interval_ms = 1000, max_per_shot = 1 },
    shotgun      = { damage = 12,  interval_ms = 700,  max_per_shot = 6 },
    tracer       = { damage = 30,  interval_ms = 1500, max_per_shot = 1 },
    plasmaRifle  = { damage = 5,   interval_ms = 80,   max_per_shot = 1 },
    plasmaPistol = { damage = 12,  interval_ms = 400,  max_per_shot = 1 },
}
local FIRE_RATE_GRACE  = 0.8
local MAX_HITS_PER_SEC = 20
local RESPAWN_TICKS         = 5  * TICK_RATE   -- 5 s clan respawn
local MIN_ACTIVATION_TICKS  = 3  * TICK_RATE   -- server-side min elapsed for activation
local COUNTDOWN_SECONDS     = 300              -- 5 minutes
local NODES_TO_EARN_KEY     = 3
local ACTIVATION_RANGE      = 60   -- world units
local MAINFRAME_RANGE       = 60
local KEY_PICKUP_RANGE      = 40
local NPCS_PER_RESET        = 4    -- facilities that get an NPC each round

-- ── World layout (placeholder — refined in task II.A/II.B) ───
local FACILITIES = {
    { id = "fac_1", x =  250, y =  180 },
    { id = "fac_2", x = -250, y =  180 },
    { id = "fac_3", x =    0, y =  300 },
    { id = "fac_4", x =  250, y = -180 },
    { id = "fac_5", x = -250, y = -180 },
    { id = "fac_6", x =    0, y = -300 },
}
local MAINFRAME_POS = { x = 0, y = 0 }

-- ── Clan → faction mapping ────────────────────────────────────
local CLAN_TO_FACTION = {
    iron_ravens = "clan1",
    ember_tide  = "clan2",
    silent_root = "clan2",
}

local M = {}

-- ── Utility ──────────────────────────────────────────────────

-- Milliseconds. Falls back to tick-derived time if nk.time() is unavailable.
local function now_ms(tick)
    local ok, t = pcall(nk.time)
    if ok and type(t) == "number" then return t end
    return math.floor(tick * (1000 / TICK_RATE))
end

-- Planar distance, RING-AWARE -- see match_handler.lua for why. Same
-- delegation so both game modes share one definition of the loop.
local function dist2d(x1, y1, x2, y2)
    return rcr_config.dist2d(x1, y1, x2, y2)
end

local function get_facility(fac_id)
    for _, f in ipairs(FACILITIES) do
        if f.id == fac_id then return f end
    end
    return nil
end

local function count_active_nodes(state, team)
    local n = 0
    for _, node in pairs(state.nodes) do
        if node.status == "active" and node.team == team then n = n + 1 end
    end
    return n
end

local function has_any_active_node(state)
    for _, node in pairs(state.nodes) do
        if node.status == "active" then return true end
    end
    return false
end

local function all_presences(state)
    local list = {}
    for _, p in pairs(state.presences) do table.insert(list, p) end
    return list
end

local function get_faction(clan)
    if not clan then return "guest" end
    return CLAN_TO_FACTION[clan] or "guest"
end

-- nk.storage_read() hands back `.value` already decoded into a Lua table,
-- not a JSON string -- calling nk.json_decode() on it throws (pcall
-- swallows it silently, no log line), so this always fell through to
-- `return nil`. Confirmed live: a real clan1 account with a verified-correct
-- `{"clan":"iron_ravens"}` storage object still read back as guest every
-- time. Handle a table directly; keep the string/json_decode path too in
-- case a future Nakama version (or a differently-configured storage
-- collection) really does hand back a raw string.
local function load_player_data(user_id)
    local ok, result = pcall(function()
        return nk.storage_read({{ collection = "player", key = "data", user_id = user_id }})
    end)
    if ok and result and #result > 0 then
        local raw = result[1].value
        if type(raw) == "table" then return raw end
        local ok2, data = pcall(nk.json_decode, raw)
        if ok2 then return data end
    end
    return nil
end

-- Assign NPCs to a random subset of facilities, seeded by reset count
local function assign_npc_positions(reset_count)
    math.randomseed(reset_count * 7919 + 42)
    local ids = {}
    for _, f in ipairs(FACILITIES) do table.insert(ids, f.id) end
    for i = #ids, 2, -1 do
        local j = math.random(i)
        ids[i], ids[j] = ids[j], ids[i]
    end
    local positions = {}
    for i = 1, math.min(NPCS_PER_RESET, #ids) do
        positions[ids[i]] = true
    end
    return positions
end

local function get_spawn(state, faction)
    if faction == "clan1" then
        return math.random(-100, 100), math.random(200, 280)
    elseif faction == "clan2" then
        return math.random(-100, 100), math.random(-280, -200)
    else
        -- Guest: spawn at a random active node
        local active = {}
        for fac_id, node in pairs(state.nodes) do
            if node.status == "active" then
                local f = get_facility(fac_id)
                if f then table.insert(active, f) end
            end
        end
        if #active > 0 then
            local f = active[math.random(#active)]
            return f.x + math.random(-20, 20), f.y + math.random(-20, 20)
        end
        return 0, 0
    end
end

-- Build sync messages to send to a newly joined player
local function build_join_sync(state)
    local msgs = {}

    -- Active node states
    for fac_id, node in pairs(state.nodes) do
        if node.status ~= "neutral" then
            table.insert(msgs, { op = NW_NODE_STATE_UPDATE,
                data = nk.json_encode({ facilityId = fac_id,
                    status = node.status, team = node.team }) })
        end
    end

    -- Key state
    if state.key then
        table.insert(msgs, { op = NW_KEY_ISSUED,
            data = nk.json_encode({ teamOwner = state.key.teamOwner,
                holderUserId = state.key.holderUid }) })
        if not state.key.holderUid then
            table.insert(msgs, { op = NW_KEY_HOLDER_UPDATE,
                data = nk.json_encode({ holderUserId = nil,
                    groundPos = { x = state.key.groundX, y = state.key.groundY } }) })
        end
    end

    -- Mainframe / countdown
    if state.mainframe.active then
        table.insert(msgs, { op = NW_MAINFRAME_ACTIVATED,
            data = nk.json_encode({ countdownSeconds = state.mainframe.countdownSeconds,
                opBuffUserId = state.opBuffHolder }) })
    end

    -- OP buff holder
    if state.opBuffHolder then
        table.insert(msgs, { op = NW_OP_BUFF_UPDATE,
            data = nk.json_encode({ userId = state.opBuffHolder, active = true }) })
    end

    -- NPC positions (use joinSync flag so client does NOT wipe state)
    local npc_list = {}
    for _, f in ipairs(FACILITIES) do
        table.insert(npc_list, { facilityId = f.id,
            hasNpc = state.npcPositions[f.id] == true })
    end
    table.insert(msgs, { op = NW_FULL_RESET,
        data = nk.json_encode({ npcPositions = npc_list, joinSync = true }) })

    return msgs
end

local function do_full_reset(state, dispatcher)
    state.resetCount = state.resetCount + 1

    for _, node in pairs(state.nodes) do
        node.status    = "neutral"
        node.team      = nil
        node.activating = nil
    end
    state.key = nil
    state.mainframe = {
        active = false, activatingUid = nil, activateStartTick = nil,
        countdownEndTick = nil, countdownSeconds = 0,
        deactivatingUid = nil, deactivateStartTick = nil,
    }
    state.opBuffHolder = nil
    state.npcPositions = assign_npc_positions(state.resetCount)

    local npc_list = {}
    for _, f in ipairs(FACILITIES) do
        table.insert(npc_list, { facilityId = f.id,
            hasNpc = state.npcPositions[f.id] == true })
    end
    dispatcher.broadcast_message(NW_FULL_RESET,
        nk.json_encode({ npcPositions = npc_list }),
        all_presences(state), nil, true)
end

-- Decode Nakama JS SDK Uint8Array encoding
local function decode_msg_data(raw)
    local t = nk.json_decode(raw)
    if type(t) == "table" and t["0"] ~= nil then
        local bytes = {}
        local i = 0
        while t[tostring(i)] ~= nil do
            bytes[i + 1] = string.char(t[tostring(i)])
            i = i + 1
        end
        return nk.json_decode(table.concat(bytes))
    end
    return t
end

-- ── match_init ───────────────────────────────────────────────

function M.match_init(context, params)
    local state = {
        players    = {},
        presences  = {},
        nodes      = {},
        key        = nil,
        mainframe  = {
            active = false, activatingUid = nil, activateStartTick = nil,
            countdownEndTick = nil, countdownSeconds = 0,
            deactivatingUid = nil, deactivateStartTick = nil,
        },
        opBuffHolder = nil,
        resetCount   = 0,
        npcPositions = {},
        ended        = false,
        lastCountdownTick = 0,
    }
    for _, f in ipairs(FACILITIES) do
        state.nodes[f.id] = { status = "neutral", team = nil, activating = nil }
    end
    state.npcPositions = assign_npc_positions(0)
    return state, TICK_RATE, "node_war"
end

-- ── match_join_attempt ────────────────────────────────────────

function M.match_join_attempt(context, dispatcher, tick, state, presence, metadata)
    if state.ended then
        return state, false, "match has ended"
    end
    local saved   = load_player_data(presence.user_id)
    local clan    = saved and saved.clan or nil
    local faction = get_faction(clan)
    if faction == "guest" and not has_any_active_node(state) then
        return state, false, "no active nodes — guests cannot join yet"
    end
    return state, true, ""
end

-- ── match_join ───────────────────────────────────────────────

function M.match_join(context, dispatcher, tick, state, presences)
    for _, presence in ipairs(presences or {}) do
        local ok, err = pcall(function()
            local uid     = presence.user_id
            local saved   = load_player_data(uid)
            local clan    = saved and saved.clan or nil
            local faction = get_faction(clan)
            local sx, sy  = get_spawn(state, faction)

            state.presences[uid] = presence
            state.players[uid] = {
                x = sx, y = sy, height = 78, angle = 0,
                health = MAX_HEALTH, kills = 0,
                shield = SHIELD_MAX, lastDamageMs = 0,
                fireWindows = {}, hitsThisSec = 0, hitSecStart = 0,
                username = presence.username, clan = clan, faction = faction,
                isDead = false, deathTick = nil,
            }

            -- Current player list → new joiner
            local list = {}
            for euid, p in pairs(state.players) do
                if euid ~= uid then
                    table.insert(list, { userId = euid, username = p.username,
                        x = p.x, y = p.y, height = p.height,
                        angle = p.angle, health = p.health, kills = p.kills or 0 })
                end
            end
            dispatcher.broadcast_message(OP_PLAYER_LIST,
                nk.json_encode({ players = list }), { presence }, nil, true)

            -- NW state sync → new joiner
            for _, m in ipairs(build_join_sync(state)) do
                dispatcher.broadcast_message(m.op, m.data, { presence }, nil, true)
            end

            -- Announce join to all
            dispatcher.broadcast_message(OP_PLAYER_JOIN,
                nk.json_encode({ userId = uid, username = presence.username,
                    x = sx, y = sy, height = 78, angle = 0, health = MAX_HEALTH }),
                nil, nil, true)
        end)
        if not ok then print("nw match_join error: " .. tostring(err)) end
    end
    return state
end

-- ── match_leave ───────────────────────────────────────────────

function M.match_leave(context, dispatcher, tick, state, presences)
    for _, presence in ipairs(presences or {}) do
        local ok, err = pcall(function()
            local uid = presence.user_id
            local p   = state.players[uid]

            -- Drop key if this player held it
            if p and state.key and state.key.holderUid == uid then
                state.key.holderUid = nil
                state.key.groundX   = p.x
                state.key.groundY   = p.y
                dispatcher.broadcast_message(NW_KEY_HOLDER_UPDATE,
                    nk.json_encode({ holderUserId = nil,
                        groundPos = { x = p.x, y = p.y } }),
                    all_presences(state), nil, true)
            end

            -- Cancel any pending activation by this player
            for _, node in pairs(state.nodes) do
                if node.activating and node.activating.uid == uid then
                    node.activating = nil
                end
            end
            if state.mainframe.activatingUid  == uid then
                state.mainframe.activatingUid     = nil
                state.mainframe.activateStartTick = nil
            end
            if state.mainframe.deactivatingUid == uid then
                state.mainframe.deactivatingUid     = nil
                state.mainframe.deactivateStartTick = nil
            end

            -- Remove OP buff
            if state.opBuffHolder == uid then
                state.opBuffHolder = nil
                dispatcher.broadcast_message(NW_OP_BUFF_UPDATE,
                    nk.json_encode({ userId = uid, active = false }),
                    all_presences(state), nil, true)
            end

            state.players[uid]  = nil
            state.presences[uid] = nil

            dispatcher.broadcast_message(OP_PLAYER_LEAVE,
                nk.json_encode({ userId = uid }), nil, nil, true)
        end)
        if not ok then print("nw match_leave error: " .. tostring(err)) end
    end
    return state
end

-- ── Message handler ───────────────────────────────────────────

local function handle_message(dispatcher, state, tick, msg)
    local uid    = msg.sender.user_id
    local record = state.players[uid]
    if not record then return end

    local op   = msg.op_code
    local data = decode_msg_data(msg.data)

    -- Dead players can only ping
    if record.isDead and op ~= OP_PING then return end

    -- ── Position & movement ────────────────────────────────────

    if op == OP_POSITION then
        record.x      = data.x      or record.x
        record.y      = data.y      or record.y
        record.height = data.height or record.height
        record.angle  = data.angle  or record.angle
        -- record.health is deliberately NOT read from the client. Health
        -- changes only via OP_HIT.
        local others = {}
        for ouid in pairs(state.presences) do
            if ouid ~= uid then table.insert(others, state.presences[ouid]) end
        end
        if #others > 0 then
            dispatcher.broadcast_message(OP_POSITION,
                nk.json_encode({ userId = uid, x = record.x, y = record.y,
                    height = record.height, angle = record.angle, health = record.health }),
                others, nil, false)
        end

    -- ── Combat ────────────────────────────────────────────────

    elseif op == OP_HIT then
        local target_id = data.targetId
        local target    = state.players[target_id]
        if not target or target.isDead then return end

        -- Damage is decided HERE, from the weapon type the client names.
        -- The client no longer sends a damage number.
        local wname = tostring(data.weaponType or "")
        local spec  = WEAPONS[wname]
        if not spec then return end

        if dist2d(record.x, record.y, target.x, target.y) > 1000 then return end

        -- Friendly fire: kick the shooter (clans only, not guest-on-guest)
        if record.faction ~= "guest" and target.faction == record.faction then
            local sp = state.presences[uid]
            if sp then
                dispatcher.broadcast_message(OP_PLAYER_KICKED,
                    nk.json_encode({ reason = "friendly_fire" }), { sp }, nil, true)
            end
            state.players[uid]   = nil
            state.presences[uid] = nil
            dispatcher.broadcast_message(OP_PLAYER_LEAVE,
                nk.json_encode({ userId = uid }), nil, nil, true)
            return
        end

        -- Fire-rate throttle: at most max_per_shot projectiles per interval
        -- per weapon, plus a global per-second ceiling so cycling weapon
        -- types cannot buy extra windows.
        local now = now_ms(tick)

        record.hitSecStart = record.hitSecStart or 0
        record.hitsThisSec = record.hitsThisSec or 0
        if (now - record.hitSecStart) >= 1000 then
            record.hitSecStart = now
            record.hitsThisSec = 0
        end
        if record.hitsThisSec >= MAX_HITS_PER_SEC then return end

        record.fireWindows = record.fireWindows or {}
        local window = record.fireWindows[wname]
        local span   = spec.interval_ms * FIRE_RATE_GRACE
        if (not window) or (now - window.start) >= span then
            window = { start = now, count = 0 }
            record.fireWindows[wname] = window
        end
        if window.count >= spec.max_per_shot then return end
        window.count       = window.count + 1
        record.hitsThisSec = record.hitsThisSec + 1

        -- Damage reductions: OP buff holder gets 50%; guests always get 50%
        local actual = spec.damage
        if target_id == state.opBuffHolder       then actual = math.floor(actual * 0.5) end
        if target.faction == "guest"             then actual = math.floor(actual * 0.5) end

        -- Shield absorbs before health; both pools live on the server.
        local prev = target.health
        target.shield = target.shield or SHIELD_MAX
        local absorbed = math.min(target.shield, actual)
        target.shield  = target.shield - absorbed
        target.health  = math.max(0, target.health - (actual - absorbed))
        target.lastDamageMs = now

        local tp = state.presences[target_id]
        if tp then
            dispatcher.broadcast_message(OP_DAMAGE,
                nk.json_encode({ shooterId = uid, damage = actual,
                    health = target.health, shield = target.shield }),
                { tp }, nil, true)
        end

        if prev > 0 and target.health <= 0 then
            record.kills = (record.kills or 0) + 1

            -- Drop key
            if state.key and state.key.holderUid == target_id then
                state.key.holderUid = nil
                state.key.groundX   = target.x
                state.key.groundY   = target.y
                dispatcher.broadcast_message(NW_KEY_HOLDER_UPDATE,
                    nk.json_encode({ holderUserId = nil,
                        groundPos = { x = target.x, y = target.y } }),
                    all_presences(state), nil, true)
            end
            -- Cancel target's activation
            for _, node in pairs(state.nodes) do
                if node.activating and node.activating.uid == target_id then
                    node.activating = nil
                end
            end

            dispatcher.broadcast_message(OP_KILL,
                nk.json_encode({ killerId = uid, victimId = target_id,
                    kills = record.kills }), nil, nil, true)

            if target.faction == "guest" then
                -- Permadeath: kick the guest
                if tp then
                    dispatcher.broadcast_message(NW_FACTION_KICK,
                        nk.json_encode({}), { tp }, nil, true)
                end
                if state.opBuffHolder == target_id then
                    state.opBuffHolder = nil
                    dispatcher.broadcast_message(NW_OP_BUFF_UPDATE,
                        nk.json_encode({ userId = target_id, active = false }),
                        all_presences(state), nil, true)
                end
                state.players[target_id]  = nil
                state.presences[target_id] = nil
                dispatcher.broadcast_message(OP_PLAYER_LEAVE,
                    nk.json_encode({ userId = target_id }), nil, nil, true)
            else
                target.isDead    = true
                target.deathTick = tick
            end
        end

    elseif op == OP_SHOOT then
        local others = {}
        for ouid in pairs(state.presences) do
            if ouid ~= uid then table.insert(others, state.presences[ouid]) end
        end
        if #others > 0 then
            dispatcher.broadcast_message(OP_SHOOT,
                nk.json_encode({ userId = uid, x = data.x, y = data.y, z = data.z,
                    dx = data.dx, dy = data.dy, dz = data.dz }),
                others, nil, false)
        end

    elseif op == OP_PING then
        local sp = state.presences[uid]
        if sp then
            dispatcher.broadcast_message(OP_PONG,
                nk.json_encode({ ts = data.ts }), { sp }, nil, false)
        end

    -- ── Node War: Node Activation ─────────────────────────────

    elseif op == NW_NODE_ACTIVATE_START then
        if record.faction == "guest" then return end
        local node = state.nodes[data.facilityId]
        local fac  = get_facility(data.facilityId)
        if not node or not fac then return end
        if node.status ~= "neutral" then return end
        if not state.npcPositions[data.facilityId] then return end
        if dist2d(record.x, record.y, fac.x, fac.y) > ACTIVATION_RANGE then return end
        node.activating = { uid = uid, startTick = tick, type = "activate" }

    elseif op == NW_NODE_ACTIVATE_COMPLETE then
        if record.faction == "guest" then return end
        local node = state.nodes[data.facilityId]
        local fac  = get_facility(data.facilityId)
        if not node or not fac then return end
        if node.status ~= "neutral" then return end
        if not node.activating or node.activating.uid ~= uid then return end
        if (tick - node.activating.startTick) < MIN_ACTIVATION_TICKS then return end
        if dist2d(record.x, record.y, fac.x, fac.y) > ACTIVATION_RANGE then return end

        node.status    = "active"
        node.team      = record.faction
        node.activating = nil
        dispatcher.broadcast_message(NW_NODE_STATE_UPDATE,
            nk.json_encode({ facilityId = data.facilityId,
                status = "active", team = record.faction }),
            all_presences(state), nil, true)

        -- Check if this team earned 3 nodes and there's no key yet
        if count_active_nodes(state, record.faction) >= NODES_TO_EARN_KEY
           and state.key == nil then
            -- Neutral the other team's nodes immediately
            local other = (record.faction == "clan1") and "clan2" or "clan1"
            for fid, onode in pairs(state.nodes) do
                if onode.team == other then
                    onode.status    = "neutral"
                    onode.team      = nil
                    onode.activating = nil
                    dispatcher.broadcast_message(NW_NODE_STATE_UPDATE,
                        nk.json_encode({ facilityId = fid, status = "neutral", team = nil }),
                        all_presences(state), nil, true)
                end
            end
            -- Issue the Key to this player
            state.key = { teamOwner = record.faction, holderUid = uid,
                          groundX = nil, groundY = nil }
            dispatcher.broadcast_message(NW_KEY_ISSUED,
                nk.json_encode({ teamOwner = record.faction, holderUserId = uid }),
                all_presences(state), nil, true)
        end

    -- ── Node War: Node Deactivation ───────────────────────────

    elseif op == NW_NODE_DEACTIVATE_START then
        if not state.key or state.key.holderUid ~= uid then return end
        if state.key.teamOwner == record.faction and record.faction ~= "guest" then return end
        local node = state.nodes[data.facilityId]
        local fac  = get_facility(data.facilityId)
        if not node or not fac then return end
        if node.status ~= "active" then return end
        if not state.npcPositions[data.facilityId] then return end
        if dist2d(record.x, record.y, fac.x, fac.y) > ACTIVATION_RANGE then return end
        node.activating = { uid = uid, startTick = tick, type = "deactivate" }

    elseif op == NW_NODE_DEACTIVATE_COMPLETE then
        if not state.key or state.key.holderUid ~= uid then return end
        if state.key.teamOwner == record.faction and record.faction ~= "guest" then return end
        local node = state.nodes[data.facilityId]
        local fac  = get_facility(data.facilityId)
        if not node or not fac then return end
        if node.status ~= "active" then return end
        if not node.activating or node.activating.uid ~= uid then return end
        if (tick - node.activating.startTick) < MIN_ACTIVATION_TICKS then return end
        if dist2d(record.x, record.y, fac.x, fac.y) > ACTIVATION_RANGE then return end

        node.status    = "neutral"
        node.team      = nil
        node.activating = nil
        dispatcher.broadcast_message(NW_NODE_STATE_UPDATE,
            nk.json_encode({ facilityId = data.facilityId,
                status = "neutral", team = nil }),
            all_presences(state), nil, true)

        -- If all Key-team nodes are gone → destroy Key → full reset
        if count_active_nodes(state, state.key.teamOwner) == 0 then
            dispatcher.broadcast_message(NW_KEY_DESTROYED,
                nk.json_encode({ cause = "all_nodes_deactivated" }),
                all_presences(state), nil, true)
            do_full_reset(state, dispatcher)
        end

    -- ── Node War: Mainframe ───────────────────────────────────

    elseif op == NW_MAINFRAME_ACTIVATE_START then
        if not state.key or state.key.holderUid ~= uid then return end
        if state.key.teamOwner ~= record.faction then return end
        if state.mainframe.active then return end
        if dist2d(record.x, record.y, MAINFRAME_POS.x, MAINFRAME_POS.y) > MAINFRAME_RANGE then return end
        state.mainframe.activatingUid     = uid
        state.mainframe.activateStartTick = tick

    elseif op == NW_MAINFRAME_ACTIVATE_COMPLETE then
        if not state.key or state.key.holderUid ~= uid then return end
        if state.key.teamOwner ~= record.faction then return end
        if state.mainframe.active then return end
        if not state.mainframe.activatingUid or state.mainframe.activatingUid ~= uid then return end
        if (tick - state.mainframe.activateStartTick) < MIN_ACTIVATION_TICKS then return end
        if dist2d(record.x, record.y, MAINFRAME_POS.x, MAINFRAME_POS.y) > MAINFRAME_RANGE then return end

        state.mainframe.active            = true
        state.mainframe.activatingUid     = nil
        state.mainframe.activateStartTick = nil
        state.mainframe.countdownEndTick  = tick + (COUNTDOWN_SECONDS * TICK_RATE)
        state.mainframe.countdownSeconds  = COUNTDOWN_SECONDS
        state.opBuffHolder                = uid

        dispatcher.broadcast_message(NW_MAINFRAME_ACTIVATED,
            nk.json_encode({ countdownSeconds = COUNTDOWN_SECONDS, opBuffUserId = uid }),
            all_presences(state), nil, true)
        dispatcher.broadcast_message(NW_OP_BUFF_UPDATE,
            nk.json_encode({ userId = uid, active = true }),
            all_presences(state), nil, true)

    elseif op == NW_MAINFRAME_DEACTIVATE_START then
        if not state.mainframe.active then return end
        if not state.key or state.key.holderUid ~= uid then return end
        if state.key.teamOwner == record.faction and record.faction ~= "guest" then return end
        if dist2d(record.x, record.y, MAINFRAME_POS.x, MAINFRAME_POS.y) > MAINFRAME_RANGE then return end
        state.mainframe.deactivatingUid     = uid
        state.mainframe.deactivateStartTick = tick

    elseif op == NW_MAINFRAME_DEACTIVATE_COMPLETE then
        if not state.mainframe.active then return end
        if not state.key or state.key.holderUid ~= uid then return end
        if state.key.teamOwner == record.faction and record.faction ~= "guest" then return end
        if not state.mainframe.deactivatingUid or state.mainframe.deactivatingUid ~= uid then return end
        if (tick - state.mainframe.deactivateStartTick) < MIN_ACTIVATION_TICKS then return end
        if dist2d(record.x, record.y, MAINFRAME_POS.x, MAINFRAME_POS.y) > MAINFRAME_RANGE then return end

        dispatcher.broadcast_message(NW_MAINFRAME_DEACTIVATED,
            nk.json_encode({}), all_presences(state), nil, true)
        dispatcher.broadcast_message(NW_KEY_DESTROYED,
            nk.json_encode({ cause = "mainframe_deactivated" }),
            all_presences(state), nil, true)
        do_full_reset(state, dispatcher)

    -- ── Node War: Key Pickup ──────────────────────────────────

    elseif op == NW_KEY_PICKUP_REQUEST then
        if not state.key or state.key.holderUid ~= nil then return end
        if dist2d(record.x, record.y, state.key.groundX, state.key.groundY) > KEY_PICKUP_RANGE then return end

        local prev_holder_uid = state.opBuffHolder
        state.key.holderUid   = uid
        state.key.groundX     = nil
        state.key.groundY     = nil

        dispatcher.broadcast_message(NW_KEY_HOLDER_UPDATE,
            nk.json_encode({ holderUserId = uid,
                team = record.faction, groundPos = nil }),
            all_presences(state), nil, true)

        -- OP buff follows the key holder only if Mainframe is active and it's their team's key
        if state.mainframe.active and state.key.teamOwner == record.faction then
            state.opBuffHolder = uid
            if prev_holder_uid and prev_holder_uid ~= uid then
                dispatcher.broadcast_message(NW_OP_BUFF_UPDATE,
                    nk.json_encode({ userId = prev_holder_uid, active = false }),
                    all_presences(state), nil, true)
            end
            dispatcher.broadcast_message(NW_OP_BUFF_UPDATE,
                nk.json_encode({ userId = uid, active = true }),
                all_presences(state), nil, true)
        end
    end
end

-- ── match_loop ────────────────────────────────────────────────

function M.match_loop(context, dispatcher, tick, state, messages)
    if state.ended then return nil end

    for _, msg in ipairs(messages or {}) do
        local ok, err = pcall(handle_message, dispatcher, state, tick, msg)
        if not ok then print("nw loop msg error: " .. tostring(err)) end
    end

    -- Shield regeneration (5/sec, starting 4s after the last damage taken)
    local tnow = now_ms(tick)
    for _, p in pairs(state.players) do
        if not p.isDead and (p.health or 0) > 0 then
            p.shield = p.shield or SHIELD_MAX
            if p.shield < SHIELD_MAX
               and (tnow - (p.lastDamageMs or 0)) >= SHIELD_REGEN_DELAY_MS then
                p.shield = math.min(SHIELD_MAX,
                                    p.shield + SHIELD_REGEN_PER_SEC / TICK_RATE)
            end
        end
    end

    -- Respawn dead clan players
    for uid, p in pairs(state.players) do
        if p.isDead and p.deathTick and (tick - p.deathTick) >= RESPAWN_TICKS then
            local rx, ry = get_spawn(state, p.faction)
            p.x = rx; p.y = ry
            p.health = MAX_HEALTH
            p.shield = SHIELD_MAX
            p.lastDamageMs = 0
            p.isDead = false; p.deathTick = nil
            dispatcher.broadcast_message(OP_PLAYER_JOIN,
                nk.json_encode({ userId = uid, username = p.username,
                    x = rx, y = ry, height = 78, angle = 0, health = MAX_HEALTH }),
                nil, nil, true)
        end
    end

    -- Countdown
    if state.mainframe.active and state.mainframe.countdownEndTick then
        local remaining_ticks = state.mainframe.countdownEndTick - tick
        if remaining_ticks <= 0 then
            local winner = state.key and state.key.teamOwner or "unknown"
            state.ended = true
            dispatcher.broadcast_message(NW_MATCH_WIN,
                nk.json_encode({ winningTeam = winner }),
                all_presences(state), nil, true)
            return nil
        end
        local secs = math.ceil(remaining_ticks / TICK_RATE)
        if secs ~= state.mainframe.countdownSeconds
           and (tick - state.lastCountdownTick) >= TICK_RATE then
            state.mainframe.countdownSeconds = secs
            state.lastCountdownTick = tick
            dispatcher.broadcast_message(NW_COUNTDOWN_UPDATE,
                nk.json_encode({ secondsRemaining = secs }),
                all_presences(state), nil, true)
        end
    end

    -- Expire stale activations (player walked away)
    for fac_id, node in pairs(state.nodes) do
        if node.activating then
            local ap = state.players[node.activating.uid]
            if not ap then
                node.activating = nil
            else
                local fac = get_facility(fac_id)
                if fac and dist2d(ap.x, ap.y, fac.x, fac.y) > ACTIVATION_RANGE then
                    node.activating = nil
                end
            end
        end
    end

    return state
end

-- ── match_terminate / match_signal ───────────────────────────

function M.match_terminate(context, dispatcher, tick, state, grace_seconds)
    return state
end

function M.match_signal(context, dispatcher, tick, state, data)
    return state, ""
end

return M
