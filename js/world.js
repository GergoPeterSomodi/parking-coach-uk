// Scene building helpers + obstacle list for collisions.
(function (P) {
  P.COL = {
    asphalt: 0x45484c, asphalt2: 0x3d4044, pavement: 0x9a9893, kerb: 0xb9b6ad, grass: 0x5d7d46,
    line: 0xf2f2f2, yellow: 0xf2c200, hedge: 0x3f6331, wall: 0x8c7d6e, brick: 0x8a4b3a,
  };
  const CAR_COLOURS = [0xc9c9c9, 0x1f1f1f, 0xa31f1f, 0xffffff, 0x274b7a, 0x6b6f75, 0x355e3b, 0xd7c9a8, 0x7b1e3c, 0x3a3a3a];
  const PARKED_SPECS = [
    { length: 4.06, width: 1.74, height: 1.48, wheelbase: 2.49, frontOverhang: 0.85, track: 1.5, wheelR: 0.32, maxSteer: 0.6, turnsPerSide: 1.4, eye: { x: -0.37, y: 1.15, z: -0.2 }, mirror: { x: 0.97, y: 0.98, z: 0.7 }, bonnetH: 0.82, bonnetEnd: 0.9 },
    { length: 4.40, width: 1.80, height: 1.47, wheelbase: 2.65, frontOverhang: 0.9, track: 1.55, wheelR: 0.33, maxSteer: 0.6, turnsPerSide: 1.4, eye: { x: -0.37, y: 1.15, z: -0.25 }, mirror: { x: 1.0, y: 0.98, z: 0.75 }, bonnetH: 0.84, bonnetEnd: 0.95 },
    { length: 4.52, width: 1.85, height: 1.66, wheelbase: 2.68, frontOverhang: 0.92, track: 1.58, wheelR: 0.36, maxSteer: 0.6, turnsPerSide: 1.4, eye: { x: -0.38, y: 1.35, z: -0.3 }, mirror: { x: 1.03, y: 1.1, z: 0.8 }, bonnetH: 0.97, bonnetEnd: 1.02 },
    { length: 3.85, width: 1.70, height: 1.50, wheelbase: 2.45, frontOverhang: 0.75, track: 1.48, wheelR: 0.31, maxSteer: 0.6, turnsPerSide: 1.4, eye: { x: -0.36, y: 1.15, z: -0.2 }, mirror: { x: 0.95, y: 0.98, z: 0.65 }, bonnetH: 0.82, bonnetEnd: 0.85 },
  ].map(P.deriveSpec);

  class World {
    constructor(scene) {
      this.scene = scene;
      this.root = new THREE.Group();
      scene.add(this.root);
      this.obstacles = [];
      this.rand = mulberry(1);
      this.lineMat = new THREE.MeshStandardMaterial({ color: P.COL.line, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
      this.yellowMat = new THREE.MeshStandardMaterial({ color: P.COL.yellow, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    }
    clear(seed = 1) {
      this.scene.remove(this.root);
      this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      this.root = new THREE.Group();
      this.scene.add(this.root);
      this.obstacles = [];
      this.rand = mulberry(seed);
    }
    add(o) { this.root.add(o); return o; }

    ground(cx, cz, sx, sz, color, y = 0.002) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
      m.rotation.x = -Math.PI / 2; m.position.set(cx, y, cz); m.receiveShadow = true;
      return this.add(m);
    }
    line(x1, z1, x2, z2, width = 0.1, yellow = false) {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), yellow ? this.yellowMat : this.lineMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.atan2(x2 - x1, z2 - z1);
      m.position.set((x1 + x2) / 2, 0.012, (z1 + z2) / 2);
      m.receiveShadow = true;
      return this.add(m);
    }
    dashed(x1, z1, x2, z2, dash = 3, gap = 6, width = 0.12) {
      const len = Math.hypot(x2 - x1, z2 - z1), ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      for (let d = 0; d < len; d += dash + gap) {
        const e = Math.min(len, d + dash);
        this.line(x1 + ux * d, z1 + uz * d, x1 + ux * e, z1 + uz * e, width);
      }
    }
    // box obstacle; sx along local x, sz along local z
    box(cx, cz, sx, sz, h, ang, color, kind = 'wall', collide = true, y0 = 0) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
      m.position.set(cx, y0 + h / 2, cz); m.rotation.y = ang;
      m.castShadow = h > 0.3; m.receiveShadow = true;
      this.add(m);
      if (collide) this.obstacles.push({ cx, cz, hx: sx / 2, hz: sz / 2, ang, kind, h });
      return m;
    }
    parkedCar(cx, cz, ang, opts = {}) {
      const r = this.rand;
      const spec = opts.spec || PARKED_SPECS[Math.floor(r() * PARKED_SPECS.length)];
      const color = opts.color ?? CAR_COLOURS[Math.floor(r() * CAR_COLOURS.length)];
      const car = P.buildCar(spec, { color });
      car.group.position.set(cx, 0, cz); car.group.rotation.y = ang;
      this.add(car.group);
      const ob = { cx, cz, hx: spec.halfW, hz: spec.halfL, ang, kind: 'car', h: spec.height, spec };
      this.obstacles.push(ob);
      return ob;
    }
    tree(x, z, s = 1) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.6 * s, 6), new THREE.MeshStandardMaterial({ color: 0x5a4632 }));
      t.position.set(x, 0.8 * s, z); t.castShadow = true; this.add(t);
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3 * s, 0), new THREE.MeshStandardMaterial({ color: 0x3e6b34, flatShading: true }));
      c.position.set(x, 2.4 * s, z); c.castShadow = true; this.add(c);
      this.obstacles.push({ cx: x, cz: z, hx: 0.2, hz: 0.2, ang: 0, kind: 'wall', h: 3 });
    }
    lamp(x, z) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 6, 6), new THREE.MeshStandardMaterial({ color: 0x55595e }));
      p.position.set(x, 3, z); p.castShadow = true; this.add(p);
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.6), new THREE.MeshStandardMaterial({ color: 0x55595e }));
      hd.position.set(x, 6, z); this.add(hd);
      this.obstacles.push({ cx: x, cz: z, hx: 0.12, hz: 0.12, ang: 0, kind: 'wall', h: 6 });
    }
    // simple terraced houses along a line (x from x1 to x2) facing z direction
    terrace(x1, x2, z, depth, facing) {
      const colours = [0x8a4b3a, 0x9b5a45, 0x7d4636, 0xa0705a, 0xc9b79c];
      for (let x = x1; x < x2; x += 5.5) {
        const h = 6 + this.rand() * 1.5;
        const c = colours[Math.floor(this.rand() * colours.length)];
        const m = this.box(x + 2.75, z + facing * depth / 2, 5.4, depth, h, 0, c, 'wall');
        // roof
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, depth * 0.62, 2, 4, 1), new THREE.MeshStandardMaterial({ color: 0x3b3b40, flatShading: true }));
        roof.rotation.y = Math.PI / 4; roof.scale.set(1.0, 1, 0.75);
        roof.position.set(x + 2.75, h + 1, z + facing * depth / 2);
        this.add(roof);
        // door + windows on the street side
        const fz = z - facing * 0.0 + (facing > 0 ? -0.01 : 0.01);
        const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.1), new THREE.MeshStandardMaterial({ color: [0x203a5c, 0x6b1d1d, 0x1d4a2b, 0x222222][Math.floor(this.rand() * 4)] }));
        door.position.set(x + 1.2, 1.05, fz); door.rotation.y = facing > 0 ? Math.PI : 0; this.add(door);
        for (const [wx, wy] of [[3.6, 1.5], [1.4, 4.4], [3.6, 4.4]]) {
          const w = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.2), new THREE.MeshStandardMaterial({ color: 0x2b3640, roughness: 0.2 }));
          w.position.set(x + wx, wy, fz); w.rotation.y = facing > 0 ? Math.PI : 0; this.add(w);
        }
      }
    }
    // bay helper: returns list of bay objects
    bayRow({ x0, n, bw, zEntry, depth, side }) {
      const bays = [];
      for (let i = 0; i <= n; i++) this.line(x0 + i * bw, zEntry, x0 + i * bw, zEntry + side * depth, 0.1);
      this.line(x0, zEntry + side * depth, x0 + n * bw, zEntry + side * depth, 0.1);
      for (let i = 0; i < n; i++) {
        bays.push({ i, side, x: x0 + bw * (i + 0.5), z: zEntry + side * depth / 2, bw, depth, zEntry,
          lineA: x0 + i * bw, lineB: x0 + (i + 1) * bw });
      }
      return bays;
    }
    fillBay(bay, ang, jitter = 0.12) {
      const r = this.rand;
      const flip = r() < 0.5 ? 0 : Math.PI;
      return this.parkedCar(bay.x + (r() - 0.5) * jitter * 2, bay.z + (r() - 0.5) * jitter * 2, ang + flip + (r() - 0.5) * 0.05);
    }
  }
  P.World = World;
  P.PARKED_SPECS = PARKED_SPECS;

  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
})(window.PS);
