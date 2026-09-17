// Reuse permission within the open capture screen without recording idle audio.
export class MicrophoneSession {
  private stream: MediaStream | null = null;
  private generation = 0;

  async acquire(
    getStream = () => navigator.mediaDevices.getUserMedia({ audio: true }),
  ) {
    if (
      this.stream?.getAudioTracks().some((track) => track.readyState === 'live')
    ) {
      this.stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      return this.stream;
    }
    this.release();
    const generation = this.generation;
    const stream = await getStream();
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException('Capture was closed.', 'AbortError');
    }
    this.stream = stream;
    return stream;
  }

  mute() {
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }

  release() {
    this.generation++;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
