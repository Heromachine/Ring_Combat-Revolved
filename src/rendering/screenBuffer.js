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
    for(var i=0;i<len;i++)buf32[i]=bg;
}

function Flip(){
    screendata.imagedata.data.set(screendata.buf8);
    screendata.context.putImageData(screendata.imagedata,0,0);
}
