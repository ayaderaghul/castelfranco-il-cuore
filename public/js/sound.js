// 8-bit sound effects, synthesized live with the Web Audio API.
// No audio files and no outside requests: every sound is a few square/triangle/noise notes.

const KEY = 'cuore.sound';
let enabled = read();
let ctx = null;
let master = null;

function read() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export const soundOn = () => enabled;

export function setSound(on) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: remember only for this visit */
  }
  if (on) sfx('toggle');
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.18; // keep it gentle
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI number → Hz

/** One note: wave type, MIDI note (or Hz via {hz}), start offset and length in seconds. */
function tone(c, { wave = 'square', midi, hz, at = 0, len = 0.08, vol = 1, slide = 0 }) {
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = wave;
  const f = hz ?? NOTE(midi);
  o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + len + 0.02);
}

function noise(c, { at = 0, len = 0.12, vol = 0.6 }) {
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  const g = c.createGain();
  src.buffer = buf;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(g).connect(master);
  src.start(t);
}

const seq = (c, notes, step, opts = {}) => notes.forEach((m, i) => m != null && tone(c, { midi: m, at: i * step, len: step * 0.95, ...opts }));

const SOUNDS = {
  // tiny tick for any button or link
  blip: (c) => tone(c, { midi: 84, len: 0.03, vol: 0.35 }),
  // bottom navigation
  nav: (c) => seq(c, [76, 83], 0.04, { vol: 0.45 }),
  // a dialog opens
  open: (c) => tone(c, { midi: 72, len: 0.09, vol: 0.4, slide: 1.5 }),
  // something saved
  ok: (c) => seq(c, [72, 76, 79], 0.06, { vol: 0.5 }),
  // event saved: a short fanfare
  fanfare: (c) => {
    seq(c, [67, 72, 76, 79, null, 76, 79], 0.08, { vol: 0.5 });
    seq(c, [55, 60, 64, 67], 0.14, { wave: 'triangle', vol: 0.8 });
  },
  // item collected: the classic coin
  coin: (c) => {
    tone(c, { midi: 83, len: 0.07, vol: 0.5 });
    tone(c, { midi: 88, at: 0.07, len: 0.28, vol: 0.5 });
  },
  // Claude finished scoring and points went up
  levelup: (c) => seq(c, [60, 64, 67, 72, 67, 72, 76, 84], 0.055, { vol: 0.45 }),
  // points went down or something was removed
  down: (c) => seq(c, [72, 67, 63, 60], 0.07, { vol: 0.45 }),
  // delete: a falling blip with a puff of noise
  del: (c) => {
    tone(c, { midi: 64, len: 0.22, vol: 0.5, slide: 0.35 });
    noise(c, { at: 0.05, len: 0.15, vol: 0.25 });
  },
  // undo a habit/chore tick
  undo: (c) => seq(c, [76, 71], 0.05, { vol: 0.4 }),
  // error or refusal
  error: (c) => {
    tone(c, { midi: 45, len: 0.12, vol: 0.5 });
    tone(c, { midi: 44, at: 0.13, len: 0.18, vol: 0.5 });
  },
  // after logging in
  start: (c) => {
    seq(c, [64, 67, 72, 76, 79, 84], 0.07, { vol: 0.45 });
    seq(c, [48, 55, 60], 0.14, { wave: 'triangle', vol: 0.8 });
  },
  // sound switched on
  toggle: (c) => seq(c, [79, 84], 0.05, { vol: 0.4 }),
};

/** Play a named effect if sound is on. Never throws: sound is decoration. */
export function sfx(name) {
  if (!enabled || !name) return;
  try {
    const c = audio();
    if (c && SOUNDS[name]) SOUNDS[name](c);
  } catch {
    /* ignore */
  }
}
