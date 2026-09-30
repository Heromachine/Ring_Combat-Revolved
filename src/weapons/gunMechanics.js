// ===============================
// Gun Mechanics - Direction and Position Calculations
// ===============================
"use strict";

// Get the gun's forward direction in world space (based on gun rotation + camera angle)
function getGunWorldDirection() {
    var rotX = gunModel.rotationX * Math.PI / 180;
    var rotY = gunModel.rotationY * Math.PI / 180;
    var rotZ = gunModel.rotationZ * Math.PI / 180;

    var cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    var cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    var cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);

    // Gun's forward is +X in model space
    var x = 1, y = 0, z = 0;

    // Apply same rotations as rendering
    var y1 = y * cosX - z * sinX;
    var z1 = y * sinX + z * cosX;
    var x2 = x * cosY + z1 * sinY;
    var z2 = -x * sinY + z1 * cosY;
    var x3 = x2 * cosZ - y1 * sinZ;
    var y3 = x2 * sinZ + y1 * cosZ;

    // Convert screen-space direction to world-space using camera angle + barrel yaw
    var aimAngle = camera.angle + (gunModel.barrelYaw || 0) * Math.PI / 180;
    var camSin = Math.sin(aimAngle);
    var camCos = Math.cos(aimAngle);

    // World forward is -sin(angle), -cos(angle)
    var worldX = -x3 * camCos - z2 * camSin;
    var worldY = x3 * camSin - z2 * camCos;
    var worldZ = y3;

    // Normalize
    var len = Math.sqrt(worldX*worldX + worldY*worldY + worldZ*worldZ) || 1;
    return { x: worldX/len, y: worldY/len, z: worldZ/len };
}

// Get barrel screen position.
// Hip fire: fixed screen-space anchor (right and down of center) — locked, no parallax.
//   Gun pitch mirrors camera pitch via rotationX in camera.js.
// ADS: barrel locked to screen center (crosshair).
// During the hip→ADS transition, lerps smoothly between the two.
function getBarrelScreenPos() {
    var sw = screendata.canvas.width;
    var sh = screendata.canvas.height;

    // Hip fire: screen-space anchor driven by hipOffsetX/Y sliders (pixel offset from center)
    var hipX = sw / 2 + gunModel.hipOffsetX;
    var hipY = sh / 2 + gunModel.hipOffsetY;

    // ADS target = screen center (crosshair), always locked regardless of look direction
    var t = gunModel.adsLerp;
    return {
        x: hipX + (sw / 2 - hipX) * t,
        y: hipY + (sh / 2 - hipY) * t
    };
}

// Get barrel position in world coordinates (for bullet spawning)
// Option B: barrel tip = gun pivot + gunDir * per-weapon barrel length (from WeaponConfig)
function getBarrelWorldPos() {
    var camSin = Math.sin(camera.angle);
    var camCos = Math.cos(camera.angle);
    var fx = -camSin, fy = -camCos;  // forward (world)
    var rx = camCos, ry = -camSin;   // right (world)

    // Gun pivot position in world (where the gun is held)
    var gunWorldX = camera.x + fx * gunModel.worldForward + rx * gunModel.worldRight;
    var gunWorldY = camera.y + fy * gunModel.worldForward + ry * gunModel.worldRight;
    var gunWorldZ = camera.height - gunModel.worldDown;

    // Gun direction: screen-center for ADS, hip anchor for hip. barrelYaw applies in both modes.
    var gunDirX, gunDirY, gunDirZ;
    var barrelYawRad = (gunModel.barrelYaw || 0) * Math.PI / 180;
    if (gunModel.pivotMode === 'barrel') {
        // ADS: barrel aims toward screen center, plus barrelYaw offset
        var screenCenterY = screendata.canvas.height / 2;
        var screenCenterPitch = Math.atan((camera.horizon - screenCenterY) / camera.focalLength);
        var cosPitch = Math.cos(screenCenterPitch);
        var sinPitch = Math.sin(screenCenterPitch);
        var aimAngle = camera.angle + barrelYawRad;
        gunDirX = -Math.sin(aimAngle) * cosPitch;
        gunDirY = -Math.cos(aimAngle) * cosPitch;
        gunDirZ = sinPitch;
    } else {
        // Hip fire: barrel aims at hip screen anchor, plus barrelYaw offset
        var sw = screendata.canvas.width;
        var sh = screendata.canvas.height;
        var hipX = sw / 2 + gunModel.hipOffsetX;
        var hipY = sh / 2 + gunModel.hipOffsetY;
        var hAngle = Math.atan((hipX - sw / 2) / (sw / 2));
        var hipAimAngle = camera.angle - hAngle + barrelYawRad;
        var hipPitch = Math.atan((camera.horizon - hipY) / camera.focalLength);
        gunDirX = -Math.sin(hipAimAngle) * Math.cos(hipPitch);
        gunDirY = -Math.cos(hipAimAngle) * Math.cos(hipPitch);
        gunDirZ = Math.sin(hipPitch);
    }

    // Barrel tip = pivot + gunDir * per-weapon barrel length
    var totalPlayerHeight = playerHeightOffset / 0.93;
    var weaponDef = WeaponConfig.weapons[playerWeapons[currentWeaponIndex].type] || {};
    var barrelLength = totalPlayerHeight * (weaponDef.barrelScale || 0.1);

    return {
        x: gunWorldX + gunDirX * barrelLength,
        y: gunWorldY + gunDirY * barrelLength,
        z: gunWorldZ + gunDirZ * barrelLength,
        dirX: gunDirX,
        dirY: gunDirY,
        dirZ: gunDirZ
    };
}
