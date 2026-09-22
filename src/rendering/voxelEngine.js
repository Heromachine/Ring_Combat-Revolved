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

function getGroundHeight(x, y) { return Terrain.groundAt(x, y); }

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

    // Ring bend, hoisted per frame. The maths is inlined into the sample loop
    // below rather than calling ringApply() per pixel -- that loop runs
    // millions of times a frame and a call per sample is not affordable.
    var _ringOn = (typeof ringWorld !== 'undefined') && ringWorld.enabled;
    var _rR=0,_rInvR=0,_rFlat=0,_rL=0,_rHalf=0,_camY=camera.y;
    if(_ringOn){
        _rR=ringWorld.ringRadius; _rInvR=ringWorld._invR; _rFlat=ringWorld.flatRadius;
        _rL=ringWorld.ringLength; _rHalf=ringWorld._halfLen;
    }

    hiddeny.fill(sh);
    for(var z=1;z<camera.distance;z+=deltaz){
        var plx=-cosang*z-sinang*z,ply=sinang*z-cosang*z,prx=cosang*z-sinang*z,pry=-sinang*z-cosang*z,dx=(prx-plx)/sw,dy=(pry-ply)/sw;
        plx+=camera.x;ply+=camera.y;var invz = camera.focalLength / z;
        for(var i=0;i<sw;i++){
            var mapoffset=Terrain.indexAt(plx,ply);
            var _alt=terrainAlt[mapoffset];
            if(_ringOn){
                // wrapped arc distance from the camera along the loop
                var _s=((((ply-_camY)+_rHalf)%_rL)+_rL)%_rL-_rHalf;
                if(_s<0)_s=-_s;
                if(_s>_rFlat)_alt+=_rR*(1-Math.cos((_s-_rFlat)*_rInvR));
            }
            var heightonscreen=(camera.height-_alt)*invz+camera.horizon;
            if(heightonscreen<hiddeny[i]){
                for(var k=heightonscreen|0;k<hiddeny[i];k++){
                    var idx=k*sw+i;
                    if(z<depth[idx]){screendata.buf32[idx]=terrainCol[mapoffset];depth[idx]=z;}
                }
                hiddeny[i]=heightonscreen;
            }
            plx+=dx;ply+=dy;
        }
        if(z>1000)deltaz+=0.02;else deltaz+=0.005;
    }
}

function horizonToPitchRad(h){return h*90/500*Math.PI/180;}
