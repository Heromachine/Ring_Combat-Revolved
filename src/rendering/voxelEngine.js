// ===============================
// Voxel Terrain Rendering Engine
// ===============================
"use strict";

// Terrain height functions.
// These are now thin delegates to Terrain (src/map/terrain.js), which owns
// every read of map.altitude/map.color. The global names are kept because
// ~20 call sites use them and there is no value in churning those; what
// matters is that the world's shape is defined in one place.
var getRawTerrainHeight = (x, y) => Terrain.heightAt(x, y);
// Water surface where there is water, else the ground -- for hover vehicles.
var getSurfaceHeight = (x, y) => Terrain.surfaceAt(x, y);

function getGroundHeight(x, y) { return Terrain.groundAt(x, y); }

// Set by Render() every frame: is the eye below the water surface, and how
// deep. Read by the ring backdrop (skipped underwater) and Flip() (blur).
var underwaterState = { active: false, depth: 0 };

// Render terrain using voxel space algorithm
function Render(){
    var sw=screendata.canvas.width,sh=screendata.canvas.height,
        sinang=Math.sin(camera.angle),cosang=Math.cos(camera.angle),
        deltaz=1,depth=screendata.depthBuffer;

    // Hoisted once per frame. The sample loop below runs millions of times, so
    // it reads these arrays directly rather than calling Terrain per pixel --
    // the seam still owns the INDEX (Terrain.indexAt), which is the part that
    // changes shape when the world becomes tiled.
    var _m=Terrain.rawMap(), terrainAlt=_m.altitude, terrainCol=_m.color;

    // Two terrain backings. The branch is hoisted per frame and is perfectly
    // predictable inside the loop. In chunk mode colour comes from a 256-entry
    // LUT keyed by height rather than a parallel colour array -- 4 bytes per
    // texel saved, same cost to read.
    var _chunks = Terrain.usingChunks();
    // One colour LUT per biome, further split into day/night-lit variants
    // by ChunkTerrain.litLUT() (see chunkTerrain.js) -- still picked when
    // the chunk changes (below), never per pixel. litLUT() degrades to the
    // plain unlit LUT when the ring/DayNight aren't active, so this stays
    // correct outside ring mode too.
    // Hoisted chunk internals. Calling ChunkTerrain.heightAt() per pixel
    // measured 178 ms/frame against 31 ms for the array path -- the call plus
    // its floor/divide per sample is far too expensive in this loop. Inlined
    // with shifts and masks, plus a one-entry cache because consecutive
    // samples along a scanline almost always land in the same chunk.
    var _cSlots=null,_cCoords=null,_cLive=null,_cBiomes=null,_cShift=9,_cMask=511,_cDim=8,_cDimMask=7;
    var _lastCx=0x7fffffff,_lastCy=0x7fffffff,_lastChunk=null,_lastLut=null,_lastRawLut=null;
    // Unlit colour per written pixel, for the flashlight (see screenBuffer.js
    // albedoBuffer()). The raw LUT is picked alongside the lit one when the
    // chunk changes, and only READ when a sample actually writes pixels
    // below -- samples hidden behind nearer terrain pay nothing for it.
    var _rawLuts = _chunks ? ChunkTerrain.colorLUTs() : null;
    var _albedo = (typeof albedoBuffer === 'function') ? albedoBuffer() : null;
    if(_chunks){
        _cSlots=ChunkTerrain.slots(); _cCoords=ChunkTerrain.coords(); _cLive=ChunkTerrain.liveFlags();
        _cBiomes=ChunkTerrain.biomes();
        _cShift=ChunkTerrain.SHIFT; _cMask=ChunkTerrain.LOCAL_MASK;
        _cDim=ChunkTerrain.RING_DIM; _cDimMask=ChunkTerrain.RING_MASK;
    }

    // Ring bend, hoisted per frame. The maths is inlined into the sample loop
    // below rather than calling ringApply() per pixel -- that loop runs
    // millions of times a frame and a call per sample is not affordable.
    var _ringOn = (typeof ringWorld !== 'undefined') && ringWorld.enabled;
    var _rR=0,_rInvR=0,_rFlat=0,_rL=0,_rHalf=0,_camY=camera.y;
    if(_ringOn){
        _rR=ringWorld.ringRadius; _rInvR=ringWorld._invR; _rFlat=ringWorld.flatRadius;
        _rL=ringWorld.ringLength; _rHalf=ringWorld._halfLen;
    }

    // Underwater (baked heightmap, eye below the sea surface): draw the sea
    // FLOOR instead of the surface, with every sample fogged toward a water
    // colour by distance. Visibility shrinks and the fog darkens with depth.
    // Above water this costs one hoisted flag check per sample.
    // The water surface is the one at the camera's position -- sea level, or
    // a baked lake's own level -- and only counts if the camera is over water.
    var _sea = null;
    if (_chunks && WorldGen.usingHeightmap && WorldGen.usingHeightmap()) {
        var _wsC = WorldGen.waterSurfaceAt ? WorldGen.waterSurfaceAt(camera.x, camera.y) : WorldGen.config.seaLevel;
        if (getRawTerrainHeight(camera.x, camera.y) < _wsC) _sea = _wsC;
    }
    var _under = _sea !== null && camera.height < _sea;
    var _uDepth = _under ? _sea - camera.height : 0;
    underwaterState.active = _under; underwaterState.depth = _uDepth;
    var _uwet = false, _bedCol = 0;
    if (_under) {
        // Fog itself is a post-pass over the depth buffer (underwaterFog(),
        // run from Flip()), so buildings, the cube, items and remote players
        // -- all drawn with depth -- fog by distance exactly like terrain.
        underwaterState.invVis = (1 + _uDepth / 30) / 260;   // ~260 WU at the surface, ~110 at 40 deep
        var _dk = Math.exp(-_uDepth / 90);
        underwaterState.fog = [22 * _dk, 64 * _dk, 84 * _dk];
        _bedCol = WorldGen.seabedColor(_uDepth);
    }

    hiddeny.fill(sh);
    for(var z=1;z<camera.distance;z+=deltaz){
        var plx=-cosang*z-sinang*z,ply=sinang*z-cosang*z,prx=cosang*z-sinang*z,pry=-sinang*z-cosang*z,dx=(prx-plx)/sw,dy=(pry-ply)/sw;
        plx+=camera.x;ply+=camera.y;var invz = camera.focalLength / z;
        for(var i=0;i<sw;i++){
            var _alt, _col, _curRawLut, _colAlt;
            if(_chunks){
                var _fx=Math.floor(plx), _fy=Math.floor(ply);
                var _cx=_fx>>_cShift, _cy=_fy>>_cShift;
                if(_cx!==_lastCx||_cy!==_lastCy){
                    _lastCx=_cx; _lastCy=_cy;
                    var _sl=((_cy&_cDimMask)*_cDim)+(_cx&_cDimMask);
                    var _hit=(_cLive[_sl]&&_cCoords[_sl*2]===_cx&&_cCoords[_sl*2+1]===_cy);
                    _lastChunk=_hit ? _cSlots[_sl] : null;
                    // Biome (and therefore which LUT) only needs re-picking
                    // when the chunk changes -- zero added per-pixel cost.
                    // litLUT() itself is a cache lookup keyed by (biome,
                    // chunk-Y), not a 256-entry rebuild, EXCEPT the first
                    // time a given chunk-Y is seen after DayNight.epoch()
                    // ticks (at most every 15s) -- still only paid here,
                    // never inside the per-pixel path below.
                    _lastLut=_hit ? ChunkTerrain.litLUT(_cBiomes[_sl], _cy<<_cShift) : null;
                    _lastRawLut=_hit ? _rawLuts[_cBiomes[_sl]] : null;
                }
                // Texel = height (low 16 bits) | colour index << 16 (see
                // chunkTerrain.js). A miss returns a bare height.
                var _tex=_lastChunk ? _lastChunk[((_fy&_cMask)<<_cShift)+(_fx&_cMask)]
                                    : (_under ? ChunkTerrain.heightAt(plx,ply) : ChunkTerrain.surfaceAt(plx,ply));
                _alt=_lastChunk ? (_tex&0xFFFF) : _tex;
                if(_under){
                    // water texel: drop from the stored surface to the floor
                    var _uci=_tex>>>16;
                    _uwet = _lastChunk ? ((_uci>>8)===3) : (_alt < _sea);
                    if(_uwet && _lastChunk) _alt -= (_uci & 255);
                }
                // Miss (chunk not resident): biome must be looked up directly
                // since there is no stored chunk to read it from. Misses are
                // already the expensive path (a full function call above);
                // one more cheap lookup here does not change that.
                if(_lastLut){ _colAlt=_tex>>>16; _col=_lastLut[_colAlt]; _curRawLut=_lastRawLut; }
                else {
                    var _bm=WorldGen.biomeIndexAt(ply);
                    _colAlt=WorldGen.colorIndex(_alt, WorldGen.materialAtWorld(plx,ply));
                    _col=ChunkTerrain.litLUT(_bm, ply)[_colAlt]; _curRawLut=_rawLuts[_bm];
                }
                // _colAlt: the LUT index, fixed before the ring bend below changes _alt
            } else {
                var mapoffset=Terrain.indexAt(plx,ply);
                _alt=terrainAlt[mapoffset];
                _col=terrainCol[mapoffset];
                _curRawLut=null;
            }
            if(_ringOn){
                // wrapped arc distance from the camera along the loop
                var _s=((((ply-_camY)+_rHalf)%_rL)+_rL)%_rL-_rHalf;
                if(_s<0)_s=-_s;
                if(_s>_rFlat)_alt+=_rR*(1-Math.cos((_s-_rFlat)*_rInvR));
            }
            var heightonscreen=(camera.height-_alt)*invz+camera.horizon;
            if(heightonscreen<hiddeny[i]){
                var _raw=_curRawLut ? _curRawLut[_colAlt] : _col;
                for(var k=heightonscreen|0;k<hiddeny[i];k++){
                    var idx=k*sw+i;
                    if(z<depth[idx]){
                        screendata.buf32[idx]=(_under&&_uwet)?_bedCol:_col;depth[idx]=z;if(_albedo)_albedo[idx]=_raw;
                    }
                }
                hiddeny[i]=heightonscreen;
            }
            plx+=dx;ply+=dy;
        }
        if(z>1000)deltaz+=0.02;else deltaz+=0.005;
    }
}

// Underwater fog: blend every pixel toward the water colour by its OWN
// depth-buffer distance -- terrain, buildings, items, players alike; sky
// (infinite depth) becomes pure fog. Run once per frame, after everything
// with depth has drawn and before the HUD (see Flip()). The falloff is a
// 1024-entry table in 4 WU steps, so the pass is one read + blend per pixel.
var _uwFogLut = new Float32Array(1024);
function underwaterFog() {
    var st = underwaterState;
    if (!st.active) return;
    var buf = screendata.buf32, depth = screendata.depthBuffer, n = buf.length;
    var inv = st.invVis, fr = st.fog[0], fg = st.fog[1], fb = st.fog[2];
    for (var k = 0; k < 1024; k++) _uwFogLut[k] = 1 - Math.exp(-(k * 4) * inv);
    var fogCol = (0xFF000000 | (fb << 16) | (fg << 8) | fr) >>> 0;
    for (var p = 0; p < n; p++) {
        var d = depth[p];
        if (d === Infinity) { buf[p] = fogCol; continue; }
        var qi = (d * 0.25) | 0, f = _uwFogLut[qi > 1023 ? 1023 : qi];
        var c = buf[p], r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
        buf[p] = (0xFF000000 | ((b + (fb - b) * f) << 16) | ((g + (fg - g) * f) << 8) | (r + (fr - r) * f)) >>> 0;
    }
}

function horizonToPitchRad(h){return h*90/500*Math.PI/180;}
