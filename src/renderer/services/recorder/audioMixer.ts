/**
 * Mixes several audio tracks (system loopback + microphone) into one track,
 * because a WebM from MediaRecorder carries a single audio track.
 */
export class AudioMixer {
  private readonly context: AudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly nodes: AudioNode[] = [];

  constructor(tracks: MediaStreamTrack[]) {
    this.context = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
    this.destination = this.context.createMediaStreamDestination();
    for (const track of tracks) {
      const source = this.context.createMediaStreamSource(new MediaStream([track]));
      const gain = this.context.createGain();
      gain.gain.value = 1;
      source.connect(gain).connect(this.destination);
      this.nodes.push(source, gain);
    }
    void this.context.resume();
  }

  get track(): MediaStreamTrack {
    const track = this.destination.stream.getAudioTracks()[0];
    if (!track) throw new Error('Audio mixer produced no track');
    return track;
  }

  close(): void {
    for (const n of this.nodes) n.disconnect();
    this.destination.stream.getTracks().forEach((t) => t.stop());
    void this.context.close().catch(() => undefined);
  }
}
