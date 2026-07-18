import type { HandCursorFrame } from "@/lib/hand-cursor";
import { performanceRecordingOutputSize } from "@/lib/performance-recording";

export type PerformanceRecordingOverlay = {
  cameraMode: string;
  edgeCount: number;
  interactionMode: string;
  nodeCount: number;
  selectedTitle: string | null;
  topologyLabel: string;
  topologyTitle: string;
  traversalLabel: string | null;
};

export type PerformanceRecordingPresentation = {
  cursorFrame: HandCursorFrame | null;
  layerVisible: boolean;
  mirrored: boolean;
  videoOpacity: number;
};

export type PerformanceCompositor = {
  canvas: HTMLCanvasElement;
  start: () => void;
  stop: () => void;
  stream: MediaStream;
};

export function createPerformanceCompositor(input: {
  fixture: boolean;
  graphCanvas: HTMLCanvasElement;
  onError: (message: string) => void;
  overlay: () => PerformanceRecordingOverlay;
  presentation: () => PerformanceRecordingPresentation;
  sourceHeight: number;
  sourceWidth: number;
  video: HTMLVideoElement;
}): PerformanceCompositor {
  const canvas = document.createElement("canvas");
  const size = performanceRecordingOutputSize({
    height: input.sourceHeight,
    width: input.sourceWidth,
  });
  canvas.height = size.height;
  canvas.width = size.width;
  canvas.dataset.performanceRecordingComposition = "webcam-graph-overlays";
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("A 2D composition canvas is unavailable.");
  }
  if (typeof canvas.captureStream !== "function") {
    throw new Error("Canvas stream capture is unavailable.");
  }
  const stream = canvas.captureStream(30);
  let frameId: number | null = null;
  let stopped = false;

  const drawFrame = () => {
    if (stopped) return;
    try {
      drawPerformanceComposition(context, canvas, input);
    } catch (error: unknown) {
      stopped = true;
      input.onError(
        error instanceof Error ? error.message : "Composition failed.",
      );
      return;
    }
    frameId = window.requestAnimationFrame(drawFrame);
  };

  return {
    canvas,
    start: () => {
      if (stopped || frameId != null) return;
      drawFrame();
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (frameId != null) window.cancelAnimationFrame(frameId);
      frameId = null;
      stream.getTracks().forEach((track) => track.stop());
      canvas.height = 2;
      canvas.width = 2;
    },
    stream,
  };
}

function drawPerformanceComposition(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  input: Parameters<typeof createPerformanceCompositor>[0],
) {
  const width = canvas.width;
  const height = canvas.height;
  const presentation = input.presentation();
  context.save();
  context.fillStyle = "#050505";
  context.fillRect(0, 0, width, height);

  if (presentation.layerVisible) {
    context.globalAlpha = presentation.videoOpacity;
    if (input.fixture) {
      drawCameraFixture(context, width, height, presentation.mirrored);
    } else {
      drawVideoCover(
        context,
        input.video,
        width,
        height,
        presentation.mirrored,
      );
    }
    context.globalAlpha = 1;
  }

  context.drawImage(input.graphCanvas, 0, 0, width, height);
  drawContrast(context, width, height);
  drawAuthoredOverlay(context, width, height, input.overlay());
  drawCursor(context, width, height, presentation.cursorFrame);
  context.restore();
}

function drawVideoCover(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  mirrored: boolean,
) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    throw new Error("Camera video is not ready to record.");
  }
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Camera video has no recordable frame.");
  }
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = width / height;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;
  if (sourceAspect > targetAspect) {
    sw = sourceHeight * targetAspect;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / targetAspect;
    sy = (sourceHeight - sh) / 2;
  }
  context.save();
  if (mirrored) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  context.restore();
}

function drawCameraFixture(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mirrored: boolean,
) {
  context.save();
  if (mirrored) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  const backdrop = context.createLinearGradient(0, 0, width, height);
  backdrop.addColorStop(0, "#0c0b0e");
  backdrop.addColorStop(0.52, "#38343a");
  backdrop.addColorStop(1, "#17161a");
  context.fillStyle = backdrop;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(169, 158, 154, 0.46)";
  context.beginPath();
  context.arc(width * 0.5, height * 0.39, height * 0.08, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(12, 11, 14, 0.62)";
  context.beginPath();
  context.ellipse(
    width * 0.5,
    height * 0.93,
    width * 0.25,
    height * 0.47,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.restore();
}

function drawContrast(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "rgba(5,5,5,0.62)");
  gradient.addColorStop(0.36, "rgba(5,5,5,0.04)");
  gradient.addColorStop(0.7, "rgba(5,5,5,0.04)");
  gradient.addColorStop(1, "rgba(5,5,5,0.48)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawAuthoredOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay: PerformanceRecordingOverlay,
) {
  const inset = Math.max(24, width * 0.03);
  context.fillStyle = "rgba(242,240,234,0.92)";
  context.font = `${Math.max(11, width * 0.009)}px ui-monospace, monospace`;
  context.textBaseline = "top";
  context.fillText("touch traversal / live performance", inset, inset);
  context.fillText(
    `${overlay.interactionMode.toLowerCase()} / ${overlay.cameraMode}`,
    inset,
    inset + 22,
  );

  context.textAlign = "right";
  context.fillText("topologies of thoughts", width - inset, inset);
  context.font = `600 ${Math.max(24, width * 0.027)}px system-ui, sans-serif`;
  context.fillText(overlay.topologyTitle, width - inset, inset + 24);
  context.font = `${Math.max(11, width * 0.009)}px ui-monospace, monospace`;
  context.fillStyle = "rgba(242,240,234,0.72)";
  context.fillText(
    `${overlay.topologyLabel} · ${overlay.nodeCount} nodes · ${overlay.edgeCount} edges`,
    width - inset,
    inset + 64,
  );

  context.textAlign = "left";
  const lowerCopy = overlay.traversalLabel ?? overlay.selectedTitle;
  if (lowerCopy) {
    context.fillStyle = "rgba(5,5,5,0.72)";
    context.fillRect(inset - 10, height - inset - 48, width * 0.48, 48);
    context.fillStyle = "rgba(242,240,234,0.9)";
    context.fillText(
      overlay.traversalLabel ? "traversal" : "selected thought",
      inset,
      height - inset - 39,
    );
    context.fillText(lowerCopy, inset, height - inset - 20);
  }
}

function drawCursor(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  cursor: HandCursorFrame | null,
) {
  if (!cursor?.visible) return;
  const x = ((cursor.position.x + 1) / 2) * width;
  const y = ((1 - cursor.position.y) / 2) * height;
  const radius = Math.max(8, width * 0.009);
  context.strokeStyle = `rgba(255,253,246,${Math.max(0.3, cursor.confidence)})`;
  context.lineWidth = Math.max(1, width * 0.0012);
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "rgba(255,253,246,0.88)";
  context.beginPath();
  context.arc(x, y, radius * 0.2, 0, Math.PI * 2);
  context.fill();
}
