// OBJ hover bike display near the default spawn. Model axes in speed-e.obj:
// +X is the nose, +Y is up, and Z is lateral. Convert Y-up to game Z-up.
"use strict";
// Park beside the large wood-textured box so it is easy to find and not occluded
// by the box itself. Keep this anchored to the box if its location changes.
var hoverBike = { x: cube.x + cube.size / 2 + 34, y: cube.y, scale: 10, loaded: false, faces: [], vertices: [], material: "Frame_|_charcoal" };
var _bikeColors = {
  "Armor_|_lit_facets": [255, 65, 220], "Armor_|_shadow_facets": [55, 90, 245],
  "Armor_|_violet": [180, 35, 255], "Cockpit_|_dark_upholstery": [35, 15, 75],
  "Frame_|_charcoal": [24, 32, 72], "Frame_|_gunmetal": [40, 205, 235],
  "Lights_|_electric_blue": [0, 245, 255], "Lights_|_violet_blue": [255, 45, 190]
};
var _bikeTextures = {};
fetch("3D_models/speed-e.obj").then(function(r){ if(!r.ok) throw Error("speed-e.obj HTTP "+r.status); return r.text(); }).then(function(src){
  var lines=src.split(/\r?\n/), vertices=[], faces=[], material="Frame_|_charcoal";
  lines.forEach(function(line){
    var p=line.trim().split(/\s+/); if(p.length<4)return;
    if(p[0]==="v") vertices.push([+p[1],+p[2],+p[3]]);
    else if(p[0]==="usemtl") material=p.slice(1).join(" ");
    else if(p[0]==="f") { var ids=p.slice(1).map(function(v){return parseInt(v.split("/")[0],10)-1;}); for(var i=1;i<ids.length-1;i++) faces.push({ids:[ids[0],ids[i],ids[i+1]],material:material}); }
  });
  hoverBike.vertices=vertices; hoverBike.faces=faces; hoverBike.loaded=vertices.length>0&&faces.length>0;
}).catch(function(e){console.error("Hover bike model failed to load",e);});
function RenderHoverBike(){
  if(!hoverBike.loaded || hoverBike.destroyed)return;
  cubeSinYaw=Math.sin(camera.angle); cubeCosYaw=Math.cos(camera.angle);
  var s=hoverBike.scale, ground=getRawTerrainHeight(hoverBike.x,hoverBike.y)+8;
  var cs=Math.cos(hoverBike.yaw||0), sn=Math.sin(hoverBike.yaw||0);
  var world=hoverBike.vertices.map(function(v){
    var lx=(v[0]+0.095)*s, ly=(v[1]-0.09)*s, lz=v[2]*s;
    // Nose (+model X) follows hoverBike.yaw; yaw zero points toward world -Y.
    var side=lz*cs-lx*sn, forward=lx*cs+lz*sn;
    return {x:hoverBike.x+side,y:hoverBike.y-forward,z:ground+ly};
  });
  // Keep the silhouette readable at pitch-black world night; light strips stay vivid.
  var night=(typeof DayNight!=="undefined")?Math.max(0.55,DayNight.intensityAtY(hoverBike.y)):1;
  hoverBike.faces.forEach(function(f){
    var rgb=_bikeColors[f.material]||[100,100,110], key=f.material;
    if(!_bikeTextures[key])_bikeTextures[key]=solidTex(packColor(rgb[0],rgb[1],rgb[2]));
    var pts=f.ids.map(function(id,i){var p=world[id];return {x:p.x,y:p.y,z:p.z,u:i===1?1:0,v:i===2?1:0};});
    var isLight=f.material.indexOf("Lights_")===0;
    var shade=(isLight?1.5:1.15)*(isLight?Math.max(0.85,night):night);
    _clipAndDraw(pts,shade,_bikeTextures[key]);
  });
}
