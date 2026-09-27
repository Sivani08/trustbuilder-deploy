(function () {
  'use strict';
  let generation = 0, recognition, stream, recorder, chunks = [], timer, restartTimer;
  let options, active = false, muted = false, processing = false, speaking = false, finalText = '', interim = '', turnId;
  const seen = new Set();
  let lastState = 'TEXT FALLBACK', lastTranscript = '';
  const status = (label, text) => { lastState=label; if(text!==undefined)lastTranscript=text; options?.onState(label, text); };
  function cancelSpeech() { window.speechSynthesis?.cancel(); speaking = false; }
  function stop() {
    active = false; generation++; clearTimeout(timer); clearTimeout(restartTimer);
    if (recognition) { recognition.onend = null; recognition.abort(); recognition = null; }
    if (recorder?.state === 'recording') void finishAudio();
    stream?.getTracks().forEach(t => t.stop()); stream = null; recorder = null;
    finalText = ''; interim = ''; processing = false; cancelSpeech(); status('TEXT FALLBACK');
  }
  function beginAudio() {
    if (!stream || !window.MediaRecorder || recorder?.state === 'recording') return;
    chunks = []; turnId = crypto.randomUUID();
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
    recorder.start(250);
  }
  async function finishAudio() {
    if (!recorder || recorder.state !== 'recording') return null;
    const current = recorder, localId = turnId, currentChunks = chunks, sessionId = options.sessionId;
    const stopped = new Promise(resolve => current.addEventListener('stop', resolve, { once: true }));
    current.stop(); await stopped; if(recorder===current)recorder = null;
    const blob = new Blob(currentChunks, { type: current.mimeType });
    if (!blob.size) return null;
    const ref = { localId, mimeType: blob.type, sizeBytes: blob.size, localOnly: true };
    const form = new FormData(); form.append('audio', blob, 'participant.webm'); form.append('sessionId', sessionId); form.append('localId', localId);
    // Evidence upload runs independently of conversation submission. Server joins by localId.
    fetch('/api/evidence/audio', { method: 'POST', credentials: 'same-origin', body: form }).then(async response => {
      if (!response.ok) throw Error('Audio upload failed');
      ref.localOnly = false;
    }).catch(() => {
      const url = URL.createObjectURL(blob);
      status('Audio upload failed. Download your recording before leaving.');
      const panel = document.querySelector('.live-voice-panel');
      if (panel) { const link = document.createElement('a'); link.href = url; link.download = 'participant-evidence.webm'; link.textContent = 'Download unsaved audio'; panel.append(link); }
    });
    return ref;
  }
  async function submit(g) {
    if (!active || g !== generation || muted || processing || interim.trim()) return;
    const text = finalText.trim(); if (!text) return;
    processing = true; finalText = ''; clearTimeout(timer); status('PROCESSING', 'YOU: ' + text);
    const ref = await finishAudio();
    if (!active || g !== generation) return;
    const eventId = ref?.localId || crypto.randomUUID();
    if (seen.has(eventId)) return; seen.add(eventId);
    try { await options.onTurn(text, ref); }
    finally { processing = false; if(active && g === generation) status(speaking ? 'AI SPEAKING' : 'LISTENING'); }
  }
  function listen(g) {
    if (!active || g !== generation) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const finalIndexes = new Set();
    recognition = new Recognition(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'en-US';
    recognition.onresult = event => {
      if (!active || muted || processing || g !== generation) return;
      if (speaking) { cancelSpeech(); status('INTERRUPTED'); }
      beginAudio(); clearTimeout(timer); interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal && !finalIndexes.has(i)) { finalIndexes.add(i); finalText += result[0].transcript + ' '; }
        else if (!result.isFinal) interim += result[0].transcript;
      }
      status('USER SPEAKING', 'YOU: ' + finalText + interim);
      // Browser recognition has no semantic VAD. A deliberate grace period protects thinking pauses.
      timer = setTimeout(() => submit(g), 2600);
    };
    recognition.onspeechstart = () => { if(active && !muted && !processing){ if(speaking){cancelSpeech();status('INTERRUPTED');} beginAudio(); clearTimeout(timer); status('USER SPEAKING'); } };
    recognition.onerror = event => {
      if (['not-allowed','service-not-allowed','audio-capture'].includes(event.error)) { stop(); status('TEXT FALLBACK · Microphone unavailable. Use recording or text.'); }
      else if(event.error === 'network') { stop(); status('TEXT FALLBACK · Speech recognition lost its connection. Your saved turns are preserved.'); }
      else if(event.error === 'no-speech') status('LISTENING · No clear speech detected. Check your microphone.');
    };
    recognition.onend = () => { if(active && g===generation) restartTimer=setTimeout(()=>listen(g),300); };
    try { recognition.start(); } catch { stop(); status('TEXT FALLBACK · Browser speech is unavailable.'); }
  }
  async function start(input) {
    stop(); options = input;
    if (!input.sessionId) return status('TEXT FALLBACK · Start a saved assessment first.');
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition) || !navigator.mediaDevices?.getUserMedia) return status('TEXT FALLBACK · Live speech is unsupported. Use recording or text.');
    const g = generation;
    try {
      status('CONNECTING');
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if(g !== generation){media.getTracks().forEach(t=>t.stop());return;}
      stream = media; active = true; muted = false; beginAudio(); listen(g); status('LISTENING');
      if(input.currentQuestion) await speak(input.currentQuestion);
    } catch(error) { stop(); status(error.name === 'NotAllowedError' ? 'TEXT FALLBACK · Microphone permission denied.' : 'TEXT FALLBACK · No microphone available.'); }
  }
  async function speak(text) {
    cancelSpeech(); if(!active || !window.speechSynthesis) return;
    speaking = true; status('AI SPEAKING', 'CLIENT: ' + text);
    await new Promise(resolve => {
      const utterance = new SpeechSynthesisUtterance(text); utterance.rate = 1; utterance.lang = 'en-US';
      const timeout = setTimeout(resolve, 30000);
      const done = () => { clearTimeout(timeout); speaking = false; if(active)status('LISTENING'); resolve(); };
      utterance.onend = done; utterance.onerror = done; speechSynthesis.speak(utterance);
    });
  }
  function toggleMute() { muted=!muted; stream?.getAudioTracks().forEach(t=>t.enabled=!muted); clearTimeout(timer); status(muted?'MUTED':'LISTENING'); }
  window.addEventListener('pagehide', stop);
  window.addEventListener('offline', () => { stop(); status('TEXT FALLBACK · Offline. Reconnect before submitting.'); });
  document.addEventListener('visibilitychange', () => { if(document.hidden && active){stop();status('Voice paused while the tab is in the background. Reconnect when ready.');} });
  window.TrustBuilderVoice = { start, stop, speak, toggleMute, refresh:()=>{if(active)options?.onState(lastState,lastTranscript);}, get active(){return active;} };
})();
