// Main: renderer, cameras, mirrors, input, HUD, game loop.
(function (P) {
  const $ = (id) => document.getElementById(id);
  const S = P.sound;
  const VIEWS = ['driver', 'top', 'chase'];
  const VIEW_NAMES = { driver: "Driver's seat", top: 'Top-down', chase: 'Behind car' };
  const MODE_NAMES = { demo: 'Demo', guided: 'Guided', test: 'Test', free: 'Practice' };

  const G = {
    specId: localStorage.getItem('pc.car') || 'tcross',
    levelIdx: 0, mode: 'guided', view: 'driver', running: false,
    yaw: 0, pitch: -0.08, topRot: 0, topH: 22, chaseYaw: 0, chasePitch: 0.38,
    keys: {}, ind: 0, dip: false, guides: true, sensors: true, zoom: 0, zoomHold: false, zoomNow: 0,
    stillTime: 0, armed: true, sensorT: 0, toastT: 0, hudT: 0, indT: 0, indOn: false,
  };
  window.PSGame = G; // for debugging

  // ---------------------------------------------------------------- renderer & scene
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbcd6ea);
  scene.fog = new THREE.Fog(0xbcd6ea, 70, 260);
  scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x4d5a3c, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 1.35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 120 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: P.COL.grass, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.02; grass.receiveShadow = true;
  scene.add(grass);

  const world = new P.World(scene);
  const helpers = new THREE.Group(); scene.add(helpers);  // target outline, highlights
  const guideLines = makeGuideLines(); scene.add(guideLines.group);

  const driverCam = new THREE.PerspectiveCamera(72, 1, 0.05, 500);
  driverCam.rotation.order = 'YXZ';
  const topCam = new THREE.PerspectiveCamera(50, 1, 0.5, 500);
  const chaseCam = new THREE.PerspectiveCamera(60, 1, 0.1, 500);

  // mirror render targets
  const RT = {
    left: new THREE.WebGLRenderTarget(352, 214),
    right: new THREE.WebGLRenderTarget(352, 214),
    interior: new THREE.WebGLRenderTarget(560, 146),
  };
  for (const k in RT) { RT[k].texture.repeat.x = -1; RT[k].texture.offset.x = 1; }

  let spec, car, veh, ghost, mirrorCams, mirrorGuide, ctx, obs;
  const coach = new P.Coach();

  function buildPlayer() {
    spec = P.CARS[G.specId];
    if (car) scene.remove(car.group);
    if (ghost) scene.remove(ghost);
    car = P.buildCar(spec, { player: true });
    scene.add(car.group);
    car.group.add(driverCam);
    driverCam.position.set(spec.eye.x, spec.eye.y, spec.eye.z);
    mirrorCams = {};
    for (const k of ['left', 'right', 'interior']) {
      const m = car.mirrors[k];
      const cam = new THREE.PerspectiveCamera(k === 'interior' ? 17 : 25, k === 'interior' ? 3.8 : 1.64, 0.08, 300);
      cam.rotation.order = 'YXZ';
      cam.position.copy(m.pos);
      cam.layers.enable(1);
      car.group.add(cam);
      mirrorCams[k] = cam;
      m.glass.material = new THREE.MeshBasicMaterial({ map: RT[k].texture });
    }
    // mirror guide strip (visible only in mirrors: layer 1)
    mirrorGuide = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 9), new THREE.MeshBasicMaterial({ color: 0xffd400 }));
    mirrorGuide.rotation.x = -Math.PI / 2;
    mirrorGuide.layers.set(1);
    mirrorGuide.visible = false;
    car.group.add(mirrorGuide);
    ghost = P.buildGhost(spec);
    scene.add(ghost);
    veh = new P.Vehicle(spec);
    obs = new P.Obs(spec);
  }

  function aimMirrors() {
    mirrorCams.left.rotation.set(G.dip ? -0.36 : -0.09, -0.24, 0);
    mirrorCams.right.rotation.set(-0.09, 0.24, 0);
    mirrorCams.interior.rotation.set(-0.05, 0, 0);
  }

  // ---------------------------------------------------------------- level loading
  function loadLevel(idx, mode) {
    G.levelIdx = idx; G.mode = mode;
    const L = P.LEVELS[idx];
    if (!spec || spec.id !== G.specId) buildPlayer();
    world.clear(idx * 17 + 3);
    ctx = L.build(world, spec);
    veh.reset(ctx.start.x, ctx.start.z, ctx.start.th);
    obs.reset();
    G.yaw = 0; G.pitch = -0.08; G.ind = 0; G.dip = false; G.zoom = 0; G.zoomHold = false;
    $('pedals').classList.toggle('auto', P.settings.auto); G.stillTime = 0; G.armed = true; G.time = 0;
    G.topRot = ctx.start.th; G.chaseYaw = 0;
    G.guides = mode !== 'test';
    G.view = 'driver';
    // target outline + helper highlights
    clearGroup(helpers);
    const targets = ctx.targets || (ctx.target ? [ctx.target] : []);
    for (const T of targets) helpers.add(makeTargetOutline(T, !!ctx.targets));
    G.highlights = new THREE.Group(); helpers.add(G.highlights);
    G.lastStepIdx = -1;
    // sticker & mirror guide
    const showAids = mode === 'demo' || mode === 'guided';
    car.sticker.visible = !!(ctx.sticker && showAids);
    if (ctx.sticker) {
      const sd = ctx.sticker.side === 'left' ? 1 : -1;
      const kx = sd * (spec.halfW + ctx.sticker.dist);
      const u = kx - spec.eye.x, k = spec.eye.y - spec.bonnetH;
      car.sticker.position.x = spec.eye.x + u * k / spec.eye.y;
    }
    mirrorGuide.visible = !!(ctx.mirrorGuide && showAids);
    if (ctx.mirrorGuide) {
      const sd = ctx.mirrorGuide.side === 'left' ? 1 : -1;
      mirrorGuide.position.set(sd * (spec.halfW + ctx.mirrorGuide.dist), 0.03, -spec.halfL - 3.5);
    }
    coach.start(ctx, mode === 'free' ? 'test' : mode, spec);
    coach.onStepDone = () => { S.chime(); };
    coach.onFinish = (res) => setTimeout(() => showDebrief(res), 600);
    $('faults').innerHTML = '';
    G.faultCount = 0;
    $('top-level').textContent = L.name;
    $('top-mode').textContent = MODE_NAMES[mode];
    $('coach').classList.toggle('hidden', mode === 'test' || mode === 'free');
    hideOverlays();
    $('hud').classList.remove('hidden');
    G.running = true;
    aimMirrors();
    $('hint').innerHTML = mode === 'demo'
      ? 'Demo: the car drives itself · <b>C</b> change view · <b>Tab</b> menu'
      : (P.settings.auto
        ? '<b>↑</b> forward · <b>↓</b> reverse · <b>Space</b> brake · <b>←</b>/<b>→</b> steer · <b>H</b> handbrake · drag the mouse to look around · <b>F1</b> help'
        : 'Start: <b>Q</b> clutch down · <b>1</b> gear · <b>B</b> + scroll up to bite · <b>H</b> handbrake off · <b>Space</b> brake · drag the mouse to look around · <b>F1</b> help');
    toast(mode === 'demo' ? 'Watch: the camera looks where you should look' : (P.settings.auto ? 'Press ↑ to drive forwards, ↓ to reverse, Space to brake' : 'Clutch down (Q), 1st gear (1), find the bite, release the handbrake (H)'), 4);
  }

  function clearGroup(g) { while (g.children.length) { const c = g.children.pop(); c.traverse(o => o.geometry && o.geometry.dispose()); } }

  function makeTargetOutline(T, faint) {
    const g = new THREE.Group();
    const corners = P.obbCorners(T);
    const pts = [...corners, corners[0]].map(c => new THREE.Vector3(c.x, 0.03, c.z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x35e07a, transparent: true, opacity: faint ? 0.35 : 0.9 }));
    g.add(line);
    if (!faint) {
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(T.hx * 2, T.hz * 2), new THREE.MeshBasicMaterial({ color: 0x35e07a, transparent: true, opacity: 0.12, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2; fill.rotation.z = T.ang; fill.position.set(T.cx, 0.02, T.cz);
      g.add(fill);
    }
    return g;
  }

  function setHighlights(list) {
    clearGroup(G.highlights);
    if (!list) return;
    for (const h of list) {
      if (h.type === 'line') {
        const len = Math.hypot(h.x2 - h.x1, h.z2 - h.z1);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.26, len), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.9, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(h.x2 - h.x1, h.z2 - h.z1);
        m.position.set((h.x1 + h.x2) / 2, 0.025, (h.z1 + h.z2) / 2);
        m.userData.pulse = true;
        G.highlights.add(m);
      } else if (h.type === 'post') {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 8), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.9 }));
        m.position.set(h.x, 0.9, h.z); m.userData.pulse = true;
        const top = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), m.material); top.position.y = 0.95; m.add(top);
        G.highlights.add(m);
      }
    }
  }

  // predicted path guide lines
  function makeGuideLines() {
    const group = new THREE.Group();
    const mk = (c) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3)); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: c })); l.frustumCulled = false; group.add(l); return l; };
    return { group, a: mk(0xffa31a), b: mk(0xffa31a) };
  }
  function updateGuideLines() {
    const on = G.guides && G.running && veh.gear !== 'N';
    guideLines.group.visible = on;
    if (!on) return;
    const dir = veh.gear === 'R' ? -1 : 1;
    const col = dir < 0 ? 0xffa31a : 0x4ec9ff;
    guideLines.a.material.color.setHex(col); guideLines.b.material.color.setHex(col);
    let x = veh.x, z = veh.z, th = veh.th;
    const pa = guideLines.a.geometry.attributes.position, pb = guideLines.b.geometry.attributes.position;
    const lz = dir < 0 ? -spec.halfL : spec.halfL;
    for (let i = 0; i < 60; i++) {
      const c = { x: x + Math.sin(th) * spec.cOff, z: z + Math.cos(th) * spec.cOff };
      const A = P.toWorld(c.x, c.z, th, spec.halfW, lz), B = P.toWorld(c.x, c.z, th, -spec.halfW, lz);
      pa.setXYZ(i, A.x, 0.04, A.z); pb.setXYZ(i, B.x, 0.04, B.z);
      const ds = 0.12 * dir;
      th += ds / spec.wheelbase * Math.tan(veh.steer);
      x += Math.sin(th) * ds; z += Math.cos(th) * ds;
    }
    pa.needsUpdate = true; pb.needsUpdate = true;
  }

  // ---------------------------------------------------------------- input
  // Up/W = go forwards, Down/S = go backwards (selects reverse), Space = brake
  const keyMap = { KeyW: 'gas', ArrowUp: 'gas', KeyS: 'back', ArrowDown: 'back', Space: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
  window.addEventListener('keydown', (e) => {
    S.init();
    if (e.code === 'Tab') { e.preventDefault(); toggleMenu(); return; }
    if (!G.running) return;
    if (keyMap[e.code]) { G.keys[keyMap[e.code]] = true; e.preventDefault(); }
    if (e.repeat) return;
    const demo = coach.mode === 'demo';
    if (keyMap[e.code] && demo) toast('Demo: the car drives itself. Press Tab and choose Guided or Test to drive.', 3);
    // forward/back keys pick the gear for you
    const kind = keyMap[e.code];
    if (!demo && (kind === 'gas' || kind === 'back')) {
      const want = kind === 'back' ? 'R' : '1';
      const wrong = kind === 'back' ? veh.gear !== 'R' : (veh.gear === 'R' || veh.gear === 'N');
      if (wrong) {
        if (Math.abs(veh.v) > 0.3) toast('Stop first (brake: Space), then change direction', 2);
        else veh.setGear(want);
      }
      if (P.settings.auto && veh.handbrake) { veh.handbrake = false; toast('Handbrake released', 1.2); }
      const why = [];
      if (!veh.engineOn && !P.settings.auto) why.push('start the engine (I)');
      if (!P.settings.auto && veh.gear !== want) why.push('press the clutch down (Q) to change gear');
      if (veh.handbrake) why.push('release the handbrake (H)');
      if (why.length) toast('To move: ' + why.join(', then '), 3);
    }
    switch (e.code) {
      case 'KeyC': G.view = VIEWS[(VIEWS.indexOf(G.view) + 1) % VIEWS.length]; toast(VIEW_NAMES[G.view], 1); break;
      case 'KeyZ': G.yaw = 0; G.pitch = -0.08; G.chaseYaw = 0; break;
      case 'KeyM': G.dip = !G.dip; aimMirrors(); toast(G.dip ? 'Left mirror dipped (kerb view)' : 'Left mirror normal', 1.2); break;
      case 'KeyG': G.guides = !G.guides; toast('Guide lines ' + (G.guides ? 'on' : 'off'), 1); break;
      case 'KeyP': G.sensors = !G.sensors; toast('Parking sensors ' + (G.sensors ? 'on' : 'off'), 1); break;
      case 'F1': case 'Slash': e.preventDefault(); showHelp(); break;
      case 'Backspace': e.preventDefault(); loadLevel(G.levelIdx, G.mode); break;
      case 'Enter': coach.finish(buildState(0), false); break;
      case 'Minus': G.topH = Math.min(70, G.topH * 1.15); break;
      case 'Equal': G.topH = Math.max(7, G.topH / 1.15); break;
      case 'KeyK': if (coach.mode === 'guided') { coach.skip(); S.click(); } break;
      case 'KeyF': G.zoomHold = true; break;
    }
    if (demo) return;
    const manual = !P.settings.auto;
    switch (e.code) {
      case 'KeyQ': if (manual) veh.clutch = 1; break;
      case 'KeyE': if (manual) veh.clutch = 0; break;
      case 'KeyB': if (manual) veh.clutch = 1 - (P.BITE_START - 0.03); break;
      case 'Digit1': veh.setGear('1'); break;
      case 'Digit2': veh.setGear('2'); break;
      case 'KeyR': veh.setGear('R'); break;
      case 'KeyN': case 'Digit0': veh.gear = 'N'; veh.emit('gear', 'N'); break;
      case 'KeyH': veh.handbrake = !veh.handbrake; S.click(); toast(veh.handbrake ? 'Handbrake on' : 'Handbrake off', 1); break;
      case 'KeyI': veh.startEngine(); break;
      case 'Comma': G.ind = G.ind === -1 ? 0 : -1; break;
      case 'Period': G.ind = G.ind === 1 ? 0 : 1; break;
    }
  });
  window.addEventListener('keyup', (e) => { if (keyMap[e.code]) G.keys[keyMap[e.code]] = false; if (e.code === 'KeyF') G.zoomHold = false; });
  window.addEventListener('blur', () => { G.keys = {}; G.zoomHold = false; });
  window.addEventListener('wheel', (e) => {
    if (!G.running) return;
    e.preventDefault();
    let d = e.deltaY || e.deltaX;
    if (e.deltaMode === 1) d *= 33;
    const notches = Math.sign(d) * Math.min(3, Math.max(1, Math.abs(d) / 100));
    // manual: wheel = clutch pedal. automatic (or demo): wheel = zoom
    if (!P.settings.auto && coach.mode !== 'demo') {
      veh.clutch = P.clamp(veh.clutch + (e.shiftKey ? 0.008 : 0.025) * notches, 0, 1);
    } else if (G.view === 'top') {
      G.topH = P.clamp(G.topH * (1 + 0.12 * notches), 7, 70);
    } else {
      G.zoom = P.clamp(G.zoom - 0.12 * notches, 0, 1);
    }
  }, { passive: false });
  canvas.addEventListener('click', () => { S.init(); if (G.running && document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
  // hold the right mouse button to zoom in (e.g. on a mirror)
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // drag with the left button to look around (works even where pointer lock is blocked)
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) G.zoomHold = true;
    if (e.button === 0) { G.dragging = true; G.lastMouse = { x: e.clientX, y: e.clientY }; }
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 2) G.zoomHold = false; if (e.button === 0) G.dragging = false; });
  document.addEventListener('pointerlockerror', () => { toast('Drag with the mouse to look around', 2); });
  document.addEventListener('mousemove', (e) => {
    const locked = document.pointerLockElement === canvas;
    if (!locked && !G.dragging) return;
    // movementX/Y can be missing or zero in some embedded browsers, so fall back to position deltas
    let mx = e.movementX, my = e.movementY;
    if (!locked) {
      mx = e.clientX - G.lastMouse.x; my = e.clientY - G.lastMouse.y;
      G.lastMouse = { x: e.clientX, y: e.clientY };
    }
    e = { movementX: mx, movementY: my };
    const k = 0.0024 * (G.view === 'driver' ? driverCam.fov / 72 : 1) * (locked ? 1 : 1.6);  // slower look when zoomed in
    if (G.view === 'driver') {
      if (coach.mode === 'demo') return;
      G.yaw = P.clamp(G.yaw - e.movementX * k, -3.0, 3.0);
      G.pitch = P.clamp(G.pitch - e.movementY * k, -1.1, 0.8);
    } else if (G.view === 'top') {
      G.topRot -= e.movementX * k;
    } else {
      G.chaseYaw -= e.movementX * k;
      G.chasePitch = P.clamp(G.chasePitch + e.movementY * k, 0.05, 1.4);
    }
  });

  // ---------------------------------------------------------------- simulation step
  let prevMoving = false;
  function buildState(dt) {
    const st = {
      veh, spec, x: veh.x, z: veh.z, cx: veh.cx, cz: veh.cz, th: veh.th, v: veh.v, steer: veh.steer,
      sf: veh.steer / spec.maxSteer, gear: veh.gear, hb: veh.handbrake, clutch: veh.clutch,
      stopped: Math.abs(veh.v) < 0.03, stillTime: G.stillTime, obs, ind: G.ind, t: G.time, justMoved: false,
    };
    return st;
  }

  function collide(prev) {
    const body = veh.bodyBox(), wheels = veh.wheelBox();
    for (const o of world.obstacles) {
      const hit = o.kind === 'kerb' ? P.obbOverlap(wheels, o) : P.obbOverlap(body, o);
      if (hit) {
        const impact = Math.abs(veh.v);
        veh.restore(prev); veh.v = 0;
        if (o.kind === 'kerb') {
          S.kerb();
          if (coach.fault('kerb', 'minor', 'Touched the kerb')) toast('Kerb!', 0.8);
        } else {
          S.bump();
          if (coach.fault('hit-' + o.kind, 'serious', o.kind === 'car' ? 'Hit a parked car' : 'Hit an obstacle')) toast('Bump!', 0.8);
        }
        return impact;
      }
    }
    return 0;
  }

  function sensorDistances() {
    let rear = Infinity, front = Infinity;
    const pts = [-0.75, 0, 0.75];
    for (const end of [-1, 1]) {
      for (const f of pts) {
        const p = P.toWorld(veh.cx, veh.cz, veh.th, f * spec.halfW, end * spec.halfL);
        const dirv = { x: Math.sin(veh.th) * end, z: Math.cos(veh.th) * end };
        for (const o of world.obstacles) {
          if (o.h < 0.3) continue;
          const q = P.obbClosest(o, p.x, p.z);
          const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
          if (d > 2.5) continue;
          if (d > 0.05 && (dx * dirv.x + dz * dirv.z) < 0.45 * d) continue;
          if (end < 0) rear = Math.min(rear, d); else front = Math.min(front, d);
        }
      }
    }
    return { rear, front };
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (G.running) step(dt);
    render();
  }

  function step(dt) {
    G.time += dt;
    const prev = veh.snapshot();
    const demo = coach.mode === 'demo';
    // observations use the driver's head direction
    obs.update(dt, G.yaw, G.pitch, G.time);
    const st = buildState(dt);
    // stationary tracking
    if (st.stopped) { G.stillTime += dt; if (G.stillTime > 1.0) G.armed = true; } else G.stillTime = 0;
    st.stillTime = G.stillTime;
    if (G.armed && Math.abs(veh.v) > 0.1) { st.justMoved = true; G.armed = false; }

    const ap = coach.update(dt, st);
    if (demo && ap) applyAutopilot(ap, dt);
    else veh.auto = null;

    // Up = gas while going forwards, Down = gas while in reverse
    const gas = (G.keys.gas && veh.gear !== 'R') || (G.keys.back && veh.gear === 'R');
    const input = demo ? {} : { gas, brake: G.keys.brake, left: G.keys.left, right: G.keys.right };
    veh.update(dt, input);
    collide(prev);

    // vehicle events
    for (const ev of veh.events) {
      if (ev.type === 'grind') { S.grind(); toast(ev.msg, 2); }
      else if (ev.type === 'stall') { S.stall(); toast(ev.msg, 2.5); coach.fault('stall', 'minor', 'Stalled the engine'); }
      else if (ev.type === 'gear') S.click();
      else if (ev.type === 'info' || ev.type === 'start') toast(ev.msg, 1.5);
    }
    veh.events.length = 0;

    // indicators
    G.indT += dt;
    if (G.ind !== 0 && G.indT > 0.38) { G.indT = 0; G.indOn = !G.indOn; S.tick(G.indOn); }
    if (G.ind === 0) G.indOn = false;

    // sensors
    G.sens = null;
    if (G.sensors && veh.gear !== 'N' && Math.abs(veh.v) < 4) {
      const d = sensorDistances();
      const useRear = veh.gear === 'R';
      const dist = useRear ? d.rear : d.front;
      G.sens = { rear: d.rear, front: d.front, active: useRear ? 'rear' : 'front' };
      if (dist < 1.5) {
        G.sensorT -= dt;
        const interval = dist < 0.3 ? 0.08 : 0.1 + (dist - 0.3) * 0.45;
        if (G.sensorT <= 0) { S.beep(!useRear); G.sensorT = interval; }
      }
    }

    // demo head movement
    if (demo && ap) {
      const look = P.resolveLook(ap.look || 'front', G.time);
      const target = obs.presets[look] || obs.presets.front;
      // turn the head through the front (a neck can't spin through the back)
      const k = Math.min(1, dt * 7);
      G.yaw += (target.yaw - G.yaw) * k; G.pitch += (target.pitch - G.pitch) * k;
    }

    // highlights + ghost per step
    const stp = coach.step;
    const showAids = coach.mode === 'demo' || coach.mode === 'guided';
    if (coach.idx !== G.lastStepIdx) {
      G.lastStepIdx = coach.idx;
      setHighlights(showAids && stp ? stp.highlights : null);
      if (showAids && stp && stp.ghost) {
        const c = { x: stp.ghost.x + Math.sin(stp.ghost.th) * spec.cOff, z: stp.ghost.z + Math.cos(stp.ghost.th) * spec.cOff };
        ghost.position.set(c.x, 0, c.z); ghost.rotation.y = stp.ghost.th; ghost.visible = true;
      } else ghost.visible = false;
    }
    const pulse = 0.55 + 0.45 * Math.sin(G.time * 6);
    G.highlights.children.forEach(m => { if (m.userData.pulse) m.material.opacity = pulse; });

    S.engine(veh.rpm, veh.engineOn, veh.throttle);
    updateCarVisual(dt);
    updateGuideLines();
    G.hudT += dt;
    if (G.hudT > 0.066) { updateHud(st, ap); G.hudT = 0; }
    if (G.toastT > 0) { G.toastT -= dt; if (G.toastT <= 0) $('toast').classList.remove('show'); }
  }

  function applyAutopilot(ap, dt) {
    veh.auto = { v: ap.v, steer: ap.steer, hold: false };
    if (ap.gear) veh.gear = ap.gear;
    if (ap.hb != null) veh.handbrake = ap.hb;
    if (ap.clutch != null) veh.clutch = P.approach(veh.clutch, ap.clutch, dt * 2);
    if (ap.ind != null) G.ind = ap.ind;
    if (ap.dip !== G.dip && ap.dip != null) { G.dip = !!ap.dip; aimMirrors(); }
  }

  function updateCarVisual() {
    car.group.position.set(veh.cx, 0, veh.cz);
    car.group.rotation.y = veh.th;
    for (const w of car.wheels) {
      if (w.front) w.pivot.rotation.y = veh.steer;
      w.spin.rotation.x = veh.wheelSpin;
    }
    car.steeringWheel.rotation.z = -veh.steer * spec.steerRatio;
    const braking = veh.brake > 0.1 || (veh.auto && veh.brake > 0);
    car.lights.brakeMat.emissive.setHex(braking ? 0xff1a1a : 0x330000);
    car.lights.revMat.emissive.setHex(veh.gear === 'R' ? 0xffffff : 0x000000);
    car.lights.indLeft.emissive.setHex(G.ind === -1 && G.indOn ? 0xffa000 : 0);
    car.lights.indRight.emissive.setHex(G.ind === 1 && G.indOn ? 0xffa000 : 0);
    driverCam.rotation.set(G.pitch, Math.PI + G.yaw, 0);
    sun.position.set(veh.cx + 14, 30, veh.cz + 9);
    sun.target.position.set(veh.cx, 0, veh.cz);
  }

  // ---------------------------------------------------------------- rendering
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    for (const c of [driverCam, topCam, chaseCam]) { c.aspect = w / h; c.updateProjectionMatrix(); }
  }
  window.addEventListener('resize', resize);
  resize();

  function render() {
    if (!car) { renderer.render(scene, topCam); return; }
    let cam = driverCam;
    G.zoomNow += ((G.zoomHold ? 1 : G.zoom) - G.zoomNow) * 0.2;
    const fov = 72 - 48 * G.zoomNow;
    if (Math.abs(driverCam.fov - fov) > 0.01) { driverCam.fov = fov; driverCam.updateProjectionMatrix(); }
    if (G.view === 'top') {
      cam = topCam;
      topCam.position.set(veh.cx, G.topH, veh.cz);
      topCam.up.set(Math.sin(G.topRot), 0, Math.cos(G.topRot));
      topCam.lookAt(veh.cx, 0, veh.cz);
    } else if (G.view === 'chase') {
      cam = chaseCam;
      const a = veh.th + G.chaseYaw, d = 9;
      chaseCam.position.set(veh.cx - Math.sin(a) * d * Math.cos(G.chasePitch), 1 + d * Math.sin(G.chasePitch), veh.cz - Math.cos(a) * d * Math.cos(G.chasePitch));
      chaseCam.lookAt(veh.cx, 0.9, veh.cz);
    }
    if (G.view !== 'top' && G.running) {
      // mirror passes: hide glass to avoid feedback
      const glasses = ['left', 'right', 'interior'].map(k => car.mirrors[k].glass);
      glasses.forEach(g => g.visible = false);
      guideLines.group.visible = false;
      for (const k of ['left', 'right', 'interior']) {
        renderer.setRenderTarget(RT[k]);
        renderer.render(scene, mirrorCams[k]);
      }
      renderer.setRenderTarget(null);
      glasses.forEach(g => g.visible = true);
      guideLines.group.visible = G.guides && veh.gear !== 'N';
    }
    renderer.render(scene, cam);
  }

  // ---------------------------------------------------------------- HUD
  function toast(msg, sec = 1.5) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); G.toastT = sec; }

  const _v = new THREE.Vector3();
  function updateHud(st, ap) {
    const mins = Math.floor(G.time / 60), secs = Math.floor(G.time % 60);
    $('top-time').textContent = `${mins}:${String(secs).padStart(2, '0')}`;
    $('top-view').textContent = VIEW_NAMES[G.view] + ' (C)';
    // dash
    $('d-speed').textContent = (Math.abs(veh.v) * 2.237).toFixed(Math.abs(veh.v) < 4.4 ? 1 : 0);
    $('d-gear').textContent = P.settings.auto && veh.gear === '1' ? 'D' : veh.gear;
    $('d-rpm').textContent = Math.round(veh.rpm);
    $('d-rpm-fill').style.width = `${P.clamp(veh.rpm / 4500, 0, 1) * 100}%`;
    $('d-hb').classList.toggle('off', !veh.handbrake);
    $('d-engine').classList.toggle('hidden', veh.engineOn);
    $('d-ind-l').classList.toggle('on', G.ind === -1 && G.indOn);
    $('d-ind-r').classList.toggle('on', G.ind === 1 && G.indOn);
    // pedals: bar height = pedal travel; top = released (up), bottom = pressed down
    const h = 110;
    const biteTop = (1 - P.BITE_FULL) * h, biteBottom = (1 - P.BITE_START) * h; // positions from top when pedal-up fraction = BITE_*
    const bite = $('p-bite');
    bite.style.top = `${biteTop}px`; bite.style.height = `${biteBottom - biteTop}px`;
    const cf = $('p-clutch-fill');
    cf.style.top = `${veh.clutch * (h - 6)}px`;
    const e = veh.engagement;
    const pedalUp = 1 - veh.clutch;
    cf.classList.toggle('biting', pedalUp > P.BITE_START && pedalUp < P.BITE_FULL);
    cf.classList.toggle('engaged', pedalUp >= P.BITE_FULL);
    $('p-clutch-label').textContent = P.settings.auto ? (G.zoomNow > 0.05 ? `Zoom ${Math.round(72 / driverCam.fov * 10) / 10}×` : '') : pedalUp <= P.BITE_START ? 'Clutch down' : pedalUp < P.BITE_FULL ? `Biting point ${Math.round(Math.sqrt(e) * 100)}%` : 'Clutch up';
    $('p-brake-fill').style.height = `${veh.brake * 100}%`;
    $('p-gas-fill').style.height = `${veh.throttle * 100}%`;
    const turns = veh.steer * spec.steerRatio / (2 * Math.PI);
    $('sw-icon').style.transform = `rotate(${-veh.steer * spec.steerRatio}rad)`;
    const at = Math.abs(turns);
    $('sw-text').textContent = at < 0.05 ? 'wheels straight' : `${fmtTurns(at)} turn${at > 1.05 ? 's' : ''} ${turns > 0 ? 'left' : 'right'}${Math.abs(st.sf) > 0.97 ? ' (FULL LOCK)' : ''}`;
    // obs chips
    document.querySelectorAll('#obs .chip').forEach(ch => {
      const z = ch.dataset.zone;
      ch.classList.toggle('on', obs.seenWithin(z, 10));
      ch.classList.toggle('now', obs.zone === z);
    });
    // sensors
    renderSensor($('s-front'), G.sens && G.sens.active === 'front' ? G.sens.front : null, 'front');
    renderSensor($('s-rear'), G.sens && G.sens.active === 'rear' ? G.sens.rear : null, 'rear');
    // faults
    if (coach.faults.length !== G.faultCount) {
      G.faultCount = coach.faults.length;
      const f = coach.faults[coach.faults.length - 1];
      const li = document.createElement('li'); li.className = f.sev; li.textContent = (f.sev === 'serious' ? '✖ ' : '• ') + f.msg;
      $('faults').prepend(li);
      setTimeout(() => li.remove(), 7000);
    }
    // coach panel
    const stp = coach.step;
    const ring = $('lookring');
    ring.style.display = 'none';
    if ((coach.mode === 'guided' || coach.mode === 'demo') && stp) {
      $('c-stepnum').textContent = `Step ${coach.idx + 1}/${coach.steps.length}`;
      $('c-title').textContent = stp.title;
      $('c-text').textContent = stp.text;
      $('c-ref').textContent = stp.ref ? (typeof stp.ref === 'function' ? stp.ref(st) : stp.ref) : '';
      const cl = stp.checklist ? stp.checklist(st) : [];
      $('c-check').innerHTML = cl.map(c => `<li class="${c.ok ? 'ok' : ''}">${c.label}</li>`).join('');
      const m = stp.meter ? stp.meter(st) : null;
      const meter = $('c-meter');
      meter.classList.toggle('hidden', !m);
      if (m) {
        const v = m.value;
        let frac, label, stopNow = false, close = false;
        if (m.unit === '°') {
          frac = P.clamp(v / m.max, 0, 1);
          stopNow = m.stopAt != null && v <= m.stopAt + 2;
          label = stopNow ? `${v.toFixed(0)}° · STRAIGHTEN NOW` : `${m.label}: ${v.toFixed(0)}°`;
        } else if (m.unit === '%') {
          frac = P.clamp(v / m.max, 0, 1); label = `${m.label}: ${(100 - v).toFixed(0)}%`;
        } else if (m.target != null) {
          frac = P.clamp(v / m.max, 0, 1); close = Math.abs(v - m.target) < 0.12;
          label = `${m.label}: ${(v * 100).toFixed(0)} cm${close ? ' ✔' : ''}`;
          $('c-meter-mark').style.display = 'block';
          $('c-meter-mark').style.left = `${(m.target / m.max) * 100}%`;
        } else {
          frac = P.clamp(v / m.max, 0, 1);
          stopNow = v < 0.25; close = v < 1;
          label = v < -0.25 ? `${(-v).toFixed(1)} m too far!` : stopNow ? 'STOP HERE' : `${m.label}: ${v.toFixed(1)} m`;
        }
        if (m.target == null) $('c-meter-mark').style.display = 'none';
        $('c-meter-fill').style.width = `${frac * 100}%`;
        meter.classList.toggle('stop', stopNow);
        meter.classList.toggle('close', !stopNow && close);
        $('c-meter-label').textContent = label;
      }
      $('c-info').textContent = stp.info ? stp.info(st) : '';
      $('c-warn').textContent = stp.warn ? (stp.warn(st) || '') : '';
      const look = P.resolveLook(stp.look || 'front', G.time);
      $('c-look').textContent = `👀 Look: ${P.ZONE_NAMES[stp.look] || P.ZONE_NAMES[look]}${stp.look && P.LOOK_SEQ[stp.look] ? ' → ' + P.ZONE_NAMES[look] : ''}`;
      // look ring in driver view
      if (G.view === 'driver') {
        const p = obs.presets[look];
        if (p && look !== 'front') {
          _v.set(Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), Math.cos(p.yaw) * Math.cos(p.pitch)).multiplyScalar(2);
          _v.add(driverCam.position);
          car.group.localToWorld(_v);
          _v.project(driverCam);
          if (_v.z < 1 && Math.abs(_v.x) < 0.95 && Math.abs(_v.y) < 0.95) {
            ring.style.display = 'block';
            ring.style.left = `${(_v.x + 1) / 2 * window.innerWidth}px`;
            ring.style.top = `${(1 - _v.y) / 2 * window.innerHeight}px`;
          }
        }
      }
    }
  }
  function fmtTurns(t) {
    const q = Math.round(t * 4) / 4;
    const whole = Math.floor(q), frac = q - whole;
    const f = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
    return (whole ? whole : (f ? '' : '0')) + f;
  }
  function renderSensor(el, d, which) {
    if (d == null || d === Infinity || d > 1.5) { el.innerHTML = ''; return; }
    const n = 6, lit = Math.ceil((1 - P.clamp(d / 1.5, 0, 1)) * n);
    let html = '';
    for (let i = 0; i < n; i++) html += `<span class="${i < lit ? (i < 2 ? 'g' : i < 4 ? 'y' : 'r') : ''}"></span>`;
    el.innerHTML = html + `<span class="t">${which} ${d < 0.3 ? 'STOP' : (d * 100).toFixed(0) + ' cm'}</span>`;
  }

  // ---------------------------------------------------------------- menus & debrief
  function hideOverlays() { ['menu', 'help', 'debrief'].forEach(id => $(id).classList.add('hidden')); }
  function toggleMenu() {
    if (!$('menu').classList.contains('hidden')) { if (ctx && !coach.finished) { hideOverlays(); G.running = true; } return; }
    G.running = false; G.keys = {};
    if (document.pointerLockElement) document.exitPointerLock();
    renderMenu();
    hideOverlays();
    $('menu').classList.remove('hidden');
  }
  function showHelp() {
    G.running = false; G.keys = {};
    if (document.pointerLockElement) document.exitPointerLock();
    G.helpFromGame = !$('hud').classList.contains('hidden') && $('menu').classList.contains('hidden');
    hideOverlays(); $('help').classList.remove('hidden');
  }
  $('btn-help').onclick = showHelp;
  $('btn-help-close').onclick = () => {
    hideOverlays();
    if (G.helpFromGame && ctx && !coach.finished) G.running = true; else { renderMenu(); $('menu').classList.remove('hidden'); }
  };
  $('btn-resume').onclick = () => { hideOverlays(); G.running = true; };

  function bestKey(levelId, mode) { return `pc.best.${G.specId}.${levelId}.${mode}`; }
  function renderMenu() {
    const cs = $('car-select');
    cs.innerHTML = '';
    for (const c of Object.values(P.CARS)) {
      const d = document.createElement('div');
      d.className = 'card' + (c.id === G.specId ? ' sel' : '');
      d.innerHTML = `<b>${c.name}</b><span>${c.blurb} · turning circle ≈ ${(2 * Math.hypot(c.R + c.halfW, c.wheelbase + c.frontOverhang)).toFixed(1)} m</span>`;
      d.onclick = () => { G.specId = c.id; localStorage.setItem('pc.car', c.id); renderMenu(); };
      cs.appendChild(d);
    }
    const gs = $('gear-select');
    gs.innerHTML = '';
    for (const [auto, name, blurb] of [[true, 'Automatic', 'Easier: the car creeps by itself, brake to stop. Mouse wheel zooms.'], [false, 'Manual', 'Clutch on the mouse wheel, biting point, stalling. Like most UK tests.']]) {
      const d = document.createElement('div');
      d.className = 'card' + (P.settings.auto === auto ? ' sel' : '');
      d.innerHTML = `<b>${name}</b><span>${blurb}</span>`;
      d.onclick = () => { P.settings.auto = auto; try { localStorage.setItem('pc.auto', auto ? '1' : '0'); } catch (e) { /* ignore */ } renderMenu(); };
      gs.appendChild(d);
    }
    const ll = $('level-list');
    ll.innerHTML = '';
    P.LEVELS.forEach((L, i) => {
      const row = document.createElement('div');
      row.className = 'lvl';
      const best = localStorage.getItem(bestKey(L.id, 'test'));
      row.innerHTML = `<div class="ico">${L.icon}</div><div class="info"><b>${L.name}</b><div>${L.desc}</div>${best ? `<span class="best">✔ Test passed (best ${best})</span>` : ''}</div><div class="btns"></div>`;
      const btns = row.querySelector('.btns');
      const modes = L.noGuide ? [['free', 'Drive']] : [['demo', 'Demo'], ['guided', 'Guided'], ['test', 'Test']];
      for (const [m, label] of modes) {
        const b = document.createElement('button');
        b.textContent = label; b.className = m === 'demo' ? 'demo' : m === 'test' ? 'test' : '';
        b.onclick = () => { S.init(); loadLevel(i, m); };
        btns.appendChild(b);
      }
      ll.appendChild(row);
    });
    $('btn-resume').classList.toggle('hidden', !(ctx && !coach.finished && !$('hud').classList.contains('hidden')));
  }

  function showDebrief(res) {
    G.running = false; G.keys = {};
    if (document.pointerLockElement) document.exitPointerLock();
    const L = P.LEVELS[G.levelIdx];
    const t = `${Math.floor(res.time / 60)}:${String(Math.floor(res.time % 60)).padStart(2, '0')}`;
    let badge;
    if (res.mode === 'demo') badge = '<span class="db-badge demo">Demo complete</span>';
    else badge = res.pass ? '<span class="db-badge pass">✔ Would pass</span>' : '<span class="db-badge fail">Needs more practice</span>';
    if (res.mode === 'test' && res.pass && G.mode === 'test') {
      const k = bestKey(L.id, 'test'), prev = localStorage.getItem(k);
      if (!prev || res.time < parseTime(prev)) localStorage.setItem(k, t);
    }
    let html = `<div class="db-head">${badge}<div><h2 style="margin:0">${L.name}</h2><div class="db-stats">${spec.name} · ${MODE_NAMES[G.mode]} · time ${t} · ${res.minor.length} minor, ${res.serious.length} serious</div></div></div>`;
    if (res.items.length) {
      html += '<h3>Your timing compared with the ideal</h3><ul class="db-items">';
      for (const it of res.items) html += `<li class="${it.verdict}"><div class="t">${it.verdict === 'good' ? '✔' : it.verdict === 'warn' ? '△' : '✖'} ${it.title}</div><div>${it.text}</div>${it.tip ? `<div class="tip">${it.tip}</div>` : ''}</li>`;
      html += '</ul>';
    }
    const all = [...res.serious, ...res.minor];
    if (res.mode !== 'demo') {
      html += '<h3>Faults (as an examiner would mark them)</h3>';
      html += all.length ? `<ul class="db-faults">${all.map(f => `<li><span class="sev ${f.sev}">${f.sev.toUpperCase()}</span>${f.msg}</li>`).join('')}</ul>` : '<p>No faults recorded. Nice!</p>';
    }
    const refs = ctx.refs || {};
    const refLines = [];
    if (refs.stop) refLines.push(`<b>Stop</b> when ${refs.stop}.`);
    if (refs.turn) refLines.push(`<b>Turn</b> when ${refs.turn}.`);
    if (refs.arc2) refLines.push(`<b>Second turn</b> when ${refs.arc2}.`);
    if (refs.final) refLines.push(`<b>Finish</b> when ${refs.final}.`);
    if (ctx.sticker) refLines.push('<b>Kerb distance</b>: about 30 cm away, the kerb seems to meet the bonnet where the yellow sticker is. In your real car, park 30 cm from a kerb and note where the kerb meets the bonnet from the driver\'s seat.');
    if (refLines.length) html += `<div class="refbox"><b>Reference points for the ${spec.name}</b><ul>${refLines.map(r => `<li>${r}</li>`).join('')}</ul><div style="color:var(--dim);font-size:12px">Reference points shift slightly with seat position. Check them in the real car with your instructor.</div></div>`;
    $('db-content').innerHTML = html;
    const next = { demo: 'guided', guided: 'test', test: 'guided', free: null }[G.mode];
    const nb = $('db-next');
    nb.classList.toggle('hidden', !next);
    if (next) { nb.textContent = next === 'guided' ? 'Try it guided' : 'Try the test'; nb.onclick = () => loadLevel(G.levelIdx, next); }
    hideOverlays();
    $('debrief').classList.remove('hidden');
  }
  function parseTime(s) { const [m, sec] = s.split(':').map(Number); return m * 60 + sec; }
  $('db-retry').onclick = () => loadLevel(G.levelIdx, G.mode);
  $('db-menu').onclick = () => { hideOverlays(); renderMenu(); $('menu').classList.remove('hidden'); };

  // ---------------------------------------------------------------- boot
  buildPlayer();
  aimMirrors();
  // background scene for the menu
  world.clear(3);
  ctx = null;
  const bg = P.LEVELS[0].build(world, spec);
  veh.reset(bg.start.x + 6, -0.4, Math.PI / 2);
  updateCarVisual();
  G.view = 'chase'; G.chaseYaw = 0.7; G.chasePitch = 0.3;
  renderMenu();
  requestAnimationFrame(frame);
  P.game = { G, loadLevel, coach, step, render, driverCam, renderer, get car() { return car; }, get veh() { return veh; }, get ctx() { return ctx; }, world };
})(window.PS);
