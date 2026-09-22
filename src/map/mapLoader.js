// ===============================
// Map Loading
// ===============================
"use strict";

function DownloadImagesAsync(urls){
    return new Promise(function(resolve){
        var pending=urls.length,result=[];
        if(!pending){resolve([]);return;}
        urls.forEach(function(url,i){
            var img=new Image();
            img.onload=function(){
                var tcv=document.createElement("canvas"),
                    tcx=tcv.getContext("2d");
                tcv.width=map.width;
                tcv.height=map.height;
                tcx.drawImage(img,0,0,map.width,map.height);
                result[i]=tcx.getImageData(0,0,map.width,map.height).data;
                pending--;
                if(!pending)resolve(result);
            };
            img.src=url;
        });
    });
}

function LoadMap(files){
    var f=files.split(";");
    DownloadImagesAsync(["maps/"+f[0]+".png","maps/"+f[1]+".png"]).then(OnLoadedImages);
}

function OnLoadedImages(result){
    var datac = result[0], datah = result[1];
    // AUTHORING: writes a whole heightmap, so it goes through the raw door
    // rather than the sampling accessors. When the tile pool lands, this
    // becomes "load one tile into the pool".
    var m = Terrain.rawMap();
    for (var i = 0; i < m.width * m.height; i++) {
        m.color[i] = 0xFF000000 |
                     (datac[(i<<2)+2] << 16) |
                     (datac[(i<<2)+1] << 8) |
                      datac[(i<<2)+0];
        m.altitude[i] = datah[i<<2];
    }

    // Flatten terrain under the cube
    flattenTerrainUnderCube();

    // Swapping maps can leave the player buried in the new terrain. Lift them
    // to ground level if they are below it; never push them down.
    var _g = getGroundHeight(camera.x, camera.y);
    if (camera.height < _g) { camera.height = _g; camera.velocityY = 0; }

    // Start draw loop
    Draw();
}

// Flatten terrain within the cube's footprint to prevent terrain poking through
function flattenTerrainUnderCube() {
    var s = cube.size;
    var minX = Math.floor(cube.x - s/2);
    var maxX = Math.ceil(cube.x + s/2);
    var minY = Math.floor(cube.y - s/2);
    var maxY = Math.ceil(cube.y + s/2);

    // Find the minimum height within the cube's footprint
    // AUTHORING: reshapes terrain in place. Reads go through the seam's index
    // helper so the wrap rule lives in one place; the write stays raw.
    var m = Terrain.rawMap();
    var minHeight = 255;
    for (var y = minY; y <= maxY; y++) {
        for (var x = minX; x <= maxX; x++) {
            var h = Terrain.heightAt(x, y);
            if (h < minHeight) minHeight = h;
        }
    }

    // Set all terrain within cube footprint to that minimum height
    for (var y = minY; y <= maxY; y++) {
        for (var x = minX; x <= maxX; x++) {
            m.altitude[Terrain.indexAt(x, y)] = minHeight;
        }
    }

    // Add one fixed heart as a test
    items.push({
        type: "heart",
        x: 20, y: 110, z: getGroundHeight(20,110)+50,
        dx: 0, dy: 0, dz: 0,
        image: textures.heart
    });

    // Spawn weapons near player start for testing.
    // Cube is at x=0, y=-80, size=100 → footprint x:-50..50, y:-130..-30. Keep clear of it.
    // Pistol — right of start
    groundWeapons.push({ type: "pistol",      x:  40, y:  40, z: getRawTerrainHeight( 40,   40) });
    // Shotgun — left of cube
    groundWeapons.push({ type: "shotgun",     x: -90, y: -80, z: getRawTerrainHeight(-90,  -80) });
    // Tracer — left diagonal, past cube
    groundWeapons.push({ type: "tracer",      x: -90, y:-160, z: getRawTerrainHeight(-90, -160) });
    // Plasma Rifle — right diagonal
    groundWeapons.push({ type: "plasmaRifle", x:  90, y: -80, z: getRawTerrainHeight( 90,  -80) });
    // Plasma Pistol — right diagonal, past cube
    groundWeapons.push({ type: "plasmaPistol",x:  90, y:-160, z: getRawTerrainHeight( 90, -160) });

    // Spawn test Prowler enemies (outside cube footprint x:-50..50, y:-130..-30)
    enemies.push(createProwler( 120,  60, { startAngle: 0,    leashRadius: 50 }));
    enemies.push(createProwler(-110, 120, { startAngle: 2.5,  leashRadius: 60, color: '#AA0044', outlineColor: '#440022' }));

    // Spawn random trees on green-ish terrain
    spawnRandomItems("tree", textures.tree, {
        step: 8,
        chance: 0.01,
        colorCheck: (col) => ((col & 0x00FF00) > 0x004000)
    });
}
