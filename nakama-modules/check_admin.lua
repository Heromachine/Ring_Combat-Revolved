-- ============================================================
-- RPC: check_admin
-- Returns { isAdmin = true/false } for the CALLING user.
--
-- The client must never decide this for itself. Previously
-- src/main.js did `isAdmin = (getUsername() === "heromachine")`,
-- which any player could defeat by typing `isAdmin = true` in
-- the browser console.
--
-- Admins are pinned by user_id, not username: Nakama lets a user
-- change their own username, so a username comparison is not a
-- stable identity. user_id is immutable.
-- ============================================================

local nk = require("nakama")

-- Immutable Nakama user_ids granted admin.
local ADMIN_USER_IDS = {
    ["cbab7c03-0c1a-4941-b758-b10cb48e5d01"] = true,   -- heromachine
}

local function check_admin(context, payload)
    local uid = context.user_id

    -- No authenticated caller (e.g. server-to-server) is never admin.
    if uid == nil or uid == "" then
        return nk.json_encode({ isAdmin = false })
    end

    local is_admin = ADMIN_USER_IDS[uid] == true

    if is_admin then
        nk.logger_info(string.format("admin session granted: user_id=%s username=%s",
            uid, tostring(context.username)))
    end

    return nk.json_encode({ isAdmin = is_admin })
end

nk.register_rpc(check_admin, "check_admin")
