import {midiToHz} from './pitch.js';
export class TonePlayer {
  constructor(context){this.context=context;this.nodes=new Set();}
  play(midi,duration,volume=.35,when=this.context.currentTime){
    const ctx=this.context, gain=ctx.createGain(); gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(volume*.35,when+.018);gain.gain.exponentialRampToValueAtTime(Math.max(.001,volume*.12),when+Math.max(.03,duration*.65));gain.gain.linearRampToValueAtTime(0,when+duration);
    // A soft fundamental with gently decaying harmonics, no external samples.
    const real=new Float32Array([0,0,0,0,0]),imag=new Float32Array([0,1,.22,.07,.02]);
    const osc=ctx.createOscillator();osc.setPeriodicWave(ctx.createPeriodicWave(real,imag));osc.frequency.value=midiToHz(midi);osc.connect(gain);this.nodes.add(osc);
    osc.onended=()=>{osc.disconnect();gain.disconnect();this.nodes.delete(osc);};osc.start(when);osc.stop(when+duration+.025);
  }
  stop(){for(const node of this.nodes){try{node.stop();}catch{}node.disconnect();}this.nodes.clear();}
}
