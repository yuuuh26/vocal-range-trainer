// YIN cumulative mean normalized difference, with parabolic period refinement.
export const hzToMidi = hz => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = midi => 440 * 2 ** ((midi - 69) / 12);
export function noteName(midi, format = 'both') {
  if (!Number.isFinite(midi)) return '—';
  const n = Math.round(midi), octave = Math.floor(n / 12) - 1;
  const name = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((n % 12) + 12) % 12];
  const international = name + octave;
  const prefix = ({0:'lowlowlow',1:'lowlow',2:'low',3:'mid1',4:'mid2',5:'hi',6:'hihi',7:'hihihi'})[octave];
  const japanese = prefix ? prefix + name : international;
  return format === 'international' ? international : format === 'japanese' ? japanese : `${japanese} (${international})`;
}
export const SCALE = [0,2,4,5,7,5,4,2,0];
export function detectPitch(input, sampleRate, floor = 0.008) {
  // Average downsampling to ~12 kHz keeps the worker inexpensive on phones.
  const stride = Math.max(1, Math.floor(sampleRate / 12000));
  const rate = sampleRate / stride, size = Math.floor(input.length / stride);
  const x = new Float32Array(size);
  let mean = 0;
  for (let i = 0; i < size; i++) {
    let sum = 0;
    for (let j = 0; j < stride; j++) sum += input[i * stride + j];
    x[i] = sum / stride; mean += x[i];
  }
  mean /= size;
  let energy = 0;
  for (let i = 0; i < size; i++) { x[i] -= mean; energy += x[i] ** 2; }
  const rms = Math.sqrt(energy / size);
  if (rms < floor) return {hz:null, confidence:0, rms};
  const maxTau = Math.min(Math.ceil(rate / 55) + 3, Math.floor(size / 2) - 1);
  const minTau = Math.max(2, Math.floor(rate / 1200));
  const window = size - maxTau - 1, cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let difference = 0;
    for (let j = 0; j < window; j++) difference += (x[j] - x[j + tau]) ** 2;
    running += difference; cmnd[tau] = running ? difference * tau / running : 1;
  }
  let tau = minTau;
  for (; tau < maxTau - 1; tau++) {
    if (cmnd[tau] < 0.12) {
      while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
      break;
    }
  }
  if (tau >= maxTau - 1 || cmnd[tau] > 0.12) return {hz:null, confidence:0, rms};
  const left = cmnd[tau - 1], center = cmnd[tau], right = cmnd[tau + 1];
  const denom = 2 * (2 * center - left - right);
  const refined = tau + (denom ? (right - left) / denom : 0);
  const hz = rate / refined;
  return {hz:hz >= 55 && hz <= 1200 ? hz : null, confidence:1 - center, rms};
}
export class PitchTracker {
  constructor() { this.reset(); }
  reset() { this.previous = null; this.pending = null; this.count = 0; this.last = -1; }
  accept(result, time) {
    if (!result.hz || result.confidence < .88) { if (time - this.last > .18) this.reset(); return null; }
    const midi = hzToMidi(result.hz);
    if (this.previous === null || Math.abs(midi - this.previous) > 2) {
      if (this.pending !== null && Math.abs(midi - this.pending) < .8) this.count++;
      else { this.pending = midi; this.count = 1; }
      const needed = this.previous !== null && Math.abs(midi - this.previous) > 7 ? 3 : 2;
      if (this.count < needed) return null;
    }
    this.previous = midi; this.last = time; this.count = 0; this.pending = null;
    return midi;
  }
}
export class SessionStats {
  constructor() { this.low = null; this.high = null; this.stableLow = null; this.stableHigh = null; this.run = []; this.last = null; this.scoreSum = 0; this.scoreCount = 0; }
  add(t, midi, confidence = 1) {
    if (midi === null) { this.run = []; return; }
    this.low = this.low === null ? midi : Math.min(this.low, midi);
    this.high = this.high === null ? midi : Math.max(this.high, midi);
    const n = Math.round(midi), first = this.run[0];
    if (first && (n !== first.n || t - this.run.at(-1).t > .15 || Math.abs(midi - first.midi) > .3)) this.run = [];
    if (confidence < .9) { this.run = []; return; }
    this.run.push({t,midi,n});
    while (this.run.length > 1 && t - this.run[0].t > 1.1) this.run.shift();
    if (t - this.run[0].t >= .35) {
      const values = this.run.map(p => p.midi * 100);
      const mean = values.reduce((a,b) => a+b,0) / values.length;
      const sd = Math.sqrt(values.reduce((a,b) => a+(b-mean)**2,0) / values.length);
      if (sd <= 15 && Math.max(...values) - Math.min(...values) <= 60) {
        this.stableLow = this.stableLow === null ? n : Math.min(this.stableLow,n);
        this.stableHigh = this.stableHigh === null ? n : Math.max(this.stableHigh,n);
        const score = Math.max(0, Math.round(100 - sd * 2));
        this.last = {mean:mean/100, sd, score}; this.scoreSum += score; this.scoreCount++;
      }
    }
  }
  summary() { return {low:this.low,high:this.high,stableLow:this.stableLow,stableHigh:this.stableHigh,score:this.scoreCount ? Math.round(this.scoreSum/this.scoreCount) : null}; }
}
export function toneStats(points, target = null) {
  const valid = points.filter(p => p.m !== null);
  if (valid.length < 4) return null;
  const mean = valid.reduce((s,p) => s+p.m,0) / valid.length;
  const sd = Math.sqrt(valid.reduce((s,p) => s+(100*(p.m-mean))**2,0)/valid.length);
  return {mean,sd,error:100*(mean-(target ?? Math.round(mean))),score:Math.max(0,Math.round(100-2*sd))};
}
