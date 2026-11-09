// Builds low-poly car meshes. Car-local: +z forward, +x LEFT, origin at centre on the ground.
(function (P) {
  const MAT = {};
  function mats() {
    if (MAT.black) return MAT;
    MAT.black = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.8 });
    MAT.tyre = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
    MAT.rim = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.6, roughness: 0.35 });
    MAT.glass = new THREE.MeshStandardMaterial({ color: 0x1d2a36, transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false });
    MAT.interior = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.9 });
    MAT.seat = new THREE.MeshStandardMaterial({ color: 0x34373d, roughness: 1 });
    MAT.head = new THREE.MeshStandardMaterial({ color: 0xf4f1e4, emissive: 0x666655, roughness: 0.3 });
    MAT.sticker = new THREE.MeshBasicMaterial({ color: 0xffd400 });
    return MAT;
  }

  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function quad(a, b, c, d, mat) {
    const g = new THREE.BufferGeometry();
    const v = new Float32Array([...a, ...b, ...c, ...a, ...c, ...d]);
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }
  function beam(p1, p2, t, mat) {
    const a = new THREE.Vector3(...p1), b = new THREE.Vector3(...p2);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(t, t, len), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.lookAt(b);
    m.castShadow = true;
    return m;
  }

  // opts: {color, player:bool}
  P.buildCar = function (spec, opts = {}) {
    const M = mats();
    const paint = new THREE.MeshStandardMaterial({ color: opts.color ?? spec.color, metalness: 0.35, roughness: 0.45 });
    const g = new THREE.Group();
    const { halfL: hl, halfW: hw, height: H, bonnetH: bh, bonnetEnd: be, belt, roofFront: rf } = spec;
    const sill = 0.30;
    const out = { group: g, wheels: [], paint };

    // lower body
    g.add(box(spec.width - 0.12, 0.10, spec.length - 0.5, M.black, 0, sill, 0));                       // floor
    for (const s of [1, -1]) g.add(box(0.06, belt - sill, spec.length - 0.55, paint, s * (hw - 0.03), (belt + sill) / 2, -0.02)); // doors/sides
    g.add(box(spec.width, bh - sill, hl - be, paint, 0, (bh + sill) / 2, (hl + be) / 2));             // bonnet block
    g.add(box(spec.width, belt - sill, 0.42, paint, 0, (belt + sill) / 2, -hl + 0.21));               // boot block
    g.add(box(spec.width + 0.02, 0.22, 0.12, M.black, 0, 0.36, hl - 0.04));                          // front bumper
    g.add(box(spec.width + 0.02, 0.22, 0.12, M.black, 0, 0.36, -hl + 0.04));                         // rear bumper
    g.add(box(spec.width + 0.04, 0.12, spec.length - 1.6, M.black, 0, 0.36, 0));                     // side skirts / arches
    // cabin
    const roofTop = H - 0.05, rr = -hl + 0.32;
    const roof = box(spec.width - 0.18, 0.06, rf - rr, paint, 0, H - 0.03, (rf + rr) / 2);
    g.add(roof);
    const ax = hw - 0.07, tx = hw - 0.12;
    for (const s of [1, -1]) {
      // pillars kept slim so the view out (especially backwards) is clear
      g.add(beam([s * ax, belt, be], [s * tx, roofTop, rf], 0.05, paint));                              // A pillar
      g.add(beam([s * ax, belt, spec.eye.z - 0.32], [s * tx, roofTop, spec.eye.z - 0.32], 0.05, paint));// B pillar
      g.add(beam([s * ax, belt, -hl + 0.1], [s * tx, roofTop, rr], 0.06, paint));                       // D pillar
    }
    // glass
    g.add(quad([ax, belt, be], [-ax, belt, be], [-tx, roofTop, rf], [tx, roofTop, rf], M.glass));        // windscreen
    g.add(quad([ax, belt, -hl + 0.1], [-ax, belt, -hl + 0.1], [-tx, roofTop, rr], [tx, roofTop, rr], M.glass)); // rear window
    for (const s of [1, -1]) {
      const x = s * (hw - 0.05);
      g.add(quad([x, belt, -hl + 0.1], [x, belt, be], [x, roofTop, rf], [x, roofTop, rr], M.glass));
    }

    // lights
    const brakeMat = new THREE.MeshStandardMaterial({ color: 0x7a0b0b, emissive: 0x330000 });
    const revMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0x000000 });
    const indMat = [0, 1].map(() => new THREE.MeshStandardMaterial({ color: 0xb36b00, emissive: 0x000000 }));
    for (const s of [1, -1]) {
      g.add(box(0.36, 0.10, 0.04, M.head, s * (hw - 0.25), bh - 0.12, hl + 0.005));
      g.add(box(0.34, 0.10, 0.04, brakeMat, s * (hw - 0.22), belt - 0.1, -hl - 0.005));
      g.add(box(0.10, 0.06, 0.04, revMat, s * (hw - 0.5), belt - 0.1, -hl - 0.005));
      const iMat = indMat[s === 1 ? 0 : 1];
      g.add(box(0.08, 0.06, 0.05, iMat, s * (hw - 0.06), bh - 0.12, hl - 0.02));
      g.add(box(0.08, 0.06, 0.05, iMat, s * (hw - 0.06), belt - 0.1, -hl + 0.02));
    }
    out.lights = { brakeMat, revMat, indLeft: indMat[0], indRight: indMat[1] };

    // wheels (pivot groups so front ones can steer)
    const tyreGeo = new THREE.CylinderGeometry(spec.wheelR, spec.wheelR, 0.22, 22);
    tyreGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(spec.wheelR * 0.62, spec.wheelR * 0.62, 0.23, 10);
    rimGeo.rotateZ(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(0.235, spec.wheelR * 1.15, 0.05);
    for (const [s, front] of [[1, true], [-1, true], [1, false], [-1, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * spec.track / 2, spec.wheelR, front ? spec.frontAxle : -spec.cOff);
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tyreGeo, M.tyre); t.castShadow = true;
      spin.add(t, new THREE.Mesh(rimGeo, M.rim));
      const sp = new THREE.Mesh(spokeGeo, M.black); spin.add(sp);
      const sp2 = sp.clone(); sp2.rotation.x = Math.PI / 2; spin.add(sp2);
      pivot.add(spin);
      g.add(pivot);
      out.wheels.push({ pivot, spin, front });
    }

    // door mirrors (housing + glass). Glass faces backwards (-z).
    out.mirrors = {};
    for (const [s, key] of [[1, 'left'], [-1, 'right']]) {
      // door mirrors are drawn larger than real life so they're readable on a screen
      const m = spec.mirror, mx = m.x + 0.06;
      g.add(box(0.36, 0.23, 0.11, paint, s * mx, m.y, m.z + 0.02));
      g.add(box(0.14, 0.05, 0.06, M.black, s * (mx - 0.2), m.y - 0.06, m.z + 0.02));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.20), new THREE.MeshBasicMaterial({ color: 0x8899aa }));
      glass.position.set(s * mx, m.y, m.z - 0.04);
      glass.rotation.y = Math.PI;
      g.add(glass);
      out.mirrors[key] = { glass, pos: new THREE.Vector3(s * mx, m.y, m.z - 0.05) };
    }

    if (opts.player) {
      // interior
      g.add(box(spec.width - 0.2, 0.14, 0.5, M.interior, 0, belt - 0.09, be - 0.28));                      // dashboard
      g.add(box(0.30, 0.05, 0.12, M.black, spec.eye.x, belt - 0.0, be - 0.52));                              // cluster hood (RHD)
      g.add(box(0.25, 0.4, 0.5, M.interior, 0, sill + 0.25, spec.eye.z + 0.35));                            // centre console
      for (const s of [1, -1]) {
        const sx = s * Math.abs(spec.eye.x);
        g.add(box(0.5, 0.12, 0.5, M.seat, sx, sill + 0.28, spec.eye.z - 0.05));
        // low seat backs and no headrests, so looking over the shoulder isn't blocked
        g.add(box(0.5, 0.45, 0.12, M.seat, sx, sill + 0.55, spec.eye.z - 0.32));
      }
      g.add(box(spec.width - 0.3, 0.32, 0.15, M.seat, 0, sill + 0.42, -spec.cOff + 0.15));                 // rear bench back
      // steering wheel on the RIGHT
      const swTilt = new THREE.Group();
      swTilt.position.set(spec.eye.x, spec.eye.y - 0.43, spec.eye.z + 0.6);
      swTilt.rotation.x = -0.5;
      const sw = new THREE.Group();
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.022, 10, 32), M.black);
      sw.add(rim);
      const spk = box(0.36, 0.035, 0.02, M.interior, 0, 0, 0); sw.add(spk);
      const spk2 = box(0.035, 0.18, 0.02, M.interior, 0, -0.09, 0); sw.add(spk2);
      const mark = box(0.035, 0.035, 0.03, new THREE.MeshBasicMaterial({ color: 0xff7a00 }), 0, 0.185, 0); sw.add(mark);
      swTilt.add(sw);
      g.add(swTilt);
      out.steeringWheel = sw;
      // interior mirror
      const im = { x: 0, y: H - 0.15, z: rf + 0.06 };
      g.add(box(0.37, 0.11, 0.03, M.black, im.x, im.y, im.z + 0.015));
      const iglass = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.092), new THREE.MeshBasicMaterial({ color: 0x8899aa }));
      iglass.position.set(im.x, im.y, im.z - 0.002);
      iglass.rotation.y = Math.PI;
      g.add(iglass);
      out.mirrors.interior = { glass: iglass, pos: new THREE.Vector3(im.x, im.y, im.z - 0.05) };
      // bonnet sticker (reference mark), positioned per level by the coach
      const sticker = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), M.sticker);
      sticker.rotation.x = -Math.PI / 2;
      sticker.position.set(0, bh + 0.003, hl - 0.06);
      sticker.visible = false;
      g.add(sticker);
      out.sticker = sticker;
    }
    return out;
  };

  // Translucent "ghost" car showing an ideal position
  P.buildGhost = function (spec) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x35e07a, transparent: true, opacity: 0.22, depthWrite: false });
    const edge = new THREE.LineBasicMaterial({ color: 0x35e07a, transparent: true, opacity: 0.8 });
    const b1 = new THREE.BoxGeometry(spec.width, spec.belt - 0.25, spec.length);
    const m1 = new THREE.Mesh(b1, mat); m1.position.y = (spec.belt + 0.25) / 2; g.add(m1);
    const l1 = new THREE.LineSegments(new THREE.EdgesGeometry(b1), edge); l1.position.copy(m1.position); g.add(l1);
    const b2 = new THREE.BoxGeometry(spec.width - 0.2, spec.height - spec.belt, spec.roofFront + spec.halfL - 0.3);
    const m2 = new THREE.Mesh(b2, mat); m2.position.set(0, (spec.height + spec.belt) / 2, (spec.roofFront - spec.halfL + 0.3) / 2); g.add(m2);
    g.visible = false;
    return g;
  };
})(window.PS);
