import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHandTrackingWorkerController,
  scaledFrameSize,
} from "../../lib/hand-tracking-client";
import type { HandWorkerOutboundMessage } from "../../lib/hand-worker-protocol";

type FrameCapture = (
  image: ImageBitmapSource,
  options?: ImageBitmapOptions,
) => Promise<ImageBitmap>;

afterEach(() => {
  FakeWorker.instances.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hand tracking client", () => {
  it("keeps small frames unchanged", () => {
    expect(scaledFrameSize(320, 180, 320)).toEqual({
      height: 180,
      width: 320,
    });
  });

  it("downscales wide camera frames before worker transfer", () => {
    expect(scaledFrameSize(1280, 720, 320)).toEqual({
      height: 180,
      width: 320,
    });
  });

  it("exposes adaptive target cadence without allocating a second stream", async () => {
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(
        new URL("../../lib/hand-tracking-client.ts", import.meta.url),
        "utf8",
      ),
    );

    expect(source).toContain("setTargetFps: (targetFps: number) => void");
    expect(source).toContain("targetFps = nextTargetFps");
    expect(source).toContain("const worker = new Worker");
  });

  it("allows only one captured frame to wait for worker inference", async () => {
    const firstCapture = deferred<ImageBitmap>();
    const firstFrame = fakeImageBitmap();
    const secondFrame = fakeImageBitmap();
    const createBitmap = vi
      .fn<FrameCapture>()
      .mockReturnValueOnce(firstCapture.promise)
      .mockResolvedValueOnce(secondFrame.bitmap);
    installBrowserFakes(createBitmap);
    const controller = createHandTrackingWorkerController();
    const worker = FakeWorker.instances[0]!;
    const video = readyVideo();

    const firstSubmission = controller.submitVideoFrame(video, 100);
    await expect(controller.submitVideoFrame(video, 200)).resolves.toBe(false);
    expect(createBitmap).toHaveBeenCalledOnce();

    firstCapture.resolve(firstFrame.bitmap);
    await expect(firstSubmission).resolves.toBe(true);
    await expect(controller.submitVideoFrame(video, 300)).resolves.toBe(false);
    expect(createBitmap).toHaveBeenCalledOnce();

    worker.emit(resultMessage(100));
    await expect(controller.submitVideoFrame(video, 300)).resolves.toBe(true);
    expect(createBitmap).toHaveBeenCalledTimes(2);
    expect(
      worker.messages.filter(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "FRAME",
      ),
    ).toHaveLength(2);
  });

  it("closes a capture that resolves after the controller is disposed", async () => {
    const capture = deferred<ImageBitmap>();
    const frame = fakeImageBitmap();
    installBrowserFakes(vi.fn<FrameCapture>().mockReturnValue(capture.promise));
    const controller = createHandTrackingWorkerController();
    const worker = FakeWorker.instances[0]!;

    const submission = controller.submitVideoFrame(readyVideo(), 100);
    controller.dispose();
    capture.resolve(frame.bitmap);

    await expect(submission).resolves.toBe(false);
    expect(frame.close).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(
      worker.messages.some(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "FRAME",
      ),
    ).toBe(false);
  });

  it("reports native worker failures once and stops accepting frames", async () => {
    const frame = fakeImageBitmap();
    const onError = vi.fn();
    const onMessage = vi.fn();
    installBrowserFakes(vi.fn<FrameCapture>().mockResolvedValue(frame.bitmap));
    const controller = createHandTrackingWorkerController({
      onError,
      onMessage,
    });
    const worker = FakeWorker.instances[0]!;

    await expect(controller.submitVideoFrame(readyVideo(), 100)).resolves.toBe(
      true,
    );
    worker.emitNativeError();
    worker.emitNativeMessageError();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith({
      message: "The local hand worker failed to load or process a frame.",
      phase: "inference",
      type: "ERROR",
    });
    expect(onMessage).toHaveBeenCalledOnce();
    expect(worker.preventDefault).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(controller.submitVideoFrame(readyVideo(), 200)).resolves.toBe(
      false,
    );
  });
});

class FakeWorker {
  static readonly instances: FakeWorker[] = [];

  readonly messages: unknown[] = [];
  onmessage: ((event: MessageEvent<HandWorkerOutboundMessage>) => void) | null =
    null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly preventDefault = vi.fn();
  readonly terminate = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }

  emit(message: HandWorkerOutboundMessage) {
    this.onmessage?.({
      data: message,
    } as MessageEvent<HandWorkerOutboundMessage>);
  }

  emitNativeError() {
    this.onerror?.({
      preventDefault: this.preventDefault,
    } as unknown as ErrorEvent);
  }

  emitNativeMessageError() {
    this.onmessageerror?.({} as MessageEvent);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
  }
}

function installBrowserFakes(createBitmap: FrameCapture) {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("HTMLMediaElement", { HAVE_CURRENT_DATA: 2 });
  vi.stubGlobal("createImageBitmap", createBitmap);
}

function readyVideo(): HTMLVideoElement {
  return {
    readyState: 2,
    videoHeight: 360,
    videoWidth: 640,
  } as HTMLVideoElement;
}

function fakeImageBitmap(): {
  bitmap: ImageBitmap;
  close: ReturnType<typeof vi.fn>;
} {
  const close = vi.fn();
  return {
    bitmap: { close } as unknown as ImageBitmap,
    close,
  };
}

function resultMessage(timestampMs: number): HandWorkerOutboundMessage {
  return {
    hands: [],
    height: 180,
    inferenceMs: 1,
    timestampMs,
    type: "RESULT",
    width: 320,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
