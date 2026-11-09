// The four DVSA manoeuvres + free practice. Each level builds its scene and returns a context with:
//   start pose, target, coaching steps (used by Demo + Guided), evaluate() and analyze() (used by the debrief).
// All reference points are computed from the selected car's real geometry, so they match the T-Cross / Tiguan.
(function (P) {
  const PI = Math.PI, D = P.deg;
  const C = P.COL;

  // ---------------------------------------------------------------- helpers
  function slowTo(remain, vmax = 0.7, a = 0.5) {
    if (remain <= 0.03) return 0;
    return Math.min(vmax, Math.max(0.15, Math.sqrt(2 * a * remain)));
  }
  // steering controller to follow a straight line through (px,pz) with heading thT
  function follow(st, px, pz, thT, dirSign) {
    const s = st.spec, max = s.maxSteer;
    const fx = Math.sin(st.th), fz = Math.cos(st.th);
    const rx = dirSign > 0 ? st.x + fx * s.wheelbase : st.x, rz = dirSign > 0 ? st.z + fz * s.wheelbase : st.z;
    const R = P.right(thT);
    const eR = (px - rx) * R.x + (pz - rz) * R.z;
    const thErr = P.wrap(st.th - thT);
    const thD = P.clamp((dirSign > 0 ? -0.35 : 0.35) * eR, -0.5, 0.5);
    return P.clamp((dirSign > 0 ? -2.2 : 2.2) * (thErr - thD), -max, max);
  }
  function centreOf(spec, pose) { return { x: pose.x + Math.sin(pose.th) * spec.cOff, z: pose.z + Math.cos(pose.th) * spec.cOff }; }
  // longitudinal position (forward of car centre) of a world point, for a rear-axle pose
  function longOf(spec, pose, wx, wz) { const c = centreOf(spec, pose); return P.toLocal(c.x, c.z, pose.th, wx, wz).z; }

  // Turn a longitudinal offset into words: "lines up with your left door mirror"
  function phrase(spec, lz, side, allowBumpers = true, plural = false) {
    let best = null;
    for (const p of spec.parts) {
      if (!allowBumpers && p.name.includes('bumper')) continue;
      const d = lz - p.z, score = Math.abs(d) + (p.name.includes('bumper') ? 0.25 : 0);
      if (!best || score < best.score) best = { p, d, score };
    }
    const nm = best.p.name.includes('bumper') ? best.p.name : `${side} ${best.p.name}`;
    const ad = Math.abs(best.d);
    const is = plural ? 'are' : 'is';
    if (ad < 0.2) return `${plural ? 'line' : 'lines'} up with your ${nm}`;
    if (ad < 0.6) return `${is} just ${best.d > 0 ? 'ahead of' : 'behind'} your ${nm}`;
    return `${is} about ${ad.toFixed(1)} m ${best.d > 0 ? 'ahead of' : 'behind'} your ${nm}`;
  }
  // choose which of several perpendicular lines makes the clearest reference at a pose
  function bestLineRef(spec, pose, lines, side) {
    let best = null;
    for (const ln of lines) {
      const lz = longOf(spec, pose, ln.x, ln.z);
      for (const p of spec.parts) {
        if (p.name.includes('bumper') || p.name === 'rear door' || p.name === 'rear wheel') continue;
        const w = p.name === 'door mirror' ? 0 : p.name === 'shoulder' ? 0.1 : 0.15;
        const sc = Math.abs(lz - p.z) + w;
        if (!best || sc < best.sc) best = { ln, lz, sc };
      }
    }
    return { line: best.ln, text: `${best.ln.label} ${phrase(spec, best.lz, side, false)}` };
  }
  const lineLabel = (k) => ['your bay\'s near line', 'your bay\'s far line', 'the first line after your bay', 'the second line after your bay', 'the third line after your bay'][k + 1] || `line ${k}`;

  function evalBay(st, T) {
    const box = st.veh.bodyBox();
    const corners = P.obbCorners(box);
    const inside = corners.every(c => P.pointInObb(T, c.x, c.z, 0.12));
    let angErr = 99;
    for (const a of T.angles) angErr = Math.min(angErr, Math.abs(D(P.wrap(st.th - a))));
    const loc = P.toLocal(T.cx, T.cz, T.ang, st.cx, st.cz);
    // gaps from car sides to the bay lines (side lines run along local z of the bay)
    const xs = corners.map(c => P.toLocal(T.cx, T.cz, T.ang, c.x, c.z).x);
    const gapPos = T.hx - Math.max(...xs), gapNeg = Math.min(...xs) + T.hx;
    const issues = [];
    if (!inside) issues.push('Not fully inside the lines');
    if (angErr > 6) issues.push(`Car is ${angErr.toFixed(0)}° crooked`);
    return { ok: inside && angErr <= 8, inside, angErr, lat: loc.x, lon: loc.z, gapPos, gapNeg, issues };
  }

  function item(title, verdict, text, tip) { return { title, verdict, text, tip }; }

  // ---------------------------------------------------------------- generic steps
  function moveOff(gear = '1') {
    const A = P.settings.auto;
    const gname = gear === 'R' ? 'reverse (R)' : A ? 'Drive (1)' : gear === '1' ? '1st gear (1)' : '2nd gear (2)';
    return {
      title: 'Move off (POM: prepare, observe, move)',
      text: A
        ? `Select ${gname}. Look all round: left blind spot, mirrors, right blind spot. Release the handbrake (Space) and let the car creep forward. Tap the brake (S) to keep it slow.`
        : `Clutch fully down (Q), select ${gname}. Look all round: left blind spot, mirrors, right blind spot. Bring the clutch up to the biting point (B, then scroll up gently until the revs dip), release the handbrake (Space) and creep forward.`,
      look: 'allRound',
      checklist: st => [
        { label: A ? `Select ${gname}` : `Clutch down & ${gname}`, ok: st.gear === gear },
        { label: 'All-round observation', ok: st.obs.allRound() },
        { label: 'Handbrake off (Space)', ok: !st.hb },
        { label: 'Creeping forward', ok: st.v > 0.15 },
      ],
      done: st => st.gear === gear && !st.hb && st.v > 0.15,
      auto: (st, ap) => {
        ap.gear = st.stepT > 0.5 ? gear : 'N'; ap.clutch = st.stepT < 3.8 ? 1 : 0.55;
        ap.look = st.stepT < 3.8 ? 'allRound' : 'front';
        ap.hb = st.stepT < 3.9; ap.v = st.stepT > 4.2 ? 0.7 : 0;
      },
    };
  }
  function prepReverse(extra = '') {
    return {
      title: 'Prepare to reverse',
      text: (P.settings.auto ? 'Stop. Select reverse (R).' : 'Stop. Clutch fully down (Q), select reverse (R).') + ' Do full all-round observation: left blind spot, over your left shoulder through the rear window, right blind spot and both mirrors. ' + extra,
      look: 'allRound',
      checklist: st => [
        { label: 'Stopped', ok: st.stopped },
        { label: 'Reverse gear (R)', ok: st.gear === 'R' },
        { label: 'All-round observation', ok: st.obs.allRound() },
      ],
      done: st => st.stopped && st.gear === 'R' && st.obs.allRound(),
      auto: (st, ap) => { ap.v = 0; ap.clutch = 1; ap.gear = st.stepT > 0.6 ? 'R' : st.gear; ap.look = st.stepT > 0.8 ? 'allRound' : 'front'; },
    };
  }
  function secure(last = true) {
    return {
      title: last ? 'Secure the car' : 'Stop and secure',
      text: 'Stop. Apply the handbrake (Space) and select neutral (N). Then you can relax your feet.',
      look: 'front',
      checklist: st => [
        { label: 'Stopped', ok: st.stopped },
        { label: 'Handbrake on', ok: st.hb },
        { label: 'Neutral (N)', ok: st.gear === 'N' },
      ],
      done: st => st.stopped && st.hb && st.gear === 'N',
      auto: (st, ap) => { ap.v = 0; ap.hb = st.stepT > 0.5; ap.gear = st.stepT > 0.9 ? 'N' : st.gear; ap.clutch = st.stepT > 0.9 ? 0 : 1; },
    };
  }

  // ---------------------------------------------------------------- car park
  function carPark(W, spec, occ) {
    const bw = 2.4, depth = 4.8, half = 3.1, n = 11, x0 = -n * bw / 2;
    W.ground(0, 0, n * bw + 34, 2 * (half + depth) + 3.2, C.asphalt);
    const right = W.bayRow({ x0, n, bw, zEntry: half, depth, side: 1 });
    const left = W.bayRow({ x0, n, bw, zEntry: -half, depth, side: -1 });
    for (const sd of [1, -1]) {
      W.box(0, sd * (half + depth + 0.15), n * bw + 34, 0.3, 0.13, 0, C.kerb, 'kerb');
      W.ground(0, sd * (half + depth + 2.3), n * bw + 34, 4, C.grass, 0.004);
      W.box(0, sd * (half + depth + 1.2), n * bw + 34, 0.9, 1.1, 0, C.hedge, 'wall');
      for (let x = x0 - 8; x < -x0 + 8; x += 7) W.tree(x + (W.rand() - 0.5) * 2, sd * (half + depth + 3.5 + W.rand() * 2), 0.9 + W.rand() * 0.4);
    }
    for (const x of [x0 - 3, -x0 + 3]) for (const sd of [1, -1]) W.lamp(x, sd * (half + depth - 0.5));
    // a shop at the far end
    W.box(-x0 + 22, 0, 12, 26, 6, 0, 0xd8d2c4, 'wall');
    W.box(-x0 + 15.9, 0, 0.2, 10, 3, 0, 0x2d4f73, 'wall', false);
    for (const b of right) if (occ(b)) W.fillBay(b, 0);
    for (const b of left) if (occ(b)) W.fillBay(b, 0);
    return { bw, depth, half, n, x0, right, left };
  }
  function bayTarget(b) { return { cx: b.x, cz: b.z, hx: b.bw / 2, hz: b.depth / 2, ang: 0 }; }

  // ================================================================ REVERSE BAY PARK
  const revbay = {
    id: 'revbay', name: 'Reverse bay park', icon: '🅿️',
    desc: 'Drive past the bay, then reverse into it. The most common test manoeuvre.',
    build(W, spec) {
      const ti = 5;
      const L = carPark(W, spec, b => b.side === 1 ? (b.i !== ti && b.i !== 8 && b.i !== 1) : W.rand() < 0.65);
      const B = L.right[ti];
      const T = Object.assign(bayTarget(B), { angles: [PI] });
      const zApp = L.half - 1.4 - spec.halfW;
      const xTurn = B.x + spec.R;          // rear axle x where full lock must be reached
      const xStop = xTurn + 0.3;           // stop a little later: lock is applied while creeping back
      const stopPose = { x: xStop, z: zApp, th: PI / 2 };
      const finalPose = { x: B.x, z: B.z + spec.cOff, th: PI };
      const lines = [];
      for (let k = -1; k <= 3; k++) { const idx = ti + 1 + k; if (idx <= L.n) lines.push({ x: L.x0 + idx * L.bw, z: L.half + 2.4, label: lineLabel(k) }); }
      const stopRef = bestLineRef(spec, stopPose, lines, 'right');
      const endLz = longOf(spec, finalPose, B.x, L.half);
      const finalRef = `the ends of the bay lines ${phrase(spec, endLz, 'side', true, true)}`;
      const err = st => D(P.wrap(PI - st.th));
      const hlRef = [{ type: 'line', x1: stopRef.line.x, z1: L.half, x2: stopRef.line.x, z2: L.half + L.depth }];

      const steps = [
        moveOff('1'),
        {
          title: 'Position the car',
          text: 'Creep slowly along the aisle about 1.5 m from the ends of the bays on your right. Look out of the right side window and count the lines past your bay (marked green).',
          ref: `STOP when ${stopRef.text}. (The yellow line shows it.)`,
          look: 'rightWindow', ghost: stopPose, highlights: hlRef,
          meter: st => ({ label: 'to stop point', value: xStop - st.x, max: 10, unit: 'm' }),
          warn: st => st.x > xStop + 0.6 ? 'You have gone past the stop point. Stop, and either reverse back a little or accept it and turn a bit later.' :
            (st.z > zApp + 0.7 ? 'You are very close to the bays. Keep about 1.5 m away to give the front room to swing.' : (st.z < zApp - 1.0 ? 'Move a little closer to the bays: about 1.5 m away is ideal.' : null)),
          done: st => st.stopped && st.stillTime > 0.3 && Math.abs(st.x - xStop) < 0.6,
          auto: (st, ap) => { ap.v = slowTo(xStop - st.x, 1.2); ap.steer = follow(st, 0, zApp, PI / 2, 1); ap.look = 'rightWindow'; ap.clutch = 0.55; },
        },
        prepReverse(),
        {
          title: 'Full right lock',
          text: (P.settings.auto ? 'Release the handbrake and let the car creep back VERY slowly (tap the brake S to slow it).' : 'Find the biting point and creep back VERY slowly.') + ' As soon as the car moves, turn the wheel quickly to FULL RIGHT LOCK (hold D, about 1½ turns). Keep looking around: through the rear window and both mirrors.',
          look: 'rear',
          meter: st => ({ label: 'steering to full right lock', value: Math.max(0, 1 + st.sf) * 100, max: 100, unit: '%' }),
          warn: st => (st.x < xTurn - 0.5 && st.sf > -0.6) ? 'Turn now! Full right lock (D).' : null,
          done: st => st.sf <= -0.9 && st.v < -0.02,
          auto: (st, ap) => { ap.hb = false; ap.v = -0.45; ap.steer = -spec.maxSteer; ap.look = 'rear'; ap.clutch = 0.6; },
        },
        {
          title: 'Swing into the bay',
          text: 'Keep full right lock and creep slowly. Keep checking all round (the front of the car swings out to the left). Glance at both door mirrors: the bay lines appear and slowly become parallel with the sides of the car.',
          ref: 'STRAIGHTEN the wheel (A, 1½ turns) when the bay lines look parallel with the car in BOTH door mirrors.',
          look: 'mirrors', ghost: finalPose,
          meter: st => ({ label: 'angle still to turn', value: err(st), max: 90, unit: '°', stopAt: 7 }),
          warn: st => (err(st) < 9 && st.sf < -0.5) ? 'STRAIGHTEN NOW: turn the wheel back to the left (A).' : (err(st) < -4 ? 'You have turned past straight. Steer left a little while reversing to correct.' : null),
          done: st => err(st) < 12 && Math.abs(st.sf) < 0.15,
          auto: (st, ap) => { ap.v = -0.45; ap.steer = err(st) > 5 ? -spec.maxSteer : 0; ap.look = 'mirrors'; ap.clutch = 0.6; },
        },
        {
          title: 'Reverse straight in',
          text: 'Wheels straight. Keep reversing slowly. Check both door mirrors: the gap to the line should look the same on each side. Small steering corrections are fine.',
          ref: `STOP when ${finalRef} (look down through the side windows).`,
          look: 'mirrors', ghost: finalPose,
          meter: st => ({ label: 'further to reverse', value: finalPose.z - st.z, max: 4, unit: 'm' }),
          info: st => { const e = evalBay(st, T); return `Gap to line: left ${e.gapNeg.toFixed(2)} m · right ${e.gapPos.toFixed(2)} m · angle ${e.angErr.toFixed(0)}°`; },
          warn: st => (finalPose.z - st.z) < -0.35 ? 'Too far back! Stop.' : null,
          done: st => st.stopped && st.stillTime > 0.2 && evalBay(st, T).inside,
          auto: (st, ap) => { const r = finalPose.z - st.z; ap.v = -slowTo(r, 0.5); ap.steer = follow(st, B.x, 0, PI, -1); ap.look = 'mirrors'; ap.clutch = 0.6; },
        },
        secure(true),
      ];

      return {
        start: { x: L.x0 - 9, z: -0.6, th: PI / 2 }, target: T, steps,
        refs: { stop: stopRef.text, final: finalRef },
        evaluate: st => evalBay(st, T),
        finishNear: st => Math.hypot(st.cx - T.cx, st.cz - T.cz) < 4,
        analyze(rec, fin) {
          const S = rec.samples, out = [];
          const i0 = S.findIndex(s => s.g === 'R' && s.v < -0.05);
          if (i0 < 0) return [item('Reversing', 'bad', 'No reversing was detected.', 'Select reverse (R) once the car has stopped.')];
          const d0 = S[i0].x - xStop;
          out.push(item('Where you stopped before reversing', Math.abs(d0) < 0.6 ? 'good' : 'warn',
            Math.abs(d0) < 0.6 ? 'Spot on.' : `${Math.abs(d0).toFixed(1)} m ${d0 > 0 ? 'past' : 'short of'} the ideal point.`,
            `Reference: stop when ${stopRef.text}.`));
          const iL = S.findIndex((s, k) => k >= i0 && s.g === 'R' && s.sf <= -0.8);
          if (iL >= 0) {
            const d = S[iL].x - xTurn;
            out.push(item('When you reached full lock', Math.abs(d) < 0.5 ? 'good' : 'warn',
              Math.abs(d) < 0.5 ? 'Good timing.' : (d < 0 ? `${(-d).toFixed(1)} m late. The car reversed too far straight back, so it swings in towards the near line (the side you came from).` : `${d.toFixed(1)} m early. The car swings in towards the far line and the car on that side.`),
              'Get the car creeping first, then turn quickly to full lock.'));
            const iU = S.findIndex((s, k) => k > iL && s.sf > -0.3);
            if (iU >= 0) {
              const e = D(P.wrap(PI - S[iU].th));
              out.push(item('When you straightened the wheel', e >= 1 && e <= 13 ? 'good' : 'warn',
                e > 13 ? `Too early: the car was still ${e.toFixed(0)}° from straight.` : (e < 1 ? `Too late: the car had turned ${(-e).toFixed(0)}° past straight.` : 'Good timing.'),
                'Straighten when the bay lines look parallel with the car in both door mirrors.'));
            }
          } else out.push(item('Full lock', 'warn', 'You never used full right lock.', 'Reverse bay parking needs full lock to get round in one go.'));
          return out.concat(finalItems(fin, 'bay'));
        },
      };
    },
  };

  function finalItems(fin, kind) {
    const out = [];
    if (!fin) return out;
    if (kind === 'bay') {
      out.push(item('Inside the bay lines', fin.inside ? 'good' : 'bad', fin.inside ? 'All four corners inside the lines.' : 'Part of the car is over the lines.', fin.inside ? '' : 'On the test, finishing over the lines is usually a fault.'));
      out.push(item('Straightness', fin.angErr <= 3 ? 'good' : fin.angErr <= 8 ? 'warn' : 'bad', `${fin.angErr.toFixed(1)}° off straight.`, fin.angErr > 3 ? 'Straighten a little earlier, and use small corrections while reversing in.' : ''));
      const c = Math.abs(fin.gapPos - fin.gapNeg) / 2;
      out.push(item('Centred in the bay', c <= 0.15 ? 'good' : c <= 0.3 ? 'warn' : 'bad', `Gaps: ${fin.gapPos.toFixed(2)} m and ${fin.gapNeg.toFixed(2)} m.`, c > 0.15 ? 'Compare the gap to the line in both mirrors while reversing in.' : ''));
    }
    return out;
  }

  // ================================================================ FORWARD BAY PARK
  const fwdbay = {
    id: 'fwdbay', name: 'Forward bay park', icon: '⬆️',
    desc: 'Drive forwards into a bay on your left, then reverse back out.',
    build(W, spec) {
      const ti = 6;
      const L = carPark(W, spec, b => b.side === -1 ? (b.i !== ti && b.i !== ti + 1 && b.i !== 2) : W.rand() < 0.6);
      const B = L.left[ti];
      const T = Object.assign(bayTarget(B), { angles: [PI] });
      const zApp = 0.9;
      const xLock = B.x - spec.R;            // rear axle x where full lock is reached
      const xStart = xLock - 0.15;           // start turning a little earlier (steering takes time)
      const startPose = { x: xStart, z: zApp, th: PI / 2 };
      const finalPose = { x: B.x, z: B.z + spec.cOff, th: PI };
      const lines = [];
      for (let k = -2; k <= 1; k++) { const idx = ti + 1 + k; if (idx >= 0) lines.push({ x: L.x0 + idx * L.bw, z: -L.half - 2.4, label: k === -2 ? 'the line before your bay' : lineLabel(k) }); }
      const turnRef = bestLineRef(spec, startPose, lines, 'left');
      const endLz = longOf(spec, finalPose, B.x, -L.half);
      const finalRef = `the ends of the bay lines ${phrase(spec, endLz, 'side', true, true)} (check in the door mirrors)`;
      const err = st => D(P.wrap(PI - st.th));
      const outZ = -L.half + 0.3;
      const state = { parked: null };
      const parkedSecure = secure(false);
      const baseDone = parkedSecure.done;
      parkedSecure.done = st => { const d = baseDone(st); if (d) state.parked = evalBay(st, T); return d; };

      const steps = [
        moveOff('1'),
        {
          title: 'Approach wide',
          text: 'Creep along on the RIGHT side of the aisle, about 2 m from the bays on your left, so the car has room to swing in. Keep it slow: ' + (P.settings.auto ? 'let it creep and use the brake.' : 'clutch at the biting point.'),
          ref: `Start turning FULL LEFT LOCK when ${turnRef.text}. (The yellow line shows it.)`,
          look: 'leftWindow', ghost: null, highlights: [{ type: 'line', x1: turnRef.line.x, z1: -L.half, x2: turnRef.line.x, z2: -L.half - L.depth }],
          meter: st => ({ label: 'to turning point', value: xStart - st.x, max: 10, unit: 'm' }),
          warn: st => st.z < zApp - 1.0 ? 'Keep further right in the aisle: you need room to swing in.' : null,
          done: st => st.x >= xStart - 0.1,
          auto: (st, ap) => { ap.v = 0.6; ap.steer = follow(st, 0, zApp, PI / 2, 1); ap.look = 'leftWindow'; ap.clutch = 0.55; },
        },
        {
          title: 'Full left lock NOW',
          text: 'Turn quickly to FULL LEFT LOCK (hold A) while creeping slowly. Look into the bay and check your left door mirror: the rear wheel cuts in towards the line.',
          look: 'leftWindow',
          meter: st => ({ label: 'steering to full left lock', value: Math.max(0, 1 - st.sf) * 100, max: 100, unit: '%' }),
          warn: st => (st.x > xLock + 0.4 && st.sf < 0.5) ? 'You are late. Full left lock now!' : null,
          done: st => st.sf >= 0.9,
          auto: (st, ap) => { ap.v = 0.5; ap.steer = spec.maxSteer; ap.look = 'leftWindow'; ap.clutch = 0.55; },
        },
        {
          title: 'Swing in',
          text: 'Keep full lock and creep. Look ahead into the bay and check the left mirror for the rear corner.',
          ref: 'STRAIGHTEN (D, 1½ turns) when the car points straight into the bay, with the lines either side looking parallel to the car.',
          look: 'front', ghost: finalPose,
          meter: st => ({ label: 'angle still to turn', value: err(st), max: 90, unit: '°', stopAt: 7 }),
          warn: st => (err(st) < 9 && st.sf > 0.5) ? 'STRAIGHTEN NOW (D).' : null,
          done: st => err(st) < 12 && Math.abs(st.sf) < 0.15,
          auto: (st, ap) => { ap.v = 0.5; ap.steer = err(st) > 5 ? spec.maxSteer : 0; ap.look = err(st) > 30 ? 'leftWindow' : 'front'; ap.clutch = 0.55; },
        },
        {
          title: 'Drive in',
          text: 'Wheels straight, creep in. Use small corrections to stay central.',
          ref: `STOP when ${finalRef}.`,
          look: 'mirrors', ghost: finalPose,
          meter: st => ({ label: 'further to go', value: st.z - finalPose.z, max: 4, unit: 'm' }),
          info: st => { const e = evalBay(st, T); return `Gap to line: right ${e.gapPos.toFixed(2)} m · left ${e.gapNeg.toFixed(2)} m · angle ${e.angErr.toFixed(0)}°`; },
          warn: st => (st.z - finalPose.z) < -0.35 ? 'Too far in! Stop.' : null,
          done: st => st.stopped && st.stillTime > 0.2 && evalBay(st, T).inside,
          auto: (st, ap) => { ap.v = slowTo(st.z - finalPose.z, 0.5); ap.steer = follow(st, B.x, 0, PI, 1); ap.look = 'mirrors'; ap.clutch = 0.55; },
        },
        parkedSecure,
        prepReverse('On the test you then drive out: reverse straight back out of the bay.'),
        {
          title: 'Reverse out',
          text: 'Release the handbrake and creep straight back. Keep looking all round, especially over both shoulders for traffic and pedestrians in the aisle. Once the front of your car is clear of the cars either side, stop in the aisle.',
          look: 'rear',
          meter: st => ({ label: 'until clear of the bay', value: Math.max(0, outZ - Math.min(...P.obbCorners(st.veh.bodyBox()).map(c => c.z))), max: 5, unit: 'm' }),
          done: st => st.stopped && Math.min(...P.obbCorners(st.veh.bodyBox()).map(c => c.z)) > outZ,
          auto: (st, ap) => { ap.hb = false; const r = outZ + 0.15 - Math.min(...P.obbCorners(st.veh.bodyBox()).map(c => c.z)); ap.v = -slowTo(r, 0.6); ap.steer = 0; ap.look = 'rear'; ap.clutch = 0.6; },
        },
        secure(true),
      ];
      return {
        start: { x: L.x0 - 9, z: -0.6, th: PI / 2 }, target: T, steps,
        refs: { turn: turnRef.text, final: finalRef },
        // once parked (and maybe reversed out again) the parked position is what gets scored
        evaluate: st => {
          const now = evalBay(st, T);
          if (state.parked && !now.inside && Math.hypot(st.cx - T.cx, st.cz - T.cz) > 1.5) return state.parked;
          return now;
        },
        finishNear: st => Math.hypot(st.cx - T.cx, st.cz - T.cz) < 4,
        analyze(rec, fin) {
          const S = rec.samples, out = [];
          const iL = S.findIndex(s => (s.g === '1' || s.g === '2') && s.v > 0 && s.sf >= 0.8 && s.x > L.x0);
          if (iL >= 0) {
            const d = S[iL].x - xLock;
            out.push(item('When you reached full lock', Math.abs(d) < 0.5 ? 'good' : 'warn',
              Math.abs(d) < 0.5 ? 'Good timing.' : (d > 0 ? `${d.toFixed(1)} m late. The car ends up towards the far line of the bay.` : `${(-d).toFixed(1)} m early. The rear wheel cuts in towards the near line and the car beside it.`),
              `Reference: start turning when ${turnRef.text}.`));
            const iU = S.findIndex((s, k) => k > iL && s.sf < 0.3);
            if (iU >= 0) {
              const e = D(P.wrap(PI - S[iU].th));
              out.push(item('When you straightened the wheel', e >= 1 && e <= 13 ? 'good' : 'warn',
                e > 13 ? `Too early: the car was still ${e.toFixed(0)}° from straight.` : (e < 1 ? `Too late: the car turned ${(-e).toFixed(0)}° past straight.` : 'Good timing.'),
                'Straighten as the car points straight into the bay.'));
            }
          } else out.push(item('Full lock', 'warn', 'You never used full left lock.', 'Use full lock to swing into the bay in one go.'));
          return out.concat(finalItems(fin, 'bay'));
        },
      };
    },
  };

  // ================================================================ ROAD (parallel + pull up on right)
  function road(W, opts = {}) {
    const hw = 4.5;
    W.ground(10, 0, 220, hw * 2, C.asphalt);
    W.dashed(-100, 0, 120, 0, 3, 6);
    for (const sd of [1, -1]) {
      W.box(10, sd * (hw + 1.5), 220, 3, 0.13, 0, C.pavement, 'kerb');
      W.terrace(-100, 120, sd * (hw + 3.2), 8, sd);
      for (let x = -90; x < 120; x += 24) W.lamp(x + (sd > 0 ? 12 : 0), sd * (hw + 0.5));
    }
    return { hw };
  }

  // ================================================================ PARALLEL PARK
  const parallel = {
    id: 'parallel', name: 'Parallel park', icon: '↔️',
    desc: 'Reverse into a gap behind a parked car at the left kerb.',
    build(W, spec) {
      const R = road(W);
      const kerbZ = -R.hw;
      const leadSpec = P.PARKED_SPECS[0], rearSpec = P.PARKED_SPECS[1];
      const G = spec.length + 2.4;                       // gap bumper to bumper
      const lead = W.parkedCar(G / 2 + leadSpec.halfL, kerbZ + 0.2 + leadSpec.halfW, PI / 2, { spec: leadSpec, color: 0xa31f1f });
      W.parkedCar(-(G / 2 + rearSpec.halfL), kerbZ + 0.22 + rearSpec.halfW, PI / 2, { spec: rearSpec, color: 0xc9c9c9 });
      for (const x of [16, 22.5, 36, -15, -21]) W.parkedCar(x, kerbZ + 0.22 + 0.88, PI / 2);
      for (const x of [-30, -6, 12, 40]) W.parkedCar(x, -kerbZ - 0.22 - 0.88, -PI / 2);
      const leadRear = G / 2, leadOuter = kerbZ + 0.2 + leadSpec.width;
      const zs = leadOuter + 0.8 + spec.halfW;          // approach: a door's width from the lead car
      const zf = kerbZ + 0.25 + spec.halfW;             // final: 25 cm from kerb
      const Dl = zs - zf;
      let a = PI / 4, s = (Dl - 2 * spec.R * (1 - Math.cos(a))) / Math.sin(a);
      if (s < 0) { s = 0; a = Math.acos(1 - Dl / (2 * spec.R)); }
      const xFin = -0.5 - spec.cOff;                     // rear axle x at the finish (slightly back in the gap, so the front clears the lead car)
      const xA2 = xFin + spec.R * Math.sin(a);           // start of right-lock arc
      const xA1e = xA2 + s * Math.cos(a);                // end of left-lock arc
      const xA1 = xA1e + spec.R * Math.sin(a);           // start of left-lock arc
      const xStop = xA1 + 1.0;
      const aDeg = D(a);
      const stopPose = { x: xStop, z: zs, th: PI / 2 };
      const a1Pose = { x: xA1, z: zs, th: PI / 2 };
      const a2Pose = { x: xA2, z: zf + spec.R * (1 - Math.cos(a)), th: PI / 2 - a };
      const finalPose = { x: xFin, z: zf, th: PI / 2 };
      const stopRef = `the lead car's rear bumper ${phrase(spec, longOf(spec, stopPose, leadRear, leadOuter), 'left')}`;
      const turnRef = `the lead car's rear bumper ${phrase(spec, longOf(spec, a1Pose, leadRear, leadOuter), 'left')}`;
      const a2Ref = `the back corner of the lead car ${phrase(spec, longOf(spec, a2Pose, leadRear, leadOuter), 'left')}`;
      const T = { cx: 0, cz: kerbZ + (spec.width + 0.5) / 2, hx: (spec.width + 0.5) / 2, hz: G / 2, ang: PI / 2, angles: [PI / 2] };
      const turned = st => D(PI / 2 - st.th);
      const kerbDist = st => { const c = P.obbCorners(st.veh.bodyBox()); return Math.min(...c.map(p => p.z)) - kerbZ; };
      const a2Remain = st => { const t = Math.max(P.rad(5), PI / 2 - st.th); return (st.z - (zf + spec.R * (1 - Math.cos(t)))) / Math.sin(t); };

      const steps = [
        moveOff('1'),
        {
          title: 'Pull up alongside',
          text: 'Drive slowly along the road. Pull up alongside the red car in front of the gap (the lead car), about a door\'s width (0.8 m) away from it, parallel to it.',
          ref: `STOP when ${stopRef}.`,
          look: 'leftWindow', ghost: stopPose,
          highlights: [{ type: 'post', x: leadRear, z: leadOuter }],
          meter: st => ({ label: 'to stop point', value: xStop - st.x, max: 12, unit: 'm' }),
          warn: st => st.x > xStop + 0.8 ? 'You have gone a little far. Stop; you can reverse straight back before turning.' : null,
          done: st => st.stopped && st.stillTime > 0.3 && Math.abs(st.x - xStop) < 0.8,
          auto: (st, ap) => { ap.v = slowTo(xStop - st.x, 2.0, 0.6); ap.steer = follow(st, 0, zs, PI / 2, 1); ap.look = 'leftWindow'; ap.clutch = 0.4; },
        },
        prepReverse('Check especially for traffic coming from behind on the right.'),
        {
          title: 'Reverse to the turning point',
          text: 'Creep back slowly in a straight line. Look over your left shoulder through the rear window, and watch the lead car\'s rear bumper through the left side windows.',
          ref: `Turn FULL LEFT LOCK when ${turnRef}. (The yellow post marks it.)`,
          look: 'rear', highlights: [{ type: 'post', x: leadRear, z: leadOuter }], ghost: a1Pose,
          meter: st => ({ label: 'to turning point', value: st.x - xA1, max: 3, unit: 'm' }),
          warn: st => (st.x < xA1 - 0.4 && st.sf < 0.5) ? 'Turn now! Full left lock (A).' : null,
          done: st => st.sf >= 0.9 && st.v < -0.02,
          auto: (st, ap) => { ap.hb = false; const r = st.x - xA1; ap.v = -0.45; ap.steer = r > 0.2 ? follow(st, 0, zs, PI / 2, -1) : spec.maxSteer; ap.look = 'rear'; ap.clutch = 0.6; },
        },
        {
          title: 'Turn in to 45°',
          text: 'Keep full left lock, creeping slowly. The rear swings in towards the kerb and the front swings out into the road, so check over your right shoulder for traffic too.',
          ref: `STRAIGHTEN the wheel (D) when the car is at about ${aDeg.toFixed(0)}° to the kerb. Looking over your left shoulder, the back of the car points at the kerb about halfway along the gap.`,
          look: 'rear', highlights: [{ type: 'post', x: leadRear, z: leadOuter }],
          meter: st => ({ label: 'angle to the kerb', value: aDeg - turned(st), max: aDeg, unit: '°', stopAt: 6 }),
          warn: st => (turned(st) > aDeg - 5 && st.sf > 0.5) ? 'STRAIGHTEN NOW (D).' : (turned(st) > aDeg + 8 ? 'The angle is getting steep: straighten now.' : null),
          done: st => turned(st) > aDeg - 12 && Math.abs(st.sf) < 0.15,
          auto: (st, ap) => { ap.v = -0.45; ap.steer = turned(st) < aDeg - 4 ? spec.maxSteer : 0; ap.look = turned(st) < 15 ? 'rightShoulder' : 'rear'; ap.clutch = 0.6; },
        },
        {
          title: 'Reverse at 45°',
          text: 'Wheels straight, keep creeping back at this angle. Dip your left mirror (M) to watch the kerb get closer.',
          ref: `Turn FULL RIGHT LOCK when ${a2Ref}, i.e. when your front has cleared the lead car.`,
          look: 'leftMirror', highlights: [{ type: 'post', x: leadRear, z: leadOuter }], ghost: a2Pose,
          meter: st => ({ label: 'to second turning point', value: a2Remain(st), max: 3, unit: 'm' }),
          warn: st => (a2Remain(st) < -0.3 && st.sf > -0.5) ? 'Full right lock now (D)!' : null,
          done: st => st.sf <= -0.9 && st.v < -0.02,
          auto: (st, ap) => { ap.v = -0.45; ap.steer = a2Remain(st) > 0.2 ? 0 : -spec.maxSteer; ap.look = 'leftMirror'; ap.clutch = 0.6; ap.dip = true; },
        },
        {
          title: 'Swing in parallel',
          text: 'Full right lock: the front swings in towards the kerb. Keep looking back, and check the front left corner clears the lead car.',
          ref: 'STRAIGHTEN (A) as the car becomes parallel with the kerb. In the left mirror the kerb stops coming towards you and runs along the car.',
          look: 'leftMirror', ghost: finalPose,
          meter: st => ({ label: 'angle to straight', value: turned(st), max: aDeg, unit: '°', stopAt: 6 }),
          warn: st => (turned(st) < 7 && st.sf < -0.5) ? 'STRAIGHTEN NOW (A).' : null,
          done: st => turned(st) < 9 && Math.abs(st.sf) < 0.15,
          auto: (st, ap) => { ap.v = -0.45; ap.steer = turned(st) > 4 ? -spec.maxSteer : 0; ap.look = 'leftMirror'; ap.clutch = 0.6; ap.dip = true; },
        },
        {
          title: 'Stop & check kerb distance',
          text: 'Stop. You should be parallel and close to the kerb (about 25–30 cm, and no more than 50 cm). You may creep forwards or back to straighten up.',
          ref: 'In your dipped left mirror (M): if the kerb runs along the yellow guide line, you are about 30 cm away.',
          look: 'leftMirror', ghost: finalPose,
          meter: st => ({ label: 'kerb distance', value: kerbDist(st), max: 1.5, unit: 'm', target: 0.3 }),
          warn: st => kerbDist(st) > 0.55 ? 'A bit far from the kerb. Small adjustments are allowed.' : null,
          done: st => st.stopped && st.stillTime > 0.3 && kerbDist(st) < 0.55 && Math.abs(turned(st)) < 8,
          auto: (st, ap) => { ap.v = 0; ap.look = 'leftMirror'; ap.dip = true; },
        },
        secure(true),
      ];
      return {
        start: { x: -34, z: zs, th: PI / 2 }, target: T, steps,
        mirrorGuide: { side: 'left', dist: 0.3 }, sticker: { side: 'left', dist: 0.3 },
        refs: { stop: stopRef, turn: turnRef, arc2: a2Ref },
        evaluate(st) {
          const e = evalBay(st, T); const kd = kerbDist(st);
          e.kerb = kd; e.ok = e.inside && e.angErr < 8 && kd < 0.55;
          if (kd > 0.5) e.issues.push(`${kd.toFixed(2)} m from the kerb`);
          return e;
        },
        finishNear: st => Math.abs(st.cx) < 6 && st.cz < kerbZ + 3,
        analyze(rec, fin) {
          const S = rec.samples, out = [];
          const i1 = S.findIndex(s => s.g === 'R' && s.v < -0.02 && s.sf >= 0.8);
          if (i1 >= 0) {
            const d = S[i1].x - xA1;
            out.push(item('First turn (full left lock)', Math.abs(d) < 0.5 ? 'good' : 'warn',
              Math.abs(d) < 0.5 ? 'Good timing.' : (d < 0 ? `${(-d).toFixed(1)} m late. You end up too far back, near the car behind.` : `${d.toFixed(1)} m early. The rear wheel heads for the kerb too soon and the car ends up too far out.`),
              `Reference: turn when ${turnRef}.`));
            const iU = S.findIndex((s, k) => k > i1 && s.sf < 0.3);
            if (iU >= 0) {
              const t = D(PI / 2 - S[iU].th);
              out.push(item('Angle when you straightened', Math.abs(t - aDeg) < 10 ? 'good' : 'warn',
                `${t.toFixed(0)}° (ideal about ${aDeg.toFixed(0)}°).`, t < aDeg - 10 ? 'Too shallow: you will finish too far from the kerb.' : (t > aDeg + 10 ? 'Too steep: the rear wheel will hit the kerb.' : '')));
            }
            const i2 = S.findIndex((s, k) => k > i1 && s.g === 'R' && s.sf <= -0.8);
            if (i2 >= 0) {
              const t = Math.max(P.rad(5), PI / 2 - S[i2].th);
              const r = (S[i2].z - (zf + spec.R * (1 - Math.cos(t)))) / Math.sin(t);
              out.push(item('Second turn (full right lock)', Math.abs(r) < 0.5 ? 'good' : 'warn',
                Math.abs(r) < 0.5 ? 'Good timing.' : (r > 0 ? `${r.toFixed(1)} m early. You end up too far from the kerb.` : `${(-r).toFixed(1)} m late. The rear wheel will touch the kerb.`),
                `Reference: turn when ${a2Ref}.`));
            }
          } else out.push(item('First turn', 'warn', 'No full left lock while reversing was detected.', 'Use full lock for the first turn.'));
          if (fin) {
            out.push(item('Distance from kerb', fin.kerb <= 0.35 ? 'good' : fin.kerb <= 0.55 ? 'warn' : 'bad', `${(fin.kerb * 100).toFixed(0)} cm.`, 'Aim for 25–30 cm. Use the dipped left mirror.'));
            out.push(item('Parallel to kerb', fin.angErr <= 3 ? 'good' : fin.angErr <= 8 ? 'warn' : 'bad', `${fin.angErr.toFixed(1)}° off parallel.`, ''));
            out.push(item('Inside the gap', fin.inside ? 'good' : 'bad', fin.inside ? 'Within the space.' : 'Not fully in the space.', ''));
          }
          return out;
        },
      };
    },
  };

  // ================================================================ PULL UP ON THE RIGHT
  const pullright = {
    id: 'pullright', name: 'Pull up on the right & reverse', icon: '↩️',
    desc: 'Pull up on the right side of the road, reverse about two car lengths, then stop.',
    build(W, spec) {
      const R = road(W);
      const kerbZ = R.hw;
      for (const x of [-75, 30, 45]) W.parkedCar(x, -kerbZ + 0.22 + 0.88, PI / 2);
      W.parkedCar(34, kerbZ - 0.22 - 0.88, -PI / 2);
      const zLane = -2.25, zf = kerbZ - 0.3 - spec.halfW;
      const xPull = 10;
      const revDist = 2 * spec.length;
      const kerbDist = st => { const c = P.obbCorners(st.veh.bodyBox()); return kerbZ - Math.max(...c.map(p => p.z)); };
      const angErr = st => Math.abs(D(P.wrap(st.th - PI / 2)));
      let startRevX = null;
      const state = { revStart: null };
      const T = { cx: xPull, cz: zf, hx: 1.5, hz: 6, ang: PI / 2, angles: [PI / 2] };

      const steps = [
        moveOff('1'),
        {
          title: 'Drive & signal',
          text: 'Drive along on the left at a steady speed. When it is safe: check your interior mirror and right mirror, then signal right (. key).',
          look: 'interiorMirror',
          checklist: st => [
            { label: 'Interior mirror', ok: st.obs.seenWithin('interiorMirror', 6) },
            { label: 'Right door mirror', ok: st.obs.seenWithin('rightMirror', 6) },
            { label: 'Signal right (.)', ok: st.ind === 1 },
          ],
          done: st => st.ind === 1 && st.obs.seenWithin('interiorMirror', 8) && st.obs.seenWithin('rightMirror', 8) && st.x > -25,
          auto: (st, ap) => { ap.v = 3; ap.steer = follow(st, 0, zLane, PI / 2, 1); ap.look = st.stepT < 1.2 ? 'interiorMirror' : st.stepT < 2.4 ? 'rightMirror' : 'front'; ap.ind = st.stepT > 2.6 ? 1 : 0; ap.clutch = 0; ap.gear = '1'; },
        },
        {
          title: 'Cross & pull up on the right',
          text: 'Steer gently across to the right-hand kerb at a shallow angle and stop parallel, close to the kerb (about 30 cm).',
          ref: 'Distance check: the yellow sticker on your bonnet shows where the kerb should appear to meet the bonnet when you are 30 cm away.',
          look: 'front',
          meter: st => ({ label: 'kerb distance', value: kerbDist(st), max: 6, unit: 'm', target: 0.3 }),
          warn: st => st.stopped && kerbDist(st) > 0.55 ? 'Too far from the kerb: creep forward and steer gently towards it.' : (angErr(st) > 12 && kerbDist(st) < 1 ? 'Straighten up so you end up parallel with the kerb.' : null),
          done: st => st.stopped && st.stillTime > 0.3 && kerbDist(st) < 0.55 && angErr(st) < 7 && st.x > -20,
          auto: (st, ap) => { const r = xPull - st.x; ap.v = slowTo(r, 2.5, 0.5); ap.steer = follow(st, 0, zf, PI / 2, 1); ap.look = 'front'; ap.ind = 1; ap.clutch = r < 3 ? 1 : 0; },
        },
        {
          title: 'Secure',
          text: 'Handbrake on (Space). Cancel your signal (. again).',
          look: 'front',
          checklist: st => [{ label: 'Handbrake on', ok: st.hb }, { label: 'Signal off', ok: st.ind === 0 }],
          done: st => st.hb && st.ind === 0 && st.stopped,
          auto: (st, ap) => { ap.v = 0; ap.hb = st.stepT > 0.4; ap.ind = st.stepT > 0.8 ? 0 : 1; ap.gear = 'N'; },
        },
        prepReverse('You are on the wrong side of the road, so check carefully for traffic in BOTH directions.'),
        {
          title: 'Reverse two car lengths',
          text: `Release the handbrake and creep back about two car lengths (${revDist.toFixed(1)} m), staying parallel and about 30 cm from the kerb. Look mainly over your left shoulder through the rear window, with glances at the right mirror for the kerb and all around for traffic.`,
          ref: 'In the right mirror: keep the kerb running along the yellow guide line. If it moves away from the car, steer slightly right; if it comes closer, steer slightly left.',
          look: 'rear',
          onEnter: st => { state.revStart = st.x; },
          meter: st => ({ label: 'further to reverse', value: revDist - (state.revStart - st.x), max: revDist, unit: 'm' }),
          info: st => `Kerb distance ${(kerbDist(st) * 100).toFixed(0)} cm`,
          warn: st => kerbDist(st) > 0.6 ? 'Drifting away from the kerb. Steer slightly right (D).' : (kerbDist(st) < 0.08 ? 'Very close to the kerb! Steer slightly left (A).' : null),
          done: st => st.stopped && st.stillTime > 0.3 && (state.revStart - st.x) > revDist - 0.6,
          auto: (st, ap) => { ap.hb = false; const r = revDist - (state.revStart - st.x); ap.v = -slowTo(r, 0.7); ap.steer = follow(st, 0, zf, PI / 2, -1); ap.look = st.stepT % 4 < 3 ? 'rear' : 'rightMirror'; ap.clutch = 0.6; },
        },
        secure(true),
      ];
      return {
        start: { x: -45, z: zLane, th: PI / 2 }, target: null, steps, state,
        mirrorGuide: { side: 'right', dist: 0.3 }, sticker: { side: 'right', dist: 0.3 },
        evaluate(st) {
          const kd = kerbDist(st), ae = angErr(st);
          const rev = state.revStart != null ? state.revStart - st.x : 0;
          const issues = [];
          if (kd > 0.55) issues.push(`${kd.toFixed(2)} m from the kerb`);
          if (ae > 6) issues.push(`${ae.toFixed(0)}° from parallel`);
          return { ok: kd < 0.55 && ae < 8, kerb: kd, angErr: ae, rev, issues, inside: true };
        },
        finishNear: st => st.cz > 0 && state.revStart != null && (state.revStart - st.x) > 3,
        analyze(rec, fin) {
          const S = rec.samples, out = [];
          const iCross = S.findIndex(s => s.cz > 0);
          if (iCross >= 0) {
            const signalled = S.slice(Math.max(0, iCross - 40), iCross + 1).some(s => s.ind === 1);
            out.push(item('Signal before crossing', signalled ? 'good' : 'bad', signalled ? 'You signalled right before crossing.' : 'No right signal before crossing the road.', 'Mirrors, signal, then move.'));
          }
          const iStop = S.findIndex((s, k) => k > iCross && s.v === 0 && s.cz > 2);
          if (iStop >= 0) {
            const kd = kerbZ - (S[iStop].cz + spec.halfW);
            out.push(item('Pulled up close to the kerb', kd <= 0.4 ? 'good' : kd <= 0.6 ? 'warn' : 'bad', `${(kd * 100).toFixed(0)} cm from the kerb.`, 'Use the bonnet sticker reference: the kerb meets the bonnet at the sticker when you are about 30 cm away.'));
          }
          const rev = S.filter(s => s.g === 'R' && s.cz > 2);
          if (rev.length) {
            const maxD = Math.max(...rev.map(s => kerbZ - (s.cz + spec.halfW)));
            const minD = Math.min(...rev.map(s => kerbZ - (s.cz + spec.halfW)));
            out.push(item('Stayed close while reversing', maxD < 0.6 && minD > 0.03 ? 'good' : 'warn', `Kerb distance varied from ${(minD * 100).toFixed(0)} to ${(maxD * 100).toFixed(0)} cm.`, 'Keep the kerb on the yellow guide line in the right mirror; make small corrections.'));
          }
          if (fin) {
            out.push(item('Distance reversed', fin.rev > revDist - 1.5 && fin.rev < revDist + 2 ? 'good' : 'warn', `${fin.rev.toFixed(1)} m (about ${(fin.rev / spec.length).toFixed(1)} car lengths).`, 'About two car lengths is what the examiner asks for.'));
            out.push(item('Final position', fin.ok ? 'good' : 'warn', `${(fin.kerb * 100).toFixed(0)} cm from the kerb, ${fin.angErr.toFixed(1)}° from parallel.`, ''));
          }
          return out;
        },
      };
    },
  };

  // ================================================================ FREE PRACTICE
  const free = {
    id: 'free', name: 'Free practice car park', icon: '🚗',
    desc: 'Park in any empty bay, forwards or in reverse. No prompts.', noGuide: true,
    build(W, spec) {
      const L = carPark(W, spec, b => W.rand() < 0.55);
      const empties = [...L.right, ...L.left].filter(b => !W.obstacles.some(o => o.kind === 'car' && Math.hypot(o.cx - b.x, o.cz - b.z) < 1));
      const targets = empties.map(b => Object.assign(bayTarget(b), { angles: [0, PI] }));
      return {
        start: { x: L.x0 - 9, z: -0.6, th: PI / 2 }, target: null, targets, steps: [],
        evaluate(st) {
          let best = null;
          for (const T of targets) { const d = Math.hypot(st.cx - T.cx, st.cz - T.cz); if (!best || d < best.d) best = { T, d }; }
          return best ? evalBay(st, best.T) : { ok: false, issues: ['No bay'] };
        },
        finishNear: st => targets.some(T => Math.hypot(st.cx - T.cx, st.cz - T.cz) < 2.5),
        analyze(rec, fin) { return finalItems(fin, 'bay'); },
      };
    },
  };

  P.LEVELS = [revbay, fwdbay, parallel, pullright, free];
})(window.PS);
