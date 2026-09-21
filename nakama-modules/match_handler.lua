-- ============================================================
-- Ring — Combat Revolved: Open World Match Handler
-- Nakama Lua server-side module
-- ============================================================

local _nk = require("nakama")

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

local TICK_RATE      = 20
local VICINITY_RANGE = 150
local SHOUT_RANGE    = 500
local MAX_HEALTH     = 100
local RESPAWN_TICKS  = 5 * TICK_RATE  -- 5 seconds until respawn

local M = {}

local function dist2d(x1, y1, x2, y2)
    local dx = x1 - x2
    local dy = y1 - y2
    return math.sqrt(dx * dx + dy * dy)
end

local function load_player_data(user_id)
    local ok, result = pcall(function()
        return _nk.storage_read({{
            collection = "player", key = "data", user_id = user_id
        }})
    end)
    if ok and result and #result > 0 then
        local ok2, data = pcall(_nk.json_decode, result[1].value)
        if ok2 then return data end
    end
    return nil
end

-- NOTE: Nakama Lua match handler functions do NOT receive logger or nk parameters.
-- Correct signatures: match_init(context, params)
--                     match_join(context, dispatcher, tick, state, presences)
--                     match_loop(context, dispatcher, tick, state, messages)
--                     etc.

function M.match_init(context, params)
    return { players = {}, presences = {} }, TICK_RATE, "open_world"
end

function M.match_join_attempt(context, dispatcher, tick, state, presence, metadata)
    return state, true, ""
end

function M.match_join(context, dispatcher, tick, state, presences)
    for _, presence in ipairs(presences or {}) do
        local ok, err = pcall(function()
            local uid   = presence.user_id
            local saved = load_player_data(uid)
            local clan  = saved and saved.clan or nil
            local sx    = math.random(-300, 300)
            local sy    = math.random(-300, 300)

            state.presences[uid] = presence
            state.players[uid]   = {
                x = sx, y = sy, height = 78, angle = 0, health = MAX_HEALTH,
                kills = 0,
                username = presence.username, clan = clan,
                lastX = sx, lastY = sy
            }

            -- Send current player list to new joiner
            local list = {}
            for euid, p in pairs(state.players) do
                if euid ~= uid then
                    table.insert(list, { userId = euid, username = p.username,
                        x = p.x, y = p.y, height = p.height, angle = p.angle, health = p.health,
                        kills = p.kills or 0 })
                end
            end
            dispatcher.broadcast_message(OP_PLAYER_LIST,
                _nk.json_encode({ players = list }), { presence }, nil, true)

            -- Broadcast join to everyone
            dispatcher.broadcast_message(OP_PLAYER_JOIN,
                _nk.json_encode({ userId = uid, username = presence.username,
                    x = sx, y = sy, height = 78, angle = 0, health = MAX_HEALTH }),
                nil, nil, true)
        end)
        if not ok then
            print("match_join error: " .. tostring(err))
        end
    end
    return state
end

function M.match_leave(context, dispatcher, tick, state, presences)
    for _, presence in ipairs(presences or {}) do
        local ok, err = pcall(function()
            local uid = presence.user_id
            state.players[uid]   = nil
            state.presences[uid] = nil
            dispatcher.broadcast_message(OP_PLAYER_LEAVE,
                _nk.json_encode({ userId = uid }), nil, nil, true)
        end)
        if not ok then
            print("match_leave error: " .. tostring(err))
        end
    end
    return state
end

-- Nakama JS SDK (older versions) serialises a Uint8Array as {"0":N,"1":N,...}.
-- Detect that format and reconstruct the original JSON string from the bytes.
local function decode_msg_data(raw)
    local t = _nk.json_decode(raw)
    if type(t) == "table" and t["0"] ~= nil then
        local bytes = {}
        local i = 0
        while t[tostring(i)] ~= nil do
            bytes[i + 1] = string.char(t[tostring(i)])
            i = i + 1
        end
        return _nk.json_decode(table.concat(bytes))
    end
    return t
end

local function handle_message(dispatcher, state, tick, msg)
    local sender_uid = msg.sender.user_id
    local record     = state.players[sender_uid]
    if not record then return end

    local op   = msg.op_code
    local data = decode_msg_data(msg.data)

    if op == OP_POSITION then
        record.x      = data.x      or record.x
        record.y      = data.y      or record.y
        record.height = data.height or record.height
        record.angle  = data.angle  or record.angle
        record.health = math.max(0, math.min(MAX_HEALTH, data.health or record.health))

        local others = {}
        for uid, p in pairs(state.presences) do
            if uid ~= sender_uid then table.insert(others, p) end
        end
        if #others > 0 then
            dispatcher.broadcast_message(OP_POSITION,
                _nk.json_encode({ userId = sender_uid,
                    x = record.x, y = record.y, height = record.height,
                    angle = record.angle, health = record.health }),
                others, nil, false)
        end

    elseif op == OP_CHAT then
        local emoji = data.emoji or "?"
        local shout = data.shout == true
        local range = shout and SHOUT_RANGE or VICINITY_RANGE
        local recipients = {}
        for uid, p in pairs(state.players) do
            if uid ~= sender_uid and dist2d(record.x, record.y, p.x, p.y) <= range then
                table.insert(recipients, state.presences[uid])
            end
        end
        if #recipients > 0 then
            dispatcher.broadcast_message(OP_CHAT,
                _nk.json_encode({ senderId = sender_uid, x = record.x, y = record.y,
                    emoji = emoji, shout = shout }),
                recipients, nil, true)
        end
        if shout then
            local radar_r = {}
            for uid, p in pairs(state.players) do
                if uid ~= sender_uid and dist2d(record.x, record.y, p.x, p.y) <= SHOUT_RANGE then
                    table.insert(radar_r, state.presences[uid])
                end
            end
            if #radar_r > 0 then
                dispatcher.broadcast_message(OP_RADAR_REVEAL,
                    _nk.json_encode({ userId = sender_uid, x = record.x, y = record.y }),
                    radar_r, nil, true)
            end
        end

    elseif op == OP_HIT then
        local target_id = data.targetId
        local damage    = math.max(0, math.min(100, tonumber(data.damage) or 0))
        local target    = state.players[target_id]
        if not target then return end
        if target.isDead then return end  -- already dead, waiting for respawn
        if dist2d(record.x, record.y, target.x, target.y) > 1000 then return end

        -- Friendly fire check
        if record.clan and target.clan and record.clan == target.clan then
            local sp = state.presences[sender_uid]
            if sp then
                dispatcher.broadcast_message(OP_PLAYER_KICKED,
                    _nk.json_encode({ reason = "friendly_fire" }), { sp }, nil, true)
            end
            state.players[sender_uid]   = nil
            state.presences[sender_uid] = nil
            dispatcher.broadcast_message(OP_PLAYER_LEAVE,
                _nk.json_encode({ userId = sender_uid }), nil, nil, true)
            return
        end

        local prev_health = target.health
        target.health = math.max(0, target.health - damage)
        local tp = state.presences[target_id]
        if tp then
            dispatcher.broadcast_message(OP_DAMAGE,
                _nk.json_encode({ shooterId = sender_uid, damage = damage, health = target.health }),
                { tp }, nil, true)
        end
        if prev_health > 0 and target.health <= 0 then
            record.kills = (record.kills or 0) + 1
            dispatcher.broadcast_message(OP_KILL,
                _nk.json_encode({ killerId = sender_uid, victimId = target_id,
                    kills = record.kills }),
                nil, nil, true)
            target.isDead    = true
            target.deathTick = tick
        end

    elseif op == OP_SHOOT then
        local others = {}
        for uid, p in pairs(state.presences) do
            if uid ~= sender_uid then table.insert(others, p) end
        end
        if #others > 0 then
            dispatcher.broadcast_message(OP_SHOOT,
                _nk.json_encode({ userId = sender_uid,
                    x = data.x, y = data.y, z = data.z,
                    dx = data.dx, dy = data.dy, dz = data.dz }),
                others, nil, false)
        end

    elseif op == OP_PING then
        local sp = state.presences[sender_uid]
        if sp then
            dispatcher.broadcast_message(OP_PONG,
                _nk.json_encode({ ts = data.ts }),
                { sp }, nil, false)
        end
    end
end

function M.match_loop(context, dispatcher, tick, state, messages)
    for _, msg in ipairs(messages or {}) do
        local ok, err = pcall(handle_message, dispatcher, state, tick, msg)
        if not ok then
            print("match_loop msg error: " .. tostring(err))
        end
    end

    -- Respawn dead players after RESPAWN_TICKS
    for uid, p in pairs(state.players) do
        if p.isDead and p.deathTick and (tick - p.deathTick) >= RESPAWN_TICKS then
            local rx = math.random(-300, 300)
            local ry = math.random(-300, 300)
            p.x      = rx
            p.y      = ry
            p.health = MAX_HEALTH
            p.isDead = false
            dispatcher.broadcast_message(OP_PLAYER_JOIN,
                _nk.json_encode({ userId = uid, username = p.username,
                    x = rx, y = ry, height = 78, angle = 0, health = MAX_HEALTH }),
                nil, nil, true)
        end
    end

    return state
end

function M.match_terminate(context, dispatcher, tick, state, grace_seconds)
    return state
end

function M.match_signal(context, dispatcher, tick, state, data)
    return state, ""
end

return M
