import {noteName} from './pitch.js';
export class PitchGraph {
  constructor(canvas,onChange) {
    this.canvas=canvas; this.onChange=onChange; this.window=30; this.follow=true; this.end=0; this.points=[]; this.duration=0; this.format='both'; this.target=null;
    new ResizeObserver(()=>this.draw()).observe(canvas);
    let drag=null;
    canvas.addEventListener('pointerdown',e=>{if(e.isPrimary){drag={x:e.clientX,end:this.visibleEnd()};canvas.setPointerCapture(e.pointerId);}});
    canvas.addEventListener('pointermove',e=>{if(!drag || this.window==='all')return; if(Math.abs(e.clientX-drag.x)<3)return; this.follow=false; this.end=this.clampEnd(drag.end-(e.clientX-drag.x)/Math.max(1,canvas.clientWidth-65)*this.window);this.draw();this.onChange();});
    const release=()=>{drag=null;}; canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
    canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','End'].includes(e.key)){e.preventDefault();if(e.key==='End')this.follow=true;else if(this.window!=='all'){this.end=this.clampEnd(this.visibleEnd()+(e.key==='ArrowLeft'?-1:1)*this.window/2);this.follow=false;}this.draw();this.onChange();}});
  }
  clampEnd(end){return Math.min(Math.max(this.duration,Number(this.window)||1),Math.max(Number(this.window)||1,end));}
  visibleEnd(){return this.window==='all'?Math.max(1,this.duration):this.follow?Math.max(this.window,this.duration):this.clampEnd(this.end);}
  setWindow(value){this.window=value==='all'?'all':Number(value);this.end=this.clampEnd(this.end);this.draw();this.onChange();}
  draw(){
    const c=this.canvas, w=c.clientWidth,h=c.clientHeight;if(!w||!h)return;
    const dpr=Math.min(devicePixelRatio||1,2);if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}
    const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const left=56,right=w-10,top=15,bottom=h-28,end=this.visibleEnd(),span=this.window==='all'?Math.max(1,this.duration):this.window,start=Math.max(0,end-span);
    // Binary search avoids traversing a long session for a small detail window.
    let lo=0,hi=this.points.length;while(lo<hi){const mid=(lo+hi)>>1;if(this.points[mid].t<start)lo=mid+1;else hi=mid;}
    const visible=[];for(let i=lo;i<this.points.length&&this.points[i].t<=end;i++)visible.push(this.points[i]);
    const valid=visible.filter(p=>p.m!==null);let low=48,high=60;
    if(valid.length){low=Math.floor(valid.reduce((a,p)=>Math.min(a,p.m),Infinity))-2;high=Math.ceil(valid.reduce((a,p)=>Math.max(a,p.m),-Infinity))+2;if(high-low<12){const middle=(high+low)/2;low=Math.floor(middle-6);high=low+12;}}
    if(this.target!==null){low=Math.min(low,this.target-2);high=Math.max(high,this.target+2);}
    const x=t=>left+(t-start)/span*(right-left),y=m=>bottom-(m-low)/(high-low)*(bottom-top);
    ctx.font='10px system-ui';ctx.textBaseline='middle';
    for(let n=low;n<=high;n++){
      ctx.strokeStyle=n%12===0?'#d7cce8':'#eee9f4';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y(n));ctx.lineTo(right,y(n));ctx.stroke();
      if((high-low<=14)||n%2===0&&high-low<=26||n%12===0){ctx.fillStyle='#8e829b';ctx.textAlign='right';ctx.fillText(noteName(n,this.format==='international'?'international':'japanese',false),left-7,y(n));}
    }
    for(let i=0;i<=4;i++){const t=start+span*i/4;ctx.strokeStyle='#f0ecf5';ctx.beginPath();ctx.moveTo(x(t),top);ctx.lineTo(x(t),bottom);ctx.stroke();ctx.textAlign=i===0?'left':i===4?'right':'center';ctx.fillStyle='#958a9f';ctx.fillText(`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`,x(t),h-10);}
    if(this.target!==null){ctx.setLineDash([5,4]);ctx.strokeStyle='#7ba78d';ctx.beginPath();ctx.moveTo(left,y(this.target));ctx.lineTo(right,y(this.target));ctx.stroke();ctx.setLineDash([]);}
    ctx.save();ctx.beginPath();ctx.rect(left,top,right-left,bottom-top);ctx.clip();ctx.strokeStyle='#8860c6';ctx.fillStyle='#8860c6';ctx.lineWidth=2;
    // Dense overviews show per-pixel min/max envelopes; detail uses actual linear segments.
    if(visible.length>(right-left)*3){const buckets=new Map();for(const p of valid){const k=Math.floor(x(p.t)),b=buckets.get(k)||[Infinity,-Infinity];b[0]=Math.min(b[0],p.m);b[1]=Math.max(b[1],p.m);buckets.set(k,b);}ctx.beginPath();for(const [k,b]of buckets){ctx.moveTo(k,y(b[0]));ctx.lineTo(k,y(b[1])+.8);}ctx.stroke();}
    else {let previous=null;ctx.beginPath();for(const p of visible){if(p.m===null){previous=null;continue;}if(previous&&p.t-previous.t<=.22){ctx.moveTo(x(previous.t),y(previous.m));ctx.lineTo(x(p.t),y(p.m));}else{ctx.moveTo(x(p.t),y(p.m));ctx.lineTo(x(p.t)+.7,y(p.m));}previous=p;}ctx.stroke();}
    ctx.restore();
    if(!valid.length){ctx.fillStyle='#a69bae';ctx.textAlign='center';ctx.font='12px system-ui';ctx.fillText(this.duration?'この範囲には音程の記録がありません':'ここに、あなたの声の軌跡が描かれます',(left+right)/2,(top+bottom)/2);}
  }
}
