// ===============================
// Screen Buffer Operations
// ===============================
"use strict";

function DrawBackground(){
    var buf32=screendata.buf32,len=buf32.length,bg=screendata.backgroundcolor;
    // The sky fill was the one thing day/night lighting never touched --
    // terrain and the ring backdrop both darken, but the sky behind/above
    // them stayed screendata.backgroundcolor's fixed colour regardless, so
    // standing in the ring's darkest zone still showed a bright sky. Lit by
    // the PLAYER's own position (camera.y), once per frame here, not
    // screendata.backgroundcolor itself -- that constant stays the real
    // base colour for anything else that ever needs it.
    if (typeof DayNight !== 'undefined' && typeof ringWorld !== 'undefined' && ringWorld.enabled) {
        bg = DayNight.litColor(bg, camera.y);
    }
    screendata.depthBuffer.fill(Infinity);
    albedoBuffer().fill(0);
    for(var i=0;i<len;i++)buf32[i]=bg;
}

// Per-pixel UNLIT colour, parallel to buf32. Day/night darkening destroys
// colour information (at full night a pixel is literally 0,0,0), so the
// flashlight can't recover what a surface looks like from buf32 alone.
// Renderers that apply day/night lighting write the pre-lighting colour
// here alongside the lit one; 0 (alpha 0) means "nothing recorded" and
// the flashlight falls back to buf32 for that pixel.
function albedoBuffer(){
    var n = screendata.buf32.length;
    if (!screendata.albedo || screendata.albedo.length !== n) screendata.albedo = new Uint32Array(n);
    return screendata.albedo;
}

function Flip(){
    screendata.imagedata.data.set(screendata.buf8);
    screendata.context.putImageData(screendata.imagedata,0,0);
}
