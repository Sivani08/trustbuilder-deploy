(function () {
  const runtime = { recorder: null, recognition: null, stream: null, chunks: [], transcript: "", confidences: [], audioBlob: null, audioUrl: null, startedAt: null, captureMeta: null, captureGeneration: 0, transcriptionController: null };

  function bestAudioMimeType() {
    if (!window.MediaRecorder) return "";
    return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type)) || "";
  }

  function audioExtension(type) {
    if (type.includes("mp4")) return "m4a";
    if (type.includes("ogg")) return "ogg";
    if (type.includes("wav")) return "wav";
    return "webm";
  }

  function createRecognition(onTranscript, onStatus) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return null;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || "en-US";
    recognition.onresult = event => {
      let finalText = "", interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          finalText += `${text} `;
          if (Number.isFinite(result[0].confidence)) runtime.confidences.push(result[0].confidence);
        } else interimText += `${text} `;
      }
      if (finalText) runtime.transcript = `${runtime.transcript} ${finalText}`.replace(/\s+/g, " ").trim();
      onTranscript(runtime.transcript, interimText.trim());
    };
    recognition.onerror = event => onStatus("partial", `Live draft paused: ${event.error}. Your audio is still preserved.`);
    recognition.onend = () => { if (runtime.recorder?.state === "recording") try { recognition.start(); } catch {} };
    return recognition;
  }

  async function startCapture({ onTranscript, onStatus }) {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("Recording is not supported in this browser.");
    runtime.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const generation = ++runtime.captureGeneration;
    runtime.chunks = []; runtime.transcript = ""; runtime.confidences = [];
    runtime.startedAt = Date.now();
    const mimeType = bestAudioMimeType();
    runtime.recorder = new MediaRecorder(runtime.stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined);
    runtime.recorder.ondataavailable = event => { if (generation === runtime.captureGeneration && event.data.size) runtime.chunks.push(event.data); };
    runtime.recorder.start(1000);
    runtime.recognition = createRecognition(onTranscript, onStatus);
    if (runtime.recognition) try { runtime.recognition.start(); } catch {}
    onStatus("recording", runtime.recognition ? "Recording with a live draft transcript" : "Recording audio; transcript can be entered or processed later");
  }

  async function stopCapture({ onStatus }) {
    if (!runtime.recorder || runtime.recorder.state === "inactive") return null;
    const generation = runtime.captureGeneration;
    const stopped = new Promise(resolve => runtime.recorder.addEventListener("stop", resolve, { once: true }));
    runtime.recorder.stop();
    runtime.recognition?.stop();
    runtime.stream?.getTracks().forEach(track => track.stop());
    await stopped;
    if (generation !== runtime.captureGeneration) return null;
    const mimeType = runtime.recorder.mimeType || runtime.chunks[0]?.type || "";
    if (!runtime.chunks.length) throw new Error("No audio was captured. Please try recording again.");
    runtime.audioBlob = new Blob(runtime.chunks, { type: mimeType || "audio/webm" });
    if (!runtime.audioBlob.size) throw new Error("The recorded audio is empty. Please try recording again.");
    runtime.captureMeta = { localId: `audio-${Date.now()}`, mimeType: runtime.audioBlob.type, sizeBytes: runtime.audioBlob.size, durationMs: runtime.startedAt ? Date.now() - runtime.startedAt : null, localOnly: true };
    if (runtime.audioUrl) URL.revokeObjectURL(runtime.audioUrl);
    runtime.audioUrl = URL.createObjectURL(runtime.audioBlob);
    const confidence = runtime.confidences.length ? runtime.confidences.reduce((a,b)=>a+b,0) / runtime.confidences.length : null;
    onStatus(runtime.transcript ? "partial" : "captured", runtime.transcript ? "Draft transcript captured—review it against the audio" : "Audio captured—add a manual transcript before evaluation");
    return { blob: runtime.audioBlob, url: runtime.audioUrl, transcript: runtime.transcript, confidence, audioRef: runtime.captureMeta };
  }

  function clearCapture() {
    runtime.captureGeneration += 1;
    runtime.transcriptionController?.abort();
    runtime.transcriptionController = null;
    runtime.recognition?.stop();
    if (runtime.recorder && runtime.recorder.state !== "inactive") runtime.recorder.stop();
    runtime.stream?.getTracks().forEach(track => track.stop());
    if (runtime.audioUrl) URL.revokeObjectURL(runtime.audioUrl);
    document.querySelectorAll("audio").forEach(audio => { audio.pause(); audio.currentTime = 0; audio.removeAttribute("src"); audio.load(); });
    runtime.recorder = null;
    runtime.recognition = null;
    runtime.stream = null;
    runtime.chunks = [];
    runtime.transcript = "";
    runtime.confidences = [];
    runtime.audioBlob = null;
    runtime.audioUrl = null;
    runtime.startedAt = null;
    runtime.captureMeta = null;
  }

  async function transcribeWithProvider(context = {}) {
    if (!runtime.audioBlob || !window.TRUSTBUILDER_TRANSCRIPTION_ENDPOINT) return null;
    if (!runtime.audioBlob.size) throw new Error("The recorded audio is empty. Please try recording again.");
    const generation = runtime.captureGeneration;
    runtime.transcriptionController?.abort();
    const controller = new AbortController();
    runtime.transcriptionController = controller;
    const form = new FormData();
    form.append("audio", runtime.audioBlob, `response.${audioExtension(runtime.audioBlob.type)}`);
    form.append("context", JSON.stringify(context));
    const role = window.TRUSTBUILDER_AUTH_USER?.role || null;
    const user = role === "administrator" ? "usr-jordan" : role === "facilitator" ? "usr-priya" : role === "participant" ? "usr-alex" : null;
    const requestId = window.TrustBuilderServices?.id?.("transcribe") || `transcribe-${Date.now()}`;
    try {
      const response = await fetch(window.TRUSTBUILDER_TRANSCRIPTION_ENDPOINT, { method: "POST", credentials: "same-origin", headers: { ...(role ? { "X-TrustBuilder-Role": role } : {}), ...(user ? { "X-TrustBuilder-User": user } : {}), "X-Request-Id": requestId }, body: form, signal: controller.signal });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json() : null;
      if (!response.ok) throw new Error(payload?.error?.message || `Transcription service returned ${response.status}.`);
      if (generation !== runtime.captureGeneration) throw new DOMException("Stale transcription result.", "AbortError");
      const text = String(payload?.text || payload?.transcript || "").trim();
      if (!text) throw new Error("The transcription service returned no text.");
      return { ...payload, text };
    } catch (error) {
      if (error.name === "AbortError") return null;
      throw error;
    } finally {
      if (runtime.transcriptionController === controller) runtime.transcriptionController = null;
    }
  }

  function evaluateResponse(text, decision) {
    const cleaned = text.trim(), lower = cleaned.toLowerCase();
    const domain = window.TrustBuilderDomain;
    const evidence = [];
    const add = (dimension, observed, quote, suggestedScore, critical=false) => evidence.push({ dimension, observed, quote, suggestedScore: observed || critical ? suggestedScore : null, critical });
    const acknowledgement = /understand|recognise|recognize|appreciate|important|impact|urgency/.test(lower);
    const uncertainty = /cannot (?:confirm|guarantee)|can(?:not|'t) responsibly|still (?:validating|testing|unknown)|evidence is incomplete|not yet/.test(lower);
    const checkpoint = /\b(?:by|at)\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|end of day|tomorrow|monday|tuesday|wednesday|thursday|friday)\b/i.test(cleaned);
    const unsupported = /\b(?:guarantee|definitely|certainly|will be fully|no doubt)\b/i.test(cleaned) && !/cannot|can(?:not|'t)/i.test(cleaned);
    const question = /\?/.test(cleaned) || /(?:could|can|would) you (?:clarify|confirm|tell)/i.test(cleaned);
    add("Stakeholder acknowledgement", acknowledgement, acknowledgement ? "Acknowledged urgency or business impact." : "No explicit acknowledgement of the stakeholder’s stakes.", acknowledgement ? 4 : 2);
    add("Evidence boundary", uncertainty, uncertainty ? "Distinguished known facts from unresolved validation." : "Did not clearly state what remained unknown.", uncertainty ? 4 : 2, unsupported);
    add("Follow-through", checkpoint, checkpoint ? "Set a time-bound return commitment." : "Next step did not include a precise checkpoint.", checkpoint ? 4 : 2);
    add("Clarification", question || /clarifying|validate before/.test((decision||"").toLowerCase()), question ? "Used a clarifying question." : `Selected “${decision || "no action"}”.`, question ? 4 : 3);
    if (unsupported) add("Critical error", false, "Used an unsupported certainty or guarantee.", 1, true);
    const words = cleaned ? cleaned.split(/\s+/).length : 0;
    const fillers = (lower.match(/\b(?:um|uh|like|you know|basically|actually)\b/g) || []).length;
    const avg = evidence.filter(x=>!x.critical).reduce((sum,x)=>sum+x.suggestedScore,0) / 4;
    const communicationQuality = domain ? {
      grammar: domain.evaluateGrammar(cleaned),
      vocabulary: domain.evaluateVocabulary(cleaned, domain.DEFAULT_SCENARIO),
      repetition: domain.evaluateRepetition(cleaned, []),
      relevance: domain.evaluateRelevance(cleaned, "", domain.DEFAULT_SCENARIO),
      clarity: domain.evaluateClarity(cleaned)
    } : null;
    return { version: "observable-v1", generatedAt: new Date().toISOString(), decision, wordCount: words, fillerCount: fillers, suggestedScore: evidence.some(e=>e.observed) ? Math.max(1, Math.min(5, Math.round(avg))) : null, requiresHumanApproval: true, criticalErrors: evidence.filter(x=>x.critical).map(x=>x.quote), evidence, communicationQuality };
  }

  window.TrustBuilderAnalysis = { startCapture, stopCapture, clearCapture, transcribeWithProvider, evaluateResponse, runtime };
})();
