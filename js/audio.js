// Tiny WebAudio sound kit: engine hum, parking-sensor beeps, bumps, gear grind, indicator ticks.
(function (P) {
  class Sound {
    constructor() { this.ctx = null; this.muted = false; }
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = 0.6; this.master.connect(c.destination);
      // engine: two detuned saws through a low-pass filter
      this.engGain = c.createGain(); this.engGain.gain.value = 0;
      this.engFilter = c.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 380;
      this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
      this.o2 = c.createOscillator(); this.o2.type = 'square';
      const g2 = c.createGain(); g2.gain.value = 0.35;
      this.o1.connect(this.engFilter); this.o2.connect(g2); g2.connect(this.engFilter);
      this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
      this.o1.start(); this.o2.start();
    }
    engine(rpm, on, load) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const f = Math.max(10, rpm / 30);
      this.o1.frequency.setTargetAtTime(f, t, 0.05);
      this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      this.engFilter.frequency.setTargetAtTime(250 + rpm * 0.15 + load * 300, t, 0.1);
      this.engGain.gain.setTargetAtTime(this.muted || !on ? 0 : 0.05 + load * 0.04, t, 0.08);
    }
    tone(freq, dur, type = 'sine', vol = 0.15, slide = 0) {
      if (!this.ctx || this.muted) return;
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    }
    noise(dur, freq, vol = 0.3) {
      if (!this.ctx || this.muted) return;
      const c = this.ctx, t = c.currentTime;
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = c.createBufferSource(); s.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
      const g = c.createGain(); g.gain.value = vol;
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
    }
    beep(front) { this.tone(front ? 1750 : 1350, 0.07, 'sine', 0.12); }
    bump() { this.noise(0.25, 300, 0.7); }
    kerb() { this.noise(0.15, 600, 0.4); }
    grind() { this.noise(0.35, 3000, 0.25); this.tone(90, 0.3, 'sawtooth', 0.08); }
    tick(on) { this.tone(on ? 2400 : 1900, 0.025, 'square', 0.05); }
    chime() { this.tone(880, 0.12, 'sine', 0.1); setTimeout(() => this.tone(1320, 0.18, 'sine', 0.1), 110); }
    stall() { this.tone(120, 0.5, 'sawtooth', 0.12, -90); }
    click() { this.tone(500, 0.03, 'square', 0.05); }
  }
  P.sound = new Sound();
})(window.PS);
