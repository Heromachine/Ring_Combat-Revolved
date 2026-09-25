// ===============================
// Camera, Physics, and Player Movement
// ===============================
"use strict";

// Physics helpers
var MAX_SLOPE=2;
var PLAYER_RADIUS = 10; // Player collision radius for cube collision
var PUSH_OUT_BUFFER = 5; // Extra buffer to prevent camera clipping on rotation
var isOnGround=()=>camera.height<=getGroundHeight(camera.x,camera.y)+0.1;
// Last frame's settled camera.height, read by buildingRenderer.js to tell
// "was inside the roof last frame" apart from "just jumped above it this
// frame" -- a same-frame check cannot distinguish those once physics has
// already moved camera.height. Must be var-declared (not just assigned):
// this file is strict mode, and an undeclared assignment throws there.
var _cameraHeightPrev = 0;

// Ray-AABB intersection for bullet collision with cube
// Returns {t: distance, hit: {x,y,z}} or null if no hit
// How far the crosshair ray is probed when deciding what you are aiming at.
// Beyond this the shot simply travels parallel to the look direction.
var AIM_MAX_DISTANCE = 2000;
// Terrain march step, in world units. Smaller = more exact aim point on
// ground at the cost of more samples per shot; the hit is then bisected.
var AIM_TERRAIN_STEP = 4;

// Nearest positive intersection distance of a ray with a sphere, or null.
function raySphereT(ox, oy, oz, d, cx, cy, cz, radius) {
    var mx = ox - cx, my = oy - cy, mz = oz - cz;
    var a  = d.x*d.x + d.y*d.y + d.z*d.z;
    var b  = 2 * (mx*d.x + my*d.y + mz*d.z);
    var c  = mx*mx + my*my + mz*mz - radius*radius;
    var disc = b*b - 4*a*c;
    if (disc < 0) return null;
    var sq = Math.sqrt(disc);
    var t1 = (-b - sq) / (2*a);
    var t2 = (-b + sq) / (2*a);
    if (t1 >= 0) return t1;
    if (t2 >= 0) return t2;
    return null;
}

function rayIntersectsCube(rayOrigin, rayDir, segmentLength) {
    var halfSize = cube.size / 2;
    var cubeBaseZ = getRawTerrainHeight(cube.x, cube.y);

    var minX = cube.x - halfSize, maxX = cube.x + halfSize;
    var minY = cube.y - halfSize, maxY = cube.y + halfSize;
    var minZ = cubeBaseZ, maxZ = cubeBaseZ + cube.size;

    var tMin = 0, tMax = segmentLength;

    // X slab
    if (Math.abs(rayDir.x) < 0.0001) {
        if (rayOrigin.x < minX || rayOrigin.x > maxX) return null;
    } else {
        var t1 = (minX - rayOrigin.x) / rayDir.x;
        var t2 = (maxX - rayOrigin.x) / rayDir.x;
        if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
    }

    // Y slab
    if (Math.abs(rayDir.y) < 0.0001) {
        if (rayOrigin.y < minY || rayOrigin.y > maxY) return null;
    } else {
        var t1 = (minY - rayOrigin.y) / rayDir.y;
        var t2 = (maxY - rayOrigin.y) / rayDir.y;
        if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
    }

    // Z slab
    if (Math.abs(rayDir.z) < 0.0001) {
        if (rayOrigin.z < minZ || rayOrigin.z > maxZ) return null;
    } else {
        var t1 = (minZ - rayOrigin.z) / rayDir.z;
        var t2 = (maxZ - rayOrigin.z) / rayDir.z;
        if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
    }

    // Hit found
    return {
        t: tMin,
        hit: {
            x: rayOrigin.x + rayDir.x * tMin,
            y: rayOrigin.y + rayDir.y * tMin,
            z: rayOrigin.z + rayDir.z * tMin
        }
    };
}

// Check if position collides with the cube (AABB collision)
function collidesWithCube(x, y, z) {
    var halfSize = cube.size / 2;
    var cubeBaseZ = getRawTerrainHeight(cube.x, cube.y);
    var cubeTopZ = cubeBaseZ + cube.size;

    // Check X bounds (with player radius)
    if (x + PLAYER_RADIUS < cube.x - halfSize) return false;
    if (x - PLAYER_RADIUS > cube.x + halfSize) return false;

    // Check Y bounds (with player radius)
    if (y + PLAYER_RADIUS < cube.y - halfSize) return false;
    if (y - PLAYER_RADIUS > cube.y + halfSize) return false;

    // Check Z bounds - allow walking on top
    // z is camera.height (player feet position, includes playerHeightOffset)
    // If player's feet are at or above cube top, they're standing ON the cube, not colliding
    var feetZ = z - playerHeightOffset;  // Convert back to raw height
    if (feetZ >= cubeTopZ - 1) return false;  // Standing on top (1 unit tolerance)
    if (feetZ < cubeBaseZ) return false;  // Below cube (shouldn't happen normally)

    return true;  // Collision with cube sides!
}

// Push player away from cube if too close (prevents camera clipping on rotation)
function pushAwayFromCube() {
    var halfSize = cube.size / 2;
    var cubeBaseZ = getRawTerrainHeight(cube.x, cube.y);
    var cubeTopZ = cubeBaseZ + cube.size;
    var feetZ = camera.height - playerHeightOffset;

    // Only push if player is at cube's height level (not on top or below)
    if (feetZ >= cubeTopZ - 1 || feetZ < cubeBaseZ) return;

    // Minimum safe distance from cube center to camera
    var safeDistance = PLAYER_RADIUS + PUSH_OUT_BUFFER;

    // Vector from cube center to camera
    var dx = camera.x - cube.x;
    var dy = camera.y - cube.y;

    // Clamp to cube surface to find closest point on cube
    var clampedX = Math.max(-halfSize, Math.min(halfSize, dx));
    var clampedY = Math.max(-halfSize, Math.min(halfSize, dy));

    // Vector from closest point on cube to camera
    var pushX = dx - clampedX;
    var pushY = dy - clampedY;
    var dist = Math.sqrt(pushX * pushX + pushY * pushY);

    // If camera is inside the cube (dist is 0 or very small), push toward nearest edge
    if (dist < 0.001) {
        // Camera is inside cube bounds - find nearest edge
        var distToLeft = dx + halfSize;
        var distToRight = halfSize - dx;
        var distToBack = dy + halfSize;
        var distToFront = halfSize - dy;

        var minDist = Math.min(distToLeft, distToRight, distToBack, distToFront);

        if (minDist === distToLeft) {
            camera.x = cube.x - halfSize - safeDistance;
        } else if (minDist === distToRight) {
            camera.x = cube.x + halfSize + safeDistance;
        } else if (minDist === distToBack) {
            camera.y = cube.y - halfSize - safeDistance;
        } else {
            camera.y = cube.y + halfSize + safeDistance;
        }
    } else if (dist < safeDistance) {
        // Camera is too close to cube surface - push outward
        var pushAmount = safeDistance - dist;
        var normX = pushX / dist;
        var normY = pushY / dist;
        camera.x += normX * pushAmount;
        camera.y += normY * pushAmount;
    }
}

var canMoveTo=(nx,ny)=>{
    // Check cube collision first
    var playerZ = camera.height;
    if (collidesWithCube(nx, ny, playerZ)) return false;
    if (typeof getBuildingCollision === 'function' && getBuildingCollision(nx, ny)) return false;

    // Original slope checking (only when on ground)
    if(!isOnGround())return true;
    var curH=getGroundHeight(camera.x,camera.y),newH=getGroundHeight(nx,ny);
    if(newH<=curH)return true;
    var horizDist=Math.hypot(nx-camera.x,ny-camera.y);
    if(!horizDist)return true;
    return (newH-curH)/horizDist<=MAX_SLOPE;
};

// Main camera update function - handles movement, jumping, shooting
function UpdateCamera(){
    // Freeze all player actions when dead — wait for server respawn
    if (player.health <= 0) {
        if (typeof HoverBikeRide !== 'undefined' && HoverBikeRide.isMounted()) HoverBikeRide.dismount();
        time = Date.now(); // prevent deltaTime spike on respawn
        return;
    }

    if (typeof HoverBikeRide !== 'undefined' && HoverBikeRide.isMounted()) {
        var rideNow = Date.now();
        HoverBikeRide.update((rideNow - time) / 1000);
        time = rideNow;
        document.getElementById('shieldinner').style.width = (player.shield / player.maxShield * 100) + '%';
        document.getElementById('health').style.width = player.health + '%';
        return;
    }

    var current=Date.now(),deltaTime=(current-time)*0.03,
        isSprinting = input.sprint || input.gpSprint,
        baseSpeed=player.moveSpeed*(isSprinting?player.sprintMultiplier:1)*deltaTime,nx,ny,slopeMult;

    // Gamepad look (Right Stick)
    if(input.lookX !== 0 || input.lookY !== 0){
        var gpSens = input.aimToggled ? gamepad.adsLookSensitivity : gamepad.lookSensitivity;
        camera.angle = (camera.angle - input.lookX * gpSens) % (2 * Math.PI);
        if(camera.angle < 0) camera.angle += 2 * Math.PI;
        camera.horizon = Math.max(-400, Math.min(600, camera.horizon - input.lookY * gpSens * 100));
    }

    // Push player away from cube if too close (prevents camera clipping on rotation)
    pushAwayFromCube();

    // Keyboard Movement
    if(input.forward){nx=camera.x-Math.sin(camera.angle)*baseSpeed;ny=camera.y-Math.cos(camera.angle)*baseSpeed;slopeMult=canMoveTo(nx,ny);camera.x+=(nx-camera.x)*slopeMult;camera.y+=(ny-camera.y)*slopeMult;}
    if(input.backward){nx=camera.x+Math.sin(camera.angle)*baseSpeed;ny=camera.y+Math.cos(camera.angle)*baseSpeed;slopeMult=canMoveTo(nx,ny);camera.x+=(nx-camera.x)*slopeMult;camera.y+=(ny-camera.y)*slopeMult;}
    if(input.left){nx=camera.x-Math.cos(camera.angle)*baseSpeed;ny=camera.y+Math.sin(camera.angle)*baseSpeed;slopeMult=canMoveTo(nx,ny);camera.x+=(nx-camera.x)*slopeMult;camera.y+=(ny-camera.y)*slopeMult;}
    if(input.right){nx=camera.x+Math.cos(camera.angle)*baseSpeed;ny=camera.y-Math.sin(camera.angle)*baseSpeed;slopeMult=canMoveTo(nx,ny);camera.x+=(nx-camera.x)*slopeMult;camera.y+=(ny-camera.y)*slopeMult;}

    // Gamepad Movement (Left Stick) - analog for smooth control
    if(input.moveX !== 0 || input.moveY !== 0){
        var fx = -Math.sin(camera.angle), fy = -Math.cos(camera.angle); // forward
        var rx = Math.cos(camera.angle), ry = -Math.sin(camera.angle);  // right
        var moveSpeed = baseSpeed * Math.min(1, Math.hypot(input.moveX, input.moveY));

        nx = camera.x + (fx * -input.moveY + rx * input.moveX) * moveSpeed;
        ny = camera.y + (fy * -input.moveY + ry * input.moveX) * moveSpeed;
        slopeMult = canMoveTo(nx, ny);
        camera.x += (nx - camera.x) * slopeMult;
        camera.y += (ny - camera.y) * slopeMult;
    }

    // ---- RING: the band has hard edges ----
    // A slope barrier is not enough. canMoveTo() begins with
    //     if (!isOnGround()) return true;
    // so every slope check is skipped while airborne -- you could jump at the
    // rim, move freely mid-air, land on top of the wall and walk out across
    // the plateau beyond. This clamp is positional, so it holds whether the
    // player is grounded, jumping or falling.
    if (typeof ringWorld !== 'undefined' && ringWorld.enabled &&
        typeof WorldGen !== 'undefined' && WorldGen.config.edgeWall) {
        var _lim = WorldGen.config.bandHalfWidth - WorldGen.config.wallRamp;
        if (camera.x >  _lim) camera.x =  _lim;
        else if (camera.x < -_lim) camera.x = -_lim;
    }

    // ---- RING: close the loop ----
    // This single line is what makes the ring WALKABLE rather than a visual
    // effect. Walk far enough along Y and you arrive back where you started.
    // Terrain lookups stay correct because ringLength is an exact multiple of
    // the heightmap's 1024 wrap (57,344 = 56 x 1024).
    if (typeof ringWorld !== 'undefined' && ringWorld.enabled) {
        camera.y = ringWrapY(camera.y);
    }

    // Advance sprite sheet animation based on movement distance
    var spDx = camera.x - playerSprite.lastX;
    var spDy = camera.y - playerSprite.lastY;
    // Crossing the seam makes the raw delta a full ring-length. Measure the
    // wrapped delta instead, or the walk animation lurches once per lap.
    if (typeof ringWorld !== 'undefined' && ringWorld.enabled) {
        spDy = ringWrapY(spDy);
    }
    var distMoved = Math.sqrt(spDx * spDx + spDy * spDy);
    if (distMoved > 0.01) {
        playerSprite.distAccum += distMoved;
        if (playerSprite.distAccum >= playerSprite.animSpeed) {
            // Cycle through walkStart..walkEnd only
            var f = playerSprite.currentFrame + 1;
            if (f < playerSprite.walkStart || f > playerSprite.walkEnd) f = playerSprite.walkStart;
            playerSprite.currentFrame = f;
            playerSprite.distAccum -= playerSprite.animSpeed;
        }
    } else {
        // Player stopped — reset to idle frame
        playerSprite.currentFrame = playerSprite.idleFrame;
        playerSprite.distAccum = 0;
    }
    playerSprite.lastX = camera.x;
    playerSprite.lastY = camera.y;

    camera.velocityY-=0.5*deltaTime;camera.height+=camera.velocityY*deltaTime;

    // Ceiling clamp: a building roof stops upward motion from inside, the
    // same way the ground stops downward motion below. Must run before the
    // ground clamp reads groundHeight, since standing exactly at a clamped
    // ceiling with camera.height an epsilon above the roof line would
    // otherwise sometimes read as "on the roof" for one frame.
    //
    // getBuildingCeiling/getBuildingRoofGround read _cameraHeightPrev
    // (declared at module scope above) rather than taking a parameter, so
    // groundAt's many other callers (minimap, item placement, mapLoader)
    // don't need to know it exists. It still holds LAST frame's final
    // height at this point -- only updated at the very end of this function,
    // after physics and both clamps have settled this frame's real height.
    if (typeof getBuildingCeiling === 'function') {
        var _ceilH = getBuildingCeiling(camera.x, camera.y);
        if (camera.height > _ceilH) {
            camera.height = _ceilH;
            if (camera.velocityY > 0) camera.velocityY = 0;
        }
    }

    // Ground clamping FIRST - ensures consistent state for jump check
    var groundHeight=getGroundHeight(camera.x,camera.y);
    var wasInAir = camera.height > groundHeight + 1; // track if falling
    if(camera.height < groundHeight){
        camera.height = groundHeight;
        camera.velocityY = 0;
    }

    _cameraHeightPrev = camera.height;

    // Crouch handling
    var isCrouching = input.crouch || input.gpCrouch;
    if(isCrouching){if(!player.isCrouching){player.isCrouching=true;}}
    else if(player.isCrouching){player.isCrouching=false;}

    // Charged jump system - hold to charge, release to jump
    var jumpHeld = input.jump || input.gpJumpHeld;
    var jumpBar = document.getElementById('jumpbar');
    var jumpCharge = document.getElementById('jumpcharge');
    // More forgiving ground check: within 2 units of ground and not moving up fast
    var onGround = (camera.height <= groundHeight + 2) && (camera.velocityY <= 0.5);

    if(jumpHeld){
        // Button is held
        if(onGround && !player.isChargingJump){
            // Just started pressing while on ground - begin charging
            player.isChargingJump = true;
            player.jumpChargeTime = 0;
        }

        if(player.isChargingJump){
            // Continue charging (don't require ground check each frame)
            player.jumpChargeTime = Math.min(player.jumpChargeTime + (current - time), player.jumpMaxChargeTime);

            // Show and update charge bar
            if(jumpBar) jumpBar.style.display = 'block';
            if(jumpCharge){
                var chargePercent = (player.jumpChargeTime / player.jumpMaxChargeTime) * 100;
                jumpCharge.style.width = chargePercent + '%';
            }
        }
    } else {
        // Button released
        if(player.isChargingJump){
            // Was charging - JUMP!
            var chargeRatio = player.jumpChargeTime / player.jumpMaxChargeTime;
            var jumpStrength = player.jumpMinStrength + (player.jumpMaxStrength - player.jumpMinStrength) * chargeRatio;
            camera.velocityY = jumpStrength;
        }

        // Reset charge state
        player.isChargingJump = false;
        player.jumpChargeTime = 0;
        if(jumpBar) jumpBar.style.display = 'none';
        if(jumpCharge) jumpCharge.style.width = '0%';
    }

    // Weapon swap (Q key or Y button)
    var wantSwap = input.swapWeapon || input.gpSwapWeapon;
    if(wantSwap && !player.wasSwapping){
        currentWeaponIndex = (currentWeaponIndex + 1) % 2;
    }
    player.wasSwapping = wantSwap;
    input.swapWeapon = false;  // Reset edge-triggered input
    input.gpSwapWeapon = false;

    // Get current weapon info
    var currentSlot = playerWeapons[currentWeaponIndex];
    var currentWeapon = weapons[currentSlot.type];

    // Check for nearby ground weapons (within 15 degrees of view and close enough)
    nearbyWeapon = null;
    var fx = -Math.sin(camera.angle), fy = -Math.cos(camera.angle);
    groundWeapons.forEach(function(gw) {
        var dx = gw.x - camera.x;
        var dy = gw.y - camera.y;
        var dist = Math.hypot(dx, dy);
        if(dist < 50) {  // Within pickup range
            // Check if facing it (within 15 degrees)
            var dot = (dx * fx + dy * fy) / dist;
            if(dot > Math.cos(15 * Math.PI / 180)) {  // cos(15deg) = 0.966
                nearbyWeapon = gw;
            }
        }
    });

    // Pickup weapon (E key or X button when near weapon)
    var wantPickup = input.pickupWeapon || input.gpPickupWeapon;
    if(wantPickup && nearbyWeapon && !player.wasPickingUp){
        // Swap current weapon with ground weapon
        var oldType = currentSlot.type;
        var oldAmmo = currentSlot.ammo;
        currentSlot.type = nearbyWeapon.type;
        currentSlot.ammo = weapons[nearbyWeapon.type].maxMagazine;
        currentSlot.isReloading = false;
        // Put old weapon on ground
        nearbyWeapon.type = oldType;
        nearbyWeapon.ammo = oldAmmo;
    }
    player.wasPickingUp = wantPickup;

    // Shooting - Hip fire or Iron sights (ADS)
    var isShooting = input.shoot || input.gpShoot;
    var isAiming = input.aimToggled;

    // ADS handling - Camera 1 (main) stays normal, scope uses Camera 2
    var fx = -Math.sin(camera.angle);
    var fy = -Math.cos(camera.angle);

    // Update scope camera state (Camera 2 for PiP) - using modular scope system
    if (activeScope) {
        activeScope.updateCamera(isAiming, currentWeapon.useScope);
    }

    // Main camera (Camera 1) - normal ADS behavior, unchanged for scoped weapons
    var adsForwardDistance = currentWeapon.useScope ? 0 : (currentWeapon.adsZoom - 1) * 30;
    var targetOffset = isAiming && !currentWeapon.useScope ? adsForwardDistance : 0;
    camera.adsOffset += (targetOffset - camera.adsOffset) * 0.15;

    // Keep main camera focal length constant
    camera.focalLength = camera.baseFocalLength;

    // Apply offset along look direction for main camera
    camera.baseX = camera.x - fx * camera.adsOffset;
    camera.baseY = camera.y - fy * camera.adsOffset;
    camera.x = camera.baseX + fx * camera.adsOffset;
    camera.y = camera.baseY + fy * camera.adsOffset;

    // Interpolate gun position between hip fire and ADS
    var targetLerp = isAiming ? 1 : 0;
    gunModel.adsLerp += (targetLerp - gunModel.adsLerp) * gunModel.adsLerpSpeed;

    // Lerp helper function
    function lerp(a, b, t) { return a + (b - a) * t; }

    // Update gun mechanics rotation/scale (used by getGunWorldDirection for barrel world pos)
    gunModel.offsetZ = lerp(gunModel.hipOffsetZ, gunModel.adsOffsetZ, gunModel.adsLerp);
    gunModel.scale = lerp(gunModel.hipScale, gunModel.adsScale, gunModel.adsLerp);
    gunModel.rotationX = lerp(gunModel.hipRotationX, gunModel.adsRotationX, gunModel.adsLerp);
    gunModel.rotationY = lerp(gunModel.hipRotationY, gunModel.adsRotationY, gunModel.adsLerp);
    gunModel.rotationZ = lerp(gunModel.hipRotationZ, gunModel.adsRotationZ, gunModel.adsLerp);

    // Update visual gun model (independent from gun mechanics)
    gunViewModel.offsetX = lerp(gunViewModel.hipOffsetX, gunViewModel.adsOffsetX, gunModel.adsLerp);
    gunViewModel.offsetY = lerp(gunViewModel.hipOffsetY, gunViewModel.adsOffsetY, gunModel.adsLerp);
    gunViewModel.offsetZ = lerp(gunViewModel.hipOffsetZ, gunViewModel.adsOffsetZ, gunModel.adsLerp);
    gunViewModel.scale = lerp(gunViewModel.hipScale, gunViewModel.adsScale, gunModel.adsLerp);
    gunViewModel.rotationX = lerp(gunViewModel.hipRotationX, gunViewModel.adsRotationX, gunModel.adsLerp);
    gunViewModel.rotationY = lerp(gunViewModel.hipRotationY, gunViewModel.adsRotationY, gunModel.adsLerp);
    gunViewModel.rotationZ = lerp(gunViewModel.hipRotationZ, gunViewModel.adsRotationZ, gunModel.adsLerp);

    // Update current barrel settings based on interpolation
    gunModel.barrelX = lerp(gunModel.hipBarrelX, gunModel.adsBarrelX, gunModel.adsLerp);
    gunModel.barrelY = lerp(gunModel.hipBarrelY, gunModel.adsBarrelY, gunModel.adsLerp);
    gunModel.barrelZ = lerp(gunModel.hipBarrelZ, gunModel.adsBarrelZ, gunModel.adsLerp);
    gunModel.barrelYaw = lerp(gunModel.hipBarrelYaw, gunModel.adsBarrelYaw, gunModel.adsLerp);

    // Update current world offset based on interpolation
    gunModel.worldForward = lerp(gunModel.hipWorldForward, gunModel.adsWorldForward, gunModel.adsLerp);
    gunModel.worldRight = lerp(gunModel.hipWorldRight, gunModel.adsWorldRight, gunModel.adsLerp);
    gunModel.worldDown = lerp(gunModel.hipWorldDown, gunModel.adsWorldDown, gunModel.adsLerp);

    // Pivot mode: ADS aims at screen center, hip fire uses gun's own rotation
    gunModel.pivotMode = isAiming ? 'barrel' : 'grip';

    // Update crosshair style based on ADS and current weapon
    var crosshair = document.getElementById('crosshair');
    if(crosshair){
        // Hide crosshair when using scope (scope has its own reticle)
        if(isAiming && currentWeapon.useScope){
            crosshair.style.display = 'none';
        } else if(isAiming){
            crosshair.style.display = 'block';
            crosshair.style.borderColor = currentWeapon.color;
            crosshair.style.width = '6px';
            crosshair.style.height = '6px';
            crosshair.style.margin = '-3px 0 0 -3px';
        } else {
            crosshair.style.display = 'block';
            crosshair.style.borderColor = 'white';
            crosshair.style.width = '10px';
            crosshair.style.height = '10px';
            crosshair.style.margin = '-5px 0 0 -5px';
        }
    }

    // Check fire mode - semi-auto requires trigger release between shots
    var canShoot = true;
    var wasShootingBefore = player.wasShooting;  // capture before update for edge detection
    if(currentWeapon.fireMode === "semi" && player.wasShooting){
        canShoot = false;
    }
    // Never fire while the in-game menu is open. This is the backstop: even
    // if a held input leaks past releaseHeldInput(), the gun stays silent
    // while the player is in the menu.
    if(typeof InGameMenu !== "undefined" && InGameMenu.isOpen()){
        canShoot = false;
    }
    player.wasShooting = isShooting;

    // Helper: the ray the CROSSHAIR looks down.
    // #crosshair is CSS-pinned to top:50%/left:50% of the container, so it is
    // always the exact screen centre regardless of gun position. Yaw is plain
    // camera.angle; pitch comes from where the horizon sits relative to centre.
    function getCrosshairDir() {
        var scY    = screendata.canvas.height / 2;
        var pitch  = Math.atan((camera.horizon - scY) / camera.focalLength);
        var cosP   = Math.cos(pitch);
        return {
            x: -Math.sin(camera.angle) * cosP,
            y: -Math.cos(camera.angle) * cosP,
            z:  Math.sin(pitch)
        };
    }

    // Helper: what the crosshair is actually pointing AT.
    // Casts from the eye down the crosshair ray and returns the nearest
    // surface it meets -- cube, remote player, test target or terrain. If it
    // meets nothing, returns a point far down the ray so distant shots still
    // travel parallel to where you are looking.
    function getAimPoint() {
        var d    = getCrosshairDir();
        var ox   = camera.x, oy = camera.y, oz = camera.height;
        var best = AIM_MAX_DISTANCE;

        // Cubes
        var ch = rayIntersectsCube({x:ox,y:oy,z:oz}, d, AIM_MAX_DISTANCE);
        if (ch && ch.t < best) best = ch.t;

        // Remote players -- same sphere the bullet collision uses, so the
        // converged ray lands on exactly what the bullet will test against.
        if (typeof Multiplayer !== "undefined" && Multiplayer.isConnected()) {
            var myId  = NakamaClient.getUserId();
            var rpIds = Object.keys(nakamaState.remotePlayers);
            for (var ri = 0; ri < rpIds.length; ri++) {
                var rp = nakamaState.remotePlayers[rpIds[ri]];
                if (!rp || rp.userId === myId || rp.health <= 0) continue;
                var rad  = playerHeightOffset * (25 / 70);
                var midZ = rp.height - playerHeightOffset * (10 / 70);
                var t = raySphereT(ox, oy, oz, d, rp.x, rp.y, midZ, rad);
                if (t !== null && t < best) best = t;
            }
        }

        // Admin test target
        if (testTarget.enabled) {
            var tt = raySphereT(ox, oy, oz, d, testTarget.x, testTarget.y,
                                testTarget.z, testTarget.radius);
            if (tt !== null && tt < best) best = tt;
        }

        // Terrain: march forward and bisect the first step that goes under.
        var prev = 0;
        for (var t2 = AIM_TERRAIN_STEP; t2 <= best; t2 += AIM_TERRAIN_STEP) {
            var px = ox + d.x * t2, py = oy + d.y * t2, pz = oz + d.z * t2;
            if (pz <= getRawTerrainHeight(px, py)) {
                var lo = prev, hi = t2;
                for (var b = 0; b < 8; b++) {
                    var mid = (lo + hi) / 2;
                    var mx = ox + d.x * mid, my = oy + d.y * mid, mz = oz + d.z * mid;
                    if (mz <= getRawTerrainHeight(mx, my)) hi = mid; else lo = mid;
                }
                if (hi < best) best = hi;
                break;
            }
            prev = t2;
        }

        return { x: ox + d.x * best, y: oy + d.y * best, z: oz + d.z * best };
    }

    // Helper: aim direction from a given muzzle position to the crosshair's
    // target point. This is the fix for hip fire shooting low: the bullet used
    // to travel parallel to wherever the GUN MODEL pointed on screen (the hip
    // anchor, offset by gunModel.hipOffsetX/Y), not to where the crosshair was
    // aiming. Now the muzzle is only the origin -- the crosshair decides the
    // direction, so the shot converges on what you are actually looking at.
    // ADS was already correct because pivotMode 'barrel' locks to centre.
    function getAimDir(spawn) {
        var aim = getAimPoint();
        var dx  = aim.x - spawn.x, dy = aim.y - spawn.y, dz = aim.z - spawn.z;
        var mag = Math.hypot(dx, dy, dz);
        if (!mag || !isFinite(mag)) return getCrosshairDir();  // degenerate: fall back
        return { x: dx / mag, y: dy / mag, z: dz / mag };
    }

    // Helper: spawn barrel position
    function getSpawnPos() {
        var bp = getBarrelWorldPos();
        return {
            x: bp.x + bp.dirX * gunModel.barrelDistance,
            y: bp.y + bp.dirY * gunModel.barrelDistance,
            z: bp.z + bp.dirZ * gunModel.barrelDistance
        };
    }

    // Helper: run hitscan tests and return hit position (or null)
    function runHitscan(spawnX, spawnY, spawnZ, rdx, rdy, rdz) {
        var hsHit = null;
        if (hitscanDistance > 0 && !currentWeapon.ccdOnly) {
            var ch = rayIntersectsCube({x:spawnX,y:spawnY,z:spawnZ},{x:rdx,y:rdy,z:rdz},hitscanDistance);
            if (ch) hsHit = {x:ch.hit.x,y:ch.hit.y,z:ch.hit.z,dist:ch.t};
        }
        if (testTarget.enabled && hitscanDistance > 0 && !currentWeapon.ccdOnly) {
            var ocX=spawnX-testTarget.x, ocY=spawnY-testTarget.y, ocZ=spawnZ-testTarget.z;
            var ta=rdx*rdx+rdy*rdy+rdz*rdz;
            var tb=2*(ocX*rdx+ocY*rdy+ocZ*rdz);
            var tc=ocX*ocX+ocY*ocY+ocZ*ocZ-testTarget.radius*testTarget.radius;
            var disc=tb*tb-4*ta*tc;
            if (disc >= 0) {
                var tt=(-tb-Math.sqrt(disc))/(2*ta);
                if (tt < 0) tt=(-tb+Math.sqrt(disc))/(2*ta);
                if (tt >= 0 && tt <= hitscanDistance && (!hsHit || tt < hsHit.dist)) {
                    testTarget.hits++;
                    var hx=spawnX+rdx*tt, hy=spawnY+rdy*tt, hz=spawnZ+rdz*tt;
                    hsHit = {x:hx,y:hy,z:hz,dist:tt};
                    testTarget.bulletHitPos = {
                        x:hx-testTarget.x, y:hy-testTarget.y, z:hz-testTarget.z,
                        dist:Math.sqrt((hx-testTarget.x)**2+(hy-testTarget.y)**2+(hz-testTarget.z)**2)
                    };
                }
            }
        }
        return hsHit;
    }

    // --- Charge weapon (Tracer): fires on trigger RELEASE ---
    // Gated on canShoot as well, because this path fires on RELEASE rather
    // than on press: without the guard, opening the menu mid-charge could
    // still loose a shot.
    if (currentWeapon.fireMode === 'charge' && canShoot) {
        if (isShooting && !wasShootingBefore && !currentSlot.isReloading && currentSlot.ammo > 0) {
            currentSlot.chargeStartTime = current;  // just pressed — begin charging
        }
        if (!isShooting && wasShootingBefore && currentSlot.chargeStartTime && currentSlot.ammo > 0) {
            // Released — fire homing tracer
            var cSpawnForAim = getSpawnPos();
            var cAimDir = getAimDir(cSpawnForAim);
            var cSpd = currentWeapon.bulletSpeed;
            var cMag = Math.hypot(cAimDir.x, cAimDir.y, cAimDir.z) || 1;
            var cdx = (cAimDir.x / cMag) * cSpd;
            var cdy = (cAimDir.y / cMag) * cSpd;
            var cdz = (cAimDir.z / cMag) * cSpd;

            // Find closest target within cone
            var homingTarget = null;
            var coneRange = currentWeapon.coneRange || 300;
            var cosHalfCone = Math.cos(currentWeapon.coneAngle || 0.4);
            if (testTarget.enabled) {
                var ttdx = testTarget.x - camera.x, ttdy = testTarget.y - camera.y, ttdz = testTarget.z - camera.height;
                var ttDist = Math.hypot(ttdx, ttdy, ttdz);
                if (ttDist > 0 && ttDist <= coneRange) {
                    var ttDot = cAimDir.x*(ttdx/ttDist) + cAimDir.y*(ttdy/ttDist) + cAimDir.z*(ttdz/ttDist);
                    if (ttDot >= cosHalfCone) homingTarget = testTarget;
                }
            }

            var cSpawn = cSpawnForAim;
            lastBulletDestroyedPos = null; lastBulletDestroyedReason = null;
            var tracerBullet = {
                type: "bullet",
                x: cSpawn.x, y: cSpawn.y, z: cSpawn.z,
                prevX: cSpawn.x, prevY: cSpawn.y, prevZ: cSpawn.z,
                dx: cdx, dy: cdy, dz: cdz,
                distance: 0,
                image: textures.bullet,
                damage: currentWeapon.damage,
                weaponType: currentSlot.type,   // server looks damage up by this
                hitscanHit: null, stopDistance: null,
                homing: !!homingTarget,
                homingTarget: homingTarget,
                homingSpeed: currentWeapon.homingSpeed || 3
            };
            lastBullet = tracerBullet;
            items.push(tracerBullet);
            if (typeof Multiplayer !== "undefined" && Multiplayer.isConnected()) {
                Multiplayer.sendShoot(cSpawn.x, cSpawn.y, cSpawn.z, cdx, cdy, cdz);
            }
            currentSlot.ammo--;
            currentSlot.lastShot = current;
            currentSlot.chargeStartTime = 0;
        }
        if (!isShooting) currentSlot.chargeStartTime = 0;
    }

    // --- Standard fire (semi, auto, spread/pellets) ---
    if (currentWeapon.fireMode !== 'charge' &&
        isShooting && canShoot && !currentSlot.isReloading && currentSlot.ammo > 0 &&
        current - currentSlot.lastShot > currentWeapon.fireRate) {

        var bulletSpeed = currentWeapon.bulletSpeed;
        var rx = Math.cos(camera.angle), ry = -Math.sin(camera.angle);

        // Spawn first: the aim direction is now measured FROM the muzzle to
        // the crosshair's target point, so it needs the muzzle position.
        var spawn = getSpawnPos();
        var spawnX = spawn.x, spawnY = spawn.y, spawnZ = spawn.z;

        var aimDir = getAimDir(spawn);
        var aimDirX = aimDir.x, aimDirY = aimDir.y, aimDirZ = aimDir.z;

        var weaponSpread = WeaponConfig.getWeaponSpread(currentSlot.type);
        var spread = isAiming ? weaponSpread.adsSpread : weaponSpread.hipSpread;
        lastBulletDestroyedPos = null;
        lastBulletDestroyedReason = null;

        // Pellet loop: shotgun fires multiple, all others fire 1
        var pellets = currentWeapon.pellets || 1;
        lastHitscanRays = []; // clear previous burst
        for (var p = 0; p < pellets; p++) {
            var spreadX = (Math.random() - 0.5) * spread;
            var spreadY = (Math.random() - 0.5) * spread;

            var dirx = aimDirX + rx * spreadX;
            var diry = aimDirY + ry * spreadX;
            var dirz = aimDirZ + spreadY;

            var mag = Math.hypot(dirx, diry, dirz) || 1;
            dirx = (dirx / mag) * bulletSpeed;
            diry = (diry / mag) * bulletSpeed;
            dirz = (dirz / mag) * bulletSpeed;

            var rayDirX = dirx / bulletSpeed;
            var rayDirY = diry / bulletSpeed;
            var rayDirZ = dirz / bulletSpeed;

            var hitscanHitPos = runHitscan(spawnX, spawnY, spawnZ, rayDirX, rayDirY, rayDirZ);

            // Record ray for debug minimap overlay
            if (isAdmin) {
                lastHitscanRays.push({
                    x0: spawnX, y0: spawnY,
                    x1: hitscanHitPos ? hitscanHitPos.x : spawnX + rayDirX * hitscanDistance,
                    y1: hitscanHitPos ? hitscanHitPos.y : spawnY + rayDirY * hitscanDistance,
                    hit: !!hitscanHitPos,
                    time: current
                });
            }

            var bullet = {
                type: "bullet",
                x: spawnX, y: spawnY, z: spawnZ,
                prevX: spawnX, prevY: spawnY, prevZ: spawnZ,
                dx: dirx, dy: diry, dz: dirz,
                distance: 0,
                image: textures.bullet,
                damage: currentWeapon.damage,
                weaponType: currentSlot.type,   // server looks damage up by this
                hitscanHit: hitscanHitPos,
                stopDistance: hitscanHitPos ? hitscanHitPos.dist : null
            };
            lastBullet = bullet;
            items.push(bullet);

            if (typeof Multiplayer !== "undefined" && Multiplayer.isConnected()) {
                Multiplayer.sendShoot(spawnX, spawnY, spawnZ, dirx, diry, dirz);
            }
        }

        currentSlot.ammo--;
        currentSlot.lastShot = current;
    }

    // Reload current weapon (skip for ammoRegen weapons — they refill automatically)
    var isReloading = input.reload || input.gpReload;
    if(isReloading && !currentSlot.isReloading && !currentWeapon.ammoRegen && currentSlot.ammo < currentWeapon.maxMagazine){
        currentSlot.isReloading = true;
        setTimeout(function(){
            currentSlot.ammo = currentWeapon.maxMagazine;
            currentSlot.isReloading = false;
        }, currentWeapon.reloadTime);
    }

    // Ammo regeneration for plasma and tracer weapons
    if (currentWeapon.ammoRegen) {
        if (currentSlot.ammo <= 0) {
            if (!currentSlot.depletedTime) currentSlot.depletedTime = current;
            if (current - currentSlot.depletedTime >= currentWeapon.regenCooldown) {
                currentSlot.ammo = currentWeapon.maxMagazine;
                currentSlot.depletedTime = null;
            }
        } else {
            currentSlot.depletedTime = null;
        }
    }

    // Update moving items (bullets only) - with CCD collision detection
    items = items.filter(it=>{
        if(it.type==="bullet"){
            it.prevX = it.x;
            it.prevY = it.y;
            it.prevZ = it.z;

            // Homing steering (tracer bullets)
            if (it.homing && it.homingTarget) {
                updateHoming3D(it, deltaTime / 30);
            }

            it.x+=it.dx*deltaTime;it.y+=it.dy*deltaTime;it.z+=it.dz*deltaTime;it.distance+=Math.hypot(it.dx,it.dy,it.dz)*deltaTime;

            if (!it.remote && it.hitscanHit && it.distance >= it.stopDistance) {
                if(it===lastBullet){
                    lastBullet=null;
                    lastBulletDestroyedPos={x:it.hitscanHit.x, y:it.hitscanHit.y, z:it.hitscanHit.z};
                    lastBulletDestroyedReason="Hitscan Hit!";
                }
                return false;
            }

            if (!it.remote && testTarget.enabled && !it.hitscanHit) {
                var segDirX = it.x - it.prevX;
                var segDirY = it.y - it.prevY;
                var segDirZ = it.z - it.prevZ;
                var segLen = Math.sqrt(segDirX*segDirX + segDirY*segDirY + segDirZ*segDirZ);

                if (segLen > 0) {
                    var rayDirX = segDirX / segLen;
                    var rayDirY = segDirY / segLen;
                    var rayDirZ = segDirZ / segLen;

                    var ocX = it.prevX - testTarget.x;
                    var ocY = it.prevY - testTarget.y;
                    var ocZ = it.prevZ - testTarget.z;

                    var a = rayDirX*rayDirX + rayDirY*rayDirY + rayDirZ*rayDirZ;
                    var b = 2 * (ocX*rayDirX + ocY*rayDirY + ocZ*rayDirZ);
                    var c = ocX*ocX + ocY*ocY + ocZ*ocZ - testTarget.radius*testTarget.radius;
                    var discriminant = b*b - 4*a*c;

                    if (discriminant >= 0) {
                        var t = (-b - Math.sqrt(discriminant)) / (2*a);
                        if (t < 0) t = (-b + Math.sqrt(discriminant)) / (2*a);

                        if (t >= 0 && t <= segLen) {
                            testTarget.hits++;
                            var hitX = it.prevX + rayDirX * t;
                            var hitY = it.prevY + rayDirY * t;
                            var hitZ = it.prevZ + rayDirZ * t;
                            testTarget.bulletHitPos = {
                                x: hitX - testTarget.x,
                                y: hitY - testTarget.y,
                                z: hitZ - testTarget.z,
                                dist: Math.sqrt((hitX-testTarget.x)**2 + (hitY-testTarget.y)**2 + (hitZ-testTarget.z)**2)
                            };
                            if(it===lastBullet){lastBullet=null;lastBulletDestroyedPos={x:hitX,y:hitY,z:hitZ};lastBulletDestroyedReason="CCD Hit!";}
                            return false;
                        }
                    }

                    var prevDist = Math.sqrt((it.prevX-testTarget.x)**2 + (it.prevY-testTarget.y)**2);
                    var currDist = Math.sqrt((it.x-testTarget.x)**2 + (it.y-testTarget.y)**2);
                    if (it.prevDistToTarget && it.prevDistToTarget < currDist && it.prevDistToTarget < testTarget.radius * 3) {
                        testTarget.misses++;
                    }
                    it.prevDistToTarget = currDist;
                }
            }

            // Enemy collision (sphere check) — single-player only
            if (!it.remote && !Multiplayer.isConnected()) {
                for (var ei = 0; ei < enemies.length; ei++) {
                    var e = enemies[ei];
                    if (e.health <= 0) continue;
                    var edx = it.x - e.x, edy = it.y - e.y, edz = it.z - (e.z + e.hitRadius);
                    if (Math.sqrt(edx*edx + edy*edy + edz*edz) < e.hitRadius) {
                        var dmg = it.damage || 10;
                        var absorbed = Math.min(e.shield, dmg);
                        e.shield = Math.max(0, e.shield - absorbed);
                        e.health = Math.max(0, e.health - (dmg - absorbed));
                        e.lastDamageTime = current;
                        if (it === lastBullet) { lastBullet = null; }
                        return false; // destroy bullet
                    }
                }
            }

            // Remote player collision (sphere check) — multiplayer only
            if (!it.remote && Multiplayer.isConnected()) {
                var myId = NakamaClient.getUserId();
                var rpIds = Object.keys(nakamaState.remotePlayers);
                for (var rpi = 0; rpi < rpIds.length; rpi++) {
                    var rp = nakamaState.remotePlayers[rpIds[rpi]];
                    if (!rp || rp.userId === myId || rp.health <= 0) continue;
                    // Sphere scales with playerHeightOffset (ratios calibrated at 7 WU eye height)
                    var rpHitRadius = playerHeightOffset * (25 / 70);   // ~35% of eye height
                    var rpMidZ = rp.height - playerHeightOffset * (10 / 70); // ~14% below eye level
                    var rpdx = it.x - rp.x, rpdy = it.y - rp.y, rpdz = it.z - rpMidZ;
                    if (Math.sqrt(rpdx*rpdx + rpdy*rpdy + rpdz*rpdz) < rpHitRadius) {
                        Multiplayer.reportHit(rp.userId, it.weaponType);
                        if (it === lastBullet) { lastBullet = null; }
                        return false; // destroy bullet
                    }
                }
            }

            // Cube collision (CCD ray-AABB intersection)
            if (it.remote) {
                var terrainHeight=getRawTerrainHeight(it.x,it.y);
                if(it.z<=terrainHeight) return false;
                if(it.distance>=ccdMaxDistance) return false;
                return true;
            }
            var segDx = it.x - it.prevX;
            var segDy = it.y - it.prevY;
            var segDz = it.z - it.prevZ;
            var segLen = Math.sqrt(segDx*segDx + segDy*segDy + segDz*segDz);
            if (segLen > 0) {
                var cubeHit = rayIntersectsCube(
                    {x: it.prevX, y: it.prevY, z: it.prevZ},
                    {x: segDx/segLen, y: segDy/segLen, z: segDz/segLen},
                    segLen
                );
                if (cubeHit) {
                    if(it===lastBullet){
                        lastBullet=null;
                        lastBulletDestroyedPos = cubeHit.hit;
                        lastBulletDestroyedReason = "Cube Hit!";
                    }
                    return false;
                }
            }

            var terrainHeight=getRawTerrainHeight(it.x,it.y);
            if(it.z<=terrainHeight){if(it===lastBullet){lastBullet=null;lastBulletDestroyedPos={x:it.x,y:it.y,z:it.z};lastBulletDestroyedReason="Terrain Collision";}return false;}

            if(it.distance>=ccdMaxDistance){if(it===lastBullet){lastBullet=null;lastBulletDestroyedPos={x:it.x,y:it.y,z:it.z};lastBulletDestroyedReason="Max Range";}return false;}
        }
        return true;
    });

    // Enemy AI update — single-player only
    if (!Multiplayer.isConnected() && typeof updateEnemies === 'function') updateEnemies(current, deltaTime);

    // Shield regen (5 HP/sec, delayed 4s after last damage) — blocked when dead
    if (player.health > 0 && player.shield < player.maxShield && (current - player.lastDamageTime) >= player.shieldRegenDelay) {
        player.shield = Math.min(player.maxShield, player.shield + player.shieldRegenRate * (deltaTime / 30));
    }

    // HUD updates
    document.getElementById('shieldinner').style.width=(player.shield/player.maxShield*100)+'%';
    document.getElementById('health').style.width=player.health+'%';
    var wepSlot = playerWeapons[currentWeaponIndex];
    var wepDef = weapons[wepSlot.type];
    document.getElementById('debug-bulletcount').innerText=`${wepDef.name}: ${wepSlot.ammo}/${wepDef.maxMagazine}${wepSlot.isReloading ? ' [RELOADING]' : ''}`;
    document.getElementById('debug-playerposition').innerText=`(${camera.x.toFixed(1)}, ${camera.y.toFixed(1)}, ${camera.height.toFixed(1)})`;
    document.getElementById('debug-playerrotation').innerText=`${(camera.angle*180/Math.PI).toFixed(1)}°, ${(camera.horizon*90/500).toFixed(1)}°`;
    document.getElementById('debug-lastbulletpos').innerText=lastBullet?`(${lastBullet.x.toFixed(1)}, ${lastBullet.y.toFixed(1)}, ${lastBullet.z.toFixed(1)})`:`None`;
    document.getElementById('debug-lastbulletscreen').innerText=lastBulletScreen?`(${lastBulletScreen.x.toFixed(0)}, ${lastBulletScreen.y.toFixed(0)}) z:${lastBulletScreen.z.toFixed(1)}`:`None`;
    document.getElementById('debug-lastbulletdestroyedpos').innerText=lastBulletDestroyedPos?`(${lastBulletDestroyedPos.x.toFixed(1)}, ${lastBulletDestroyedPos.y.toFixed(1)}, ${lastBulletDestroyedPos.z.toFixed(1)})`:`None`;
    document.getElementById('debug-lastbulletdestroyedreason').innerText=lastBulletDestroyedReason?`${lastBulletDestroyedReason}`:`None`;

    time=current;
}
