// ===============================
// Settings Manager - Slider bindings and persistence
// ===============================
"use strict";

// Metric label helpers (scale: 1 WU ≈ 30 cm)
function wuLabelM(wu) {
    return wu + ' (' + Math.round(parseFloat(wu) * 0.30) + ' m)';
}
function wuLabelCm(wu) {
    return wu + ' (' + Math.round(parseFloat(wu) * 30) + ' cm)';
}

var savedSettings = null;
var editMode = 'hip';  // 'ads' or 'hip' - which mode we're editing (mirrors input.aimToggled)

// Function to update gun sliders to show current mode's values (visual gunViewModel only)
function updateGunSliders() {
    var prefix = editMode === 'ads' ? 'ads' : 'hip';
    document.getElementById('gunX').value = gunViewModel[prefix + 'OffsetX'];
    document.getElementById('gunX-value').innerText = gunViewModel[prefix + 'OffsetX'];
    document.getElementById('gunY').value = gunViewModel[prefix + 'OffsetY'];
    document.getElementById('gunY-value').innerText = gunViewModel[prefix + 'OffsetY'];
    document.getElementById('gunZ').value = gunViewModel[prefix + 'OffsetZ'];
    document.getElementById('gunZ-value').innerText = gunViewModel[prefix + 'OffsetZ'];
    document.getElementById('gunScale').value = gunViewModel[prefix + 'Scale'];
    document.getElementById('gunScale-value').innerText = gunViewModel[prefix + 'Scale'];
    document.getElementById('gunRotX').value = gunViewModel[prefix + 'RotationX'];
    document.getElementById('gunRotX-value').innerText = gunViewModel[prefix + 'RotationX'];
    document.getElementById('gunRotY').value = gunViewModel[prefix + 'RotationY'];
    document.getElementById('gunRotY-value').innerText = gunViewModel[prefix + 'RotationY'];
    document.getElementById('gunRotZ').value = gunViewModel[prefix + 'RotationZ'];
    document.getElementById('gunRotZ-value').innerText = gunViewModel[prefix + 'RotationZ'];
}

// Function to update barrel sliders to show current mode's values
function updateBarrelSliders() {
    var prefix = editMode === 'ads' ? 'ads' : 'hip';
    document.getElementById('barrelYaw').value = gunModel[prefix + 'BarrelYaw'];
    document.getElementById('barrelYaw-value').innerText = gunModel[prefix + 'BarrelYaw'];
    document.getElementById('barrelX').value = gunModel[prefix + 'BarrelX'];
    document.getElementById('barrelX-value').innerText = gunModel[prefix + 'BarrelX'].toFixed(2);
    document.getElementById('barrelY').value = gunModel[prefix + 'BarrelY'];
    document.getElementById('barrelY-value').innerText = gunModel[prefix + 'BarrelY'].toFixed(2);
    document.getElementById('barrelZ').value = gunModel[prefix + 'BarrelZ'];
    document.getElementById('barrelZ-value').innerText = gunModel[prefix + 'BarrelZ'].toFixed(2);
}

// Function to update world offset sliders to show current mode's values
function updateWorldOffsetSliders() {
    var prefix = editMode === 'ads' ? 'ads' : 'hip';
    document.getElementById('gunWorldFwd').value = gunModel[prefix + 'WorldForward'];
    document.getElementById('gunWorldFwd-value').innerText = gunModel[prefix + 'WorldForward'].toFixed(1);
    document.getElementById('gunWorldRight').value = gunModel[prefix + 'WorldRight'];
    document.getElementById('gunWorldRight-value').innerText = gunModel[prefix + 'WorldRight'].toFixed(1);
    document.getElementById('gunWorldDown').value = gunModel[prefix + 'WorldDown'];
    document.getElementById('gunWorldDown-value').innerText = gunModel[prefix + 'WorldDown'].toFixed(1);
}

// Unified function to set edit mode for both Gun and Barrel tabs
function setEditMode(mode) {
    editMode = mode;
    var isAds = mode === 'ads';
    var activeColor = '#4CAF50';
    var inactiveColor = '#555';
    var labelColor = isAds ? '#4CAF50' : '#ff9800';
    var labelText = isAds ? '[Editing ADS]' : '[Editing Hip]';

    // Update Gun Tab buttons
    document.getElementById('editADS').style.background = isAds ? activeColor : inactiveColor;
    document.getElementById('editHip').style.background = isAds ? inactiveColor : activeColor;
    document.getElementById('editModeLabel').innerText = labelText;
    document.getElementById('editModeLabel').style.color = labelColor;

    // Update Barrel Tab buttons
    document.getElementById('barrelEditADS').style.background = isAds ? activeColor : inactiveColor;
    document.getElementById('barrelEditHip').style.background = isAds ? inactiveColor : activeColor;
    document.getElementById('barrelEditModeLabel').innerText = labelText;
    document.getElementById('barrelEditModeLabel').style.color = labelColor;

    // Update sliders for all tabs
    updateGunSliders();
    updateBarrelSliders();
    updateWorldOffsetSliders();
}

// Setup all sliders and event listeners
function setupSliders() {
    // Tab switching for controls panel
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var tabId = this.getAttribute('data-tab');
            // Hide all tabs
            document.querySelectorAll('.tab-content').forEach(function(tab) {
                tab.style.display = 'none';
            });
            // Deactivate all buttons
            document.querySelectorAll('.tab-btn').forEach(function(b) {
                b.style.background = '#333';
                b.style.color = '#aaa';
            });
            // Show selected tab
            document.getElementById('tab-' + tabId).style.display = 'block';
            // Activate button
            this.style.background = '#555';
            this.style.color = 'white';
        });
    });

    // Scope mode toggle buttons
    document.getElementById('scopeModeForward').addEventListener('click', function() {
        setScopeMode('forward');
    });
    document.getElementById('scopeModeFocal').addEventListener('click', function() {
        setScopeMode('focal');
    });

    // Camera FOV slider
    document.getElementById('fov').addEventListener('input', function(e){
        camera.baseFocalLength = parseInt(e.target.value);
        camera.focalLength = camera.baseFocalLength;
        document.getElementById('fov-value').innerText = camera.baseFocalLength;
    });

    // Pitch offset slider
    document.getElementById('pitchOffset').addEventListener('input', function(e){
        pitchOffset = parseInt(e.target.value);
        document.getElementById('pitchOffset-value').innerText = pitchOffset;
    });

    // Target FPS slider
    document.getElementById('targetFPS').addEventListener('input', function(e){
        targetFPS = parseInt(e.target.value);
        frameDuration = 1000 / targetFPS;
        document.getElementById('targetFPS-value').innerText = targetFPS;
    });

    // Draw distance slider
    document.getElementById('drawDistance').addEventListener('input', function(e){
        camera.distance = parseInt(e.target.value);
        document.getElementById('drawDistance-value').innerText = wuLabelM(camera.distance);
    });

    // Player height slider
    document.getElementById('playerHeight').addEventListener('input', function(e){
        playerHeightOffset = parseInt(e.target.value);
        document.getElementById('playerHeight-value').innerText = wuLabelCm(playerHeightOffset);
    });

    // Standing height slider
    document.getElementById('normalHeight').addEventListener('input', function(e){
        player.normalHeight = parseInt(e.target.value);
        document.getElementById('normalHeight-value').innerText = player.normalHeight;
    });

    // Crouch height slider
    document.getElementById('crouchHeight').addEventListener('input', function(e){
        player.crouchHeight = parseInt(e.target.value);
        document.getElementById('crouchHeight-value').innerText = player.crouchHeight;
    });

    // Jump min strength slider
    document.getElementById('jumpMin').addEventListener('input', function(e){
        player.jumpMinStrength = parseInt(e.target.value);
        document.getElementById('jumpMin-value').innerText = player.jumpMinStrength;
    });

    // Jump max strength slider
    document.getElementById('jumpMax').addEventListener('input', function(e){
        player.jumpMaxStrength = parseInt(e.target.value);
        document.getElementById('jumpMax-value').innerText = player.jumpMaxStrength;
    });

    // Walk speed slider
    document.getElementById('walkSpeed').addEventListener('input', function(e){
        player.moveSpeed = parseFloat(e.target.value);
        document.getElementById('walkSpeed-value').innerText = player.moveSpeed.toFixed(1);
    });

    // Sprint multiplier slider
    document.getElementById('sprintMultiplier').addEventListener('input', function(e){
        player.sprintMultiplier = parseFloat(e.target.value);
        document.getElementById('sprintMultiplier-value').innerText = player.sprintMultiplier.toFixed(1);
    });

    // Bullet size slider
    document.getElementById('bulletSize').addEventListener('input', function(e){
        bulletSize = parseFloat(e.target.value);
        document.getElementById('bulletSize-value').innerText = bulletSize;
    });

    // Barrel distance slider
    document.getElementById('barrelDistance').addEventListener('input', function(e){
        gunModel.barrelDistance = parseInt(e.target.value);
        document.getElementById('barrelDistance-value').innerText = wuLabelCm(gunModel.barrelDistance);
    });

    // Hit Detection sliders
    document.getElementById('hitscanDist').addEventListener('input', function(e){
        hitscanDist = parseInt(e.target.value);
        document.getElementById('hitscanDist-value').innerText = wuLabelM(hitscanDist);
    });
    document.getElementById('ccdMaxDist').addEventListener('input', function(e){
        ccdMaxDist = parseInt(e.target.value);
        document.getElementById('ccdMaxDist-value').innerText = wuLabelM(ccdMaxDist);
    });
    document.getElementById('showHitRanges').addEventListener('change', function(e){
        showHitRanges = e.target.checked;
    });

    // GMD (Gun Mechanics Debug) controls
    document.getElementById('showGMD').addEventListener('change', function(e){
        showGMD = e.target.checked;
    });
    document.getElementById('showTestTarget').addEventListener('change', function(e){
        testTarget.enabled = e.target.checked;
    });
    document.getElementById('showMinimaps').addEventListener('change', function(e){
        showMinimaps = e.target.checked;
    });
    document.getElementById('targetDistance').addEventListener('input', function(e){
        var dist = parseInt(e.target.value);
        document.getElementById('targetDistance-value').innerText = wuLabelM(dist);
        testTarget.distance = dist;
        positionTestTarget();
    });
    document.getElementById('targetRadius').addEventListener('input', function(e){
        testTarget.radius = parseFloat(e.target.value);
        document.getElementById('targetRadius-value').innerText = testTarget.radius.toFixed(1) + ' (' + Math.round(testTarget.radius * 30) + ' cm)';
    });
    document.getElementById('resetHitCount').addEventListener('click', function(){
        testTarget.hits = 0;
        testTarget.misses = 0;
        testTarget.bulletHitPos = null;
    });

    // Gun Tab edit mode buttons — also sync ADS state so the gun moves to match
    document.getElementById('editADS').addEventListener('click', function() {
        input.aimToggled = true;
        setEditMode('ads');
    });
    document.getElementById('editHip').addEventListener('click', function() {
        input.aimToggled = false;
        setEditMode('hip');
    });

    // Gun viewmodel sliders - visual only, writes to gunViewModel (not gunModel mechanics)
    document.getElementById('gunX').addEventListener('input', function(e){
        var val = parseInt(e.target.value);
        if (editMode === 'ads') gunViewModel.adsOffsetX = val;
        else gunViewModel.hipOffsetX = val;
        document.getElementById('gunX-value').innerText = val;
    });
    document.getElementById('gunY').addEventListener('input', function(e){
        var val = parseInt(e.target.value);
        if (editMode === 'ads') gunViewModel.adsOffsetY = val;
        else gunViewModel.hipOffsetY = val;
        document.getElementById('gunY-value').innerText = val;
    });
    document.getElementById('gunZ').addEventListener('input', function(e){
        var val = parseInt(e.target.value);
        if (editMode === 'ads') gunViewModel.adsOffsetZ = val;
        else gunViewModel.hipOffsetZ = val;
        document.getElementById('gunZ-value').innerText = val;
    });
    document.getElementById('gunScale').addEventListener('input', function(e){
        var val = parseInt(e.target.value);
        if (editMode === 'ads') gunViewModel.adsScale = val;
        else gunViewModel.hipScale = val;
        document.getElementById('gunScale-value').innerText = val;
    });
    document.getElementById('gunRotX').addEventListener('input', function(e){
        var val = parseInt(e.target.value);
        if (editMode === 'ads') gunViewModel.adsRotationX = val;
        else gunViewModel.hipRotationX = val;
        document.getElementById('gunRotX-value').innerText = val;
    });
    document.getElementById('gunRotY').addEventListener('input', function(e){
        var val = parseInt(e.target.value);
        if (editMode === 'ads') gunViewModel.adsRotationY = val;
        else gunViewModel.hipRotationY = val;
        document.getElementById('gunRotY-value').innerText = val;
    });
    document.getElementById('gunRotZ').addEventListener('input', function(e){
        var val = parseInt(e.target.value);
        if (editMode === 'ads') gunViewModel.adsRotationZ = val;
        else gunViewModel.hipRotationZ = val;
        document.getElementById('gunRotZ-value').innerText = val;
    });

    // Barrel Tab edit mode buttons — also sync ADS state
    document.getElementById('barrelEditADS').addEventListener('click', function() {
        input.aimToggled = true;
        setEditMode('ads');
    });
    document.getElementById('barrelEditHip').addEventListener('click', function() {
        input.aimToggled = false;
        setEditMode('hip');
    });

    // Barrel yaw slider - update based on current edit mode
    document.getElementById('barrelYaw').addEventListener('input', function(e){
        var val = parseInt(e.target.value);
        if (editMode === 'ads') gunModel.adsBarrelYaw = val;
        else gunModel.hipBarrelYaw = val;
        document.getElementById('barrelYaw-value').innerText = val;
    });

    // Barrel position sliders - update based on current edit mode
    document.getElementById('barrelX').addEventListener('input', function(e){
        var val = parseFloat(e.target.value);
        if (editMode === 'ads') gunModel.adsBarrelX = val;
        else gunModel.hipBarrelX = val;
        document.getElementById('barrelX-value').innerText = val.toFixed(2);
    });
    document.getElementById('barrelY').addEventListener('input', function(e){
        var val = parseFloat(e.target.value);
        if (editMode === 'ads') gunModel.adsBarrelY = val;
        else gunModel.hipBarrelY = val;
        document.getElementById('barrelY-value').innerText = val.toFixed(2);
    });
    document.getElementById('barrelZ').addEventListener('input', function(e){
        var val = parseFloat(e.target.value);
        if (editMode === 'ads') gunModel.adsBarrelZ = val;
        else gunModel.hipBarrelZ = val;
        document.getElementById('barrelZ-value').innerText = val.toFixed(2);
    });

    // Gun world offset sliders - float values (0.1 step), update based on current edit mode
    document.getElementById('gunWorldFwd').addEventListener('input', function(e){
        var val = parseFloat(e.target.value);
        if (editMode === 'ads') gunModel.adsWorldForward = val;
        else gunModel.hipWorldForward = val;
        document.getElementById('gunWorldFwd-value').innerText = val.toFixed(1);
    });
    document.getElementById('gunWorldRight').addEventListener('input', function(e){
        var val = parseFloat(e.target.value);
        if (editMode === 'ads') gunModel.adsWorldRight = val;
        else gunModel.hipWorldRight = val;
        document.getElementById('gunWorldRight-value').innerText = val.toFixed(1);
    });
    document.getElementById('gunWorldDown').addEventListener('input', function(e){
        var val = parseFloat(e.target.value);
        if (editMode === 'ads') gunModel.adsWorldDown = val;
        else gunModel.hipWorldDown = val;
        document.getElementById('gunWorldDown-value').innerText = val.toFixed(1);
    });

    // UI Scale sliders
    document.getElementById('uiScaleAll').addEventListener('input', function(e){
        var scale = parseFloat(e.target.value);
        uiScale.all = scale;
        document.getElementById('uiScaleAll-value').innerText = scale.toFixed(1);
        // Update all individual scales
        uiScale.crosshair = scale;
        uiScale.healthbar = scale;
        uiScale.jumpbar = scale;
        uiScale.minimap = scale;
        uiScale.weaponUI = scale;
        // Update slider displays
        document.getElementById('uiScaleCrosshair').value = scale;
        document.getElementById('uiScaleCrosshair-value').innerText = scale.toFixed(1);
        document.getElementById('uiScaleHealthbar').value = scale;
        document.getElementById('uiScaleHealthbar-value').innerText = scale.toFixed(1);
        document.getElementById('uiScaleJumpbar').value = scale;
        document.getElementById('uiScaleJumpbar-value').innerText = scale.toFixed(1);
        document.getElementById('uiScaleMinimap').value = scale;
        document.getElementById('uiScaleMinimap-value').innerText = scale.toFixed(1);
        document.getElementById('uiScaleWeaponUI').value = scale;
        document.getElementById('uiScaleWeaponUI-value').innerText = scale.toFixed(1);
        applyUIScales();
    });
    document.getElementById('uiScaleCrosshair').addEventListener('input', function(e){
        uiScale.crosshair = parseFloat(e.target.value);
        document.getElementById('uiScaleCrosshair-value').innerText = uiScale.crosshair.toFixed(1);
        applyUIScales();
    });
    document.getElementById('uiScaleHealthbar').addEventListener('input', function(e){
        uiScale.healthbar = parseFloat(e.target.value);
        document.getElementById('uiScaleHealthbar-value').innerText = uiScale.healthbar.toFixed(1);
        applyUIScales();
    });
    document.getElementById('uiScaleJumpbar').addEventListener('input', function(e){
        uiScale.jumpbar = parseFloat(e.target.value);
        document.getElementById('uiScaleJumpbar-value').innerText = uiScale.jumpbar.toFixed(1);
        applyUIScales();
    });
    document.getElementById('uiScaleMinimap').addEventListener('input', function(e){
        uiScale.minimap = parseFloat(e.target.value);
        document.getElementById('uiScaleMinimap-value').innerText = uiScale.minimap.toFixed(1);
        applyUIScales();
    });
    document.getElementById('minimapZoomRange').addEventListener('input', function(e){
        minimapZoomRange = parseInt(e.target.value);
        document.getElementById('minimapZoomRange-value').innerText = wuLabelM(minimapZoomRange);
    });
    document.getElementById('sideViewZoomRange').addEventListener('input', function(e){
        sideViewZoomRange = parseInt(e.target.value);
        document.getElementById('sideViewZoomRange-value').innerText = wuLabelM(sideViewZoomRange);
    });
    document.getElementById('uiScaleWeaponUI').addEventListener('input', function(e){
        uiScale.weaponUI = parseFloat(e.target.value);
        document.getElementById('uiScaleWeaponUI-value').innerText = uiScale.weaponUI.toFixed(1);
        applyUIScales();
    });

    // Controls tab — Mouse look sensitivity
    document.getElementById('mouseHipSens').addEventListener('input', function(e){
        mouseSensitivity = parseFloat(e.target.value);
        document.getElementById('mouseHipSens-value').innerText = mouseSensitivity.toFixed(4);
    });
    document.getElementById('mouseAdsSens').addEventListener('input', function(e){
        mouseAdsSensitivity = parseFloat(e.target.value);
        document.getElementById('mouseAdsSens-value').innerText = mouseAdsSensitivity.toFixed(4);
    });

    // Controls tab — Gamepad look sensitivity
    document.getElementById('gpHipSens').addEventListener('input', function(e){
        gamepad.lookSensitivity = parseFloat(e.target.value);
        document.getElementById('gpHipSens-value').innerText = gamepad.lookSensitivity.toFixed(3);
    });
    document.getElementById('gpAdsSens').addEventListener('input', function(e){
        gamepad.adsLookSensitivity = parseFloat(e.target.value);
        document.getElementById('gpAdsSens-value').innerText = gamepad.adsLookSensitivity.toFixed(3);
    });

    // Controls tab — HUD size buttons
    function setHudSize(size) {
        var scale = size === 'small' ? 0.75 : size === 'large' ? 1.35 : 1.0;
        uiScale.all = uiScale.crosshair = uiScale.healthbar = uiScale.jumpbar = uiScale.minimap = uiScale.weaponUI = scale;
        document.getElementById('uiScaleAll').value = scale;
        document.getElementById('uiScaleAll-value').innerText = scale.toFixed(1);
        document.getElementById('uiScaleCrosshair').value = scale;
        document.getElementById('uiScaleCrosshair-value').innerText = scale.toFixed(1);
        document.getElementById('uiScaleHealthbar').value = scale;
        document.getElementById('uiScaleHealthbar-value').innerText = scale.toFixed(1);
        document.getElementById('uiScaleJumpbar').value = scale;
        document.getElementById('uiScaleJumpbar-value').innerText = scale.toFixed(1);
        document.getElementById('uiScaleMinimap').value = scale;
        document.getElementById('uiScaleMinimap-value').innerText = scale.toFixed(1);
        document.getElementById('uiScaleWeaponUI').value = scale;
        document.getElementById('uiScaleWeaponUI-value').innerText = scale.toFixed(1);
        applyUIScales();
        ['hudSmall','hudMedium','hudLarge'].forEach(function(id) {
            var active = (id === 'hud' + size.charAt(0).toUpperCase() + size.slice(1));
            document.getElementById(id).style.background = active ? '#4CAF50' : '#555';
            document.getElementById(id).style.color = active ? '#fff' : '#aaa';
        });
    }
    document.getElementById('hudSmall').addEventListener('click', function(){ setHudSize('small'); });
    document.getElementById('hudMedium').addEventListener('click', function(){ setHudSize('medium'); });
    document.getElementById('hudLarge').addEventListener('click', function(){ setHudSize('large'); });

    // Initialize sliders in hip fire mode (player starts in hip fire)
    setEditMode('hip');

    // Save button
    document.getElementById('saveSettings').addEventListener('click', async function() {
        var btn = this;
        savedSettings = getAllSettings();
        localStorage.setItem('ringCombatSettings', JSON.stringify(savedSettings));

        // Push to Nakama for cross-device persistence
        if (NakamaClient.isLoggedIn()) {
            var ok = await NakamaClient.writeAdminSettings(savedSettings);
            if (ok) console.log('Settings saved to Nakama admin storage');
        }

        // Copy full JSON (settings.json + gunModel.json + gamepad.json) to clipboard
        ConfigLoader.copyToClipboard(gunModel);
        console.log('Settings saved to localStorage + Nakama + copied to clipboard as JSON');
        btn.textContent = 'Saved!';
        setTimeout(() => btn.textContent = 'Save', 2000);
    });

    // Reset button
    document.getElementById('resetSettings').addEventListener('click', function() {
        if (savedSettings) {
            applySettings(savedSettings);
            this.textContent = 'Reset!';
            setTimeout(() => this.textContent = 'Reset', 1000);
        }
    });

    // Drag-to-move settings panel
    var dragHandle = document.getElementById('settings-drag-handle');
    var panel = document.getElementById('controls');
    if (dragHandle && panel) {
        var dragOffsetX = 0, dragOffsetY = 0, isDragging = false;
        dragHandle.addEventListener('mousedown', function(e) {
            isDragging = true;
            dragOffsetX = e.clientX - panel.offsetLeft;
            dragOffsetY = e.clientY - panel.offsetTop;
            dragHandle.style.cursor = 'grabbing';
            e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            panel.style.left = (e.clientX - dragOffsetX) + 'px';
            panel.style.top  = (e.clientY - dragOffsetY) + 'px';
        });
        document.addEventListener('mouseup', function() {
            isDragging = false;
            dragHandle.style.cursor = 'move';
        });
    }
}

// Get all current settings for saving
function getAllSettings() {
    return {
        fov: camera.baseFocalLength,
        pitchOffset: pitchOffset,
        targetFPS: targetFPS,
        drawDistance: camera.distance,
        playerHeight: playerHeightOffset,
        normalHeight: player.normalHeight,
        crouchHeight: player.crouchHeight,
        jumpMin: player.jumpMinStrength,
        jumpMax: player.jumpMaxStrength,
        walkSpeed: player.moveSpeed,
        sprintMultiplier: player.sprintMultiplier,
        bulletSize: bulletSize,
        barrelDistance: gunModel.barrelDistance,
        // Gun visual position (gunViewModel — independent from gun mechanics)
        adsOffsetX: gunViewModel.adsOffsetX,
        adsOffsetY: gunViewModel.adsOffsetY,
        adsOffsetZ: gunViewModel.adsOffsetZ,
        adsScale: gunViewModel.adsScale,
        adsRotationX: gunViewModel.adsRotationX,
        adsRotationY: gunViewModel.adsRotationY,
        adsRotationZ: gunViewModel.adsRotationZ,
        hipOffsetX: gunViewModel.hipOffsetX,
        hipOffsetY: gunViewModel.hipOffsetY,
        hipOffsetZ: gunViewModel.hipOffsetZ,
        hipScale: gunViewModel.hipScale,
        hipRotationX: gunViewModel.hipRotationX,
        hipRotationY: gunViewModel.hipRotationY,
        hipRotationZ: gunViewModel.hipRotationZ,
        // Barrel
        adsBarrelX: gunModel.adsBarrelX,
        adsBarrelY: gunModel.adsBarrelY,
        adsBarrelZ: gunModel.adsBarrelZ,
        adsBarrelYaw: gunModel.adsBarrelYaw,
        hipBarrelX: gunModel.hipBarrelX,
        hipBarrelY: gunModel.hipBarrelY,
        hipBarrelZ: gunModel.hipBarrelZ,
        hipBarrelYaw: gunModel.hipBarrelYaw,
        // World offset
        adsWorldForward: gunModel.adsWorldForward,
        adsWorldRight: gunModel.adsWorldRight,
        adsWorldDown: gunModel.adsWorldDown,
        hipWorldForward: gunModel.hipWorldForward,
        hipWorldRight: gunModel.hipWorldRight,
        hipWorldDown: gunModel.hipWorldDown,
        // UI Scale
        uiScaleAll: uiScale.all,
        uiScaleCrosshair: uiScale.crosshair,
        uiScaleHealthbar: uiScale.healthbar,
        uiScaleJumpbar: uiScale.jumpbar,
        uiScaleMinimap: uiScale.minimap,
        uiScaleWeaponUI: uiScale.weaponUI,
        minimapZoomRange: minimapZoomRange,
        sideViewZoomRange: sideViewZoomRange,
        // Look sensitivity
        mouseSensitivity:    mouseSensitivity,
        mouseAdsSensitivity: mouseAdsSensitivity,
        gpHipSensitivity:    gamepad.lookSensitivity,
        gpAdsSensitivity:    gamepad.adsLookSensitivity,
        // Scope and debug
        scopeMode: scopeMode,
        showHitRanges: showHitRanges,
        showGMD: showGMD,
        showMinimaps: showMinimaps,
        showTestTarget: testTarget.enabled,
        targetDistance: testTarget.distance,
        targetRadius: testTarget.radius
    };
}

// Apply loaded settings
function applySettings(s) {
    if (s.fov !== undefined) {
        camera.baseFocalLength = s.fov;
        camera.focalLength = s.fov;
        document.getElementById('fov').value = s.fov;
        document.getElementById('fov-value').innerText = s.fov;
    }
    if (s.pitchOffset !== undefined) {
        pitchOffset = s.pitchOffset;
        document.getElementById('pitchOffset').value = s.pitchOffset;
        document.getElementById('pitchOffset-value').innerText = s.pitchOffset;
    }
    if (s.targetFPS !== undefined) {
        targetFPS = s.targetFPS;
        frameDuration = 1000 / targetFPS;
        document.getElementById('targetFPS').value = s.targetFPS;
        document.getElementById('targetFPS-value').innerText = s.targetFPS;
    }
    if (s.drawDistance !== undefined) {
        camera.distance = s.drawDistance;
        document.getElementById('drawDistance').value = s.drawDistance;
        document.getElementById('drawDistance-value').innerText = wuLabelM(s.drawDistance);
    }
    if (s.playerHeight !== undefined) {
        playerHeightOffset = s.playerHeight;
        document.getElementById('playerHeight').value = s.playerHeight;
        document.getElementById('playerHeight-value').innerText = wuLabelCm(s.playerHeight);
    }
    if (s.normalHeight !== undefined) {
        player.normalHeight = s.normalHeight;
        document.getElementById('normalHeight').value = s.normalHeight;
        document.getElementById('normalHeight-value').innerText = s.normalHeight;
    }
    if (s.crouchHeight !== undefined) {
        player.crouchHeight = s.crouchHeight;
        document.getElementById('crouchHeight').value = s.crouchHeight;
        document.getElementById('crouchHeight-value').innerText = s.crouchHeight;
    }
    if (s.jumpMin !== undefined) {
        player.jumpMinStrength = s.jumpMin;
        document.getElementById('jumpMin').value = s.jumpMin;
        document.getElementById('jumpMin-value').innerText = s.jumpMin;
    }
    if (s.jumpMax !== undefined) {
        player.jumpMaxStrength = s.jumpMax;
        document.getElementById('jumpMax').value = s.jumpMax;
        document.getElementById('jumpMax-value').innerText = s.jumpMax;
    }
    if (s.walkSpeed !== undefined) {
        player.moveSpeed = s.walkSpeed;
        document.getElementById('walkSpeed').value = s.walkSpeed;
        document.getElementById('walkSpeed-value').innerText = s.walkSpeed.toFixed(1);
    }
    if (s.sprintMultiplier !== undefined) {
        player.sprintMultiplier = s.sprintMultiplier;
        document.getElementById('sprintMultiplier').value = s.sprintMultiplier;
        document.getElementById('sprintMultiplier-value').innerText = s.sprintMultiplier.toFixed(1);
    }
    if (s.bulletSize !== undefined) {
        bulletSize = s.bulletSize;
        document.getElementById('bulletSize').value = s.bulletSize;
        document.getElementById('bulletSize-value').innerText = s.bulletSize;
    }
    if (s.barrelDistance !== undefined) {
        gunModel.barrelDistance = s.barrelDistance;
        document.getElementById('barrelDistance').value = s.barrelDistance;
        document.getElementById('barrelDistance-value').innerText = wuLabelCm(s.barrelDistance);
    }
    // Gun visual position - ADS (gunViewModel)
    if (s.adsOffsetX !== undefined) {
        gunViewModel.adsOffsetX = s.adsOffsetX;
        gunViewModel.adsOffsetY = s.adsOffsetY;
        gunViewModel.adsOffsetZ = s.adsOffsetZ;
        gunViewModel.adsScale = s.adsScale;
        gunViewModel.adsRotationX = s.adsRotationX;
        gunViewModel.adsRotationY = s.adsRotationY;
        gunViewModel.adsRotationZ = s.adsRotationZ;
    }
    // Gun visual position - Hip (gunViewModel)
    if (s.hipOffsetX !== undefined) {
        gunViewModel.hipOffsetX = s.hipOffsetX;
        gunViewModel.hipOffsetY = s.hipOffsetY;
        gunViewModel.hipOffsetZ = s.hipOffsetZ;
        gunViewModel.hipScale = s.hipScale;
        gunViewModel.hipRotationX = s.hipRotationX;
        gunViewModel.hipRotationY = s.hipRotationY;
        gunViewModel.hipRotationZ = s.hipRotationZ;
    }
    // Barrel - ADS
    if (s.adsBarrelX !== undefined) {
        gunModel.adsBarrelX = s.adsBarrelX;
        gunModel.adsBarrelY = s.adsBarrelY;
        gunModel.adsBarrelZ = s.adsBarrelZ;
        gunModel.adsBarrelYaw = s.adsBarrelYaw;
    }
    // Barrel - Hip
    if (s.hipBarrelX !== undefined) {
        gunModel.hipBarrelX = s.hipBarrelX;
        gunModel.hipBarrelY = s.hipBarrelY;
        gunModel.hipBarrelZ = s.hipBarrelZ;
        gunModel.hipBarrelYaw = s.hipBarrelYaw;
    }
    // World offset - ADS
    if (s.adsWorldForward !== undefined) {
        gunModel.adsWorldForward = s.adsWorldForward;
        gunModel.adsWorldRight = s.adsWorldRight;
        gunModel.adsWorldDown = s.adsWorldDown;
    }
    // World offset - Hip
    if (s.hipWorldForward !== undefined) {
        gunModel.hipWorldForward = s.hipWorldForward;
        gunModel.hipWorldRight = s.hipWorldRight;
        gunModel.hipWorldDown = s.hipWorldDown;
    }
    // UI Scale
    if (s.uiScaleAll !== undefined) {
        uiScale.all = s.uiScaleAll;
        document.getElementById('uiScaleAll').value = s.uiScaleAll;
        document.getElementById('uiScaleAll-value').innerText = s.uiScaleAll.toFixed(1);
    }
    if (s.uiScaleCrosshair !== undefined) {
        uiScale.crosshair = s.uiScaleCrosshair;
        document.getElementById('uiScaleCrosshair').value = s.uiScaleCrosshair;
        document.getElementById('uiScaleCrosshair-value').innerText = s.uiScaleCrosshair.toFixed(1);
    }
    if (s.uiScaleHealthbar !== undefined) {
        uiScale.healthbar = s.uiScaleHealthbar;
        document.getElementById('uiScaleHealthbar').value = s.uiScaleHealthbar;
        document.getElementById('uiScaleHealthbar-value').innerText = s.uiScaleHealthbar.toFixed(1);
    }
    if (s.uiScaleJumpbar !== undefined) {
        uiScale.jumpbar = s.uiScaleJumpbar;
        document.getElementById('uiScaleJumpbar').value = s.uiScaleJumpbar;
        document.getElementById('uiScaleJumpbar-value').innerText = s.uiScaleJumpbar.toFixed(1);
    }
    if (s.uiScaleMinimap !== undefined) {
        uiScale.minimap = s.uiScaleMinimap;
        document.getElementById('uiScaleMinimap').value = s.uiScaleMinimap;
        document.getElementById('uiScaleMinimap-value').innerText = s.uiScaleMinimap.toFixed(1);
    }
    if (s.uiScaleWeaponUI !== undefined) {
        uiScale.weaponUI = s.uiScaleWeaponUI;
        document.getElementById('uiScaleWeaponUI').value = s.uiScaleWeaponUI;
        document.getElementById('uiScaleWeaponUI-value').innerText = s.uiScaleWeaponUI.toFixed(1);
    }
    if (s.minimapZoomRange !== undefined) {
        minimapZoomRange = s.minimapZoomRange;
        document.getElementById('minimapZoomRange').value = s.minimapZoomRange;
        document.getElementById('minimapZoomRange-value').innerText = wuLabelM(s.minimapZoomRange);
    }
    if (s.sideViewZoomRange !== undefined) {
        sideViewZoomRange = s.sideViewZoomRange;
        document.getElementById('sideViewZoomRange').value = s.sideViewZoomRange;
        document.getElementById('sideViewZoomRange-value').innerText = wuLabelM(s.sideViewZoomRange);
    }
    if (s.mouseSensitivity !== undefined) {
        mouseSensitivity = s.mouseSensitivity;
        document.getElementById('mouseHipSens').value = s.mouseSensitivity;
        document.getElementById('mouseHipSens-value').innerText = s.mouseSensitivity.toFixed(4);
    }
    if (s.mouseAdsSensitivity !== undefined) {
        mouseAdsSensitivity = s.mouseAdsSensitivity;
        document.getElementById('mouseAdsSens').value = s.mouseAdsSensitivity;
        document.getElementById('mouseAdsSens-value').innerText = s.mouseAdsSensitivity.toFixed(4);
    }
    if (s.gpHipSensitivity !== undefined) {
        gamepad.lookSensitivity = s.gpHipSensitivity;
        document.getElementById('gpHipSens').value = s.gpHipSensitivity;
        document.getElementById('gpHipSens-value').innerText = s.gpHipSensitivity.toFixed(3);
    }
    if (s.gpAdsSensitivity !== undefined) {
        gamepad.adsLookSensitivity = s.gpAdsSensitivity;
        document.getElementById('gpAdsSens').value = s.gpAdsSensitivity;
        document.getElementById('gpAdsSens-value').innerText = s.gpAdsSensitivity.toFixed(3);
    }
    if (s.scopeMode !== undefined) {
        setScopeMode(s.scopeMode);
    }
    // Debug/GMD
    if (s.showHitRanges !== undefined) {
        showHitRanges = s.showHitRanges;
        document.getElementById('showHitRanges').checked = s.showHitRanges;
    }
    if (s.showGMD !== undefined) {
        showGMD = s.showGMD;
        document.getElementById('showGMD').checked = s.showGMD;
    }
    if (s.showMinimaps !== undefined) {
        showMinimaps = s.showMinimaps;
        document.getElementById('showMinimaps').checked = s.showMinimaps;
    }
    if (s.showTestTarget !== undefined) {
        testTarget.enabled = s.showTestTarget;
        document.getElementById('showTestTarget').checked = s.showTestTarget;
    }
    if (s.targetDistance !== undefined) {
        testTarget.distance = s.targetDistance;
        document.getElementById('targetDistance').value = s.targetDistance;
        document.getElementById('targetDistance-value').innerText = wuLabelM(s.targetDistance);
    }
    if (s.targetRadius !== undefined) {
        testTarget.radius = s.targetRadius;
        document.getElementById('targetRadius').value = s.targetRadius;
        document.getElementById('targetRadius-value').innerText = s.targetRadius.toFixed(1) + ' (' + Math.round(s.targetRadius * 30) + ' cm)';
    }
    // Update sliders
    updateGunSliders();
    updateBarrelSliders();
    updateWorldOffsetSliders();
    applyUIScales();
}

// Apply player height (and related values) from settings.json, overriding any saved setting.
// Called for all users so the canonical values in settings.json always win.
function _applyPlayerHeightFromJson() {
    var s = ConfigLoader.settings;
    if (!s || !s.player) return;
    if (s.player.playerHeight !== undefined) {
        playerHeightOffset = s.player.playerHeight;
        var el = document.getElementById('playerHeight');
        if (el) {
            el.value = s.player.playerHeight;
            document.getElementById('playerHeight-value').innerText = wuLabelCm(s.player.playerHeight);
        }
    }
    if (s.player.normalHeight !== undefined) player.normalHeight   = s.player.normalHeight;
    if (s.player.crouchHeight !== undefined) player.crouchHeight   = s.player.crouchHeight;
    if (s.player.jumpMin     !== undefined) player.jumpMinStrength = s.player.jumpMin;
    if (s.player.jumpMax     !== undefined) player.jumpMaxStrength = s.player.jumpMax;
}

// Load settings from localStorage, Nakama, or JSON
async function loadSettings() {
    var jsonLoaded = await ConfigLoader.loadAll();

    if (isAdmin) {
        // 1. Try localStorage first (fastest, same machine)
        var stored = localStorage.getItem('ringCombatSettings');
        if (stored) {
            try {
                savedSettings = JSON.parse(stored);
                console.log('Loading saved settings from localStorage');
                applySettings(savedSettings);
                if (jsonLoaded) { ConfigLoader.applyWeapons(); ConfigLoader.applyGamepad(); }
                _applyPlayerHeightFromJson();
                return;
            } catch(e) {
                console.log('Could not load saved settings from localStorage:', e);
            }
        }

        // 2. Try Nakama admin storage (cross-device fallback)
        if (NakamaClient.isLoggedIn()) {
            try {
                var nakamaSettings = await NakamaClient.readAdminSettings();
                if (nakamaSettings) {
                    savedSettings = nakamaSettings;
                    // Also cache locally so next load is instant
                    localStorage.setItem('ringCombatSettings', JSON.stringify(savedSettings));
                    console.log('Loading saved settings from Nakama admin storage');
                    applySettings(savedSettings);
                    if (jsonLoaded) { ConfigLoader.applyWeapons(); ConfigLoader.applyGamepad(); }
                    _applyPlayerHeightFromJson();
                    return;
                }
            } catch(e) {
                console.log('Could not load settings from Nakama:', e);
            }
        }
    }

    // Everyone else (and admin fallback): use data/*.json files
    if (jsonLoaded && ConfigLoader.gunModel) {
        ConfigLoader.applyGunModel(gunModel);
        ConfigLoader.applyWeapons();
        ConfigLoader.applyGamepad();

        // Apply player scale from settings.json (camera settings are NOT applied — those are
        // admin-calibrated and must not override defaults for regular users).
        _applyPlayerHeightFromJson();

        console.log('Settings loaded from data/*.json files');
    }
}

// Debug functions
window.clearVoxelSettings = function() {
    localStorage.removeItem('ringCombatSettings');
    console.log('Saved settings cleared. Refresh to use defaults from JSON.');
};

window.reloadJsonConfigs = function() {
    ConfigLoader.loadAll().then(function(loaded) {
        if (loaded) {
            ConfigLoader.applyGunModel(gunModel);
            ConfigLoader.applyWeapons();
            ConfigLoader.applyGamepad();
            console.log('JSON configs reloaded and applied');
        }
    });
};
