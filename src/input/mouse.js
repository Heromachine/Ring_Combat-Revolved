// ===============================
// Mouse Input Handlers
// ===============================
"use strict";

function DetectMouseDown(e){
    if(e.button===0) input.shoot=true;
    if(e.button===2){
        input.aimToggled = !input.aimToggled;
        if(typeof setEditMode==='function') setEditMode(input.aimToggled ? 'ads' : 'hip');
    }
}

function DetectMouseUp(e){
    if(e.button===0) input.shoot=false;
    // ADS is now toggle, no action on mouse up
}

// Clears every held input. Call this whenever the game stops receiving
// release events -- opening the menu, losing pointer lock, or the window
// losing focus. Without it a button held at that moment stays "down"
// forever: holding fire and pressing Tab left input.shoot true and the
// gun kept firing, and alt-tabbing while holding W kept the player walking.
// Toggle state (aimToggled) is deliberately preserved -- it is not a
// held key and should survive the menu.
function releaseHeldInput(){
    input.forward=false; input.backward=false; input.left=false; input.right=false;
    input.jump=false;    input.sprint=false;   input.crouch=false;
    input.shoot=false;   input.reload=false;   input.aim=false;
    input.swapWeapon=false; input.pickupWeapon=false; input.interact=false;
    input.gpShoot=false; input.gpAim=false; input.gpCrouch=false;
    input.gpSprint=false; input.gpReload=false; input.gpJumpHeld=false;
    input.gpSwapWeapon=false; input.gpPickupWeapon=false;
    input.moveX=0; input.moveY=0; input.lookX=0; input.lookY=0;
    // Drop any in-progress charge so releasing later cannot fire a shot
    // the player never asked for.
    if (typeof playerWeapons !== "undefined") {
        for (var i=0;i<playerWeapons.length;i++){ playerWeapons[i].chargeStartTime = 0; }
    }
    if (typeof player !== "undefined") { player.wasShooting = false; }
}

function DetectMouseMove(e){
    var sens = input.aimToggled ? mouseAdsSensitivity : mouseSensitivity;
    camera.angle=(camera.angle-e.movementX*sens)%(2*Math.PI);
    if(camera.angle<0)camera.angle+=2*Math.PI;
    camera.horizon=Math.max(-400,Math.min(600,camera.horizon-e.movementY*(sens*100)));
}

function DetectMouseWheel(e){
    // Only handle zoom when ADS with sniper scope
    var currentSlot = playerWeapons[currentWeaponIndex];
    var currentWeapon = weapons[currentSlot.type];
    if(input.aimToggled && currentWeapon.useScope && activeScope){
        e.preventDefault();
        activeScope.handleZoom(e.deltaY);
    }
}
