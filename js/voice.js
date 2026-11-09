// Voice coach: reads guided steps and cues aloud with the browser's built-in speech (British voice if available).
(function (P) {
  const RATES = { normal: 1.0, slow: 0.8 };
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;

  // make on-screen text sound natural when read aloud
  function speakable(t) {
    return String(t)
      .replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, '')
      .replace(/↑/g, 'up arrow').replace(/↓/g, 'down arrow').replace(/[←]/g, 'left arrow').replace(/[→]/g, 'right arrow')
      .replace(/(\d)½/g, '$1 and a half').replace(/½/g, 'a half').replace(/¼/g, 'a quarter')
      .replace(/(\d)\s?°/g, '$1 degrees')
      .replace(/(\d)\s?cm\b/g, '$1 centimetres')
      .replace(/(\d)\s?m\b/g, '$1 metres')
      .replace(/\(([A-Z0-9]|Space|\.)\)/g, '')                // drop "(H)", "(1)", "(Space)" key hints
      .replace(/\(hold ([AD])[^)]*\)/g, '')                   // "(hold D, about 1½ turns)"
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .trim();
  }

  class Voice {
    get available() { return !!synth; }
    get on() { return !!synth && P.settings.voice !== 'off' && !(P.sound && P.sound.muted); }
    pickVoice() {
      const vs = synth.getVoices();
      return vs.find(v => v.lang === 'en-GB' && /female|libby|sonia|hazel|serena|kate|google uk english female/i.test(v.name))
        || vs.find(v => v.lang === 'en-GB')
        || vs.find(v => /^en/i.test(v.lang));
    }
    // interrupt = cancel whatever is being said first
    say(text, interrupt = true) {
      if (!this.on || !text) return;
      if (interrupt) synth.cancel();
      const u = new SpeechSynthesisUtterance(speakable(text));
      u.rate = RATES[P.settings.voice] || 0.8;
      const v = this.pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
      synth.speak(u);
    }
    stop() { if (synth) synth.cancel(); }
    busy() { return this.on && (synth.speaking || synth.pending); }
  }
  if (synth) synth.getVoices(); // starts loading the voice list early
  P.voice = new Voice();
  P.speakable = speakable;
})(window.PS);
