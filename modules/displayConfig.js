/**
 * Display Configuration - Standard Gaming Settings
 * VoxelSpace Engine
 */

var DisplayConfig = {
    // ===================
    // Resolution Settings
    // ===================
    resolution: {
        // Base render resolution (internal)
        baseWidth: 800,
        baseHeight: 450,  // 16:9 aspect

        // Aspect ratio lock
        aspectRatio: 16 / 9,
        maintainAspectRatio: true,

        // Resolution scaling (1.0 = native, 0.5 = half, 2.0 = double)
        renderScale: 1.0,

        // Common resolution presets
        presets: {
            '720p':  { width: 1280, height: 720 },
            '900p':  { width: 1600, height: 900 },
            '1080p': { width: 1920, height: 1080 },
            '1440p': { width: 2560, height: 1440 },
            '4K':    { width: 3840, height: 2160 }
        },
        currentPreset: '720p'
    },

    // ===================
    // Display Mode
    // ===================
    display: {
        // 'windowed', 'borderless', 'fullscreen'
        mode: 'windowed',

        // VSync
        vsync: true,

        // Target frame rate (when vsync off)
        targetFPS: 60,

        // Frame rate cap options
        fpsOptions: [30, 60, 90, 120, 144, 165, 240, 'unlimited'],

        // Show FPS counter
        showFPS: true,

        // Fullscreen on startup
        fullscreenOnStart: false
    },

    // ===================
    // Graphics Quality
    // ===================
    graphics: {
        // Overall quality preset: 'low', 'medium', 'high', 'ultra', 'custom'
        qualityPreset: 'high',

        // Render distance (terrain)
        renderDistance: 800,
        renderDistanceOptions: {
            low: 400,
            medium: 600,
            high: 800,
            ultra: 1200
        },

        // Terrain detail level
        terrainDetail: 1.0,  // 1.0 = full, 0.5 = half detail

        // Shadow quality (future)
        shadows: 'medium',
        shadowOptions: ['off', 'low', 'medium', 'high'],

        // Anti-aliasing (future)
        antiAliasing: 'none',
        antiAliasingOptions: ['none', 'FXAA', 'MSAA 2x', 'MSAA 4x'],

        // Texture quality
        textureQuality: 'high',
        textureOptions: ['low', 'medium', 'high'],

        // Effects
        particleEffects: true,
        bulletTrails: true,
        muzzleFlash: true
    },

    // ===================
    // Field of View
    // ===================
    fov: {
        default: 90,
        min: 60,
        max: 120,
        current: 90
    },

    // ===================
    // UI Settings
    // ===================
    ui: {
        // HUD scale (0.5 - 2.0)
        hudScale: 1.0,

        // Minimap
        minimapEnabled: true,
        minimapSize: 200,  // pixels
        minimapOpacity: 0.8,

        // Crosshair
        crosshairEnabled: true,
        crosshairStyle: 'dot',  // 'dot', 'cross', 'circle', 'custom'
        crosshairColor: '#00FF00',
        crosshairSize: 10,

        // Health bar
        healthBarEnabled: true,
        healthBarPosition: 'bottom-left',

        // Ammo counter
        ammoCounterEnabled: true,
        ammoCounterPosition: 'bottom-right',

        // Debug info
        showDebugInfo: false
    },

    // ===================
    // Brightness & Color
    // ===================
    color: {
        brightness: 1.0,      // 0.5 - 1.5
        contrast: 1.0,        // 0.5 - 1.5
        gamma: 1.0,           // 0.5 - 2.0
        saturation: 1.0       // 0.0 - 2.0
    },

    // ===================
    // Performance
    // ===================
    performance: {
        // Dynamic resolution scaling
        dynamicResolution: false,
        dynamicResolutionTarget: 60,  // target FPS
        dynamicResolutionMin: 0.5,    // minimum scale

        // Frame smoothing
        frameSmoothing: true,

        // Reduce input lag
        reducedInputLag: false,

        // Background FPS limit
        backgroundFPSLimit: 30
    }
};

// ===================
// Helper Functions
// ===================

/**
 * Apply a quality preset
 */
DisplayConfig.applyQualityPreset = function(preset) {
    switch(preset) {
        case 'low':
            this.graphics.renderDistance = this.graphics.renderDistanceOptions.low;
            this.graphics.terrainDetail = 0.5;
            this.graphics.shadows = 'off';
            this.graphics.antiAliasing = 'none';
            this.graphics.textureQuality = 'low';
            this.graphics.particleEffects = false;
            break;
        case 'medium':
            this.graphics.renderDistance = this.graphics.renderDistanceOptions.medium;
            this.graphics.terrainDetail = 0.75;
            this.graphics.shadows = 'low';
            this.graphics.antiAliasing = 'none';
            this.graphics.textureQuality = 'medium';
            this.graphics.particleEffects = true;
            break;
        case 'high':
            this.graphics.renderDistance = this.graphics.renderDistanceOptions.high;
            this.graphics.terrainDetail = 1.0;
            this.graphics.shadows = 'medium';
            this.graphics.antiAliasing = 'FXAA';
            this.graphics.textureQuality = 'high';
            this.graphics.particleEffects = true;
            break;
        case 'ultra':
            this.graphics.renderDistance = this.graphics.renderDistanceOptions.ultra;
            this.graphics.terrainDetail = 1.0;
            this.graphics.shadows = 'high';
            this.graphics.antiAliasing = 'MSAA 4x';
            this.graphics.textureQuality = 'high';
            this.graphics.particleEffects = true;
            break;
    }
    this.graphics.qualityPreset = preset;
};

/**
 * Get canvas dimensions maintaining aspect ratio
 */
DisplayConfig.getCanvasDimensions = function(containerWidth, containerHeight) {
    var targetAspect = this.resolution.aspectRatio;
    var containerAspect = containerWidth / containerHeight;

    var width, height;

    if (this.resolution.maintainAspectRatio) {
        if (containerAspect > targetAspect) {
            // Container is wider - fit to height
            height = containerHeight;
            width = height * targetAspect;
        } else {
            // Container is taller - fit to width
            width = containerWidth;
            height = width / targetAspect;
        }
    } else {
        width = containerWidth;
        height = containerHeight;
    }

    // Apply render scale
    var renderWidth = Math.floor(width * this.resolution.renderScale);
    var renderHeight = Math.floor(height * this.resolution.renderScale);

    // Cap at base resolution for performance
    renderWidth = Math.min(renderWidth, this.resolution.baseWidth);
    renderHeight = Math.min(renderHeight, this.resolution.baseHeight);

    return {
        canvasWidth: Math.floor(width),
        canvasHeight: Math.floor(height),
        renderWidth: renderWidth,
        renderHeight: renderHeight
    };
};

/**
 * Save settings to localStorage
 */
DisplayConfig.save = function() {
    try {
        localStorage.setItem('ringcombat_display_config', JSON.stringify({
            resolution: this.resolution,
            display: this.display,
            graphics: this.graphics,
            fov: this.fov,
            ui: this.ui,
            color: this.color,
            performance: this.performance
        }));
        return true;
    } catch(e) {
        console.error('Failed to save display config:', e);
        return false;
    }
};

/**
 * Load settings from localStorage
 */
DisplayConfig.load = function() {
    try {
        var saved = localStorage.getItem('ringcombat_display_config');
        if (saved) {
            var config = JSON.parse(saved);
            // Merge saved config with defaults (to handle new settings)
            Object.keys(config).forEach(function(key) {
                if (DisplayConfig[key]) {
                    Object.assign(DisplayConfig[key], config[key]);
                }
            });
            return true;
        }
    } catch(e) {
        console.error('Failed to load display config:', e);
    }
    return false;
};

/**
 * Reset to defaults
 */
DisplayConfig.resetToDefaults = function() {
    localStorage.removeItem('ringcombat_display_config');
    location.reload();
};

// DisplayConfig.load() is called explicitly in beginGame() for admin users only.
