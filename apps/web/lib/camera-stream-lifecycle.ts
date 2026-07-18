export type CameraTrackLike = {
  addEventListener: (
    type: "ended",
    listener: EventListenerOrEventListenerObject,
  ) => void;
  removeEventListener: (
    type: "ended",
    listener: EventListenerOrEventListenerObject,
  ) => void;
  stop: () => void;
};

export type CameraStreamLike = {
  getTracks: () => readonly CameraTrackLike[];
  getVideoTracks: () => readonly CameraTrackLike[];
};

export function stopCameraStream(stream: CameraStreamLike | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

export function watchCameraStreamEnded(
  stream: CameraStreamLike,
  onEnded: () => void,
): () => void {
  const tracks = stream.getVideoTracks();
  let handled = false;
  const handleEnded = () => {
    if (handled) {
      return;
    }
    handled = true;
    onEnded();
  };

  tracks.forEach((track) => track.addEventListener("ended", handleEnded));
  return () => {
    tracks.forEach((track) => track.removeEventListener("ended", handleEnded));
  };
}
