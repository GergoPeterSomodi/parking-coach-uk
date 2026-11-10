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

  // Two routes to the game, tried at the same time:
  //  1. direct link (WebRTC via PeerJS): fastest, but some networks block it
  //  2. relay (a public MQTT message server): works on any network with internet, a little slower
  // Messages go over the direct link when it's open, otherwise over the relay. Never both.
  const RELAY_BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
  let relay = null, relayOk = false, lastFromGame = 0, lastVia = '';
  const directOpen = () => !!(conn && conn.open);

  function connect() {
    setStatus('Step 1 of 3: reaching the connection service…');
    startRelay();
    if (!window.Peer) return;
    if (!peer || peer.destroyed) {
      peer = new Peer();
      peer.on('open', () => { if (!directOpen()) setStatus(`Step 2 of 3: looking for the game (code ${code})…`); openConn(); });
      peer.on('error', (e) => {
        if (e.type === 'peer-unavailable' && !connectedAtAll()) setStatus(`Game with code <b style="color:#ff5a5a">${code}</b> not found. Is the 📱 screen open in the game? Retrying…`);
        setTimeout(() => { if (!directOpen()) openConn(); }, 3000);
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
    } else openConn();
    // if the direct link hasn't opened after a few seconds, say we're using the relay
    setTimeout(() => { if (!directOpen() && !connectedAtAll()) setStatus('Direct link is slow or blocked on this network: trying the relay…'); }, 7000);
  }
  function openConn() {
    if (directOpen() || !peer || !peer.open) return;
    conn = peer.connect(ID_PREFIX + code, { reliable: true });
    if (!connectedAtAll()) setStatus('Step 3 of 3: linking to the game…');
    conn.on('open', () => { send({ hello: 1 }); });
    conn.on('data', (d) => onGameData(d, 'direct'));
    conn.on('close', () => setTimeout(openConn, 1500));
  }

  function startRelay(i = 0) {
    if (!window.mqtt || relay) return;
    const base = 'parkingcoachuk/v1/' + code;
    relay = mqtt.connect(RELAY_BROKERS[i % RELAY_BROKERS.length], { clientId: 'pcuk-phone-' + Math.random().toString(36).slice(2, 10), clean: true, connectTimeout: 6000, reconnectPeriod: 3000 });
    relay.on('connect', () => { relayOk = true; relay.subscribe(base + '/p'); relay.publish(base + '/g', JSON.stringify({ hello: 1 })); });
    relay.on('message', (t, buf) => { try { onGameData(JSON.parse(buf.toString()), 'relay'); } catch (e) { /* ignore */ } });
    relay.on('close', () => { relayOk = false; });
    relay.on('error', () => { relayOk = false; try { relay.end(true); } catch (e) { /* ignore */ } relay = null; setTimeout(() => startRelay(i + 1), 2000); });
  }

  function send(m) {
    if (directOpen()) { conn.send(m); return; }
    if (relay && relayOk) relay.publish('parkingcoachuk/v1/' + code + '/g', JSON.stringify(m));
  }
  const connectedAtAll = () => performance.now() - lastFromGame < 3000;
  // for troubleshooting from the browser console
  window.pcDebug = () => ({ code, direct: directOpen(), relayHost: relay && relay.options && relay.options.hostname, relayOk, relayConnected: relay && relay.connected, sinceGame: Math.round(performance.now() - lastFromGame), lastVia });
  // keep-alive so the game knows we're here even when not steering
  // (the game answers every ping, even while it's paused on a menu)
  setInterval(() => { send({ ping: 1 }); }, 1000);
  setInterval(() => {
    if (!document.body.classList.contains('driving')) return;
    if (connectedAtAll()) setStatus(lastVia === 'direct' ? '<b>● Connected</b> (direct link): drive!' : '<b>● Connected</b> (via relay): drive!');
    else if (lastFromGame) setStatus('Lost contact with the game… reconnecting');
  }, 1000);

  function onGameData(d, via) {
    lastFromGame = performance.now(); lastVia = via;
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
  // (a bit less often over the relay, which is a shared public server)
  let lastSent = null, sendTick = 0;
  setInterval(() => {
    if (!gotMotion) return;
    sendTick++;
    const v = +steer.toFixed(3);
    if (!directOpen() && (sendTick % 2 || v === lastSent) && sendTick % 15) return;
    lastSent = v; send({ s: v });
  }, 33);

  // ---------------------------------------------------------------- buttons
  // hold buttons (gas, brake, reverse, steer pads) send key down/up; small buttons send a single tap
  document.querySelectorAll('.pad[data-code]').forEach((el) => {
    const code = el.dataset.code;
    const down = (e) => {
      e.preventDefault();
      if (el.id === 'reverse' && mode !== 'easy') { send({ tap: gear === 'R' ? 'Digit1' : 'KeyR' }); el.classList.add('on'); navigator.vibrate && navigator.vibrate(15); return; }
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* finger already lifted */ }
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
