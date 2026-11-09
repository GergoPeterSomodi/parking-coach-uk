// Parking Coach UK - shared config and maths helpers
// Coordinate system: metres. Ground is the X/Z plane, Y is up.
// A car with heading th faces f = (sin th, cos th). Its LEFT is (cos th, -sin th), RIGHT is (-cos th, sin th).
// Car-local space: +z = forward, +x = LEFT, y = up. Origin at the car's centre on the ground.
window.PS = window.PS || {};

(function (P) {
  P.CARS = {
    tcross: {
      id: 'tcross', name: 'VW T-Cross', blurb: 'Small SUV, 4.11 m long',
      length: 4.11, width: 1.78, height: 1.58, wheelbase: 2.55, frontOverhang: 0.83,
      track: 1.52, wheelR: 0.34, maxSteer: 0.64, turnsPerSide: 1.4, mass: 1300,
      eye: { x: -0.37, y: 1.30, z: -0.25 },     // right-hand drive: driver sits on the right (-x)
      mirror: { x: 1.00, y: 1.06, z: 0.72 },
      bonnetH: 0.90, bonnetEnd: 0.95, color: 0x2f5f9e,
    },
    tiguan: {
      id: 'tiguan', name: 'VW Tiguan', blurb: 'Mid-size SUV, 4.51 m long',
      length: 4.51, width: 1.84, height: 1.67, wheelbase: 2.68, frontOverhang: 0.92,
      track: 1.58, wheelR: 0.36, maxSteer: 0.61, turnsPerSide: 1.45, mass: 1600,
      eye: { x: -0.38, y: 1.38, z: -0.30 },
      mirror: { x: 1.03, y: 1.13, z: 0.80 },
      bonnetH: 0.97, bonnetEnd: 1.02, color: 0x8d969e,
    },
  };

  P.deriveSpec = function (c) {
    c.rearOverhang = c.length - c.wheelbase - c.frontOverhang;
    c.halfL = c.length / 2;
    c.halfW = c.width / 2;
    c.cOff = c.halfL - c.rearOverhang;            // rear axle -> centre distance
    c.frontAxle = c.wheelbase - c.cOff;           // centre -> front axle
    c.R = c.wheelbase / Math.tan(c.maxSteer);     // rear-axle turning radius at full lock
    c.steerRatio = (c.turnsPerSide * 2 * Math.PI) / c.maxSteer;
    c.roofFront = c.bonnetEnd - 0.72;
    c.belt = c.bonnetH + 0.08;
    // Body parts along the car, measured forward from the centre. Used to phrase reference points.
    c.parts = [
      { name: 'front bumper', z: c.halfL },
      { name: 'front wheel', z: c.frontAxle },
      { name: 'door mirror', z: c.mirror.z },
      { name: 'shoulder', z: c.eye.z - 0.1 },
      { name: 'rear door', z: (c.eye.z - c.cOff) / 2 - 0.1 },
      { name: 'rear wheel', z: -c.cOff },
      { name: 'rear bumper', z: -c.halfL },
    ];
    return c;
  };
  Object.values(P.CARS).forEach(P.deriveSpec);

  // ---------- maths ----------
  P.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  P.lerp = (a, b, t) => a + (b - a) * t;
  P.wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  P.deg = (r) => r * 180 / Math.PI;
  P.rad = (d) => d * Math.PI / 180;
  P.approach = (v, target, rate) => v < target ? Math.min(target, v + rate) : Math.max(target, v - rate);
  P.fwd = (th) => ({ x: Math.sin(th), z: Math.cos(th) });
  P.left = (th) => ({ x: Math.cos(th), z: -Math.sin(th) });
  P.right = (th) => ({ x: -Math.cos(th), z: Math.sin(th) });
  // local (lx = left, lz = forward) -> world, relative to a car centre pose
  P.toWorld = (cx, cz, th, lx, lz) => ({
    x: cx + Math.cos(th) * lx + Math.sin(th) * lz,
    z: cz - Math.sin(th) * lx + Math.cos(th) * lz,
  });
  P.toLocal = (cx, cz, th, wx, wz) => {
    const dx = wx - cx, dz = wz - cz;
    return { x: dx * Math.cos(th) - dz * Math.sin(th), z: dx * Math.sin(th) + dz * Math.cos(th) };
  };

  // Oriented boxes on the ground: {cx, cz, hx, hz, ang}. hx is half-size along local x, hz along local z.
  P.obbAxes = (b) => [{ x: Math.cos(b.ang), z: -Math.sin(b.ang) }, { x: Math.sin(b.ang), z: Math.cos(b.ang) }];
  P.obbOverlap = function (a, b) {
    const A = P.obbAxes(a), B = P.obbAxes(b);
    const dx = b.cx - a.cx, dz = b.cz - a.cz;
    const axes = [A[0], A[1], B[0], B[1]];
    for (const n of axes) {
      const ra = a.hx * Math.abs(A[0].x * n.x + A[0].z * n.z) + a.hz * Math.abs(A[1].x * n.x + A[1].z * n.z);
      const rb = b.hx * Math.abs(B[0].x * n.x + B[0].z * n.z) + b.hz * Math.abs(B[1].x * n.x + B[1].z * n.z);
      if (Math.abs(dx * n.x + dz * n.z) > ra + rb) return false;
    }
    return true;
  };
  P.obbCorners = function (b) {
    const [u, w] = P.obbAxes(b);
    const out = [];
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      out.push({ x: b.cx + u.x * b.hx * sx + w.x * b.hz * sz, z: b.cz + u.z * b.hx * sx + w.z * b.hz * sz });
    }
    return out;
  };
  // closest point on box to a point
  P.obbClosest = function (b, px, pz) {
    const [u, w] = P.obbAxes(b);
    const dx = px - b.cx, dz = pz - b.cz;
    const lu = P.clamp(dx * u.x + dz * u.z, -b.hx, b.hx);
    const lw = P.clamp(dx * w.x + dz * w.z, -b.hz, b.hz);
    return { x: b.cx + u.x * lu + w.x * lw, z: b.cz + u.z * lu + w.z * lw };
  };
  P.pointInObb = function (b, px, pz, margin = 0) {
    const [u, w] = P.obbAxes(b);
    const dx = px - b.cx, dz = pz - b.cz;
    return Math.abs(dx * u.x + dz * u.z) <= b.hx + margin && Math.abs(dx * w.x + dz * w.z) <= b.hz + margin;
  };
})(window.PS);
