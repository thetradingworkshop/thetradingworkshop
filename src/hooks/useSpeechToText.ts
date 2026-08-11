import { useCallback, useEffect, useRef, useState } from 'react';

// The Web Speech API's recognition constructor is still vendor-prefixed on
// every browser that implements it (Chrome/Edge/Safari) and entirely absent
// on Firefox — there's no unprefixed global to rely on, so both names have
// to be checked and the caller has to be ready for neither to exist.
function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

// A minimal shape of the bits of SpeechRecognition this hook actually uses —
// lib.dom.d.ts doesn't ship types for this API at all (it's not part of the
// standard DOM lib), so this stands in for the real interface rather than
// sprinkling `any` through the implementation below.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

// Shared by every dictation button in the app (RichTextEditor's toolbar,
// DictationTextarea) — one mic press starts a continuous recognition
// session; each finalized phrase fires `onFinalResult` so the caller can
// insert it wherever the cursor currently is, rather than waiting for the
// whole session to end.
export function useSpeechToText(onFinalResult: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported] = useState(() => getSpeechRecognitionCtor() !== null);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // `onFinalResult` is very often a fresh closure every render (an inline
  // arrow function reading current component state) — routing through a
  // ref means `start()` never has to depend on it and doesn't need to
  // recreate the recognition session just because the caller re-rendered.
  const onFinalResultRef = useRef(onFinalResult);
  useEffect(() => { onFinalResultRef.current = onFinalResult; }, [onFinalResult]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Voice dictation isn't supported in this browser — try Chrome, Edge, or Safari.");
      return;
    }
    setError(null);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
      }
      if (finalText.trim()) onFinalResultRef.current(finalText.trim());
    };
    recognition.onerror = (event) => {
      // "no-speech" fires constantly during normal pauses in continuous
      // mode and "aborted" fires on our own stop() call — neither is a
      // real error worth surfacing.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setError(event.error === 'not-allowed' ? 'Microphone access was denied.' : `Voice dictation error: ${event.error}`);
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, []);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  // Stop the mic if the component using it unmounts mid-dictation (e.g. the
  // user closes the drawer/modal without hitting the mic again first).
  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  return { isListening, isSupported, error, start, stop, toggle };
}
