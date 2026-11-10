// Game side of the phone wheel: waits for a phone to connect (PeerJS / WebRTC), then turns its
// messages into steering and key presses. Only a fixed set of keys is accepted from the phone.
(function (P) {
  const ID_PREFIX = 'parking-coach-uk-';
  P.HOSTED_URL = 'https://gergopetersomodi.github.io/parking-coach-uk/';
  const ALLOWED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyH', 'KeyC', 'KeyZ', 'Digit1', 'KeyR', 'KeyN']);
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code }));

  // the phone tries a direct link first and falls back to this public relay (see js/controller.js)
  const RELAY_BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];

  class PhoneLink {
    constructor() {
      this.peer = null; this.conn = null; this.code = ''; this.steer = 0; this.lastMsg = 0; this.held = new Set(); this.state = 'off'; this.onChange = () => {};
      this.relay = null; this.relayOk = false; this.lastRelayMsg = 0;
      // notice when the phone goes quiet on the relay
      setInterval(() => {
        if (this.state === 'connected' && !this.connected) { this.releaseAll(); this.setState('waiting'); }
      }, 1000);
    }
    get directOpen() { return !!(this.conn && this.conn.open); }
    get viaRelay() { return !this.directOpen && performance.now() - this.lastRelayMsg < 3000; }
    get connected() { return this.directOpen || this.viaRelay; }
    get route() { return this.directOpen ? 'direct link' : this.viaRelay ? 'relay' : ''; }

    startRelay(i = 0) {
      if (!window.mqtt || this.relay) return;
      const base = 'parkingcoachuk/v1/' + this.code;
      const r = mqtt.connect(RELAY_BROKERS[i % RELAY_BROKERS.length], { clientId: 'pcuk-game-' + Math.random().toString(36).slice(2, 10), clean: true, connectTimeout: 6000, reconnectPeriod: 3000 });
      this.relay = r;
      r.on('connect', () => { this.relayOk = true; r.subscribe(base + '/g'); });
      r.on('message', (t, buf) => {
        if (this.directOpen) return;          // direct link wins when both work
        let d; try { d = JSON.parse(buf.toString()); } catch (e) { return; }
        const was = this.connected;
        this.lastRelayMsg = performance.now();
        if (!was) this.setState('connected');
        this.onData(d);
      });
      r.on('close', () => { this.relayOk = false; });
      r.on('error', () => { this.relayOk = false; try { r.end(true); } catch (e) { /* ignore */ } this.relay = null; setTimeout(() => this.startRelay(i + 1), 2000); });
    }
    // the phone is steering if it has sent tilt data recently
    get steering() { return this.connected && this.hasTilt && performance.now() - this.lastMsg < 1000; }

    setState(s, msg) { this.state = s; this.msg = msg || ''; this.onChange(); }

    start() {
      if (this.peer && !this.peer.destroyed) return;
      if (!window.Peer && !window.mqtt) { this.setState('error', 'Could not load the connection library. Are you online?'); return; }
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no look-alikes (O/0, I/1)
      this.code = this.code || Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
      this.setState('starting');
      this.startRelay();
      if (!window.Peer) { this.setState('waiting'); return; }
      this.peer = new Peer(ID_PREFIX + this.code);
      this.peer.on('open', () => this.setState('waiting'));
      this.peer.on('connection', (c) => {
        if (this.conn) { try { this.conn.close(); } catch (e) { /* ignore */ } }
        this.conn = c;
        c.on('open', () => { this.setState('connected'); });
        c.on('data', (d) => this.onData(d));
        c.on('close', () => { if (this.conn === c) { this.releaseAll(); this.conn = null; this.setState('waiting'); } });
      });
      this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch (e) { /* ignore */ } });
      this.peer.on('error', (e) => {
        if (e.type === 'unavailable-id') { this.peer.destroy(); this.peer = null; this.code = ''; this.start(); return; }
        // the relay may still work, so only report this if nothing is connected
        if (!this.connected) this.setState('waiting');
      });
    }

    onData(d) {
      if (!d || typeof d !== 'object') return;
      this.lastMsg = performance.now();
      // answer a hello/ping straight away so the phone knows the game is there (even while the game is paused)
      if ((d.hello || d.ping) && this.hudFn) this.send({ hud: this.hudFn() });
      if (typeof d.s === 'number' && isFinite(d.s)) { this.steer = Math.max(-1, Math.min(1, d.s)); this.hasTilt = true; }
      if (d.down && ALLOWED.has(d.down)) { this.held.add(d.down); key('keydown', d.down); }
      if (d.up && ALLOWED.has(d.up)) { this.held.delete(d.up); key('keyup', d.up); }
      if (d.tap && ALLOWED.has(d.tap)) { key('keydown', d.tap); key('keyup', d.tap); }
    }
    releaseAll() { for (const c of this.held) key('keyup', c); this.held.clear(); this.steer = 0; this.hasTilt = false; }
    send(m) {
      try {
        if (this.directOpen) this.conn.send(m);
        else if (this.viaRelay && this.relayOk) this.relay.publish('parkingcoachuk/v1/' + this.code + '/p', JSON.stringify(m));
      } catch (e) { /* ignore */ }
    }
    // the controller page must be on https for the tilt sensor, so a local copy points at the hosted one
    controllerUrl() {
      const base = location.protocol === 'https:' ? new URL('.', location.href).href : P.HOSTED_URL;
      return base + 'controller.html#' + this.code;
    }
  }
  P.phone = new PhoneLink();
})(window.PS);
