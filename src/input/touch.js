// ===============================
// Touch Controls for Mobile
// ===============================
"use strict";

// Landscape phone/tablet layout. Portrait keeps its own layout (and SWAP)
// until it gets its own pass.
function isTouchLandscape() {
    return touchControls.enabled && window.innerWidth >= window.innerHeight;
}

// A stick only grabs a touch that STARTS on its ring (plus a little slack for
// thumbs). Once grabbed it follows that finger anywhere until it lifts, so
// sliding off the ring keeps steering instead of dropping out.
var STICK_GRAB_SLACK = 1.2;
function _grabStick(stick, pos, touch) {
    if (stick.active) return false;
    var r = touchControls.stickRadius * STICK_GRAB_SLACK;
    if (Math.hypot(touch.clientX - pos.x, touch.clientY - pos.y) > r) return false;
    stick.active   = true;
    stick.touchId  = touch.identifier;
    stick.startX   = pos.x;
    stick.startY   = pos.y;
    stick.currentX = touch.clientX;
    stick.currentY = touch.clientY;
    return true;
}

function enableTouchControls() {
    touchControls.enabled = true;
    updateTouchControlPositions();
}

function updateTouchControlPositions() {
    var sw = window.innerWidth;
    var sh = window.innerHeight;
    var r  = touchControls.stickRadius;
    var isPortrait = sw < sh;

    if (isPortrait) {
        // Portrait: game view fills top ~55%, controls in bottom ~45%
        var ctrlTop = Math.floor(sh * 0.55);
        var ctrlH   = sh - ctrlTop;
        var ctrlMid = ctrlTop + Math.floor(ctrlH / 2);
        touchControls.controlsTop = ctrlTop;

        // MOVE stick: left side of controls area, vertically centered
        touchControls.leftStickPos  = { x: r + 35, y: ctrlMid - 20 };
        // LOOK stick: right side of controls area, upper portion
        touchControls.rightStickPos = { x: sw - r - 35, y: ctrlTop + Math.floor(ctrlH * 0.35) };

        // Right-side action buttons (right thumb):
        touchControls.shootButton.x = sw - 75;
        touchControls.shootButton.y = sh - 85;
        touchControls.zoomButton.x  = sw - 75;
        touchControls.zoomButton.y  = sh - 195;
        touchControls.jumpButton.x  = sw - 185;
        touchControls.jumpButton.y  = sh - 85;

        // SWAP: left side, above move stick
        touchControls.swapButton.x  = r + 35;
        touchControls.swapButton.y  = ctrlTop + 40;

    } else {
        // Landscape: controls span full screen bottom
        touchControls.controlsTop = 0;

        touchControls.leftStickPos  = { x: r + 35, y: sh - r - 80 };
        touchControls.rightStickPos = { x: sw - r - 35, y: sh - r - 30 };  // moved down

        // ADS sits just under the (touch-size) minimap, FIRE under ADS,
        // both clear of the LOOK ring below.
        touchControls.shootButton.x = sw - 80;
        touchControls.shootButton.y = sh - 175;
        touchControls.zoomButton.x  = sw - 80;
        touchControls.zoomButton.y  = sh - 250;
        touchControls.jumpButton.x  = sw - 190;
        touchControls.jumpButton.y  = sh - 100;
        touchControls.swapButton.x  = r + 35 + 115;
        touchControls.swapButton.y  = sh - 80;
    }

    touchControls.shootButton.radius = 32;  // smaller (was 45)
    touchControls.jumpButton.radius  = 32;
    touchControls.zoomButton.radius  = 32;
    touchControls.swapButton.radius  = 28;
}

function handleTouchStart(e) {
    e.preventDefault();
    if (!touchControls.enabled) enableTouchControls();

    for (var i = 0; i < e.changedTouches.length; i++) {
        var touch = e.changedTouches[i];
        var x = touch.clientX;
        var y = touch.clientY;

        // Weapon slot touches
        for (var j = 0; j < touchControls.weaponSlots.length; j++) {
            var slot = touchControls.weaponSlots[j];
            if (x >= slot.x && x <= slot.x + slot.w && y >= slot.y && y <= slot.y + slot.h) {
                if (slot.index !== currentWeaponIndex) {
                    currentWeaponIndex = slot.index;
                }
                return;
            }
        }

        // Pickup hitbox
        if (touchControls.pickupHitbox && nearbyWeapon) {
            var ph = touchControls.pickupHitbox;
            if (x >= ph.x && x <= ph.x + ph.w && y >= ph.y && y <= ph.y + ph.h) {
                input.pickupWeapon = true;
                setTimeout(function() { input.pickupWeapon = false; }, 100);
                return;
            }
        }

        // FIRE
        var sb = touchControls.shootButton;
        if (Math.hypot(x - sb.x, y - sb.y) < sb.radius) {
            sb.active = true; sb.touchId = touch.identifier;
            input.shoot = true;
            continue;
        }

        // JUMP (hold to charge)
        var jb = touchControls.jumpButton;
        if (Math.hypot(x - jb.x, y - jb.y) < jb.radius) {
            jb.active = true; jb.touchId = touch.identifier;
            input.jump = true;
            continue;
        }

        // ZOOM / ADS toggle
        var zb = touchControls.zoomButton;
        if (Math.hypot(x - zb.x, y - zb.y) < zb.radius) {
            zb.active = true; zb.touchId = touch.identifier;
            input.aimToggled = !input.aimToggled;
            if(typeof setEditMode==='function') setEditMode(input.aimToggled ? 'ads' : 'hip');
            continue;
        }

        // SWAP WEAPON (portrait only -- landscape taps the weapon squares)
        var wb = touchControls.swapButton;
        if (!isTouchLandscape() && Math.hypot(x - wb.x, y - wb.y) < wb.radius) {
            wb.active = true; wb.touchId = touch.identifier;
            input.swapWeapon = true;
            continue;
        }

        // MOVE / LOOK sticks: fixed rings, grabbed only by a touch that
        // starts on the ring.
        if (_grabStick(touchControls.leftStick, touchControls.leftStickPos, touch)) continue;
        _grabStick(touchControls.rightStick, touchControls.rightStickPos, touch);
    }
}

function handleTouchMove(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
        var touch = e.changedTouches[i];
        if (touchControls.leftStick.active && touch.identifier === touchControls.leftStick.touchId) {
            touchControls.leftStick.currentX = touch.clientX;
            touchControls.leftStick.currentY = touch.clientY;
        }
        if (touchControls.rightStick.active && touch.identifier === touchControls.rightStick.touchId) {
            touchControls.rightStick.currentX = touch.clientX;
            touchControls.rightStick.currentY = touch.clientY;
        }
    }
}

function handleTouchEnd(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
        var touch = e.changedTouches[i];

        if (touchControls.leftStick.touchId === touch.identifier) {
            touchControls.leftStick.active  = false;
            touchControls.leftStick.touchId = null;
            input.moveX = 0; input.moveY = 0;
        }
        if (touchControls.rightStick.touchId === touch.identifier) {
            touchControls.rightStick.active  = false;
            touchControls.rightStick.touchId = null;
        }
        if (touchControls.shootButton.touchId === touch.identifier) {
            touchControls.shootButton.active  = false;
            touchControls.shootButton.touchId = null;
            input.shoot = false;
        }
        if (touchControls.jumpButton.touchId === touch.identifier) {
            touchControls.jumpButton.active  = false;
            touchControls.jumpButton.touchId = null;
            input.jump = false;
        }
        if (touchControls.zoomButton.touchId === touch.identifier) {
            touchControls.zoomButton.active  = false;
            touchControls.zoomButton.touchId = null;
        }
        if (touchControls.swapButton.touchId === touch.identifier) {
            touchControls.swapButton.active  = false;
            touchControls.swapButton.touchId = null;
        }
    }
}

function updateTouchInput() {
    if (!touchControls.enabled) return;

    var ls = touchControls.leftStick;
    var rs = touchControls.rightStick;
    var r  = touchControls.stickRadius;
    var dz = touchControls.stickDeadzone;

    // Left stick (MOVE): displacement from fixed center → move direction + magnitude
    if (ls.active) {
        var dx = ls.currentX - ls.startX;
        var dy = ls.currentY - ls.startY;
        var dist = Math.hypot(dx, dy);
        if (dist > dz) {
            var norm = Math.min(dist, r) / r;
            input.moveX = (dx / dist) * norm;
            input.moveY = (dy / dist) * norm;
        } else {
            input.moveX = 0;
            input.moveY = 0;
        }
    }

    // Right stick (LOOK): velocity-based — displacement from fixed center = turn speed.
    // Finger held still at any offset keeps turning at constant speed (no start reset).
    if (rs.active) {
        var dx = rs.currentX - rs.startX;
        var dy = rs.currentY - rs.startY;
        var dist = Math.hypot(dx, dy);
        if (dist > dz) {
            var norm = Math.min(dist, r) / r;  // 0 (center) → 1 (edge)
            camera.angle  -= (dx / dist) * norm * 0.05;
            camera.horizon = Math.max(-400, Math.min(600,
                camera.horizon - (dy / dist) * norm * 8));
            // Intentionally NOT resetting startX/Y — continuous turn while held
        }
    }
}
