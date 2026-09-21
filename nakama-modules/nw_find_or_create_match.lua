local nk = require("nakama")

local function find_or_create_nw_match(context, payload)
    local matches = nk.match_list(10, true, "node_war", nil, nil, nil)

    for _, match in ipairs(matches) do
        if match.size < 20 then
            return nk.json_encode({ matchId = match.match_id })
        end
    end

    local match_id = nk.match_create("nw_match", {})
    return nk.json_encode({ matchId = match_id })
end

-- Namespaced (rcr_ = Ring Combat Revolved): this Nakama instance is shared
-- with HeroEngine's herogames modules and rpc ids are a single flat
-- namespace with no collision detection. See find_or_create_match.lua.
nk.register_rpc(find_or_create_nw_match, "rcr_find_or_create_nw_match")
