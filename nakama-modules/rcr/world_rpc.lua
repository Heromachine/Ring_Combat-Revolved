-- ============================================================
-- RPC: rcr_world_config
-- ============================================================
-- Hands the client the world parameters the SERVER is using, so the two
-- cannot disagree. The client calls this once at startup and configures its
-- ring and terrain generator from the reply.
local nk     = require("nakama")
local config = require("rcr.config")

local function world_config(context, payload)
    local r = config.ring
    return nk.json_encode({
        ring = {
            enabled         = r.enabled,
            lengthTiles     = r.lengthTiles,
            widthTiles      = r.widthTiles,
            tileAdvance     = r.tileAdvance,
            flatRadiusTiles = r.flatRadiusTiles,
            detailTiles     = r.detailTiles,
            seed            = r.seed,
            ringLength      = config.ring_length()
        }
    })
end

nk.register_rpc(world_config, "rcr_world_config")
