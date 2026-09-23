// ===============================
// Gamepad Support
// ===============================
"use strict";

function pollGamepad(){
    var gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    var gp = null;

    // Find first connected gamepad
    for(var i = 0; i < gamepads.length; i++){
        if(gamepads[i] && gamepads[i].connected){
            gp = gamepads[i];
            break;
        }
    }

    if(!gp){
        gamepad.connected = false;
        input.moveX = 0;
        input.moveY = 0;
        input.lookX = 0;
        input.lookY = 0;
        input.gpShoot = false;
        input.gpAim = false;
        input.gpCrouch = false;
        input.gpSprint = false;
        input.gpReload = false;
        input.gpJumpHeld = false;
        return;
    }

    gamepad.connected = true;
    var dz = gamepad.deadzone;

    // Apply deadzone to axes
    function applyDeadzone(val){
        if(Math.abs(val) < dz) return 0;
        return (val - Math.sign(val) * dz) / (1 - dz);
    }

    // Movement (Left Stick)
    input.moveX = applyDeadzone(gp.axes[gamepad.axes.moveX] || 0);
    input.moveY = applyDeadzone(gp.axes[gamepad.axes.moveY] || 0);

    // Look (Right Stick)
    input.lookX = applyDeadzone(gp.axes[gamepad.axes.lookX] || 0);
    input.lookY = applyDeadzone(gp.axes[gamepad.axes.lookY] || 0);

    // Buttons - read directly from gamepad
    var btn = gp.buttons;

    // Helper to check if a gamepad button is pressed
    function isPressed(btnIndex){
        return btn[btnIndex] && (btn[btnIndex].pressed || btn[btnIndex].value > 0.5);
    }

    // Read current gamepad button states
    var gpJump = isPressed(gamepad.buttons.jump);
    var gpCrouch = isPressed(gamepad.buttons.crouch);
    var gpReload = isPressed(gamepad.buttons.reload);
    var gpSprint = isPressed(gamepad.buttons.sprint);
    var gpShoot = isPressed(gamepad.buttons.shoot);
    var gpAim = isPressed(gamepad.buttons.aim);

    // Jump - track held state for charged jump (jump on RELEASE)
    input.gpJumpHeld = gpJump;

    // These are held buttons - directly set state from gamepad
    input.gpCrouch = gpCrouch;
    input.gpSprint = gpSprint;
    input.gpShoot = gpShoot;
    input.gpReload = gpReload;

    // ADS toggle for gamepad (edge detection: toggle on press)
    if(gpAim && !input.prevGpAim){
        input.aimToggled = !input.aimToggled;
        if(typeof setEditMode==='function') setEditMode(input.aimToggled ? 'ads' : 'hip');
    }
    input.prevGpAim = gpAim;

    // Start button - open the in-game menu, same as Tab on keyboard
    // (edge detection: only on press). Previously called toggleDebugUI(),
    // which pops the admin-only controls/debug panel -- unlike its keyboard
    // equivalent (ESC, keyboard.js case 27), that call had no isAdmin guard,
    // so any gamepad player could open admin-only UI. toggleDebugUI() is
    // left defined below in case it is wired to a real admin-gated control
    // later; it is just no longer reachable from Start.
    var gpStart = isPressed(gamepad.buttons.start);
    if(gpStart && !gamepad.prevStart){
        if (typeof InGameMenu !== 'undefined') InGameMenu.toggle();
    }
    gamepad.prevStart = gpStart;

    // Y button - swap weapons (edge detection)
    var gpSwap = isPressed(gamepad.buttons.swapWeapon);
    input.gpSwapWeapon = gpSwap && !prevSwapButton;
    prevSwapButton = gpSwap;

    // X button for pickup when near a weapon
    input.gpPickupWeapon = isPressed(gamepad.buttons.pickup);

    // A button - "activate"/"accept": same action as the keyboard F key
    // (talk to an NPC's quest dialog, open a Node War node/Mainframe
    // confirm prompt, advance/accept a quest dialog line).
    // B button - "cancel": same action as the keyboard Escape key (close
    // an open quest dialog or Node War confirm prompt).
    // Both dispatched as real synthetic keydowns rather than calling into
    // QuestManager/NodeWarInteract directly -- both already listen for
    // KeyF/Escape on document and hold all the relevant state (open
    // dialog, current prompt target, etc.) in private closures with no
    // public "press F"/"press Escape" method to call instead. This
    // guarantees A/B always do exactly what F/Escape do, including any
    // future change to either module, with nothing to keep in sync by hand.
    var gpActivate = isPressed(gamepad.buttons.activate);
    if(gpActivate && !gamepad.prevActivate){
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF' }));
    }
    gamepad.prevActivate = gpActivate;

    var gpCancel = isPressed(gamepad.buttons.cancel);
    if(gpCancel && !gamepad.prevCancel){
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    }
    gamepad.prevCancel = gpCancel;

    // RB - toggle flashlight, same as keyboard L.
    var gpFlashlight = isPressed(gamepad.buttons.flashlight);
    if(gpFlashlight && !gamepad.prevFlashlight){
        if (typeof ToggleFlashlight === 'function') ToggleFlashlight();
    }
    gamepad.prevFlashlight = gpFlashlight;
}

function toggleDebugUI(){
    debugUIVisible = !debugUIVisible;
    var display = debugUIVisible ? 'block' : 'none';
    // Hide/show non-gaming UI elements
    var debugElements = ['controls', 'fps', 'info', 'lastbulletpos', 'lastbulletscreen', 'lastbulletdestroyedpos', 'lastbulletdestroyedreason', 'playerposition', 'playerrotation'];
    debugElements.forEach(function(id){
        var el = document.getElementById(id);
        if(el) el.style.display = display;
    });
}
