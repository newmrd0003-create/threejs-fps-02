// Audio: WebAudio synthesis only — no audio files, no network.
// One shared noise buffer; every sound is a few oscillators / filtered
// noise bursts built on demand. The context resumes on the first user gesture.
export function createAudio() {
  let ctx = null;
  let noiseBuf = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noise(dur, filterFreq, gain, type = 'lowpass') {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = null) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    shot(def) {
      // Crack (high noise) + thump (low sine drop) — louder for the rifle.
      noise(0.09, 3200, def.id === 'rifle' ? 0.5 : 0.35, 'highpass');
      tone(160, 0.12, 0.4, 'sine', 55);
    },
    enemyShot() {
      noise(0.08, 2200, 0.22, 'highpass');
      tone(140, 0.1, 0.2, 'sine', 60);
    },
    dry() { tone(900, 0.04, 0.12, 'square'); },
    reload() {
      tone(500, 0.05, 0.15, 'square');
      setTimeout(() => tone(700, 0.05, 0.15, 'square'), 160);
    },
    select() { tone(600, 0.04, 0.12, 'square', 900); },
    hit(kill, head) {
      tone(head ? 1400 : 1100, 0.07, 0.25, 'sine');
      if (kill) {
        tone(700, 0.12, 0.3, 'sine', 1400);
        setTimeout(() => tone(1050, 0.1, 0.25, 'sine'), 90);
      }
    },
    hurt() {
      tone(220, 0.18, 0.35, 'sawtooth', 90);
      noise(0.12, 500, 0.25);
    },
    explosion() {
      noise(0.7, 300, 0.9);
      tone(90, 0.6, 0.7, 'sine', 30);
    },
    throwGrenade() { noise(0.06, 1200, 0.15, 'bandpass'); },
    plantBeep() { tone(1200, 0.08, 0.2, 'square'); },
    plantTick() { tone(1000, 0.04, 0.12, 'square'); },
    buy() {
      tone(880, 0.08, 0.2, 'sine');
      setTimeout(() => tone(1320, 0.1, 0.2, 'sine'), 80);
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.25, 'sine'), i * 110));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.25, 0.22, 'sine'), i * 130));
    },
    footstep() { noise(0.05, 700, 0.07); },
  };
}
