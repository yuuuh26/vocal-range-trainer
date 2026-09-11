import {noteName,PitchTracker,SessionStats,SCALE,toneStats} from './pitch.js';
import {PitchGraph} from './graph.js';
import {TonePlayer} from './audio.js';
import {saveSession,listSessions,deleteSession,getSettings,saveSettings} from './storage.js';
const $=id=>document.getElementById(id);
const state={mode:'live',practice:'scale',format:'both',floor:.008,running:false,starting:false,paused:false,points:[],recent:[],duration:0,startedAt:null,sessionId:null,saved:false,stats:new SessionStats(),summary:null,epoch:0,gate:true,step:0,key:48,phase:'idle',phaseStart:0,target:null,storeEvery:.09,lastStored:-1,decimated:false};
let context,stream,source,analyser,worker,player,timer,wakeLock,busy=false,clock=0,toastTimer,requestId=0;
const tracker=new PitchTracker();
const graph=new PitchGraph($('pitchGraph'),updateGraphControls);
const name=n=>noteName(n,state.format);
const time=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
function status(text,listening=false){$('inputStatus').replaceChildren(Object.assign(document.createElement('i'),{}),document.createTextNode(' '+text));$('inputStatus').classList.toggle('listening',listening);}
function setCurrent(midi,hz){
  $('currentNote').textContent=name(midi);$('frequency').textContent=hz?hz.toFixed(1)+' Hz':'— Hz';
  const diff=midi===null?null:100*(midi-(state.target??Math.round(midi)));
  $('cents').textContent=diff===null?'— cent':`${diff>=0?'+':''}${Math.round(diff)} cent`;
  $('pitchDirection').textContent=diff===null?'声を待っています':Math.abs(diff)<=10?'ちょうどいい':diff>0?'高め':'低め';
  $('meterNeedle').hidden=diff===null;if(diff!==null){$('meterNeedle').style.left=`${50+Math.max(-50,Math.min(50,diff))}%`;document.querySelector('.meter').setAttribute('aria-valuenow',Math.round(Math.max(-50,Math.min(50,diff))));}
  $('meterCaption').textContent=state.target===null?'中央 = 最寄りの音':`目標 ${name(state.target)}`;
}
function renderStats(){const s=state.summary||state.stats.summary();for(const [id,key]of [['stableLow','stableLow'],['stableHigh','stableHigh'],['instantLow','low'],['instantHigh','high']])$(id).textContent=name(s[key]);$('rangeWidth').textContent=s.stableLow===null?'—':`${s.stableHigh-s.stableLow}半音（${((s.stableHigh-s.stableLow)/12).toFixed(1)}オクターブ）`;$('sessionScore').textContent=s.score??'—';$('rangeDuration').textContent=time(state.duration);}
function renderDetails(){const result=toneStats(state.recent,state.target);$('average').textContent=result?name(result.mean):'—';$('averageError').textContent=result?`${result.error>=0?'+':''}${Math.round(result.error)} cent`:'—';$('wobble').textContent=result?`±${Math.round(result.sd)} cent`:'—';$('stability').textContent=result?result.score:'—';}
function updateGraphControls(){$('follow').hidden=graph.follow||graph.window==='all';$('graphState').textContent=graph.window==='all'?'セッション全体':graph.follow?`直近${graph.window}秒`:'過去を表示中';}
function render(){graph.points=state.points;graph.duration=state.duration;graph.target=state.target;graph.format=state.format;graph.draw();$('elapsed').textContent=time(state.duration);renderStats();renderDetails();updateGraphControls();}
function fillNotes(){for(const [id,min,max,defaultValue]of [['startNote',36,72,48],['endNote',36,72,55],['targetNote',36,84,60]]){const el=$(id),value=el.value||String(defaultValue);el.replaceChildren();for(let n=min;n<=max;n++){const o=document.createElement('option');o.value=n;o.textContent=name(n);el.append(o);}el.value=value;}updateScaleRange();}
function updateScaleRange(){const start=+$('startNote').value,end=+$('endNote').value;$('scaleRange').textContent=`実際に鳴る範囲：${name(Math.min(start,end))} 〜 ${name(Math.max(start,end)+7)}`;}
function buttons(){
  $('start').hidden=state.running;$('start').disabled=state.starting;$('start').textContent=state.starting?'マイクを準備中…':state.mode==='practice'?(state.practice==='scale'?'▶ お手本から始める':'● 単音練習を始める'):'● 測定を始める';
  $('stop').hidden=!state.running&&!state.starting;$('pause').hidden=!state.running||state.mode!=='practice';$('pause').textContent=state.paused?'再開':'一時停止';
  $('savePanel').hidden=state.running||!state.sessionId;$('save').disabled=state.saved;$('save').textContent=state.saved?'保存済み':'練習結果を保存';
  document.querySelectorAll('[data-mode],[data-practice],#practicePanel select,#practicePanel input,#preset,#referenceTone').forEach(el=>el.disabled=state.running||state.starting);
  $('historyOpen').disabled=state.running||state.starting;
}
function mode(value){state.mode=value;$('practicePanel').hidden=value!=='practice';$('rangeExtra').hidden=value!=='range';document.querySelectorAll('[data-mode]').forEach(el=>{const on=el.dataset.mode===value;el.classList.toggle('active',on);el.setAttribute('aria-pressed',on);});$('modeTitle').textContent=({live:'声の動きを、見てみよう。',range:'今日の声域を、確かめよう。',practice:'聴いて、まねて、整える。'})[value];$('modeEyebrow').textContent=({live:'LISTEN TO YOUR VOICE',range:'FIND YOUR RANGE',practice:'A LITTLE PRACTICE, EVERY DAY'})[value];state.target=value==='practice'&&state.practice==='tone'?+$('targetNote').value:null;setCurrent(null,null);buttons();render();}
async function audioContext(){if(!context||context.state==='closed'){context=new AudioContext({latencyHint:'interactive'});player=new TonePlayer(context);}await context.resume();return context;}
function addPoint(t,midi,confidence=0){
  const point={t:Math.round(t*1000)/1000,m:midi===null?null:Math.round(midi*1000)/1000};
  state.stats.add(t,midi,confidence);state.recent.push(point);while(state.recent.length&&t-state.recent[0].t>1)state.recent.shift();
  if(t-state.lastStored>=state.storeEvery||midi===null&&state.points.at(-1)?.m!==null){state.points.push(point);state.lastStored=t;}
  if(state.points.length>72000){const reduced=[];for(let i=0;i<state.points.length;i+=4){const group=state.points.slice(i,i+4),valid=group.filter(p=>p.m!==null);if(valid.length===group.length){const min=valid.reduce((a,b)=>a.m<b.m?a:b),max=valid.reduce((a,b)=>a.m>b.m?a:b);reduced.push(...(min===max?[min]:[min,max].sort((a,b)=>a.t-b.t)));}else reduced.push(group.find(p=>p.m===null));}state.points=reduced;state.storeEvery*=2;state.decimated=true;$('retention').textContent='全体を保持（長時間のため間引き）';}
}
async function start(){
  if(state.running||state.starting)return;
  if(state.sessionId&&!state.saved&&!confirm('今回の未保存結果を破棄して、新しい測定を始めますか？'))return;
  if(state.mode==='practice'&&state.practice==='scale'){
    const dir=+$('direction').value;if((+$('endNote').value-+$('startNote').value)*dir<0){toast('開始音・終了位置と、上昇／下降の方向を合わせてね。');return;}
    if(!Number.isFinite(+$('tempo').value)||+$('tempo').value<40||+$('tempo').value>160){toast('テンポは40〜160 BPMで指定してね。');return;}
  }
  if(!navigator.mediaDevices?.getUserMedia){toast('このブラウザではマイクを使用できません。HTTPSのURLをChromeで開いてください。');return;}
  const request=++requestId;state.starting=true;buttons();
  try{
    await audioContext();
    const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},video:false});
    if(request!==requestId||document.hidden){media.getTracks().forEach(t=>t.stop());return;}
    stream=media;source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=8192;analyser.smoothingTimeConstant=0;source.connect(analyser);
    worker=new Worker(new URL('./pitch-worker.js',import.meta.url),{type:'module'});busy=false;
    worker.onmessage=({data})=>{busy=false;if(!state.running||data.epoch!==state.epoch||!state.gate||state.paused)return;if(data.error){toast('音声解析でエラーが発生しました。もう一度開始してね。');stop();return;}const m=tracker.accept(data,data.t);addPoint(data.t,m,data.confidence);setCurrent(m,m===null?null:data.hz);};
    worker.onerror=()=>{toast('音声解析を開始できませんでした。再読み込みしてね。');stop();};
    Object.assign(state,{starting:false,running:true,paused:false,points:[],recent:[],duration:0,startedAt:new Date().toISOString(),sessionId:crypto.randomUUID(),sessionMode:state.mode,saved:false,stats:new SessionStats(),summary:null,lastStored:-1,storeEvery:.09,decimated:false});
    $('comment').value='';$('retention').textContent='セッション全体を保持';tracker.reset();state.epoch++;graph.follow=true;clock=performance.now();state.gate=true;state.phase='idle';setCurrent(null,null);buttons();status('聴いています',true);
    stream.getAudioTracks().forEach(track=>track.onended=()=>{if(state.running){stop();toast('マイクの接続が終了しました。ここまでの結果を保存できます。');}});
    if(state.mode==='practice'&&state.practice==='scale'){state.key=+$('startNote').value;beginCall();}
    else if(state.mode==='practice'){state.target=+$('targetNote').value;$('phaseLabel').textContent='あなたの番 · 目標音を長く、やさしく';$('practiceTarget').textContent=name(state.target);}
    timer=setInterval(tick,50);if(navigator.wakeLock)navigator.wakeLock.request('screen').then(lock=>{if(state.running)wakeLock=lock;else lock.release();}).catch(()=>{});
  }catch(error){if(request===requestId){stop();const messages={NotAllowedError:'マイクが許可されていません。Chromeのサイト設定から許可してね。',NotFoundError:'マイクが見つかりません。接続を確認してね。',NotReadableError:'マイクを使用できません。ほかの録音アプリを閉じて試してね。'};toast(messages[error.name]||`開始できませんでした：${error.message}`);}}
  finally{if(request===requestId){state.starting=false;buttons();}}
}
let lastDraw=0;
function tick(){if(!state.running)return;state.duration=(performance.now()-clock)/1000;if(!state.paused){advancePractice();if(state.gate&&!busy){const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);busy=true;worker.postMessage({samples,rate:context.sampleRate,floor:state.floor,t:state.duration,epoch:state.epoch},[samples.buffer]);}else if(!state.gate)addPoint(state.duration,null);}else addPoint(state.duration,null);if(performance.now()-lastDraw>95){render();lastDraw=performance.now();}}
function gate(on){state.gate=on;state.epoch++;tracker.reset();state.recent=[];state.stats.run=[];setCurrent(null,null);}
function beginCall(){
  gate(false);state.target=null;state.phase='call';state.phaseStart=state.duration;state.step=0;$('nextKey').hidden=true;
  const beat=60/+$('tempo').value;
  for(let i=0;i<SCALE.length;i++)player.play(state.key+SCALE[i],beat*.85,+$('volume').value/100,context.currentTime+.08+i*beat);
  state.phaseStart=state.duration+.08;$('phaseLabel').textContent='お手本を聴こう';$('practiceTarget').textContent=`開始音 ${name(state.key)}`;status('お手本の再生中 · 解析は休止');
}
function advancePractice(){if(state.mode!=='practice'||state.practice!=='scale'||state.phase==='idle'||state.phase==='manual')return;
  const beat=60/+$('tempo').value,age=state.duration-state.phaseStart;
  if(state.phase==='call'){
    state.step=Math.max(0,Math.min(8,Math.floor(age/beat)));showStep();
    if(age>=9*beat){state.phase='wait';state.phaseStart=state.duration;$('phaseLabel').textContent='ひと呼吸 · あなたの番へ';showStep(-1);}
  }else if(state.phase==='wait'&&age>=.8){state.phase='response';state.phaseStart=state.duration;state.responseErrors=[];gate(true);$('phaseLabel').textContent='あなたの番 · 表示に合わせて発声';status('あなたの声を聴いています',true);}
  else if(state.phase==='response'){
    state.step=Math.min(8,Math.floor(age/beat));state.target=state.key+SCALE[state.step];$('practiceTarget').textContent=name(state.target);showStep();
    // Evaluate middle portions of each note to avoid transition timing bias.
    const fraction=age/beat-Math.floor(age/beat),last=state.recent.at(-1);if(fraction>.25&&fraction<.8&&last?.m!==null&&last&&state.duration-last.t<.15)state.responseErrors.push(Math.abs((last.m-state.target)*100));
    if(age>=9*beat){const errors=state.responseErrors;gate(false);state.target=null;state.phase='rest';state.phaseStart=state.duration;$('phaseLabel').textContent=errors.length>=5?`今回の平均誤差 ${Math.round(errors.reduce((a,b)=>a+b,0)/errors.length)} cent（発声音のみ）`:'声を十分に検出できませんでした';showStep(-1);status('ひと休み');}
  }else if(state.phase==='rest'&&age>=1.5){if(state.key===+$('endNote').value){stop();toast('設定した範囲の練習が完了したよ。');}else if($('advance').value==='manual'){state.phase='manual';$('nextKey').hidden=false;$('practiceTarget').textContent='準備できたら、次のキーへ';}else nextKey();}
}
function showStep(index=state.step){[...$('scaleDots').children].forEach((e,i)=>e.classList.toggle('active',i===index));}
function nextKey(){state.key+=+$('direction').value;beginCall();}
function pause(){if(!state.running)return;state.paused=!state.paused;player.stop();gate(false);if(state.paused){status('一時停止中');$('phaseLabel').textContent='一時停止 · 再開すると同じキーのお手本から';$('nextKey').hidden=true;}else if(state.practice==='scale')beginCall();else {gate(true);status('聴いています',true);$('phaseLabel').textContent='あなたの番';}buttons();}
function stop(){const wasRunning=state.running;requestId++;state.starting=false;if(state.running)state.duration=(performance.now()-clock)/1000;state.running=false;state.paused=false;state.epoch++;clearInterval(timer);worker?.terminate();worker=null;busy=false;source?.disconnect();stream?.getTracks().forEach(t=>t.stop());stream=null;player?.stop();wakeLock?.release().catch(()=>{});wakeLock=null;if(context?.state==='running')context.suspend().catch(()=>{});state.phase='idle';state.target=null;$('nextKey').hidden=true;showStep(-1);if(wasRunning)state.summary=state.stats.summary();status(state.sessionId?'測定終了 · グラフで振り返れます':'開始するとマイクが有効になるよ');setCurrent(null,null);buttons();render();}
async function store(){if(!state.sessionId||state.running||state.saved)return;$('save').disabled=true;try{await saveSession({id:state.sessionId,date:state.startedAt,duration:state.duration,summary:state.summary||state.stats.summary(),points:state.points,comment:$('comment').value,mode:state.sessionMode||state.mode,decimated:state.decimated});state.saved=true;toast('練習結果とピッチ履歴を保存したよ。');if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});}catch(error){toast(`保存できませんでした。空き容量を確認してね。${error.message||''}`);}buttons();}
async function histories(){const sessions=(await listSessions()).sort((a,b)=>b.date.localeCompare(a.date));$('historyList').replaceChildren();if(!sessions.length){const p=document.createElement('p');p.className='hint';p.textContent='保存した練習が、ここに並びます。';$('historyList').append(p);}
  for(const s of sessions){const el=document.createElement('article');el.className='history-item';const heading=document.createElement('h3');heading.textContent=new Date(s.date).toLocaleString('ja-JP');const desc=document.createElement('p');desc.textContent=`${time(s.duration)} · ${name(s.summary.stableLow)} 〜 ${name(s.summary.stableHigh)}\n${s.comment||''}`;const actions=document.createElement('div');actions.className='history-actions';const open=document.createElement('button');open.textContent='軌跡を見る';open.onclick=()=>{if(state.sessionId&&!state.saved&&!confirm('未保存の結果を破棄して履歴を開きますか？'))return;Object.assign(state,{points:s.points||[],duration:s.duration,summary:s.summary,sessionId:s.id,startedAt:s.date,saved:true,recent:[],decimated:!!s.decimated});$('comment').value=s.comment||'';$('retention').textContent=s.decimated?'全体を保持（長時間のため間引き）':'セッション全体を保持';mode('range');graph.follow=true;render();$('historyDialog').close();status('保存した練習を表示中');};const del=document.createElement('button');del.textContent='削除';del.onclick=async()=>{if(confirm('この練習履歴を削除しますか？ 元に戻せません。')){try{await deleteSession(s.id);if(state.sessionId===s.id){state.saved=false;buttons();}await histories();}catch{toast('削除できませんでした。');}}};actions.append(open,del);el.append(heading,desc,actions);$('historyList').append(el);}return sessions;}
async function storageInfo(){const sessions=await listSessions(),bytes=new Blob([JSON.stringify(sessions)]).size,persisted=await navigator.storage?.persisted?.();$('storageInfo').textContent=`保存 ${sessions.length}件 · 約${(bytes/1024).toFixed(1)}KB\n永続ストレージ：${persisted?'許可済み':'未許可（許可はブラウザが判断します）'}`;}
function download(text,filename,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),20000);}
async function exportHistory(backup=false){try{const sessions=await listSessions();if(!sessions.length){toast('保存済みの練習がありません。');return;}sessions.sort((a,b)=>a.date.localeCompare(b.date));const dates=sessions.map(s=>new Date(s.date).toLocaleDateString('sv-SE').replaceAll('-',''));const file=`発声練習記録_${dates[0]}-${dates.at(-1)}`;if(backup)download(JSON.stringify({app:'vocal-range-trainer',version:1,sessions}),file+'.json','application/json');else{let text='# 発声練習記録\n\n';for(const s of sessions)text+=`## ${new Date(s.date).toLocaleString('ja-JP')}\n\n- 時間：${time(s.duration)}\n- 安定声域：${noteName(s.summary.stableLow)} 〜 ${noteName(s.summary.stableHigh)}\n- 瞬間声域：${noteName(s.summary.low)} 〜 ${noteName(s.summary.high)}\n- 安定部分の平均安定度：${s.summary.score??'未測定'}\n\n${s.comment||''}\n\n`;text+='安定度は安定した区間の揺れを基にした参考値です。生音声は保存していません。\n';download(text,file+'.md','text/markdown;charset=utf-8');}}catch{toast('出力できませんでした。');}}
async function importHistory(file){if(!file)return;try{if(file.size>30*1024*1024)throw new Error('30MB以下のファイルを選んでね。');const data=JSON.parse(await file.text());if(data.app!=='vocal-range-trainer'||data.version!==1||!Array.isArray(data.sessions)||data.sessions.length>5000)throw new Error('対応するバックアップではありません。');const valid=data.sessions.every(s=>typeof s.id==='string'&&s.id.length<100&&Number.isFinite(Date.parse(s.date))&&Number.isFinite(s.duration)&&s.duration>=0&&s.duration<604800&&typeof s.comment==='string'&&s.comment.length<100000&&s.summary&&['low','high','stableLow','stableHigh','score'].every(k=>s.summary[k]===null||Number.isFinite(s.summary[k]))&&Array.isArray(s.points)&&s.points.length<=72000&&s.points.every((p,i)=>Number.isFinite(p.t)&&p.t>=0&&p.t<=s.duration+.1&&(i===0||p.t>=s.points[i-1].t)&&(p.m===null||Number.isFinite(p.m)&&p.m>=20&&p.m<=100)));if(!valid)throw new Error('バックアップのデータ形式を確認できません。');const ids=new Set((await listSessions()).map(s=>s.id));let count=0;for(const s of data.sessions)if(!ids.has(s.id)){await saveSession(s);ids.add(s.id);count++;}toast(`${count}件を追加しました。既存の履歴は保持しています。`);await histories();}catch(e){toast('読み込めませんでした：'+e.message);}finally{$('import').value='';}}
for(const el of document.querySelectorAll('[data-mode]'))el.onclick=()=>mode(el.dataset.mode);
for(const el of document.querySelectorAll('[data-window]'))el.onclick=()=>{document.querySelectorAll('[data-window]').forEach(b=>{b.classList.toggle('active',b===el);b.setAttribute('aria-pressed',b===el);});graph.setWindow(el.dataset.window);};
for(const el of document.querySelectorAll('[data-practice]'))el.onclick=()=>{state.practice=el.dataset.practice;document.querySelectorAll('[data-practice]').forEach(b=>{b.classList.toggle('active',b===el);b.setAttribute('aria-pressed',b===el);});$('scaleFields').hidden=state.practice!=='scale';$('toneFields').hidden=state.practice!=='tone';$('scaleDots').hidden=state.practice!=='scale';$('phaseLabel').textContent=state.practice==='scale'?'お手本 → 少し待つ → あなたの番':'目標音を聴いてから、長く発声';$('practiceTarget').textContent=state.practice==='scale'?'1 · 2 · 3 · 4 · 5 · 4 · 3 · 2 · 1':name(+$('targetNote').value);mode('practice');};
$('start').onclick=start;$('stop').onclick=stop;$('pause').onclick=pause;$('nextKey').onclick=nextKey;$('save').onclick=store;$('follow').onclick=()=>{graph.follow=true;render();};
$('settingsOpen').onclick=()=>{$('settingsDialog').showModal();storageInfo().catch(()=>toast('保存領域を利用できません。'));};$('historyOpen').onclick=()=>{$('historyDialog').showModal();histories().catch(()=>toast('履歴を読み込めませんでした。'));};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
$('noteFormat').onchange=async()=>{state.format=$('noteFormat').value;fillNotes();render();setCurrent(null,null);try{await saveSettings({format:state.format,floor:state.floor});}catch{toast('設定を保存できませんでした。');}};
$('noiseFloor').onchange=async()=>{state.floor=+$('noiseFloor').value;try{await saveSettings({format:state.format,floor:state.floor});}catch{toast('設定を保存できませんでした。');}};
$('persist').onclick=async()=>{if(!navigator.storage?.persist){toast('このブラウザは永続ストレージ申請に対応していません。');return;}try{const allowed=await navigator.storage.persist();toast(allowed?'保存データの保護が許可されたよ。':'今回は未許可でした。ホーム画面に追加して継続使用後、再申請できます。');await storageInfo();}catch{toast('申請できませんでした。');}};
$('startNote').onchange=updateScaleRange;$('endNote').onchange=updateScaleRange;$('volume').oninput=()=>{$('volumeText').textContent=$('volume').value+'%';};
$('preset').onclick=()=>{$('startNote').value='48';$('endNote').value='55';$('direction').value='1';$('tempo').value='80';$('advance').value='auto';updateScaleRange();};
$('targetNote').onchange=()=>{state.target=+$('targetNote').value;$('practiceTarget').textContent=name(state.target);setCurrent(null,null);render();};
$('referenceTone').onclick=async()=>{try{await audioContext();player.stop();player.play(+$('targetNote').value,1.2,+$('volume').value/100);}catch{toast('音を再生できませんでした。');}};
$('export').onclick=()=>exportHistory();$('backup').onclick=()=>exportHistory(true);$('import').onchange=()=>importHistory($('import').files[0]);
for(let i=0;i<9;i++)$('scaleDots').append(document.createElement('i'));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(state.running||state.starting)){stop();toast('画面を離れたため終了しました。結果は保存できます。');}else if(document.hidden)player?.stop();});
window.addEventListener('pagehide',()=>{if(state.running||state.starting)stop();});
window.addEventListener('beforeunload',e=>{if(state.running||state.sessionId&&!state.saved){e.preventDefault();e.returnValue='';}});
fillNotes();mode('live');
getSettings().then(settings=>{if(settings){state.format=['both','japanese','international'].includes(settings.format)?settings.format:'both';state.floor=[.004,.008,.016].includes(settings.floor)?settings.floor:.008;$('noteFormat').value=state.format;$('noiseFloor').value=state.floor;fillNotes();render();}}).catch(()=>toast('履歴保存を利用できません。通常のChromeで開いてね。'));
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>toast('オフライン準備に失敗しました。通信中に再読み込みしてね。'));
