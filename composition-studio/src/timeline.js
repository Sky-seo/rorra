import * as THREE from 'three';

const $=id=>document.getElementById(id);
const SPACING=2;        // seconds appended per new keyframe
const MIN_GAP=.1;
const DEFAULT_EASE=.5;
// MP4/H.264 first so the file drops straight into editing and sharing tools;
// WebM is the fallback for browsers whose MediaRecorder cannot write MP4.
const VIDEO_FORMATS=[
 ['video/mp4;codecs=avc1.42E01E','mp4'],
 ['video/mp4;codecs=avc1','mp4'],
 ['video/mp4','mp4'],
 ['video/webm;codecs=vp9','webm'],
 ['video/webm;codecs=vp8','webm'],
 ['video/webm','webm'],
];

// Timing follows the CSS cubic-bezier(x1,0,x2,1) model: solve x(t)=progress for
// t, then read y(t). x1 flattens the start of a segment, x2 its end.
function bezierEase(x1,x2,progress){
 if(progress<=0)return 0;
 if(progress>=1)return 1;
 if(x1===0&&x2===1)return progress;
 const x=t=>3*t*(1-t)*(1-t)*x1+3*t*t*(1-t)*x2+t*t*t;
 const slope=t=>3*(1-t)*(1-t)*x1+6*t*(1-t)*(x2-x1)+3*t*t*(1-x2);
 let t=progress;
 for(let i=0;i<10;i++){
  const error=x(t)-progress;
  if(Math.abs(error)<1e-6)break;
  const d=slope(t);
  if(Math.abs(d)<1e-7)break;
  t=Math.max(0,Math.min(1,t-error/d));
 }
 return 3*t*t*(1-t)+t*t*t;
}
// A segment's curve is shaped by the key it leaves and the key it arrives at.
const curveOf=(from,to)=>[from.easeOut,1-to.easeIn];
function curvePath(x1,x2){
 const points=[];
 for(let i=0;i<=24;i++){
  const x=i/24;
  points.push((x*100).toFixed(1)+','+((1-bezierEase(x1,x2,x))*100).toFixed(1));
 }
 return 'M'+points.join('L');
}

// Keyframes store the orbit itself (target, distance, angles, FOV) rather than a
// world position, so a move between two views arcs around the product instead of
// cutting through it.
export function setupTimeline({camera,orbit,notify,onApply,video}){
 const keys=[];
 let playing=false,head=0,stamp=0,selected=null,progress=0,recording=false,endOfPlayback=null;

 const capture=()=>{
  const spherical=new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbit.target));
  return {target:orbit.target.toArray(),radius:spherical.radius,phi:spherical.phi,theta:spherical.theta,fov:camera.fov};
 };
 const apply=view=>{
  orbit.target.fromArray(view.target);
  camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(view.radius,view.phi,view.theta)));
  if(camera.fov!==view.fov){camera.fov=view.fov;camera.updateProjectionMatrix();}
  onApply?.();
 };
 const duration=()=>keys.length?keys[keys.length-1].time:0;

 function between(a,b,t){
  const ease=bezierEase(...curveOf(a,b),t);
  progress=ease;
  // Angles sweep by their literal slider values rather than taking the short way
  // round, so a key at Y -180° followed by one at Y 180° turns a full circle
  // instead of collapsing to no movement. The move always follows the Y rotation
  // slider from the one value to the other.
  const turn=b.theta-a.theta;
  return {
   target:a.target.map((v,i)=>v+(b.target[i]-v)*ease),
   // Distance reads as zoom, so ramp it geometrically: a linear ramp between a
   // far and a near keyframe barely moves at first and then rushes in.
   radius:a.radius*Math.pow(b.radius/a.radius,ease),
   phi:a.phi+(b.phi-a.phi)*ease,
   theta:a.theta+turn*ease,
   fov:a.fov+(b.fov-a.fov)*ease,
  };
 }
 function sample(time){
  if(!keys.length)return null;
  if(keys.length===1||time<=keys[0].time){progress=0;return keys[0];}
  if(time>=duration()){progress=1;return keys[keys.length-1];}
  let i=0;while(i<keys.length-1&&keys[i+1].time<=time)i++;
  const a=keys[i],b=keys[i+1],span=b.time-a.time;
  if(span<=0){progress=1;return b;}
  return between(a,b,(time-a.time)/span);
 }
 function seek(time){
  head=Math.max(0,Math.min(duration(),time));
  const view=sample(head);if(view)apply(view);
  paint();
 }
 function stop(){
  if(!playing)return;
  playing=false;orbit.enabled=true;
  $('timeline-play').textContent='▶ Play';
  $('timeline-play').setAttribute('aria-pressed','false');
  const finished=endOfPlayback;endOfPlayback=null;finished?.();
 }

 // Records the move exactly as it plays: captureStream pulls frames straight off
 // the WebGL canvas, so what lands in the file is what the viewport renders.
 async function record(){
  if(keys.length<2||recording||!video)return;
  const format=VIDEO_FORMATS.find(([mime])=>window.MediaRecorder?.isTypeSupported(mime));
  if(!format){notify('This browser cannot record video.');return;}
  const [type,extension]=format;
  let recorder,stream;
  try{
   stream=video.stream();
   recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:16e6});
  }catch(error){notify('Recording failed to start: '+error.message);return;}
  const chunks=[];
  recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
  const flushed=new Promise(resolve=>{recorder.onstop=resolve;});
  recording=true;video.before?.();render();
  try{
   seek(0);
   recorder.start();
   await new Promise(resolve=>{endOfPlayback=resolve;play();});
   // Let the final frame reach the encoder before closing the stream.
   await new Promise(resolve=>setTimeout(resolve,150));
   recorder.stop();await flushed;
   stream.getTracks().forEach(track=>track.stop());
   if(!chunks.length){notify('Recording produced no frames.');return;}
   const url=URL.createObjectURL(new Blob(chunks,{type}));
   const link=document.createElement('a');
   link.href=url;link.download=(video.name?.()||'camera')+'.'+extension;link.click();
   setTimeout(()=>URL.revokeObjectURL(url),10000);
   notify('Camera move saved as a '+extension.toUpperCase()+' video.');
  }catch(error){notify('Recording failed: '+error.message);}
  finally{recording=false;video.after?.();render();}
 }
 function play(){
  if(keys.length<2)return;
  if(head>=duration())head=0;
  playing=true;stamp=performance.now();orbit.enabled=false;
  $('timeline-play').textContent='❚❚ Pause';
  $('timeline-play').setAttribute('aria-pressed','true');
 }
 function paint(){
  const total=duration(),ratio=total?head/total:0;
  $('timeline-head').style.left=(ratio*100)+'%';
  $('timeline-progress').style.width=(ratio*100)+'%';
  $('timeline-duration').textContent=head.toFixed(1)+' / '+total.toFixed(1)+'s';
  $('timeline-track').setAttribute('aria-valuemax',total.toFixed(1));
  $('timeline-track').setAttribute('aria-valuenow',head.toFixed(1));
 }
 function select(index){
  selected=index;
  render();
  if(index!==null)seek(keys[index].time);
 }
 function renderEase(){
  const panel=$('timeline-ease'),key=selected===null?null:keys[selected];
  panel.hidden=!key;
  if(!key)return;
  $('timeline-ease-name').textContent='Key '+(selected+1)+' easing';
  const previous=keys[selected-1],next=keys[selected+1];
  for(const [side,partner,label] of [['in',previous,'Arrival from key '+selected],['out',next,'Departure to key '+(selected+2)]]){
   const slider=$('timeline-ease-'+side),value=Math.round(key['ease'+(side==='in'?'In':'Out')]*100);
   slider.value=value;slider.disabled=!partner||recording;
   $('timeline-ease-'+side+'-value').textContent=partner?value+'%':'—';
   $('timeline-ease-'+side+'-note').textContent=partner?label:'No adjacent keyframe';
   const curve=$('timeline-curve-'+side);
   const pair=side==='in'?(previous&&curveOf(previous,key)):(next&&curveOf(key,next));
   curve.setAttribute('d',pair?curvePath(...pair):'M0,100L100,0');
   curve.parentElement.classList.toggle('is-off',!partner);
  }
 }
 function render(){
  const total=duration();
  $('timeline-play').disabled=keys.length<2||recording;
  $('timeline-add').disabled=recording;
  $('timeline-clear').disabled=!keys.length||recording;
  const button=$('timeline-record');
  button.disabled=keys.length<2&&!recording;
  button.textContent=recording?'■ Stop recording':'↗ Save video';
  button.classList.toggle('is-recording',recording);
  const marks=$('timeline-marks');marks.replaceChildren();
  keys.forEach((key,index)=>{
   const mark=document.createElement('button');
   mark.type='button';mark.className='timeline-mark'+(index===selected?' selected':'');
   mark.style.left=(total?key.time/total*100:0)+'%';
   mark.title='Keyframe '+(index+1)+' · '+key.time.toFixed(1)+'s';
   mark.setAttribute('aria-label',mark.title);
   mark.onclick=event=>{event.stopPropagation();stop();select(index);};
   marks.append(mark);
  });
  const list=$('timeline-keys');list.replaceChildren();
  keys.forEach((key,index)=>{
   const row=document.createElement('div');row.className='timeline-key'+(index===selected?' selected':'');
   const jump=document.createElement('button');jump.type='button';jump.className='timeline-key-jump';
   jump.textContent='Key '+(index+1);jump.title='Jump here and edit its easing';
   jump.setAttribute('aria-pressed',String(index===selected));
   jump.onclick=()=>{stop();select(index===selected?null:index);};
   const time=document.createElement('input');
   time.type='number';time.step=.1;time.min=0;time.value=key.time.toFixed(1);
   time.setAttribute('aria-label','Keyframe '+(index+1)+' time in seconds');
   time.disabled=index===0||recording;
   time.onchange=()=>{
    const value=time.valueAsNumber;
    if(!Number.isFinite(value)){render();return;}
    // Keep the list ordered so playback never runs backwards.
    const low=keys[index-1].time+MIN_GAP,high=keys[index+1]?keys[index+1].time-MIN_GAP:Infinity;
    key.time=Math.max(low,Math.min(high,value));
    render();seek(head);
   };
   const recapture=document.createElement('button');recapture.type='button';recapture.className='timeline-key-set';
   recapture.textContent='↺';recapture.title='Replace with the current view';
   recapture.onclick=()=>{Object.assign(key,capture(),{time:key.time,easeIn:key.easeIn,easeOut:key.easeOut});notify('Keyframe '+(index+1)+' updated.');seek(key.time);};
   const remove=document.createElement('button');remove.type='button';remove.className='timeline-key-remove';
   remove.textContent='✕';remove.title='Delete keyframe '+(index+1);
   remove.onclick=()=>{
    keys.splice(index,1);
    if(keys.length)keys[0].time=0;
    if(selected!==null&&selected>=keys.length)selected=keys.length?keys.length-1:null;
    if(keys.length<2)stop();
    render();seek(Math.min(head,duration()));
   };
   row.append(jump,time,recapture,remove);list.append(row);
  });
  renderEase();
  paint();
 }

 for(const side of ['in','out']){
  const slider=$('timeline-ease-'+side);
  slider.oninput=()=>{
   if(selected===null)return;
   keys[selected]['ease'+(side==='in'?'In':'Out')]=slider.valueAsNumber/100;
   renderEase();seek(head);
  };
 }
 $('timeline-record').onclick=()=>{if(recording)stop();else record();};
 $('timeline-ease-close').onclick=()=>select(null);
 $('timeline-add').onclick=()=>{
  stop();
  keys.push({...capture(),time:keys.length?duration()+SPACING:0,easeIn:DEFAULT_EASE,easeOut:DEFAULT_EASE});
  render();seek(duration());
  notify('Keyframe '+keys.length+' added.');
 };
 $('timeline-play').onclick=()=>{playing?stop():play();};
 $('timeline-clear').onclick=()=>{stop();keys.length=0;head=0;selected=null;render();notify('Timeline cleared.');};

 const track=$('timeline-track');
 const scrub=event=>{
  const rect=track.getBoundingClientRect();
  seek((event.clientX-rect.left)/rect.width*duration());
 };
 track.onpointerdown=event=>{
  if(!duration()||event.target.classList.contains('timeline-mark'))return;
  stop();track.setPointerCapture(event.pointerId);scrub(event);event.preventDefault();
 };
 track.onpointermove=event=>{if(track.hasPointerCapture(event.pointerId))scrub(event);};
 track.onpointerup=track.onpointercancel=event=>{if(track.hasPointerCapture(event.pointerId))track.releasePointerCapture(event.pointerId);};
 track.onkeydown=event=>{
  const step={ArrowLeft:-.1,ArrowRight:.1,Home:-Infinity,End:Infinity}[event.key];
  if(step===undefined)return;
  event.preventDefault();stop();
  seek(Number.isFinite(step)?head+step:step<0?0:duration());
 };

 render();
 return {
  tick(){
   if(!playing)return;
   const now=performance.now();
   head=Math.min(duration(),head+(now-stamp)/1000);
   stamp=now;
   const view=sample(head);if(view)apply(view);
   if(head>=duration())stop();
   paint();
  },
  snapshot:()=>({count:keys.length,playing,recording,selected,time:+head.toFixed(2),duration:+duration().toFixed(2),
   progress:+progress.toFixed(4),times:keys.map(k=>+k.time.toFixed(2)),
   ease:keys.map(k=>[+k.easeIn.toFixed(2),+k.easeOut.toFixed(2)])}),
 };
}
