-- ============================================================
-- RPC: rcr_find_or_create_match
-- Returns the match_id of the open world match (creates if none exists)
--
-- The id is namespaced (rcr_ = Ring Combat Revolved) because this Nakama
-- instance is shared. HeroEngine's herogames/main.lua also registers a
-- "find_or_create_match", and it was winning the name: every join attempt
-- from this game hit HeroEngine's handler and failed with
-- "projectId required", so the open world match was unreachable.
-- Keep this id unique to this project.
-- ============================================================

local nk = require("nakama")

local function find_or_create_match(context, payload)
    -- List matches with label "open_world"
    local matches = nk.match_list(10, true, "open_world", nil, nil, nil)

    if matches and #matches > 0 then
        -- Join the first available match
        return nk.json_encode({ match_id = matches[1].match_id })
    end

    -- No existing match — create one
    local match_id = nk.match_create("match_handler", {})
    return nk.json_encode({ match_id = match_id })
end

nk.register_rpc(find_or_create_match, "rcr_find_or_create_match")
