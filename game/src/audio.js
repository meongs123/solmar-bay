// Synthesized audio for SOLMAR BAY: WebAudio only, no sound files. A low
// bass pad loops quietly, the engine hum follows the car speed, sirens wail
// while wanted, and short blips mark pickups, punches, shots and jingles.
// Audio starts on the first user gesture (autoplay policy).
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null, engineGain = null;
  let sirenOsc = null, sirenGain = null;
  let padOsc = null, padGain = null;
  let muted = false;
  let musicTimer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    // Engine hum: two detuned saws through a lowpass.
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    const engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'sawtooth';
    engineOsc2.frequency.value = 58;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 320;
    engineOsc.connect(lp); engineOsc2.connect(lp);
    lp.connect(engineGain); engineGain.connect(master);
    engineOsc.start(); engineOsc2.start();
    // Siren: a sine that sweeps up and down.
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'sine';
    sirenOsc.frequency.value = 700;
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain); sirenGain.connect(master);
    sirenOsc.start();
    // Bass pad: slow chord that breathes under everything.
    padOsc = ctx.createOscillator();
    padOsc.type = 'triangle';
    padOsc.frequency.value = 55;
    padGain = ctx.createGain();
    padGain.gain.value = 0.05;
    padOsc.connect(padGain); padGain.connect(master);
    padOsc.start();
    return true;
  }

  function blip(freq, dur, type = 'square', vol = 0.15, slideTo = null) {
    if (!ctx || muted) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  function jingle(notes, step = 0.09) {
    if (!ctx || muted) return;
    notes.forEach((f, i) => {
      setTimeout(() => blip(f, 0.16, 'triangle', 0.18), i * step * 1000);
    });
  }

  const A = {
    unlock() { ensure(); },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    get muted() { return muted; },
    setEngine(speedFrac, inCar) {
      if (!ctx) return;
      const target = inCar ? 0.05 + speedFrac * 0.1 : 0;
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
      if (engineOsc) engineOsc.frequency.setTargetAtTime(55 + speedFrac * 90, ctx.currentTime, 0.1);
    },
    setSiren(on) {
      if (!ctx) return;
      sirenGain.gain.setTargetAtTime(on && !muted ? 0.035 : 0, ctx.currentTime, 0.2);
      if (on) sirenOsc.frequency.setTargetAtTime(650 + Math.sin(Date.now() / 350) * 220, ctx.currentTime, 0.05);
    },
    punch() { blip(140, 0.12, 'square', 0.2, 70); },
    shoot() { blip(900, 0.09, 'sawtooth', 0.22, 120); },
    hit() { blip(220, 0.1, 'square', 0.18, 90); },
    pickup() { jingle([660, 880]); },
    cash() { jingle([880, 1174, 1568], 0.07); },
    crash() { blip(90, 0.25, 'sawtooth', 0.25, 40); },
    bust() { jingle([392, 330, 262, 196], 0.16); },
    jingle(kind) {
      if (kind === 'mission') jingle([523, 659, 784]);
      else if (kind === 'complete') jingle([523, 659, 784, 1046], 0.08);
      else if (kind === 'fail') jingle([330, 262, 196], 0.14);
      else jingle([660, 880]);
    },
    startMusic() {
      if (musicTimer || !ctx) return;
      // A lazy two-bar bass line, one note a second.
      const line = [55, 55, 65.4, 49, 55, 55, 73.4, 65.4];
      let i = 0;
      musicTimer = setInterval(() => {
        if (muted || !ctx) return;
        blip(line[i % line.length], 0.5, 'triangle', 0.05);
        i++;
      }, 1000);
    },
  };
  return A;
}
