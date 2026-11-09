// Phone controller: tilt the phone like a steering wheel; on-screen gas / brake / reverse.
// Connects to the game peer-to-peer (WebRTC via PeerJS). After the handshake, data goes directly over Wi-Fi/internet.
(function () {
  const $ = (id) => document.getElementById(id);
  const ID_PREFIX = 'parking-coach-uk-';
  const FULL_LOCK_DEG = 75;   // rotate the phone this far for full lock
  const DEADZONE_DEG = 3;

  let peer = null, conn = null, code = '';
  let neutral = null, lastUp = null, steer = 0, steerDeg = 0, gotMotion = false;
  let mode = 'easy', gear = 'N';
  let wakeLock = null;

  // ---------------------------------------------------------------- start screen
  const fromHash = (location.hash || '').replace('#', '').toUpperCase();
  if (fromHash) $('code').value = fromHash;
  $('go').onclick = start;

  async function start() {
    code = $('code').value.trim().toUpperCase();
    if (code.length < 4) { $('err').textContent = 'Type the code shown in the game.'; return; }
    $('err').textContent = '';
    // motion permission (needed on iPhone; Android just works)
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== 'granted') { $('err').textContent = 'Motion access was refused, so steering will use the ◀ ▶ buttons.'; }
      }
    } catch (e) { /* ignore */ }
    // full screen + landscape + keep the screen on (best effort, never blocks connecting)
    try {
      const fs = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (fs && fs.then) fs.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => {});
    } catch (e) { /* not supported */ }
    keepAwake();
    $('start').classList.add('hidden');
    $('drive').classList.remove('hidden');
    document.body.classList.add('driving');
    window.addEventListener('devicemotion', onMotion);
    setTimeout(() => { if (!gotMotion) { $('steerpads').classList.remove('hidden'); $('note').textContent = 'No tilt sensor found: steer with ◀ ▶'; } }, 2500);
    connect();
  }

  function keepAwake() {
    try { navigator.wakeLock.request('screen').then((l) => { wakeLock = l; }).catch(() => {}); } catch (e) { /* not supported */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.body.classList.contains('driving')) keepAwake(); });

  // ---------------------------------------------------------------- connection
  function setStatus(html) { $('status').innerHTML = html; }

  function connect() {
    if (!window.Peer) { setStatus('Could not load the connection library. Check the internet connection and reload.'); return; }
    setStatus('Connecting…');
    if (!peer || peer.destroyed) {
      peer = new Peer();
      peer.on('open', openConn);
      peer.on('error', (e) => {
        if (e.type === 'peer-unavailable') setStatus(`Game with code <b style="color:#ff5a5a">${code}</b> not found. Is the phone screen open in the game? <button class="small" onclick="location.reload()">Retry</button>`);
        else setStatus('Connection problem (' + e.type + '). Retrying…');
        setTimeout(() => { if (!conn || !conn.open) openConn(); }, 3000);
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
    } else openConn();
  }
  function openConn() {
    if (conn && conn.open) return;
    conn = peer.connect(ID_PREFIX + code, { reliable: true });
    conn.on('open', () => { setStatus('<b>● Connected</b>: drive!'); send({ hello: 1 }); });
    conn.on('data', onGameData);
    conn.on('close', () => { setStatus('Disconnected. Reconnecting…'); setTimeout(openConn, 1500); });
  }
  function send(m) { if (conn && conn.open) conn.send(m); }

  function onGameData(d) {
    if (d.vibrate && navigator.vibrate) navigator.vibrate(d.vibrate);
    if (d.hud) {
      gear = d.hud.gear; mode = d.hud.mode || mode;
      $('hud').textContent = `${d.hud.gear === '1' && mode !== 'manual' ? 'D' : d.hud.gear} · ${d.hud.mph} mph`;
      $('hb').classList.toggle('on', !!d.hud.hb);
      // Easy: hold REVERSE to go backwards. Automatic/Manual: tap it to switch between Drive and Reverse.
      $('reverse').innerHTML = mode === 'easy' ? 'REVERSE<small>hold</small>' : (gear === 'R' ? 'DRIVE<small>tap to select</small>' : 'REVERSE<small>tap to select</small>');
    }
  }

  // ---------------------------------------------------------------- steering from the tilt sensor
  // Uses the gravity direction in the plane of the screen, so it works however the phone is tilted towards you.
  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const len = Math.hypot(a.x, a.y);
    if (len < 2) return;                 // phone lying flat: no reliable wheel angle
    const up = { x: a.x / len, y: a.y / len };
    if (!gotMotion) { gotMotion = true; $('steerpads').classList.add('hidden'); $('note').textContent = ''; }
    lastUp = up;
    if (!neutral) neutral = up;          // the position when you start counts as "straight"
    // signed angle between neutral and now; turning the phone clockwise = steer right (positive)
    const cross = neutral.x * up.y - neutral.y * up.x, dot = neutral.x * up.x + neutral.y * up.y;
    let deg = Math.atan2(cross, dot) * 180 / Math.PI;
    steerDeg = steerDeg * 0.6 + deg * 0.4;
    const eff = Math.abs(steerDeg) < DEADZONE_DEG ? 0 : (Math.abs(steerDeg) - DEADZONE_DEG) * Math.sign(steerDeg);
    steer = Math.max(-1, Math.min(1, eff / (FULL_LOCK_DEG - DEADZONE_DEG)));
    $('wheel').style.transform = `rotate(${steerDeg.toFixed(1)}deg)`;
  }
  $('centre').onclick = () => { if (lastUp) neutral = lastUp; steerDeg = 0; steer = 0; navigator.vibrate && navigator.vibrate(30); };

  // send the wheel position ~30 times a second
  setInterval(() => { if (gotMotion) send({ s: +steer.toFixed(3) }); }, 33);

  // ---------------------------------------------------------------- buttons
  // hold buttons (gas, brake, reverse, steer pads) send key down/up; small buttons send a single tap
  document.querySelectorAll('.pad[data-code]').forEach((el) => {
    const code = el.dataset.code;
    const down = (e) => {
      e.preventDefault();
      if (el.id === 'reverse' && mode !== 'easy') { send({ tap: gear === 'R' ? 'Digit1' : 'KeyR' }); el.classList.add('on'); navigator.vibrate && navigator.vibrate(15); return; }
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      el.classList.add('on'); send({ down: code }); navigator.vibrate && navigator.vibrate(10);
    };
    const up = (e) => {
      if (!el.classList.contains('on')) return;
      el.classList.remove('on');
      if (el.id === 'reverse' && mode !== 'easy') return;
      send({ up: code });
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  });
  document.querySelectorAll('[data-tap]').forEach((el) => {
    el.addEventListener('click', () => { send({ tap: el.dataset.tap }); navigator.vibrate && navigator.vibrate(15); });
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
})();
