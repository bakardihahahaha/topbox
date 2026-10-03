// The camera "click" — made on the spot with the Web Audio API (no sound file to load): two very
// short bursts of filtered noise, like a shutter opening and closing.
let ctx: AudioContext | null = null;

function burst(ac: AudioContext, at: number, length: number, freq: number, gain: number) {
  const samples = Math.floor(ac.sampleRate * length);
  const buffer = ac.createBuffer(1, samples, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples, 3);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 0.8;
  const vol = ac.createGain();
  vol.gain.value = gain;
  src.connect(filter).connect(vol).connect(ac.destination);
  src.start(at);
}

export function playShutter(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime + 0.01;
    burst(ctx, now, 0.045, 3200, 0.9); // "pst-"
    burst(ctx, now + 0.075, 0.06, 1800, 0.7); // "-ryk"
  } catch {
    // no audio here — the photo is taken anyway
  }
}
