'use client';
import { useEffect, useRef, useState } from 'react';
import { MicrophoneSession } from './microphone-session';

// Both Capture and open-note dictation use the same microphone lifecycle.
export function useVoiceRecorder(
  onFile: (file: File, capturedAt: string) => Promise<void>,
  disabled: boolean,
  setError: (message: string) => void,
) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const microphone = useRef(new MicrophoneSession());
  const recorder = useRef<MediaRecorder | null>(null);
  const active = useRef(true);
  const requesting = useRef(false);
  const onRecorded = useRef(onFile);
  onRecorded.current = onFile;
  useEffect(() => {
    active.current = true;
    const stop = () => {
      if (recorder.current?.state === 'recording') recorder.current.stop();
      microphone.current.release();
    };
    const hide = () => {
      if (document.hidden) stop();
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (recorder.current?.state === 'recording') event.preventDefault();
    };
    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('beforeunload', warn);
    return () => {
      active.current = false;
      stop();
      window.removeEventListener('pagehide', stop);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('beforeunload', warn);
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setElapsed(seconds);
      if (seconds >= 180 && recorder.current?.state === 'recording')
        recorder.current.stop();
    }, 500);
    return () => clearInterval(timer);
  }, [recording]);
  async function start() {
    if (requesting.current || disabled) return;
    if (starting || recorder.current?.state === 'recording') return;
    requesting.current = true;
    setStarting(true);
    setError('');
    let stream: MediaStream | undefined;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === 'undefined'
      )
        throw new Error(
          'Recording is unavailable in this browser. Use your keyboard microphone to dictate below.',
        );
      stream = await microphone.current.acquire();
      if (!active.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      const current = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = current;
      const chunks: Blob[] = [],
        started = new Date().toISOString();
      let size = 0;
      current.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          size += event.data.size;
        }
        if (size > 10 * 1024 * 1024 && current.state === 'recording')
          current.stop();
      };
      current.onstop = () => {
        microphone.current.mute();
        recorder.current = null;
        setRecording(false);
        if (!chunks.length) {
          setError('No audio was recorded. Try again.');
          return;
        }
        const type = (current.mimeType || chunks[0].type || 'audio/webm').split(
          ';',
        )[0];
        const extension = type.includes('mp4')
          ? 'm4a'
          : type.includes('ogg')
            ? 'ogg'
            : 'webm';
        void onRecorded.current(
          new File(
            chunks,
            `Voice note ${started.slice(0, 19).replace(/:/g, '-')}.${extension}`,
            { type },
          ),
          started,
        );
      };
      current.onerror = () => {
        setError(
          'Recording was interrupted. Saving the audio captured so far.',
        );
        if (current.state !== 'inactive') current.stop();
      };
      current.start(1000);
      setElapsed(0);
      setRecording(true);
    } catch (reason) {
      microphone.current.release();
      if ((reason as Error).name === 'AbortError') return;
      setError(
        (reason as Error).name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in this app’s browser settings, or use keyboard dictation below.'
          : (reason as Error).message,
      );
    } finally {
      requesting.current = false;
      setStarting(false);
    }
  }
  return {
    recording,
    starting,
    elapsed,
    start,
    stop: () => recorder.current?.stop(),
  };
}
