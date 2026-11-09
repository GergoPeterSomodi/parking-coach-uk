// Vehicle physics: kinematic bicycle model + simplified manual drivetrain (clutch, biting point, stalling).
(function (P) {
  const RATIO = { '1': 420, '2': 230, 'R': 440 };   // engine rpm per (m/s) of road speed
  const IDLE = 800, STALL_RPM = 420;
  P.BITE_START = 0.35;  // pedal "up" fraction where the clutch starts to bite
  P.BITE_FULL = 0.75;   // fully engaged
  P.clutchEngagement = (clutchDown) => {
    const n = P.clamp((1 - clutchDown - P.BITE_START) / (P.BITE_FULL - P.BITE_START), 0, 1);
    return n * n;
  };

  class Vehicle {
    constructor(spec) { this.spec = spec; this.events = []; this.reset(0, 0, 0); }

    reset(x, z, th) {
      this.x = x; this.z = z; this.th = th;  // rear-axle position + heading
      this.v = 0; this.steer = 0;
      this.rpm = IDLE; this.engineOn = true;
      this.gear = 'N'; this.clutch = 0; this.throttle = 0; this.brake = 0; this.handbrake = true;
      this.wheelSpin = 0;
      this.auto = null; // autopilot command object when demo mode drives
    }

    get cx() { return this.x + Math.sin(this.th) * this.spec.cOff; }
    get cz() { return this.z + Math.cos(this.th) * this.spec.cOff; }
    get dir() { return this.gear === 'R' ? -1 : 1; }
    get engagement() { return this.gear === 'N' ? 0 : P.clutchEngagement(this.clutch); }

    emit(type, msg) { this.events.push({ type, msg }); }

    setGear(g) {
      if (P.settings.auto && g === '2') g = '1';
      if (g === this.gear) return true;
      if (!P.settings.auto && g !== 'N' && this.engineOn && this.clutch < 0.85) {
        this.emit('grind', 'Press the clutch fully down before changing gear (Q or scroll down)');
        return false;
      }
      if (g === 'R' && this.v > 0.3) { this.emit('grind', 'Stop the car before selecting reverse'); return false; }
      if ((g === '1' || g === '2') && this.v < -0.3) { this.emit('grind', 'Stop the car before selecting a forward gear'); return false; }
      this.gear = g;
      this.emit('gear', g);
      return true;
    }

    startEngine() {
      if (this.engineOn) return;
      if (this.gear !== 'N' && this.clutch < 0.85) { this.emit('info', 'Press the clutch down (Q) to start the engine in gear'); return; }
      this.engineOn = true; this.rpm = IDLE; this.emit('start', 'Engine started');
    }

    stall() { this.engineOn = false; this.emit('stall', 'Stalled! Clutch down (Q), then press I to restart'); }

    // input: {gas, brake, left, right}
    update(dt, input) {
      const s = this.spec;
      if (this.auto) return this.updateAuto(dt);
      // pedals
      this.throttle = P.approach(this.throttle, input.gas ? 1 : 0, dt * 2.5);
      this.brake = P.approach(this.brake, input.brake ? 1 : 0, dt * 6);
      // steering (stays where you leave it at low speed; self-centres a little when going faster)
      const rate = s.maxSteer / 1.0;
      if (input.steerTarget != null) {
        // phone wheel: the wheels follow the phone's angle (a little faster than the keys)
        this.steer = P.approach(this.steer, input.steerTarget, rate * 1.6 * dt);
      } else {
        if (input.left) this.steer += rate * dt;
        if (input.right) this.steer -= rate * dt;
      }
      if (input.steerTarget == null && !input.left && !input.right && Math.abs(this.v) > 2) {
        this.steer = P.approach(this.steer, 0, 0.25 * (Math.abs(this.v) - 2) * dt);
      }
      this.steer = P.clamp(this.steer, -s.maxSteer, s.maxSteer);

      if (P.settings.auto) return this.updateAutomatic(dt);

      const N = 4, h = dt / N, m = s.mass, K = 6000;
      for (let i = 0; i < N; i++) {
        const e = this.engagement;
        const rg = RATIO[this.gear] || 420;
        const sw = this.v * this.dir;
        const se = this.rpm / rg;
        const F = e * K * (se - sw);
        let gov;
        if (this.engineOn) {
          const target = IDLE + this.throttle * 2700;
          gov = P.clamp(10 * (target - this.rpm), -1500, 1700 + this.throttle * 4500);
        } else gov = this.rpm > 0 ? -1500 : 0;
        const drag = e > 0 ? F * 480 / rg : 0;
        this.rpm = Math.max(0, this.rpm + (gov - drag) * h);
        if (this.engineOn && this.rpm < STALL_RPM) { this.stall(); }

        const Fd = F * this.dir;
        const hold = this.brake * 9000 + (this.handbrake ? 7000 : 0);
        if (Math.abs(this.v) < 0.03) {
          const base = 250 + hold;
          if (Math.abs(Fd) <= base) this.v = 0;
          else this.v += (Fd - Math.sign(Fd) * base) / m * h;
        } else {
          const resist = 250 + 1150 * Math.min(Math.abs(this.v), 0.75) + 0.45 * this.v * this.v + hold;
          const nv = this.v + (Fd - Math.sign(this.v) * resist) / m * h;
          this.v = (Math.sign(nv) !== Math.sign(this.v) && Math.abs(Fd) < resist) ? 0 : nv;
        }
        this.integrate(h);
      }
    }

    // Automatic gearbox: the car creeps slowly in Drive/Reverse, gas speeds up, brake stops. No stalling.
    updateAutomatic(dt) {
      this.engineOn = true;
      const dirG = this.gear === 'N' ? 0 : this.dir;
      const creep = 0.6, max = this.gear === 'R' ? 2.5 : 7;
      const target = dirG && !this.handbrake ? dirG * (creep + this.throttle * (max - creep)) : 0;
      if (this.brake > 0.05) this.v = P.approach(this.v, 0, (6 * this.brake + 0.5) * dt);
      else if (this.handbrake || !dirG) this.v = P.approach(this.v, 0, (this.handbrake ? 6 : 0.6) * dt);
      else {
        const speedingUp = Math.abs(target) > Math.abs(this.v) && (this.v === 0 || Math.sign(target) === Math.sign(this.v));
        this.v = P.approach(this.v, target, (speedingUp ? 0.7 + this.throttle * 1.8 : 1.5) * dt);
      }
      this.rpm = 750 + Math.abs(this.v) * 160 + this.throttle * 1200;
      const N = 4;
      for (let i = 0; i < N; i++) this.integrate(dt / N);
    }

    // Demo autopilot: drives kinematically towards commanded speed/steer
    updateAuto(dt) {
      const a = this.auto, s = this.spec;
      this.steer = P.approach(this.steer, P.clamp(a.steer, -s.maxSteer, s.maxSteer), s.maxSteer / 1.0 * dt);
      const tv = a.hold ? 0 : a.v;
      const acc = Math.abs(tv) < Math.abs(this.v) || Math.sign(tv) !== Math.sign(this.v) ? 2.0 : 0.8;
      this.v = P.approach(this.v, tv, acc * dt);
      this.rpm = this.engineOn ? IDLE + Math.abs(this.v) * 120 : 0;
      this.throttle = 0; this.brake = Math.abs(tv) < Math.abs(this.v) - 0.05 ? 0.5 : 0;
      this.integrate(dt);
    }

    integrate(h) {
      const s = this.spec;
      this.th = P.wrap(this.th + this.v / s.wheelbase * Math.tan(this.steer) * h);
      this.x += Math.sin(this.th) * this.v * h;
      this.z += Math.cos(this.th) * this.v * h;
      this.wheelSpin += this.v / s.wheelR * h;
    }

    // Body box and the (narrower) wheel box used for kerbs
    bodyBox() { const s = this.spec; return { cx: this.cx, cz: this.cz, hx: s.halfW, hz: s.halfL, ang: this.th }; }
    wheelBox() {
      const s = this.spec, mid = (s.frontAxle - s.cOff) / 2; // centre of wheelbase relative to car centre
      const c = P.toWorld(this.cx, this.cz, this.th, 0, mid);
      return { cx: c.x, cz: c.z, hx: s.track / 2 + 0.11, hz: s.wheelbase / 2 + s.wheelR * 0.8, ang: this.th };
    }
    snapshot() { return { x: this.x, z: this.z, th: this.th, wheelSpin: this.wheelSpin }; }
    restore(p) { this.x = p.x; this.z = p.z; this.th = p.th; this.wheelSpin = p.wheelSpin; }
  }
  P.Vehicle = Vehicle;
})(window.PS);
