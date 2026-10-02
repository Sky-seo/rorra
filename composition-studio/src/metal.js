import * as THREE from 'three';

// A neutral photographic studio: broad white cards and soft dark separators.
export function createStudioEnvironment(renderer) {
 const width=2048,height=1024,data=new Float32Array(width*height*4);
 const wrap=d=>Math.atan2(Math.sin(d),Math.cos(d));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const longitude=x/width*Math.PI*2,latitude=(y/height-.5)*Math.PI;
  let value=.14+.08*Math.cos(latitude);
  for(const [angle,strength,spread] of [[.5,1.8,.32],[2.7,1.3,.5],[4.9,2,.28]])
   value+=strength*Math.exp(-.5*(wrap(longitude-angle)/spread)**2)*Math.exp(-.5*(latitude/1.15)**2);
  value-=.12*Math.exp(-.5*(wrap(longitude-1.65)/.23)**2)*Math.cos(latitude)**2;
  const i=(y*width+x)*4;data[i]=value;data[i+1]=value;data[i+2]=value;data[i+3]=1;
 }
 const source=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.FloatType);
 source.mapping=THREE.EquirectangularReflectionMapping;source.needsUpdate=true;
 const pmrem=new THREE.PMREMGenerator(renderer),target=pmrem.fromEquirectangular(source);
 source.dispose();pmrem.dispose();return target;
}

// STEP models are Z-up before the group rotation. Cylindrical UVs keep the
// fine machining lines horizontal on the original CAD surfaces.
function applyCylindricalUV(geometry) {
 const position=geometry.attributes.position,uv=new Float32Array(position.count*2);
 for(let i=0;i<position.count;i++){
  uv[i*2]=Math.atan2(position.getY(i),position.getX(i))/(2*Math.PI)+.5;
  uv[i*2+1]=position.getZ(i)/80;
 }
 geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
}

// One grain map is shared by every brushed part of a model. Building it per
// mesh would allocate hundreds of copies on the multi-part Shower assembly.
function brushedGrain(maxAnisotropy=8) {
 const width=64,height=1024,data=new Uint8Array(width*height*4);
 let seed=31;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 for(let y=0;y<height;y++){
  const line=170+random()*24;
  for(let x=0;x<width;x++){const i=(y*width+x)*4,v=Math.round(line+random()*4);data[i]=v;data[i+1]=v;data[i+2]=v;data[i+3]=255;}
 }
 const grain=new THREE.DataTexture(data,width,height);grain.wrapS=grain.wrapT=THREE.RepeatWrapping;
 grain.magFilter=THREE.LinearFilter;grain.minFilter=THREE.LinearMipmapLinearFilter;grain.generateMipmaps=true;grain.anisotropy=maxAnisotropy;grain.needsUpdate=true;
 return grain;
}

function brushedMetal(grain) {
 return new THREE.MeshPhysicalMaterial({color:'#dededb',metalness:1,roughness:.46,roughnessMap:grain,anisotropy:.35,anisotropyRotation:0});
}

// Product finishes, matched to the supplied product photography.
export const PRODUCT_FINISHES=[
 {id:'metal',name:'Metal',detail:'Polished stainless',swatch:'#dfe5e9',accent:'#f4f6f7'},
 {id:'black',name:'Black',detail:'Coated stainless',swatch:'#1b1c1e',accent:'#2b2c2f'},
];
export const DEFAULT_FINISH='metal';
// Entries hold raw MeshPhysicalMaterial parameters; `brushed` adds the shared
// grain map and `label` becomes userData.finish for the snapshot.
const RUBBER={label:'rubber',color:'#161719',metalness:0,roughness:.78,ior:1.46,specularIntensity:.35};
const SPECS={
 shower:{
  metal:{
   housing:{label:'metal',color:'#edf0f2',metalness:1,roughness:.05},
   face:{label:'rubber',color:'#3b3d40',metalness:0,roughness:.63,ior:1.46,specularIntensity:.35},
   badge:{label:'badge',color:'#fbfcfc',metalness:0,roughness:.16,clearcoat:1,clearcoatRoughness:.06,side:THREE.DoubleSide},
  },
  black:{
   housing:{label:'coated',color:'#121315',metalness:0,roughness:.33,clearcoat:1,clearcoatRoughness:.05},
   face:{label:'rubber',color:'#1d1e21',metalness:0,roughness:.6,ior:1.46,specularIntensity:.35},
   badge:{label:'badge',color:'#17181a',metalness:0,roughness:.36,clearcoat:.8,clearcoatRoughness:.12,side:THREE.DoubleSide},
  },
 },
 dispenser:{
  metal:{
   housing:{label:'metal',color:'#dededb',metalness:1,roughness:.46,brushed:true},
   rubber:RUBBER,
  },
  black:{
   housing:{label:'coated',color:'#26272a',metalness:0,roughness:.47,clearcoat:.35,clearcoatRoughness:.3},
   rubber:{label:'rubber',color:'#141516',metalness:0,roughness:.7,ior:1.46,specularIntensity:.35},
  },
 },
};

function finishMaterial(spec,grain) {
 const {brushed,label,...params}=spec;
 const material=new THREE.MeshPhysicalMaterial(params);
 if(brushed&&grain){material.roughnessMap=grain;material.anisotropy=.35;material.anisotropyRotation=0;}
 return material;
}

export function findFinishGroup(root) {
 let found=null;root?.traverse(node=>{if(node.userData.finishProduct)found=node;});return found;
}

// Re-materials a tagged product in place. Safe to call repeatedly: the outgoing
// materials and their grain map are released on every switch.
export function applyFinish(group,finishId) {
 const spec=SPECS[group.userData.finishProduct]?.[finishId];if(!spec)return false;
 const targets=[];group.traverse(node=>{if(node.userData.finishRole)targets.push(node);});
 if(!targets.length)return false;
 const retired=new Set();
 for(const node of targets)for(const material of Array.isArray(node.material)?node.material:[node.material])if(material)retired.add(material);
 const grain=Object.values(spec).some(part=>part.brushed)?brushedGrain(group.userData.maxAnisotropy):null;
 for(const node of targets){
  const part=spec[node.userData.finishRole];if(!part)continue;
  node.material=finishMaterial(part,grain);node.userData.finish=part.label;
 }
 for(const material of retired){
  for(const value of Object.values(material))if(value?.isTexture)value.dispose();
  material.dispose();
 }
 group.userData.productFinish=finishId;
 return true;
}

// The AQM CAD parks the five "rorra" letters as zero-thickness sketch faces on a
// construction plane ~90 mm above the lid. The handle below them is domed, so
// there is no face for them to sit on; left in, they float in mid-air and
// stretch the model's bounding box, which skews normalising and framing.
function dropStraySketches(group,parts) {
 const sketch=node=>/^Surface \d+$/i.test(node.name);
 let solidTop=-Infinity;
 for(const node of parts)if(!sketch(node))solidTop=Math.max(solidTop,node.geometry.boundingBox.max.z+node.position.z);
 const stray=parts.filter(node=>sketch(node)&&node.geometry.boundingBox.min.z+node.position.z>solidTop);
 for(const node of stray){
  node.removeFromParent();node.geometry.dispose();
  for(const material of Array.isArray(node.material)?node.material:[node.material])material?.dispose();
 }
 return parts.filter(node=>!stray.includes(node));
}

// Tags the supplied Shower CAD so any finish can be applied to it later.
function tagShower(group,parts) {
 for(const node of parts){
  const bounds=node.geometry.boundingBox;
  // The 150 mm front plate (including molded outlets) spans Z=52.92-68.05.
  // The separate 28 mm center medallion is tagged on its own below.
  const face=bounds.min.z>52&&bounds.max.z<69&&bounds.max.x-bounds.min.x>145;
  node.userData.finishRole=face?'face':'housing';
  if(!face)applyCylindricalUV(node.geometry);
  if(bounds.min.z>=53.5&&bounds.max.z<53.9&&bounds.max.x-bounds.min.x<25)node.position.z=-1.15;
 }
 // The source's center emblem consists of open surface patches. Add a thin
 // backing face so the medallion reads correctly from the spray side.
 const badge=new THREE.Mesh(new THREE.CircleGeometry(13.7,128),new THREE.MeshBasicMaterial());
 badge.rotation.x=Math.PI;badge.position.set(-.75,-.32,52.8);
 badge.name='Shower center medallion';badge.userData.finishRole='badge';group.add(badge);
}

// Tags the AQM / DD dispenser CADs: moulded gaskets and feet stay non-metal.
function tagDispenser(group,parts) {
 for(const node of parts){
  const rubber=/gasket|stand[ _]foot|body[ _]foot/i.test(node.name)||node.name==='PRT0015_2';
  node.userData.finishRole=rubber?'rubber':'housing';
  if(!rubber)applyCylindricalUV(node.geometry);
 }
 // Reference-derived seal in the 2 mm gap between the CAD stand and body.
 const stand=parts.find(node=>/^stand$/i.test(node.name));
 if(stand){
  const b=stand.geometry.boundingBox;
  const seal=new THREE.Mesh(new THREE.TorusGeometry((b.max.x-b.min.x)/2-.5,1.15,16,256),new THREE.MeshBasicMaterial());
  seal.position.set((b.min.x+b.max.x)/2,(b.min.y+b.max.y)/2,b.max.z+1);
  seal.name='Reference base isolation seal';seal.userData.finishRole='rubber';group.add(seal);
 }
}

export function applyProductMaterials(group,maxAnisotropy,profile) {
 let parts=group.children.filter(node=>node.isMesh);
 group.userData.maxAnisotropy=maxAnisotropy;
 for(const node of parts){
  for(const material of Array.isArray(node.material)?node.material:[node.material])material.dispose();
  node.geometry.computeBoundingBox();
 }
 parts=dropStraySketches(group,parts);
 const dispenser=parts.some(node=>/^outer[ _]body$/i.test(node.name));
 if(profile==='shower'||dispenser){
  group.userData.finishProduct=profile==='shower'?'shower':'dispenser';
  if(profile==='shower')tagShower(group,parts);else tagDispenser(group,parts);
  applyFinish(group,DEFAULT_FINISH);
  return;
 }
 // Imported models keep a single brushed finish; they have no known part roles.
 const grain=brushedGrain(maxAnisotropy);
 for(const node of parts){
  applyCylindricalUV(node.geometry);
  node.material=brushedMetal(grain);node.userData.finish='metal';
 }
 if(!parts.length)grain.dispose();
}
