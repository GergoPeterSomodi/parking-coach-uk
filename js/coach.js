// Coaching engine: observation tracking, guided steps, demo autopilot, fault recording, debrief.
(function (P) {
  const D = P.deg, rad = P.rad;
  const LOOK_ZONES = ['rear', 'leftShoulder', 'rightShoulder', 'leftMirror', 'rightMirror', 'interiorMirror'];
  P.ZONE_NAMES = {
    front: 'Ahead', rear: 'Rear window', leftShoulder: 'Left blind spot', rightShoulder: 'Right blind spot',
    leftMirror: 'Left mirror', rightMirror: 'Right mirror', interiorMirror: 'Interior mirror',
    leftWindow: 'Left window', rightWindow: 'Right window', mirrors: 'Both door mirrors', allRound: 'All round',
  };

  P.gazePresets = function (spec) {
    const e = spec.eye, m = spec.mirror;
    const dirTo = (x, y, z) => { const dx = x - e.x, dy = y - e.y, dz = z - e.z; return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) }; };
    return {
      front: { yaw: 0, pitch: -0.08 },
      leftMirror: dirTo(m.x + 0.06, m.y, m.z - 0.04),
      rightMirror: dirTo(-m.x - 0.06, m.y, m.z - 0.04),
      interiorMirror: dirTo(0, spec.height - 0.15, spec.roofFront + 0.06),
      leftShoulder: { yaw: rad(118), pitch: -0.1 },
      rightShoulder: { yaw: rad(-118), pitch: -0.1 },
      rear: { yaw: rad(162), pitch: -0.12 },
      leftWindow: { yaw: rad(72), pitch: -0.32 },
      rightWindow: { yaw: rad(-80), pitch: -0.38 },
    };
  };
  P.LOOK_SEQ = {
    allRound: ['leftShoulder', 'rear', 'rightShoulder', 'rightMirror', 'leftMirror'],
    mirrors: ['leftMirror', 'rightMirror', 'rear'],
  };
  P.resolveLook = function (look, t, per = 0.75) {
    const seq = P.LOOK_SEQ[look];
    if (!seq) return look;
    const p = look === 'mirrors' ? 1.3 : per;
    return seq[Math.floor(t / p) % seq.length];
  };

  class Obs {
    constructor(spec) { this.spec = spec; this.presets = P.gazePresets(spec); this.reset(); }
    reset() { this.last = {}; this.t = 0; this.zone = 'front'; this.zoneTime = 0; }
    classify(yaw, pitch) {
      const yd = D(yaw);
      if (Math.abs(yd) >= 140) return 'rear';
      if (yd >= 95) return 'leftShoulder';
      if (yd <= -95) return 'rightShoulder';
      const v = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
      for (const k of ['leftMirror', 'rightMirror', 'interiorMirror']) {
        const p = this.presets[k];
        const w = { x: Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: Math.cos(p.yaw) * Math.cos(p.pitch) };
        const ang = Math.acos(P.clamp(v.x * w.x + v.y * w.y + v.z * w.z, -1, 1));
        if (ang < rad(k === 'interiorMirror' ? 9 : 11)) return k;
      }
      if (Math.abs(yd) < 30) return 'front';
      return yd > 0 ? 'leftWindow' : 'rightWindow';
    }
    update(dt, yaw, pitch, t) {
      this.t = t;
      const z = this.classify(yaw, pitch);
      if (z === this.zone) this.zoneTime += dt; else { this.zone = z; this.zoneTime = 0; }
      if (this.zoneTime >= 0.2) this.last[z] = t;
    }
    seenWithin(z, sec) { return this.last[z] != null && this.t - this.last[z] <= sec; }
    allRound(sec = 12) {
      return this.seenWithin('leftShoulder', sec) && this.seenWithin('rightShoulder', sec) &&
        (this.seenWithin('rear', sec) || this.seenWithin('interiorMirror', sec));
    }
    lookingBack() { return LOOK_ZONES.includes(this.zone); }
  }
  P.Obs = Obs;

  class Coach {
    constructor() { this.active = false; }

    start(ctx, mode, spec) {
      this.ctx = ctx; this.mode = mode; this.spec = spec;
      this.steps = (mode === 'demo' || mode === 'guided') ? ctx.steps : [];
      this.idx = 0; this.stepT = 0; this.entered = -1;
      this.faults = []; this.rec = { samples: [] }; this.sampleT = 0;
      this.time = 0; this.finished = false; this.active = true;
      this.noLook = 0; this.revFlag = false; this.lastFault = {};
      this.maxNoLook = 0;
    }
    get step() { return this.steps[this.idx] || null; }

    fault(type, sev, msg) {
      if (this.mode === 'demo' || this.finished) return;
      const t = this.time;
      if (this.lastFault[type] != null && t - this.lastFault[type] < 2.5) return;
      this.lastFault[type] = t;
      this.faults.push({ type, sev, msg, t });
      return true;
    }

    skip() { if (this.step) { this.idx++; this.stepT = 0; } }

    // returns autopilot command (demo) or null
    update(dt, st) {
      if (!this.active || this.finished) return null;
      this.time += dt;
      if (!this.paused) this.stepT += dt;   // paused while the demo waits for the voice
      st.stepT = this.stepT;
      // record
      this.sampleT += dt;
      if (this.sampleT >= 0.1) {
        this.sampleT = 0;
        this.rec.samples.push({ t: this.time, x: st.x, z: st.z, cx: st.cx, cz: st.cz, th: st.th, v: st.stopped ? 0 : st.v, sf: st.sf, g: st.gear, ind: st.ind });
      }
      // observation rules
      if (this.mode !== 'demo') {
        if (st.justMoved) {
          if (!st.obs.allRound(12)) this.fault('obs-move', 'minor', st.v < 0 ? 'Started reversing without full all-round observation' : 'Moved off without full all-round observation');
        }
        if (st.v < -0.1) {
          if (st.obs.lookingBack()) this.noLook = 0; else this.noLook += dt;
          this.maxNoLook = Math.max(this.maxNoLook, this.noLook);
          if (this.noLook > 3.5 && !this.revFlag) { this.revFlag = true; this.fault('obs-rev', 'minor', 'Reversed for a while without looking behind (rear window, shoulders or mirrors)'); }
          if (this.noLook > 8) this.fault('obs-rev-serious', 'serious', 'Reversed without looking where you were going');
        } else if (st.stopped) { this.revFlag = false; this.noLook = 0; }
      }

      let ap = null;
      const step = this.step;
      if (step) {
        if (this.entered !== this.idx) { this.entered = this.idx; this.stepT = 0; st.stepT = 0; if (step.onEnter) step.onEnter(st); }
        if (this.mode === 'demo') {
          ap = { v: 0, steer: st.steer, hold: false, gear: null, hb: null, look: step.look || 'front', clutch: null, ind: null, dip: false };
          step.auto(st, ap);
        }
        if (step.done(st)) {
          this.idx++; this.stepT = 0;
          this.onStepDone && this.onStepDone();
          if (!this.step) this.finish(st, true);
        }
      }
      // finish detection for free/test modes, and as a fallback in guided
      if (!this.finished && this.mode !== 'demo' && st.stopped && st.hb && st.stillTime > 0.8 && st.gear === 'N' && this.ctx.finishNear(st)) {
        if (this.mode !== 'guided' || this.ctx.evaluate(st).ok) this.finish(st, true);
      }
      return ap;
    }

    finish(st, auto) {
      if (this.finished) return;
      this.finished = true;
      const fin = this.ctx.evaluate(st);
      const items = this.mode === 'demo' ? [] : this.ctx.analyze(this.rec, fin);
      const serious = this.faults.filter(f => f.sev === 'serious');
      const minor = this.faults.filter(f => f.sev === 'minor');
      if (!fin.ok) serious.push({ sev: 'serious', msg: 'Final position: ' + (fin.issues.join(', ') || 'not parked correctly') });
      const pass = serious.length === 0 && minor.length <= 3;
      this.result = { mode: this.mode, fin, items, serious, minor, pass, time: this.time };
      this.onFinish && this.onFinish(this.result);
    }
  }
  P.Coach = Coach;
})(window.PS);
