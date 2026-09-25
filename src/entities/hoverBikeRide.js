// Experimental, local hover bike controls. The normal player position broadcast
// still carries the rider, but the bike itself is not server authoritative yet.
"use strict";

var HoverBikeRide = (function () {
    var mounted = false;
    var bound = false;
    var speed = 0;                 // signed world units / second
    var statusUntil = 0;
    var MAX_SPEED = 260;
    var MAX_REVERSE = 75;
    var ACCEL = 145;
    var BRAKE = 210;
    var COAST = 48;
    var MOUNT_RANGE = 48;
    var EYE_ABOVE_GROUND = 29;
    var BIKE_RADIUS = 18;

    function isMounted() { return mounted; }

    function nearBike() {
        return (typeof _loopActive === 'undefined' || _loopActive) &&
            !hoverBike.destroyed && hoverBike.loaded && player.health > 0 &&
            Math.hypot(camera.x - hoverBike.x, camera.y - hoverBike.y) <= MOUNT_RANGE &&
            Math.abs(camera.height - playerHeightOffset -
                getRawTerrainHeight(hoverBike.x, hoverBike.y)) < 40;
    }

    function uiBlocked() {
        var quest = document.getElementById('dialog-box');
        var node = document.getElementById('nw-confirm');
        return (typeof InGameMenu !== 'undefined' && InGameMenu.isOpen()) ||
            (quest && quest.style.display === 'flex') ||
            (node && node.style.display === 'flex');
    }

    function blocked(x, y) {
        var half = cube.size / 2 + BIKE_RADIUS;
        if (Math.abs(x - cube.x) < half && Math.abs(y - cube.y) < half) return true;
        if (typeof buildings !== 'undefined') {
            for (var i = 0; i < buildings.length; i++) {
                var b = buildings[i];
                if (Math.abs(x - b.x) < b.width / 2 + BIKE_RADIUS &&
                    Math.abs(y - b.y) < b.depth / 2 + BIKE_RADIUS) return true;
            }
        }
        if (typeof ringWorld !== 'undefined' && ringWorld.enabled &&
            typeof WorldGen !== 'undefined' && WorldGen.config.edgeWall) {
            if (Math.abs(x) > WorldGen.config.bandHalfWidth - WorldGen.config.wallRamp - BIKE_RADIUS) return true;
        }
        return false;
    }

    function placeRider() {
        camera.x = hoverBike.x;
        camera.y = hoverBike.y;
        camera.height = getRawTerrainHeight(hoverBike.x, hoverBike.y) + EYE_ABOVE_GROUND;
        camera.angle = hoverBike.yaw;
        camera.velocityY = 0;
        camera.adsOffset = 0;
        camera.baseX = camera.x;
        camera.baseY = camera.y;
        camera.focalLength = camera.baseFocalLength;
    }

    function mount() {
        if (!nearBike() || uiBlocked()) return;
        mounted = true;
        speed = 0;
        hoverBike.yaw = hoverBike.yaw || 0;
        input.aimToggled = false;
        player.isChargingJump = false;
        player.jumpChargeTime = 0;
        placeRider();
        time = Date.now();
    }

    function dismount() {
        if (!mounted) return;
        mounted = false;
        speed = 0;
        var sideX = Math.cos(hoverBike.yaw), sideY = -Math.sin(hoverBike.yaw);
        var distance = BIKE_RADIUS + PLAYER_RADIUS + 8;
        var x = hoverBike.x + sideX * distance, y = hoverBike.y + sideY * distance;
        if (blocked(x, y)) { x = hoverBike.x - sideX * distance; y = hoverBike.y - sideY * distance; }
        if (blocked(x, y)) { x = hoverBike.x; y = hoverBike.y; }
        camera.x = x;
        camera.y = y;
        camera.height = getGroundHeight(x, y);
        camera.velocityY = 0;
        camera.baseX = x;
        camera.baseY = y;
        time = Date.now();
    }

    function destroy() {
        mounted = false;
        speed = 0;
        hoverBike.destroyed = true;
        camera.height = getGroundHeight(camera.x, camera.y);
        camera.velocityY = 0;
        statusUntil = Date.now() + 4500;
    }

    function reset() {
        mounted = false;
        speed = 0;
        statusUntil = 0;
        hoverBike.x = cube.x + cube.size / 2 + 34;
        hoverBike.y = cube.y;
        hoverBike.yaw = 0;
        hoverBike.destroyed = false;
    }

    function update(dt) {
        if (!mounted) return;
        dt = Math.max(0, Math.min(0.05, dt));
        var throttle = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
        var steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        if (Math.abs(input.moveY) > Math.abs(throttle)) throttle = -input.moveY;
        if (Math.abs(input.moveX) > Math.abs(steer)) steer = input.moveX;

        if (throttle > 0) {
            speed = Math.min(MAX_SPEED, speed + (speed < 0 ? BRAKE : ACCEL) * throttle * dt);
        } else if (throttle < 0) {
            speed = Math.max(-MAX_REVERSE, speed + (speed > 0 ? BRAKE : ACCEL * 0.7) * throttle * dt);
        } else {
            speed -= Math.sign(speed) * Math.min(Math.abs(speed), COAST * dt);
        }

        // The steering rate falls with speed, giving a wide high-speed turn.
        var speedRatio = Math.min(1, Math.abs(speed) / MAX_SPEED);
        if (Math.abs(speed) > 3) {
            var turnRate = 1.8 * (1 - 0.72 * speedRatio);
            hoverBike.yaw -= steer * turnRate * dt * Math.sign(speed);
        }

        var fx = -Math.sin(hoverBike.yaw), fy = -Math.cos(hoverBike.yaw);
        var travelSign = Math.sign(speed) || 1;
        var look = 18;
        var currentGround = getRawTerrainHeight(hoverBike.x, hoverBike.y);
        var aheadGround = getRawTerrainHeight(hoverBike.x + fx * look * travelSign,
                                              hoverBike.y + fy * look * travelSign);
        var grade = Math.abs(aheadGround - currentGround) / look;
        // tan(45 degrees) = 1. A full-speed impact destroys the vehicle.
        if (grade > 1 && Math.abs(speed) >= MAX_SPEED * 0.95) {
            destroy();
            return;
        }
        if (grade > 1) speed = 0; // approach steep ground slowly and stop
        else if (grade > 0.3) speed *= Math.max(0.65, 1 - (grade - 0.3) * dt);

        // Short steps keep collision checks from skipping through the box.
        var distance = speed * dt;
        var count = Math.max(1, Math.ceil(Math.abs(distance) / 5));
        for (var i = 0; i < count; i++) {
            var nx = hoverBike.x + fx * distance / count;
            var ny = hoverBike.y + fy * distance / count;
            if (typeof ringWorld !== 'undefined' && ringWorld.enabled) ny = ringWrapY(ny);
            if (blocked(nx, ny)) { speed = 0; break; }
            hoverBike.x = nx;
            hoverBike.y = ny;
        }
        placeRider();
        playerSprite.lastX = camera.x;
        playerSprite.lastY = camera.y;
    }

    function updatePrompt() {
        var prompt = document.getElementById('bike-prompt');
        var status = document.getElementById('bike-status');
        if (!prompt || !status) return;
        var showPrompt = mounted || (nearBike() && !uiBlocked());
        prompt.style.display = showPrompt ? 'block' : 'none';
        if (showPrompt) prompt.textContent = mounted ? '[F / A] Dismount' : '[F / A] Ride Hover Bike';
        var crashed = !mounted && hoverBike.destroyed && Date.now() < statusUntil;
        status.style.display = mounted || crashed ? 'block' : 'none';
        if (mounted) status.textContent = 'HOVER BIKE  ' + Math.round(Math.abs(speed)) + ' / ' + MAX_SPEED +
            ' WU/s  |  LEFT STICK / WASD: DRIVE';
        else if (crashed) status.textContent = 'HOVER BIKE DESTROYED — STEEP SLOPE IMPACT';
    }

    function init() {
        if (bound) return;
        bound = true;
        document.addEventListener('keydown', function (e) {
            if (e.repeat || e.code !== 'KeyF') return;
            if (mounted) {
                e.preventDefault(); e.stopImmediatePropagation();
                dismount();
            } else if (nearBike() && !uiBlocked()) {
                e.preventDefault(); e.stopImmediatePropagation();
                mount();
            }
        }, true);
    }

    return { init: init, reset: reset, isMounted: isMounted, update: update,
             updatePrompt: updatePrompt, dismount: dismount };
})();
