import { detectPitch } from './pitch.js';
self.onmessage = ({data}) => {
  try { self.postMessage({...detectPitch(data.samples,data.rate,data.floor),t:data.t,epoch:data.epoch}); }
  catch (error) { self.postMessage({error:error.message,epoch:data.epoch}); }
};
