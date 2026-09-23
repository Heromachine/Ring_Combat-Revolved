// ===============================
// Global State Variables
// ===============================
"use strict";

// Scale reference: 1 world unit (WU) ≈ 1 foot ≈ 30 cm
// Player eye height: 7 WU ≈ 7 feet (eye level of ~6'3" person)
// globals.js sets the fallback default; actual value is loaded from data/settings.json at startup
var WU_TO_CM = 30;

var camera = {
    x: 0, y: 0, height: 78, angle: 0, horizon: 100,
    distance: 2000, velocityY: 0,
    baseFocalLength: 300,  // normal FOV
    focalLength: 300,      // current focal length
    // ADS camera offset (moves camera forward for zoom effect)
    adsOffset: 0,          // current offset
    baseX: 0, baseY: 0     // actual player position (before ADS offset)
};

var enemies = [];

var player={health:100,shield:100,maxShield:100,shieldRegenRate:5,shieldRegenDelay:4000,lastDamageTime:0,
            isCrouching:false,moveSpeed:1.5,sprintMultiplier:2,
            // Charged jump system
            jumpMinStrength:3,      // tap jump
            jumpMaxStrength:12,     // fully charged (basketball player ~1m vertical)
            jumpChargeTime:0,       // current charge time in ms
            jumpMaxChargeTime:1000, // 1 second to fully charge
            isChargingJump:false,
            crouchHeight:40,normalHeight:78,
            // Weapon state
            wasSwapping:false,wasPickingUp:false,wasShooting:false};

// Weapon definitions
var weapons = {
    testgun: {
        name: "Test Gun",
        letter: "T",
        color: "#00FFFF",      // Cyan
        bgColor: "#008888",
        magazine: Infinity,
        maxMagazine: Infinity,
        reloadTime: 0,
        fireRate: 100,
        fireMode: "auto",
        damage: 50,
        bulletSpeed: 15,
        adsZoom: 1.5,
        useScope: true         // Has picture-in-picture scope for testing
    },
    rifle: {
        name: "Rifle",
        letter: "R",
        color: "#8B00FF",      // Purple
        bgColor: "#4B0082",
        magazine: 30,
        maxMagazine: 30,
        reloadTime: 2000,
        fireRate: 100,         // Fast auto fire
        fireMode: "auto",
        damage: 15,
        bulletSpeed: 12,
        adsZoom: 1.8           // 1.8x zoom when aiming
    },
    pistol: {
        name: "Desert Eagle .50 AE",
        letter: "P",
        color: "#C0C0C0",      // Silver
        bgColor: "#808080",
        magazine: 7,
        maxMagazine: 7,
        reloadTime: 1000,
        fireRate: 200,         // Semi-auto
        fireMode: "semi",
        damage: 25,
        bulletSpeed: 10,
        adsZoom: 1.3           // 1.3x zoom (minimal for pistol)
    },
    sniper: {
        name: "Sniper",
        letter: "S",
        color: "#228B22",      // Forest green
        bgColor: "#006400",
        magazine: 5,
        maxMagazine: 5,
        reloadTime: 3000,
        fireRate: 1000,        // Slow but powerful
        fireMode: "semi",
        damage: 100,
        bulletSpeed: 20,
        adsZoom: 4.0,          // 4x scope zoom (base)
        useScope: true,        // Has picture-in-picture scope
        ccdOnly: true          // No hitscan, CCD only for realistic bullet travel
    },
    shotgun: {
        name: "Shotgun",
        letter: "G",
        color: "#D2691E",
        bgColor: "#8B4513",
        magazine: 8,
        maxMagazine: 8,
        reloadTime: 1800,
        fireRate: 700,
        fireMode: "semi",
        damage: 12,            // Per pellet
        bulletSpeed: 9,
        pellets: 6,            // Pellets per shot
        adsZoom: 1.2
    },
    tracer: {
        name: "Tracer",
        letter: "C",
        color: "#00FFAA",
        bgColor: "#008866",
        magazine: 3,
        maxMagazine: 3,
        reloadTime: 0,
        fireRate: 0,
        fireMode: "charge",    // Hold to charge, release to fire
        chargeTime: 1500,      // ms to fully charge
        damage: 30,
        bulletSpeed: 18,
        homingSpeed: 3,        // Radians/sec turn rate
        coneAngle: 0.4,        // Half-angle of targeting cone (radians)
        coneRange: 300,        // Max target acquisition range (world units)
        ammoRegen: true,
        regenCooldown: 8000,   // ms after depletion before regen
        adsZoom: 1.5
    },
    plasmaRifle: {
        name: "Plasma Rifle",
        letter: "A",
        color: "#FF00FF",
        bgColor: "#880088",
        magazine: 40,
        maxMagazine: 40,
        reloadTime: 0,
        fireRate: 80,
        fireMode: "auto",
        damage: 5,
        bulletSpeed: 14,
        ammoRegen: true,
        regenCooldown: 10000,
        adsZoom: 1.6
    },
    plasmaPistol: {
        name: "Plasma Pistol",
        letter: "L",
        color: "#CC00FF",
        bgColor: "#660088",
        magazine: 12,
        maxMagazine: 12,
        reloadTime: 0,
        fireRate: 400,
        fireMode: "semi",
        damage: 12,
        bulletSpeed: 11,
        ammoRegen: true,
        regenCooldown: 10000,
        adsZoom: 1.3
    }
};

// Player's current weapons (2 slots)
var playerWeapons = [
    { type: "testgun", ammo: Infinity, isReloading: false, lastShot: 0 },
    { type: "sniper", ammo: 5, isReloading: false, lastShot: 0 }
];
var currentWeaponIndex = 0;  // Which weapon is active (0 or 1)
var prevSwapButton = false;  // For edge detection on Y button

// Weapons on ground
var groundWeapons = [];
var nearbyWeapon = null;     // Weapon player can pick up

// Legacy gun object for compatibility
var gun={magazine:200,maxMagazine:200,reloadTime:1000,isReloading:false,lastShot:0,fireRate:300};
var items=[];  // unified bullets + hearts + pickups
var lastBullet=null,lastBulletDestroyedPos=null,lastBulletDestroyedReason=null,lastBulletScreen=null;
var map={width:1024,height:1024,shift:10,altitude:new Uint8Array(1024*1024),color:new Uint32Array(1024*1024)};
var screendata={canvas:null,context:null,imagedata:null,bufarray:null,buf8:null,buf32:null,backgroundcolor:0xFFE09090,depthBuffer:null};
var input={forward:false,backward:false,left:false,right:false,jump:false,sprint:false,crouch:false,shoot:false,reload:false,aim:false,mouseX:0,mouseY:0,
       // Gamepad analog values (for smooth movement)
       moveX:0,moveY:0,lookX:0,lookY:0,
       // Gamepad button states (separate from keyboard/mouse)
       gpShoot:false,gpAim:false,gpCrouch:false,gpSprint:false,gpReload:false,gpJumpHeld:false,
       // Weapon controls
       swapWeapon:false,gpSwapWeapon:false,pickupWeapon:false,gpPickupWeapon:false,
       // ADS toggle state
       aimToggled:false,prevGpAim:false};

// Mobile touch controls
var touchControls = {
    enabled: false,        // Auto-enabled on touch devices
    leftStick: { active: false, touchId: null, startX: 0, startY: 0, currentX: 0, currentY: 0 },
    rightStick: { active: false, touchId: null, startX: 0, startY: 0, currentX: 0, currentY: 0 },
    stickRadius: 50,       // Radius of joystick circle
    stickDeadzone: 10,     // Deadzone before input registers
    leftStickPos: { x: 100, y: 0 },   // Will be set based on screen size
    rightStickPos: { x: 0, y: 0 },    // Will be set based on screen size
    weaponSlots: [],       // Hitboxes for weapon icons [{x, y, w, h, index}]
    pickupHitbox: null,    // Hitbox for pickup prompt
    shootButton: { x: 0, y: 0, radius: 45, active: false, touchId: null },
    jumpButton:  { x: 0, y: 0, radius: 32, active: false, touchId: null },
    zoomButton:  { x: 0, y: 0, radius: 32, active: false, touchId: null },
    swapButton:  { x: 0, y: 0, radius: 28, active: false, touchId: null },
    controlsTop: 0,        // Y (viewport) where controls area starts in portrait mode
    // Portrait mode: separate controls canvas below the game canvas
    controlsCanvas: null,  // <canvas id="controls-canvas"> element (portrait only)
    controlsCtx: null,     // 2D context of controls canvas (null = draw on game canvas)
    canvasOffsetY: 0       // Viewport Y of controls canvas top (0 = game canvas, gameH = portrait)
};

var debugUIVisible=true;  // Toggle with Start button
var playerHeightOffset=70; // Player eye height above terrain
var mouseSensitivity    = 0.002;  // Mouse hip look speed
var mouseAdsSensitivity = 0.001;  // Mouse ADS look speed
var bulletVertOffset=0;    // Vertical offset for bullet spawn (negative = below eye level)
var bulletFwdOffset=0;     // Forward offset for bullet spawn (weapon distance from camera)
var bulletHorizOffset=0;   // Horizontal offset for bullet spawn (left/right)
var bulletSize=0.75;       // Bullet rendering scale

// Hitscan/CCD hybrid system
var lastHitscanRays = [];  // Stores rays from most recent shot burst for debug overlay
var hitscanDistance=50;    // Distance for instant hitscan (world units)
var ccdMaxDistance=500;    // Max distance for CCD bullets before despawn
var showHitRanges=true;    // Show hitscan/CCD radius circles on minimap
var showGMD=false;         // Show Gun Mechanics Debug overlay
var showMinimaps=true;     // Show minimaps and legend overlays
var minimapZoomRange=200;  // Minimap zoom range in world units
var sideViewZoomRange=200; // Side view zoom range (synced with minimapZoomRange via Z key)

// Sniper scope mode - modular scope system
var scopeMode = 'forward';  // 'forward' or 'focal'
var activeScope = null;     // Will be set to ScopeForwardPosition or ScopeFocalLength

// UI Scale settings
var uiScale={
    all: 1.0,
    crosshair: 1.0,
    healthbar: 1.0,
    jumpbar: 1.0,
    minimap: 1.0,
    weaponUI: 1.0
};

var gamepad={
    connected:false,
    deadzone:0.15,
    lookSensitivity:0.05,
    adsLookSensitivity:0.03,
    // Previous button states for edge detection
    prevJump:false,
    prevStart:false,
    prevActivate:false,
    prevCancel:false,
    prevFlashlight:false,
    // Standard gamepad mapping (Xbox-style, works with most controllers)
    buttons:{
        jump:4,        // LB (Left Bumper) - hold to charge, release to jump
        crouch:11,     // Right Stick Click (R3)
        activate:0,    // A - same as keyboard F (talk to NPC / Node War activate / accept)
        cancel:1,      // B - same as keyboard Escape (close dialog / cancel)
        reload:2,      // X
        sprint:10,     // Left Stick Click
        shoot:7,       // RT (Right Trigger as button)
        aim:6,         // LT (Left Trigger as button)
        start:9,       // Start button - opens the in-game menu (same as Tab)
        swapWeapon:3,  // Y button - swap weapons
        pickup:2,      // X button - also pickup (context sensitive)
        flashlight:5   // RB (Right Bumper) - same as keyboard L
    },
    axes:{
        moveX:0,       // Left Stick X
        moveY:1,       // Left Stick Y
        lookX:2,       // Right Stick X
        lookY:3        // Right Stick Y
    }
};

var updaterunning=false,time=Date.now(),timelastframe=Date.now(),frames=0,pitchOffset=250,targetFPS=60,frameDuration=1000/targetFPS,lastFrameTime=0,hiddeny;

// ===============================
// Item textures
var textures = {
    bullet: (() => { let i = new Image(); i.src = "images/bullet.png"; return i; })(),
    heart:  (() => { let i = new Image(); i.src = "images/heart.png";  return i; })(),
    tree:   (() => { let i = new Image(); i.src = "images/tree.png";   return i; })(),
    player: (() => { let i = new Image(); i.src = "images/MC_sprite_sheet.png"; return i; })()
};

// ===============================
// Sprite sheet animation state
var playerSprite = {
    frameCount: 12,       // columns (frames per row) in the sprite sheet
    rows: 4,              // rows in the sprite sheet
    currentRow: 0,        // which row to display (0 = first walk cycle)
    currentFrame: 0,      // current frame index within the row
    idleFrame: 0,         // frame to show when standing still
    walkStart: 2,         // first walk-cycle frame (skip 0 and 1)
    walkEnd: 11,          // last walk-cycle frame (inclusive)
    animSpeed: 8,         // world units of movement per frame advance
    distAccum: 0,         // accumulated movement distance
    lastX: 0,             // previous x for distance calc
    lastY: 0,             // previous y for distance calc
    // Explicit frame rectangles per row (pixel coords in sprite sheet)
    // Each row is an array of {x, y, w, h} for every frame in that row
    frameRects: [
        // Row 0 – 12 frames (walk + shoot cycle)
        [
            {x:1,y:0,w:44,h:69},{x:51,y:0,w:57,h:69},{x:120,y:0,w:40,h:69},
            {x:170,y:0,w:36,h:69},{x:216,y:0,w:39,h:69},{x:265,y:0,w:44,h:69},
            {x:319,y:0,w:45,h:69},{x:374,y:0,w:39,h:69},{x:424,y:0,w:36,h:69},
            {x:468,y:0,w:39,h:69},{x:512,y:0,w:44,h:69},{x:571,y:0,w:44,h:69}
        ],
        // Row 1 – 6 frames
        [
            {x:12,y:69,w:36,h:75},{x:53,y:69,w:39,h:75},{x:105,y:69,w:38,h:75},
            {x:150,y:69,w:41,h:75},{x:197,y:69,w:37,h:75},{x:240,y:69,w:36,h:75}
        ],
        // Row 2 – 12 frames (mirror of row 0)
        [
            {x:1,y:144,w:44,h:75},{x:51,y:144,w:57,h:75},{x:120,y:144,w:40,h:75},
            {x:170,y:144,w:37,h:75},{x:216,y:144,w:39,h:75},{x:265,y:144,w:44,h:75},
            {x:319,y:144,w:46,h:75},{x:374,y:144,w:39,h:75},{x:424,y:144,w:36,h:75},
            {x:468,y:144,w:39,h:75},{x:512,y:144,w:44,h:75},{x:571,y:144,w:44,h:75}
        ],
        // Row 3 – 6 frames
        [
            {x:12,y:219,w:36,h:56},{x:53,y:219,w:39,h:56},{x:105,y:219,w:38,h:56},
            {x:150,y:219,w:41,h:56},{x:198,y:219,w:36,h:56},{x:240,y:219,w:39,h:56}
        ]
    ]
};

// ===============================
// 3D Cube - Blue, 100 units tall, placed in front of player start
var cube = {
    x: 0,       // world X position (centered in front of player)
    y: -80,     // world Y position (negative Y = in front at angle 0)
    z: 0,       // base height (will sit on terrain)
    size: 100,  // 100 feet/units tall (and wide/deep)
    color: 0xFF0000FF  // Blue in ABGR format
};

// Precomputed trig values for current frame (set in RenderCube)
var cubeSinYaw = 0, cubeCosYaw = 0;

// ===============================
// Gun Viewmodel (first-person weapon)
var gunModel = {
    vertices: [],      // Array of {x, y, z}
    faces: [],         // Array of vertex indices
    loaded: false,
    texture: null,
    // Current interpolated position (updated each frame)
    offsetX: 100,      // pixels from right
    offsetY: 50,       // pixels from bottom
    offsetZ: 0,        // depth offset
    scale: 300,        // rendering scale
    rotationX: 0,      // X-axis rotation in degrees
    rotationY: 0,      // Y-axis rotation in degrees
    rotationZ: 0,      // Z-axis rotation in degrees

    // ADS (Aim Down Sights) position - gun raised to eye level
    adsOffsetX: 0,     // unused — ADS barrel always locks to screen center
    adsOffsetY: 0,     // unused — ADS barrel always locks to screen center
    adsOffsetZ: 0,
    adsScale: 350,
    adsRotationX: 0,
    adsRotationY: 0,
    adsRotationZ: 0,

    // Hip fire position - gun held at hip/chest level
    hipOffsetX: 100,   // offset to the right
    hipOffsetY: 50,    // lower position
    hipOffsetZ: 0,
    hipScale: 300,
    hipRotationX: 0,
    hipRotationY: 0,
    hipRotationZ: 0,

    // Interpolation factor (0 = hip, 1 = ADS)
    adsLerp: 0,
    adsLerpSpeed: 0.15,  // how fast to transition

    // Barrel configuration (gun-relative: forward/up/right along gun direction)
    // Current/interpolated values (updated each frame based on adsLerp)
    barrelX: 0.26,     // forward along gun barrel
    barrelY: 0.08,     // up from gun center
    barrelZ: 0.0,      // right from gun center
    barrelYaw: 0,      // horizontal aim offset in degrees (left/right)

    // ADS barrel settings
    adsBarrelX: 0.04,
    adsBarrelY: 0,
    adsBarrelZ: 0,
    adsBarrelYaw: 0,

    // Hip barrel settings
    hipBarrelX: -0.5,
    hipBarrelY: -0.3,
    hipBarrelZ: -0.3,
    hipBarrelYaw: 15,

    barrelDistance: 1, // world units in front of barrel to spawn bullet

    // World-space offset from camera (where the gun pivot is held, in world units)
    // 1 WU = 30 cm. These are realistic viewmodel distances.
    // Current/interpolated values (updated each frame based on adsLerp)
    worldForward: 2.2,
    worldRight: 5,
    worldDown: 5,

    // ADS world offset — gun centered, pulled forward for iron sights
    adsWorldForward: 1,
    adsWorldRight: 0,
    adsWorldDown: 1,

    // Hip fire world offset — gun held to the right side
    hipWorldForward: 2.2,
    hipWorldRight: 5,
    hipWorldDown: 5,

    // Pivot mode: 'barrel' for ADS (pivot at bullet spawn), 'grip' for hip fire
    pivotMode: 'grip'  // current pivot mode
};

// ===============================
// Gun Viewmodel - Visual-only settings for the on-screen 3D gun model.
// These are completely independent from gun mechanics (bullet direction,
// barrel world position, minimap). Gun mechanics stay in gunModel above.
var gunViewModel = {
    // Current interpolated visual values (updated each frame)
    offsetX: 223,      // pixels from screen center (right = positive)
    offsetY: 290,      // pixels from screen center (down = positive)
    offsetZ: -100,     // depth scale offset
    scale: 762,        // rendering scale
    rotationX: 23,
    rotationY: -81,
    rotationZ: -28,

    // Hip fire visual settings
    hipOffsetX: 223,
    hipOffsetY: 290,
    hipOffsetZ: -100,
    hipScale: 762,
    hipRotationX: 23,
    hipRotationY: -81,
    hipRotationZ: -28,

    // ADS visual settings
    adsOffsetX: 0,
    adsOffsetY: 165,
    adsOffsetZ: -100,
    adsScale: 1000,
    adsRotationX: 0,
    adsRotationY: -90,
    adsRotationZ: 0,

    // Pitch parallax: how much the gun shifts vertically when looking up/down in hip fire.
    // 0 = no parallax (gun stays fixed to screen), 1 = full world-locked feel.
    // Fades to 0 in ADS automatically.
    hipPitchParallax: 0.4
};

// ===============================
// Test Target - floating circle for gun mechanics testing
var testTarget = {
    enabled: false,
    x: 0,           // world X position (will be set relative to player)
    y: 0,           // world Y position
    z: 0,           // world Z position (height)
    radius: 2,      // target radius in world units
    distance: 30,   // distance from player to spawn target
    color: '#ff0000',
    ringColor: '#ffffff',
    // Calculated each frame
    playerDistance: 0,
    angleToTarget: 0,    // horizontal angle difference
    pitchToTarget: 0,    // vertical angle to target
    aimError: 0,         // how far off aim is from target center
    bulletHitPos: null,  // last bullet impact position relative to target
    hits: 0,
    misses: 0
};

// ── Admin / developer flag ───────────────────────────────────────────────────
// Set to true after login when the authenticated username is "heromachine".
// Dev features (settings menu, debug overlay, side-view minimap, etc.) are
// hidden for all other users.
var isAdmin = false;

// ===============================
// Multiplayer / Nakama State
var nakamaState = {
    remotePlayers: {},   // userId -> { userId, username, x, y, height, angle, health, lastSeen }
    myClan:        null, // "iron_ravens" | "ember_tide" | "silent_root"
    chatBubbles:   [],   // [ { senderId, x, y, emoji, shout, expiry } ]
    radarReveals:  {},   // userId -> { x, y, expiry } — players revealed by shout
    myKills: 0,
    myPing:  null,

    // Node War state (server-authoritative, updated via opcodes)
    nw: {
        nodes: [
            { facilityId: 'fac_1', x:  250, y:  180, status: 'neutral', team: null },
            { facilityId: 'fac_2', x: -250, y:  180, status: 'neutral', team: null },
            { facilityId: 'fac_3', x:    0, y:  300, status: 'neutral', team: null },
            { facilityId: 'fac_4', x:  250, y: -180, status: 'neutral', team: null },
            { facilityId: 'fac_5', x: -250, y: -180, status: 'neutral', team: null },
            { facilityId: 'fac_6', x:    0, y: -300, status: 'neutral', team: null },
        ],
        npcPositions: {},   // facilityId → hasNpc (bool) — rebroadcast by server on full reset
        key:          null, // { exists, teamOwner, holderUserId, groundPos:{x,y} }
        mainframe:    null, // { active, countdownSeconds }
        opBuffHolder: null, // userId of current OP buff holder
        factions:     {},   // userId → 'clan1'|'clan2'|'guest'
        winningTeam:  null, // set on MATCH_WIN
    },
};

// ===============================
// Scoreboard state
var showScoreboard = false;
