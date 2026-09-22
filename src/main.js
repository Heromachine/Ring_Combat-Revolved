// ===============================
// Main Entry Point - Init and Draw Loop
// ===============================
"use strict";

// Apply UI scale transforms to HUD elements
function applyUIScales() {
    var crosshair = document.getElementById('crosshair');
    var healthbar = document.getElementById('healthbar');
    var jumpbar = document.getElementById('jumpbar');

    if (crosshair) {
        var cs = uiScale.crosshair;
        crosshair.style.width = (10 * cs) + 'px';
        crosshair.style.height = (10 * cs) + 'px';
        crosshair.style.margin = (-5 * cs) + 'px 0 0 ' + (-5 * cs) + 'px';
    }

    if (healthbar) {
        var hs = uiScale.healthbar;
        healthbar.style.width = (180 * hs) + 'px';
        healthbar.style.height = (8 * hs) + 'px';
        healthbar.style.bottom = (18 * hs) + 'px';
        healthbar.style.left = (10 * hs) + 'px';
        healthbar.style.borderWidth = (1 * hs) + 'px';
    }

    var shieldbar = document.getElementById('shieldbar');
    if (shieldbar) {
        var hs = uiScale.healthbar;
        shieldbar.style.width = (180 * hs) + 'px';
        shieldbar.style.height = (8 * hs) + 'px';
        shieldbar.style.bottom = (30 * hs) + 'px';
        shieldbar.style.left = (10 * hs) + 'px';
        shieldbar.style.borderWidth = (1 * hs) + 'px';
    }

    if (jumpbar) {
        var js = uiScale.jumpbar;
        jumpbar.style.width = (180 * js) + 'px';
        jumpbar.style.height = (3 * js) + 'px';
        jumpbar.style.bottom = (10 * js) + 'px';
        jumpbar.style.left = (10 * js) + 'px';
        jumpbar.style.borderWidth = '0';
    }
}

function OnResizeWindow(){
    screendata.canvas = document.getElementById('fullscreenCanvas');
    var controlsCanvas = document.getElementById('controls-canvas');
    var gameContainer  = document.getElementById('game-container');
    var W = window.innerWidth;
    var H = window.innerHeight;
    var isTouch    = ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    var isPortrait = W < H;

    var prevH = (screendata.canvas.height > 0) ? screendata.canvas.height : H;
    var renderW, renderH;

    if (!isTouch) {
        // ── PC Browser: 16:9 letterboxed, centered ──────────────────
        controlsCanvas.style.display = 'none';
        touchControls.controlsCanvas = null;
        touchControls.controlsCtx    = null;
        touchControls.canvasOffsetY  = 0;

        var dims     = DisplayConfig.getCanvasDimensions(W, H);
        var canvasW  = dims.canvasWidth;
        var canvasH  = dims.canvasHeight;
        renderW = dims.renderWidth;
        renderH = dims.renderHeight;

        gameContainer.style.left   = Math.floor((W - canvasW) / 2) + 'px';
        gameContainer.style.top    = Math.floor((H - canvasH) / 2) + 'px';
        gameContainer.style.width  = canvasW + 'px';
        gameContainer.style.height = canvasH + 'px';
        screendata.canvas.style.width  = '100%';
        screendata.canvas.style.height = '100%';

    } else if (!isPortrait) {
        // ── Mobile Landscape: full screen + controls overlay ─────────
        controlsCanvas.style.display = 'none';
        touchControls.controlsCanvas = null;
        touchControls.controlsCtx    = null;
        touchControls.canvasOffsetY  = 0;

        renderW = W;
        renderH = H;
        gameContainer.style.left   = '0px';
        gameContainer.style.top    = '0px';
        gameContainer.style.width  = W + 'px';
        gameContainer.style.height = H + 'px';
        screendata.canvas.style.width  = '100%';
        screendata.canvas.style.height = '100%';

    } else {
        // ── Mobile Portrait: game on top, controls below ─────────────
        var gameH = Math.floor(H * 0.55);
        var ctrlH = H - gameH;
        renderW = W;
        renderH = gameH;
        touchControls.canvasOffsetY = gameH;

        // Game canvas occupies only the top game area
        gameContainer.style.left   = '0px';
        gameContainer.style.top    = '0px';
        gameContainer.style.width  = W + 'px';
        gameContainer.style.height = gameH + 'px';
        screendata.canvas.style.width  = '100%';
        screendata.canvas.style.height = '100%';

        // Controls canvas positioned directly below game canvas
        controlsCanvas.style.display = 'block';
        controlsCanvas.style.left    = '0px';
        controlsCanvas.style.top     = gameH + 'px';
        controlsCanvas.style.width   = W + 'px';
        controlsCanvas.style.height  = ctrlH + 'px';
        controlsCanvas.width  = W;
        controlsCanvas.height = ctrlH;

        touchControls.controlsCanvas = controlsCanvas;
        touchControls.controlsCtx    = controlsCanvas.getContext('2d');
    }

    // Scale horizon proportionally when render height changes
    if (prevH > 0 && prevH !== renderH) {
        camera.horizon = Math.round(camera.horizon * renderH / prevH);
    }

    screendata.canvas.width  = renderW;
    screendata.canvas.height = renderH;

    // Recalculate touch button positions for new window size
    if (touchControls.enabled) updateTouchControlPositions();

    if(screendata.canvas.getContext){
        screendata.context=screendata.canvas.getContext('2d');
        screendata.imagedata=screendata.context.createImageData(screendata.canvas.width,screendata.canvas.height);
    }
    screendata.bufarray=new ArrayBuffer(screendata.imagedata.width*screendata.imagedata.height*4);
    screendata.buf8=new Uint8Array(screendata.bufarray);
    screendata.buf32=new Uint32Array(screendata.bufarray);
    screendata.depthBuffer=new Float32Array(screendata.canvas.width*screendata.canvas.height);
    hiddeny=new Int32Array(screendata.canvas.width);
}

var _loopActive = false;
var gameMode = 'freeplay'; // 'freeplay' | 'nodewar'

function exitGame() {
    _loopActive = false;
    gameMode = 'freeplay';
    if (typeof Multiplayer !== 'undefined' && Multiplayer.isConnected()) {
        Multiplayer.disconnect();
    }
    if (document.exitPointerLock) document.exitPointerLock();
    var gameContainer = document.getElementById('game-container');
    if (gameContainer) gameContainer.style.display = 'none';
    ModeMenu.show();
}

// Main draw loop
var _frameCount = 0;
function Draw(timestamp){
    if (!_loopActive) return;
    updaterunning=true;
    if(timestamp-lastFrameTime>=frameDuration){
        lastFrameTime=timestamp;
        pollGamepad();
        if (typeof updateTouchInput === 'function') updateTouchInput();
        UpdateCamera();
        // Keep chunks resident around the player and drip-feed generation.
        // Budget 1 chunk/frame: a chunk costs ~10 ms to build, so generating
        // several in one frame would stall visibly.
        if (typeof spikeStatus === 'function' && (_frameCount++ & 31) === 0) spikeStatus();
        if (typeof ChunkTerrain !== 'undefined' && Terrain.usingChunks()) {
            ChunkTerrain.requestAround(camera.x, camera.y, camera.distance);
            ChunkTerrain.pump(1);
        }
        updateTargetMetrics();
        updateGreenCubeFloat(timestamp);
        updateShadowCubeFloat(timestamp);
        QuestManager.update();
        DrawBackground();
        RenderCube();
        RenderGreenCube();
        RenderShadowCube();
        Render();
        // Draws the far side of the loop arcing overhead. Must run AFTER
        // Render(), which fills hiddeny[] -- the backdrop uses it to avoid
        // painting over near terrain. No-op while the ring is off.
        if (typeof RenderRingBackdrop === 'function') RenderRingBackdrop();
        var playerSprites = [];
        var _now = Date.now();
        var _myId = (typeof NakamaClient !== "undefined") ? NakamaClient.getUserId() : null;
        for (var _uid in nakamaState.remotePlayers) {
            if (_uid === _myId) continue;
            var _rp = nakamaState.remotePlayers[_uid];
            if (_now - _rp.lastSeen > 10000) continue;
            playerSprites.push({ x: _rp.x, y: _rp.y, z: _rp.height - playerHeightOffset, type: "player", image: textures.player, spriteFrame: _rp.spriteFrame || 0, spriteRow: _rp.spriteRow || 0 });
        }
        // Add enemy sprites — skip dead enemies
        var enemySprites = [];
        if (!Multiplayer.isConnected()) {
            enemySprites = enemies
                .filter(function(e) { return e.state !== 'dead'; })
                .map(function(e) {
                    return { type: 'enemy', x: e.x, y: e.y, z: e.z + e.hitRadius, image: e.texture };
                });
        }
        RenderItems(playerSprites.concat(enemySprites));
        Flip();
        RenderTestTarget();
        if (!Multiplayer.isConnected()) DrawEnemyBars(screendata.context);
        RenderGroundWeapons();
        RenderGunViewmodel(screendata.context);
        RenderSniperScope();
        DrawMinimap();
        DrawWeaponUI(screendata.context);
        // In portrait mode draw controls on the separate controls canvas; otherwise on game canvas
        if (touchControls.controlsCtx) {
            touchControls.controlsCtx.clearRect(0, 0, touchControls.controlsCanvas.width, touchControls.controlsCanvas.height);
            DrawTouchControls(touchControls.controlsCtx);
        } else {
            DrawTouchControls(screendata.context);
        }
        DrawGunDebugInfo();
        RenderRemotePlayerOverlays();
        if (typeof Multiplayer !== "undefined") Multiplayer.update();
        DrawScoreboard();
        frames++;
    }
    requestAnimationFrame(Draw);
}

// Initialize game
function Init(){
    _loopActive = true;
    var _gc = document.getElementById('game-container');
    if (_gc) _gc.style.display = '';
    // AUTHORING: flat default fill before the real map loads.
    var _m=Terrain.rawMap();
    for(var i=0;i<_m.width*_m.height;i++){_m.color[i]=0xFF007050;_m.altitude[i]=0;}
    // C21;D21 has the most terrain variation of the available pairs
    // (height std 33.5 over range 1-125, 228 distinct colours). The old
    // default CE;DE is a featureless light-grey arena -- its entire palette
    // is rgb(193,193,192) -- which made the ring impossible to judge and
    // read on screen as "everything is white". Press M to cycle maps.
    LoadMap("C21;D21");
    OnResizeWindow();
    loadGunModel();
    loadCubeTexture();
    initGreenCube();
    initShadowCube();
    QuestManager.init();
    InGameMenu.init();

    var canvas=document.getElementById("fullscreenCanvas");

    // Tab switching for controls panel
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var tabId = this.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(function(tab) {
                tab.style.display = 'none';
            });
            document.querySelectorAll('.tab-btn').forEach(function(b) {
                b.style.background = 'transparent';
                b.style.color = 'rgba(138,176,200,0.45)';
            });
            document.getElementById('tab-' + tabId).style.display = 'block';
            this.style.background = 'rgba(80,160,220,0.15)';
            this.style.color = '#8ab0c8';
        });
    });

    // Initialize scope mode
    setScopeMode('focal');

    // Scope mode toggle buttons
    document.getElementById('scopeModeForward').addEventListener('click', function() {
        setScopeMode('forward');
    });
    document.getElementById('scopeModeFocal').addEventListener('click', function() {
        setScopeMode('focal');
    });

    // Event listeners
    window.onkeydown=DetectKeysDown;
    window.onkeyup=DetectKeysUp;
    canvas.onmousedown=DetectMouseDown;
    // mouseup is bound to the WINDOW, not the canvas. Bound to the canvas it
    // was missed whenever the release happened over something else -- opening
    // the Tab menu put an overlay under the cursor, so the release never
    // reached the canvas and input.shoot stayed true.
    window.addEventListener('mouseup', DetectMouseUp);
    canvas.onwheel=DetectMouseWheel;
    canvas.oncontextmenu=function(e){e.preventDefault();return false;};
    window.onresize=OnResizeWindow;

    canvas.requestPointerLock=canvas.requestPointerLock||canvas.mozRequestPointerLock;
    canvas.onclick=function(){canvas.requestPointerLock();};
    document.addEventListener('pointerlockchange',function(){
        if(document.pointerLockElement===canvas||document.mozPointerLockElement===canvas){
            canvas.onmousemove=DetectMouseMove;
        } else {
            canvas.onmousemove=null;
            // Lock lost (menu, Esc, alt-tab). Release events may never arrive,
            // so drop everything held rather than leaving it stuck down.
            releaseHeldInput();
        }
    },false);

    // Focus loss is the other way release events go missing.
    window.addEventListener('blur', releaseHeldInput);

    // Mobile touch controls setup — listen on game canvas
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    // Also listen on the portrait controls canvas so buttons work there too
    var controlsCanvasEl = document.getElementById('controls-canvas');
    controlsCanvasEl.addEventListener('touchstart', handleTouchStart, { passive: false });
    controlsCanvasEl.addEventListener('touchmove', handleTouchMove, { passive: false });
    controlsCanvasEl.addEventListener('touchend', handleTouchEnd, { passive: false });
    controlsCanvasEl.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    // FPS counter
    setInterval(function(){
        var current=Date.now();
        document.getElementById('debug-fps').innerText=(frames/(current-timelastframe)*1000).toFixed(1)+" fps";
        frames=0;
        timelastframe=current;
    },2000);

    // Setup all sliders (see settings files for full implementation)
    setupSliders();

    // Load settings
    loadSettings();

    console.log('Tips:');
    console.log('  - clearVoxelSettings() to reset localStorage');
    console.log('  - reloadJsonConfigs() to reload from data/*.json');
}

// ── Multiplayer startup flow ──────────────────────────────
async function StartMultiplayer() {
    // 1. Show login screen, wait for auth
    LoginScreen.show(async function (isAnonymous) {
        // 2. Load player data to check if clan already chosen
        var savedData = null;
        if (!isAnonymous) {
            savedData = await NakamaClient.readPlayerData();
        }

        var hasClan = savedData && savedData.clan;

        if (hasClan) {
            nakamaState.myClan = savedData.clan;
            beginGame(isAnonymous);
        } else {
            // 3. Show clan selection
            ClanScreen.show(isAnonymous, function (clanId) {
                beginGame(isAnonymous);
            });
        }
    });
}

async function beginGame(isAnonymous) {
    // Connect to Nakama match
    try {
        await Multiplayer.init(isAnonymous);
    } catch (e) {
        console.warn("Multiplayer failed to connect, running offline:", e);
    }

    // Adopt the server's world parameters before anything reads ring
    // geometry, so client and server agree on where the seam is.
    if (typeof NakamaClient !== "undefined" && typeof applyServerWorldConfig === "function") {
        applyServerWorldConfig(await NakamaClient.fetchWorldConfig());
    }

    // Admin check — decided by the SERVER, never by the client.
    // The check_admin RPC pins admin to an immutable Nakama user_id.
    // Fails closed to non-admin if the RPC or session is unavailable.
    isAdmin = await NakamaClient.checkAdmin();
    if (isAdmin) {
        DisplayConfig.load(); // restore admin's saved display settings
    } else {
        showGMD        = false;   // gun mechanics debug overlay
        showHitRanges  = false;   // hit-range circles on minimap
        testTarget.enabled = false; // floating test target
    }

    // Start the game loop
    Init();
    requestAnimationFrame(Draw);
}

async function StartNodeWar() {
    gameMode = 'nodewar';
    LoginScreen.show(async function (isAnonymous) {
        var savedData = null;
        if (!isAnonymous) {
            savedData = await NakamaClient.readPlayerData();
        }
        var hasClan = savedData && savedData.clan;
        if (hasClan) {
            nakamaState.myClan = savedData.clan;
            beginNodeWarGame(isAnonymous);
        } else {
            ClanScreen.show(isAnonymous, function (clanId) {
                beginNodeWarGame(isAnonymous);
            });
        }
    });
}

async function beginNodeWarGame(isAnonymous) {
    try {
        await Multiplayer.init(isAnonymous, 'nodewar');
    } catch (e) {
        console.warn("Node War: multiplayer failed, running offline:", e);
    }
    isAdmin = await NakamaClient.checkAdmin();
    if (isAdmin) {
        DisplayConfig.load();
    } else {
        showGMD        = false;
        showHitRanges  = false;
        testTarget.enabled = false;
    }
    Init();
    requestAnimationFrame(Draw);
}

async function beginAdminGame() {
    // Grant admin tools only if the server says so; others get read-only dev access
    isAdmin = await NakamaClient.checkAdmin();
    if (isAdmin) {
        DisplayConfig.load();
    } else {
        showGMD        = false;
        showHitRanges  = false;
        testTarget.enabled = false;
    }
    // Auto-assign dev clan — no clan selection screen for admins
    nakamaState.myClan = "iron_ravens";
    // No multiplayer connection — single-player with dev tools
    Init();
    requestAnimationFrame(Draw);
}

// Mode selection is handled by ModeMenu in index.html.
// ModeMenu.show() is called after the splash screen dismisses.
