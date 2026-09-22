-- ============================================================
-- rcr.config — world parameters, server-authoritative
-- ============================================================
-- THE SERVER OWNS THESE NUMBERS. The client fetches them at startup via the
-- rcr_world_config RPC rather than declaring its own copy.
--
-- This exists because of a mistake already made once in this project: the
-- WEAPONS damage table is hand-mirrored between src/core/globals.js and BOTH
-- Lua match handlers, and nothing detects drift -- the symptom is a silent
-- difference in time-to-kill. Ring geometry is worse, because the server uses
-- it to decide whether a shot is in range. If client and server disagree
-- about ringLength, hits near the seam are rejected and it reads as flaky
-- netcode, not as a configuration bug.
--
-- So: one definition, here, and the client asks.
local M = {}

M.ring = {
    -- Matches the Phase 0 decision (HeroLab 8c6866b6). ringLength is the only
    -- value the server strictly needs -- it is what wraps distance -- but the
    -- rest travel with it so the client cannot configure itself differently.
    enabled         = true,    -- the ring IS the world; dist2d wraps accordingly
    lengthTiles     = 64,
    widthTiles      = 8,
    tileAdvance     = 896,     -- tileWidth 1024 - overlap 128
    flatRadiusTiles = 0.5,
    detailTiles     = 1.2,
    seed            = 1337
}

function M.ring_length()
    return M.ring.lengthTiles * M.ring.tileAdvance
end

-- Shortest signed distance along the loop. Returns the plain difference when
-- the ring is off, so flat worlds are unaffected.
function M.wrap_dy(dy)
    if not M.ring.enabled then return dy end
    local L = M.ring_length()
    if L <= 0 then return dy end
    local h = L * 0.5
    return ((dy + h) % L + L) % L - h
end

-- Ring-aware planar distance. THE reason this module exists: with a wrapping
-- Y axis two players standing next to each other across the seam are a full
-- ring-length apart by plain Euclidean measure, so hit validation and chat
-- range silently fail in a band that moves with the ring.
function M.dist2d(x1, y1, x2, y2)
    local dx = x1 - x2
    local dy = M.wrap_dy(y1 - y2)
    return math.sqrt(dx * dx + dy * dy)
end

return M
