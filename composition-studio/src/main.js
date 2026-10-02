import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { clone as cloneHierarchy } from 'three/addons/utils/SkeletonUtils.js';
import { setupTimeline } from './timeline.js';
import { createStudioEnvironment, applyProductMaterials, applyFinish, findFinishGroup, PRODUCT_FINISHES } from './metal.js';
const $ = id => document.getElementById(id);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9edf0');
scene.fog = new THREE.Fog('#e9edf0',12,35);
const camera = new THREE.PerspectiveCamera(36,1,0.01,1000);
const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio,1.5),2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
$('canvas-host').append(renderer.domElement);
renderer.domElement.setAttribute('aria-label','3D model viewport');
const env = createStudioEnvironment(renderer);
scene.environment = env.texture;
scene.environmentIntensity = 1;
scene.add(new THREE.HemisphereLight(0xffffff,0x8796a1,0.8));
const light = new THREE.DirectionalLight(0xfff9ec,2);
light.position.set(5,9,4); light.castShadow=true;
light.shadow.mapSize.set(4096,4096);
Object.assign(light.shadow.camera,{left:-8,right:8,top:8,bottom:-8});
light.shadow.bias=-0.00015;
light.shadow.normalBias=0.025;
scene.add(light);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:0.12}));
ground.rotation.x=-Math.PI/2;ground.position.y=-1.52;ground.receiveShadow=true;scene.add(ground);
const grid = new THREE.GridHelper(200,200,0xaebcc5,0xcbd5dc);
grid.position.y=-1.53;grid.material.transparent=true;grid.material.opacity=.48;scene.add(grid);
const orbit = new OrbitControls(camera,renderer.domElement);
orbit.minPolarAngle=THREE.MathUtils.degToRad(1);orbit.maxPolarAngle=THREE.MathUtils.degToRad(179);
const gizmo = new TransformControls(camera,renderer.domElement);
gizmo.setSize(.85);scene.add(gizmo.getHelper());
gizmo.addEventListener('dragging-changed',event=>{orbit.enabled=!event.value;});
gizmo.addEventListener('objectChange',syncObject);
let object=null,baseDistance=9,busy=false,currentName='',toastTimer;
const objects=[],assets=[];let nextObjectId=1;let objectClipboard=null,pasteCount=0;
const sampleAsset={name:'Rorra AQM.step',source:'/models/rorra-aqm.step'};
assets.push(sampleAsset,{name:'Rorra DD.step',source:'/models/rorra-dd.step'},{name:'Rorra Shower.stp',source:'/models/rorra-shower.stp'});
const radians=THREE.MathUtils.degToRad,degrees=THREE.MathUtils.radToDeg;
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',5000);}
function syncCamera(){
 const offset=camera.position.clone().sub(orbit.target),s=new THREE.Spherical().setFromVector3(offset);
 const zoom=100*baseDistance/s.radius,pitch=90-degrees(s.phi),yaw=degrees(s.theta);
 for(const [id,value,unit] of [['zoom',zoom,'%'],['pitch',pitch,'°'],['yaw',yaw,'°']]){$(id).value=value;if(document.activeElement!==$(id+'-value'))$(id+'-value').value=Number(value.toFixed(1));}
}
orbit.addEventListener('change',syncCamera);
function setCamera(pitch=20,yaw=35,zoom=100){
 const s=new THREE.Spherical(baseDistance*100/zoom,radians(90-pitch),radians(yaw));
 camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(s));orbit.update();syncCamera();
}
for(const id of ['zoom','pitch','yaw'])$(id).addEventListener('input',()=>setCamera(+$('pitch').value,+$('yaw').value,+$('zoom').value));
function fit(reset=false,all=false){
 if(!objects.length)return;
 const box=new THREE.Box3();
 for(const item of all||!object?objects:[object])box.expandByObject(item);
 const size=box.getSize(new THREE.Vector3());
 orbit.target.copy(box.getCenter(new THREE.Vector3()));
 const halfFov=radians(camera.fov/2),horizontal=Math.atan(Math.tan(halfFov)*camera.aspect);
 baseDistance=size.length()/2/Math.sin(Math.min(halfFov,horizontal))*1.15;
 orbit.minDistance=baseDistance/3;orbit.maxDistance=baseDistance*5;
 setCamera(reset?20:+$('pitch').value,reset?35:+$('yaw').value,100);
}
function setPerspective(value){
 const ratio=Math.tan(radians(camera.fov/2))/Math.tan(radians(value/2));
 camera.position.sub(orbit.target).multiplyScalar(ratio).add(orbit.target);
 baseDistance*=ratio;orbit.minDistance*=ratio;orbit.maxDistance*=ratio;
 camera.fov=value;camera.updateProjectionMatrix();orbit.update();syncCamera();
 $('perspective').value=value;if(document.activeElement!==$('perspective-value'))$('perspective-value').value=value;
}
$('perspective').addEventListener('input',()=>setPerspective(+$('perspective').value));
for(const id of ['zoom','pitch','yaw','perspective']){
 const field=$(id+'-value'),slider=$(id);
 field.addEventListener('change',()=>{
  const value=field.valueAsNumber;
  if(!Number.isFinite(value)){field.value=slider.value;return;}
  const clamped=Math.min(+slider.max,Math.max(+slider.min,value));
  slider.value=clamped;
  if(id==='perspective')setPerspective(+slider.value);
  else setCamera(+$('pitch').value,+$('yaw').value,+$('zoom').value);
  field.value=slider.value;
 });
 field.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();field.blur();}if(e.key==='Escape'){field.value=slider.value;field.blur();}});
}

$('fit').onclick=()=>fit();$('reset-camera').onclick=()=>{setPerspective(36);fit(true);};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{const v={front:[0,0],side:[0,90],top:[89,0]}[b.dataset.view];setCamera(...v,+$('zoom').value);});
for(const kind of ['position','rotation']){
 for(const axis of ['x','y','z']){
  const label=document.createElement('label');label.textContent=axis.toUpperCase();
  const input=document.createElement('input');input.type='number';input.step=kind==='rotation'?'1':'0.1';input.value='0';input.id=kind+'-'+axis;input.setAttribute('aria-label',(kind==='position'?'Position':'Rotation')+' '+axis.toUpperCase());
  input.addEventListener('change',()=>{if(!object)return;const value=Number(input.value);if(!Number.isFinite(value)){syncObject();return;}object[kind][axis]=kind==='rotation'?radians(value):value;object.updateMatrixWorld();syncObject();});
  label.append(input);$(kind+'-fields').append(label);
 }
}
function syncObject(){syncSize();if(!object)return;for(const kind of ['position','rotation'])for(const axis of ['x','y','z']){const field=$(kind+'-'+axis);if(document.activeElement!==field)field.value=(kind==='rotation'?degrees(object[kind][axis]):object[kind][axis]).toFixed(2);}}
function mode(value){gizmo.setMode(value);document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===value);b.setAttribute('aria-pressed',b.dataset.mode===value);});}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>mode(b.dataset.mode));
$('space').onchange=e=>gizmo.setSpace(e.target.value);
function syncSize(){
 const value=object?Number((object.scale.x*100).toFixed(1)):100;
 for(const id of ['object-size','object-size-value']){$(id).value=value;$(id).disabled=!object;}
 $('reset-size').disabled=!object;
}
function setObjectSize(value){
 if(!object)return;
 if(!Number.isFinite(value)){syncSize();return;}
 const percent=Math.max(10,Math.min(500,value));
 // Keep the model's lowest point at its current height while resizing.
 object.updateMatrixWorld(true);const before=new THREE.Box3().setFromObject(object).min.y;
 object.scale.setScalar(percent/100);object.updateMatrixWorld(true);
 const after=new THREE.Box3().setFromObject(object).min.y;
 if(Number.isFinite(before)&&Number.isFinite(after))object.position.y+=before-after;
 object.updateMatrixWorld(true);syncObject();
}
$('object-size').oninput=()=>setObjectSize($('object-size').valueAsNumber);
$('object-size-value').onchange=()=>setObjectSize($('object-size-value').valueAsNumber);
$('object-size-value').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.target.blur();}};
$('reset-size').onclick=()=>setObjectSize(100);
$('reset-object').onclick=()=>{if(object){object.position.set(0,0,0);object.rotation.set(0,0,0);object.scale.setScalar(1);object.updateMatrixWorld(true);syncObject();}};
$('grid').onclick=()=>{grid.visible=!grid.visible;ground.visible=grid.visible;$('grid').setAttribute('aria-pressed',String(grid.visible));$('grid').classList.toggle('active',grid.visible);};
function cloneObject(source){
 const copy=cloneHierarchy(source),geometries=new Map(),materials=new Map(),textures=new Map();
 copy.traverse(node=>{
  if(node.geometry){if(!geometries.has(node.geometry))geometries.set(node.geometry,node.geometry.clone());node.geometry=geometries.get(node.geometry);}
  const cloneMaterial=original=>{
   if(!materials.has(original)){
    const material=original.clone();
    for(const [key,value] of Object.entries(original))if(value?.isTexture){if(!textures.has(value))textures.set(value,value.clone());material[key]=textures.get(value);}
    materials.set(original,material);
   }
   return materials.get(original);
  };
  if(node.material)node.material=Array.isArray(node.material)?node.material.map(cloneMaterial):cloneMaterial(node.material);
 });
 copy.userData={...source.userData};
 return copy;
}
window.addEventListener('keydown',e=>{
 if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)||document.activeElement.isContentEditable||e.altKey)return;
 const key=e.key.toLowerCase();
 if(e.metaKey||e.ctrlKey){
  if(key==='c'&&object&&!busy&&!gizmo.dragging){
   e.preventDefault();if(objectClipboard)dispose(objectClipboard);objectClipboard=cloneObject(object);pasteCount=0;toast('Object copied · Press ⌘V to paste');
  }
  if(key==='v'&&objectClipboard&&!busy&&!gizmo.dragging){
   e.preventDefault();if(e.repeat)return;
   const copy=cloneObject(objectClipboard),serial=nextObjectId++;
   copy.userData={...objectClipboard.userData,id:serial,label:objectClipboard.userData.asset.name+' · '+serial};
   copy.position.x+=0.5*(++pasteCount);
   objects.push(copy);scene.add(copy);selectObject(copy);toast('Object pasted');
  }
  return;
 }
 if(key==='delete'||key==='backspace'){if(object&&!busy){e.preventDefault();$('delete-object').click();}return;}
 if(key==='w')mode('translate');if(key==='e')mode('rotate');if(key==='f')fit();
});

function setupFinishes(){
 for(const finish of PRODUCT_FINISHES){
  const button=document.createElement('button');button.type='button';button.className='finish-option';button.dataset.finish=finish.id;
  const swatch=document.createElement('span');swatch.className='finish-swatch';swatch.style.background=finish.swatch;
  const accent=document.createElement('i');accent.style.background=finish.accent;swatch.append(accent);
  const text=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');
  name.textContent=finish.name;detail.textContent=finish.detail;text.append(name,detail);
  button.append(swatch,text);
  button.onclick=()=>{
   const target=findFinishGroup(object);
   if(!target||target.userData.productFinish===finish.id)return;
   applyFinish(target,finish.id);syncFinishes();toast(finish.name+' finish applied.');
  };
  $('finish-options').append(button);
 }
}
function syncFinishes(){
 const current=findFinishGroup(object)?.userData.productFinish;
 $('finish-panel').hidden=!current;
 document.querySelectorAll('[data-finish]').forEach(button=>{
  const active=button.dataset.finish===current;
  button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));
 });
}
function renderAssets(){
 $('asset-list').replaceChildren();
 assets.forEach(asset=>{
  const row=document.createElement('div');row.className='asset-row';
  const label=document.createElement('button');label.className='asset';label.title='Select model in scene';
  const icon=document.createElement('span');icon.className='asset-icon';icon.textContent='◈';
  const text=document.createElement('span');const name=document.createElement('strong');name.textContent=asset.name.replace(/\.[^.]+$/,'');
  const detail=document.createElement('small');detail.textContent=asset.name.split('.').pop().toUpperCase()+' · Model';text.append(name,detail);label.append(icon,text);
  label.onclick=()=>{const found=objects.find(item=>item.userData.asset===asset);if(found)selectObject(found);else loadModel(asset.source,asset.name,asset);};
  const add=document.createElement('button');add.className='asset-add';add.textContent='+';add.title=asset.name+' — Add to scene';add.setAttribute('aria-label',asset.name+' — Add to scene');add.disabled=busy;add.onclick=()=>loadModel(asset.source,asset.name,asset);
  row.append(label,add);$('asset-list').append(row);
 });
}
function selectObject(next){
 object=next;gizmo.detach();if(object)gizmo.attach(object);
 currentName=object?.userData.label||'';
 $('delete-object').hidden=!object;
 $('object-name').textContent=currentName||(objects.length?'Click an object to select it':'Add a model to get started');
 $('mesh-count').textContent=object?.userData.stats||'';
 $('status').textContent=objects.length+' objects'+(object?' · '+currentName:'');
 document.querySelectorAll('.vector-fields input, #reset-object, #space, [data-mode]').forEach(input=>input.disabled=!object);
 if(!object)document.querySelectorAll('.vector-fields input').forEach(input=>input.value='0');
 $('scene-list').replaceChildren();
 for(const item of objects){const row=document.createElement('button');row.className='scene-item'+(item===object?' active':'');row.textContent=item.userData.label;row.setAttribute('aria-pressed',String(item===object));row.onclick=()=>selectObject(item);$('scene-list').append(row);}
 syncObject();syncFinishes();
}
$('delete-object').onclick=()=>{
 if(!object||busy)return;
 const removed=object,name=removed.userData.label;
 selectObject(null);scene.remove(removed);objects.splice(objects.indexOf(removed),1);dispose(removed);selectObject(null);toast(name+' deleted');
};
const picker=new THREE.Raycaster(),pointer=new THREE.Vector2();let clickStart=null,transformed=false;
gizmo.addEventListener('mouseDown',()=>{transformed=true;});
renderer.domElement.addEventListener('pointerdown',e=>{if(e.button!==0)return;clickStart={x:e.clientX,y:e.clientY};transformed=false;},true);
renderer.domElement.addEventListener('pointerup',e=>{
 if(e.button!==0||!clickStart)return;
 const start=clickStart;clickStart=null;
 if(transformed||Math.hypot(e.clientX-start.x,e.clientY-start.y)>4)return;
 const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
 scene.updateMatrixWorld(true);picker.setFromCamera(pointer,camera);
 const hit=picker.intersectObjects(objects,true)[0];let selected=hit?.object;
 while(selected&&!objects.includes(selected))selected=selected.parent;
 selectObject(selected||null);
});
renderer.domElement.addEventListener('pointercancel',()=>{clickStart=null;});

function dispose(root){const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const mat of node.material?(Array.isArray(node.material)?node.material:[node.material]):[]){materials.add(mat);for(const value of Object.values(mat))if(value?.isTexture)textures.add(value);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}
function material(color){return new THREE.MeshStandardMaterial({color:color?new THREE.Color(...color):new THREE.Color('#c8cbbb'),roughness:.48,metalness:.15});}
function readStep(buffer,profile){return new Promise((resolve,reject)=>{const worker=new Worker(window.__RORRA_OFFLINE?.workerURL || '/step-worker.js');const timeout=setTimeout(()=>{worker.terminate();reject(new Error('STEP conversion timed out. Please try a smaller file.'));},120000);const finish=()=>{clearTimeout(timeout);worker.terminate();};worker.onerror=e=>{finish();reject(new Error(e.message));};worker.onmessage=({data})=>{finish();if(data.error){reject(new Error(data.error));return;}const group=new THREE.Group();for(const mesh of data.meshes){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(mesh.attributes.position.array,3));geometry.setIndex(mesh.index.array);if(mesh.attributes.normal)geometry.setAttribute('normal',new THREE.Float32BufferAttribute(mesh.attributes.normal.array,3));else geometry.computeVertexNormals();const materials=[material(mesh.color)];geometry.clearGroups();let cursor=0;for(const face of mesh.brep_faces||[]){if(face.first*3>cursor)geometry.addGroup(cursor,face.first*3-cursor,0);let index=0;if(face.color){materials.push(material(face.color));index=materials.length-1;}geometry.addGroup(face.first*3,(face.last-face.first+1)*3,index);cursor=(face.last+1)*3;}if(cursor<mesh.index.array.length)geometry.addGroup(cursor,mesh.index.array.length-cursor,0);const part=new THREE.Mesh(geometry,materials);part.name=mesh.name;group.add(part);}group.rotation.x=-Math.PI/2;applyProductMaterials(group,renderer.capabilities.getMaxAnisotropy(),profile);resolve(group);};worker.postMessage(buffer,[buffer]);});}
async function parse(buffer,extension,profile){if(['step','stp'].includes(extension))return readStep(buffer,profile);if(extension==='glb')return (await new GLTFLoader().parseAsync(buffer,'')).scene;if(extension==='obj')return new OBJLoader().parse(new TextDecoder().decode(buffer));if(extension==='stl')return new THREE.Mesh(new STLLoader().parse(buffer),material());throw new Error('Please choose a STEP, GLB, OBJ, or STL file.');}
async function loadModel(source,name,asset=null){
 if(busy)return;busy=true;$('loading').hidden=false;['upload','upload-side'].forEach(id=>$(id).disabled=true);document.querySelectorAll('.asset-add, .asset-row .asset').forEach(b=>b.disabled=true);
 let incoming;
 try{
  {
  const buffer=source instanceof File?await source.arrayBuffer():window.__RORRA_OFFLINE ? await window.__RORRA_OFFLINE.sampleBuffer(source) : await fetch(source).then(r=>{if(!r.ok)throw new Error('Model file not found.');return r.arrayBuffer();});
  incoming=await parse(buffer,name.split('.').pop().toLowerCase(),asset?.source==='/models/rorra-shower.stp'?'shower':undefined);
  }
  incoming.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(incoming),size=bounds.getSize(new THREE.Vector3()),extent=Math.max(size.x,size.y,size.z);
  if(!Number.isFinite(extent)||extent<=0)throw new Error('No displayable 3D geometry found.');
  const normalized=new THREE.Group();normalized.add(incoming);const factor=3/extent;normalized.scale.setScalar(factor);incoming.position.sub(bounds.getCenter(new THREE.Vector3()));
  const wrapper=new THREE.Group();wrapper.add(normalized);
  let meshes=0,triangles=0;wrapper.traverse(node=>{if(node.isMesh){meshes++;triangles+=(node.geometry.index?.count||node.geometry.attributes.position.count)/3;node.castShadow=true;node.receiveShadow=true;}});
  if(!asset){asset={source,name};assets.push(asset);}
  const serial=nextObjectId++;
  wrapper.userData={asset,id:serial,label:name+' · '+serial,stats:meshes+' meshes · '+Math.round(triangles).toLocaleString()+' triangles'};
  if(objects.length){const existing=new THREE.Box3();objects.forEach(item=>existing.expandByObject(item));wrapper.position.x=existing.max.x+size.x*factor/2+0.8;}
  objects.push(wrapper);scene.add(wrapper);selectObject(wrapper);renderAssets();
  if(objects.length===1){ground.position.y=new THREE.Box3().setFromObject(wrapper).min.y-.015;grid.position.y=ground.position.y-.01;}
  fit(true,true);syncObject();
 }catch(error){if(incoming)dispose(incoming);console.error(error);toast('Import failed: '+error.message);$('status').textContent=object?'Existing model preserved · '+currentName:'Please choose another file';}
 finally{busy=false;$('loading').hidden=true;['upload','upload-side'].forEach(id=>$(id).disabled=false);renderAssets();}
}
$('upload').onclick=$('upload-side').onclick=()=>$('file').click();
$('file').onchange=e=>{const file=e.target.files[0];if(file)loadModel(file,file.name);e.target.value='';};

let dragDepth=0;
window.addEventListener('drop',()=>{dragDepth=0;$('viewport').classList.remove('dragging');},true);
window.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;$('viewport').classList.add('dragging');});
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('dragleave',()=>{if(--dragDepth<=0)$('viewport').classList.remove('dragging');});
window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('viewport').classList.remove('dragging');const file=e.dataTransfer.files[0];if(file)loadModel(file,file.name);});
$('capture').onclick=()=>{if(!objects.length)return toast('Please import a model first.');const helper=gizmo.getHelper(),visible=helper.visible;helper.visible=false;renderer.render(scene,camera);const a=document.createElement('a');a.download=(currentName||'scene').replace(/\.[^.]+$/,'')+'-composition.png';a.href=renderer.domElement.toDataURL('image/png');a.click();helper.visible=visible;toast('Current view saved as a PNG image.');};
new ResizeObserver(()=>{const host=$('canvas-host');camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,host.clientHeight);}).observe($('canvas-host'));
const timeline=setupTimeline({camera,orbit,notify:toast,onApply:syncCamera,video:{
 stream:()=>renderer.domElement.captureStream(30),
 // The transform gizmo is an editing widget, so keep it out of the take.
 before:()=>{gizmo.getHelper().visible=false;},
 after:()=>{gizmo.getHelper().visible=true;},
 name:()=>(currentName||'scene').replace(/\.[^.]+$/,'')+'-camera-move',
}});
renderer.setAnimationLoop(()=>{timeline.tick();orbit.update();renderer.render(scene,camera);});
setupFinishes();
renderAssets();selectObject(null);setCamera();loadModel(sampleAsset.source,sampleAsset.name,sampleAsset);
// Read-only scene snapshot for browser integration checks.
window.__studio={snapshot:()=>({loaded:objects.length>0,busy,count:objects.length,selectedId:object?.userData.id,objects:objects.map(item=>({id:item.userData.id,name:item.userData.label,position:item.position.toArray()})),gridVisible:grid.visible,shadowVisible:ground.visible,position:object?.position.toArray(),rotation:object?.rotation.toArray().slice(0,3),scale:object?.scale.toArray(),bounds:object?new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).toArray():null,bottom:object?new THREE.Box3().setFromObject(object).min.y:null,camera:camera.position.toArray(),fov:camera.fov,finish:findFinishGroup(object)?.userData.productFinish||null,timeline:timeline.snapshot(),mode:gizmo.getMode(),orbitEnabled:orbit.enabled,finishes:object?(()=>{const result=[];object.traverse(n=>{if(n.userData.finish)result.push({role:n.userData.finish,color:'#'+n.material.color.getHexString(),metalness:n.material.metalness,roughness:n.material.roughness,transmission:n.material.transmission,opacity:n.material.opacity});});return result;})():[],meshes:object?$('mesh-count').textContent:null})};
