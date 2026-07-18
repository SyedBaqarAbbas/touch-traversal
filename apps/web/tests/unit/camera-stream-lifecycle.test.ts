import { describe, expect, it, vi } from "vitest";

import {
  stopCameraStream,
  watchCameraStreamEnded,
  type CameraTrackLike,
} from "../../lib/camera-stream-lifecycle";

function createTrack(): CameraTrackLike & { emitEnded: () => void } {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  return {
    addEventListener: (_type, listener) => listeners.add(listener),
    emitEnded: () => {
      for (const listener of listeners) {
        if (typeof listener === "function") {
          listener(new Event("ended"));
        } else {
          listener.handleEvent(new Event("ended"));
        }
      }
    },
    removeEventListener: (_type, listener) => listeners.delete(listener),
    stop: vi.fn(),
  };
}

describe("camera stream lifecycle", () => {
  it("stops every owned media track on disable or unmount", () => {
    const first = createTrack();
    const second = createTrack();
    const stream = {
      getTracks: () => [first, second],
      getVideoTracks: () => [first],
    };

    stopCameraStream(stream);

    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.stop).toHaveBeenCalledOnce();
  });

  it("reports runtime track failure once and detaches cleanly", () => {
    const track = createTrack();
    const onEnded = vi.fn();
    const detach = watchCameraStreamEnded(
      {
        getTracks: () => [track],
        getVideoTracks: () => [track],
      },
      onEnded,
    );

    track.emitEnded();
    track.emitEnded();
    expect(onEnded).toHaveBeenCalledOnce();

    detach();
    track.emitEnded();
    expect(onEnded).toHaveBeenCalledOnce();
  });
});
