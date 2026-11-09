// Game side of the phone wheel: waits for a phone to connect (PeerJS / WebRTC), then turns its
// messages into steering and key presses. Only a fixed set of keys is accepted from the phone.
(function (P) {
  const ID_PREFIX = 'parking-coach-uk-';
  P.HOSTED_URL = 'https://gergopetersomodi.github.io/parking-coach-uk/';
  const ALLOWED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyH', 'KeyC', 'KeyZ', 'Digit1', 'KeyR', 'KeyN']);
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code }));

  class PhoneLink {
    constructor() { this.peer = null; this.conn = null; this.code = ''; this.steer = 0; this.lastMsg = 0; this.held = new Set(); this.state = 'off'; this.onChange = () => {}; }
    get connected() { return !!(this.conn && this.conn.open); }
    // the phone is steering if it has sent tilt data recently
    get steering() { return this.connected && this.hasTilt && performance.now() - this.lastMsg < 1000; }

    setState(s, msg) { this.state = s; this.msg = msg || ''; this.onChange(); }

    start() {
      if (this.peer && !this.peer.destroyed) return;
      if (!window.Peer) { this.setState('error', 'Could not load the connection library. Are you online?'); return; }
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no look-alikes (O/0, I/1)
      this.code = Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
      this.setState('starting');
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
        if (e.type === 'unavailable-id') { this.peer.destroy(); this.peer = null; this.start(); return; }
        this.setState('error', 'Connection problem: ' + e.type);
      });
    }

    onData(d) {
      if (!d || typeof d !== 'object') return;
      this.lastMsg = performance.now();
      if (typeof d.s === 'number' && isFinite(d.s)) { this.steer = Math.max(-1, Math.min(1, d.s)); this.hasTilt = true; }
      if (d.down && ALLOWED.has(d.down)) { this.held.add(d.down); key('keydown', d.down); }
      if (d.up && ALLOWED.has(d.up)) { this.held.delete(d.up); key('keyup', d.up); }
      if (d.tap && ALLOWED.has(d.tap)) { key('keydown', d.tap); key('keyup', d.tap); }
    }
    releaseAll() { for (const c of this.held) key('keyup', c); this.held.clear(); this.steer = 0; this.hasTilt = false; }
    send(m) { if (this.connected) { try { this.conn.send(m); } catch (e) { /* ignore */ } } }
    // the controller page must be on https for the tilt sensor, so a local copy points at the hosted one
    controllerUrl() {
      const base = location.protocol === 'https:' ? new URL('.', location.href).href : P.HOSTED_URL;
      return base + 'controller.html#' + this.code;
    }
  }
  P.phone = new PhoneLink();
})(window.PS);
