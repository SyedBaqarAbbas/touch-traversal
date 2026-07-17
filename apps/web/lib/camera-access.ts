export const cameraAccessStatuses = [
  "idle",
  "requesting",
  "active",
  "denied",
  "error",
  "unsupported",
  "disabled",
] as const;

export type CameraAccessStatus = (typeof cameraAccessStatuses)[number];

export type CameraAccessState = {
  errorMessage: string | null;
  status: CameraAccessStatus;
};

export type CameraAccessEvent =
  | { type: "REQUEST" }
  | { type: "ACTIVE" }
  | { type: "DENIED"; message?: string }
  | { type: "ERROR"; message?: string }
  | { type: "UNSUPPORTED" }
  | { type: "DISABLE" }
  | { type: "RESET" };

export type CameraAccessCopy = {
  actionLabel: string | null;
  description: string;
  statusLabel: string;
  title: string;
};

export const initialCameraAccessState: CameraAccessState = {
  errorMessage: null,
  status: "idle",
};

export function reduceCameraAccess(
  state: CameraAccessState,
  event: CameraAccessEvent,
): CameraAccessState {
  switch (event.type) {
    case "REQUEST":
      return { errorMessage: null, status: "requesting" };
    case "ACTIVE":
      return { errorMessage: null, status: "active" };
    case "DENIED":
      return {
        errorMessage:
          event.message ??
          "Camera permission was denied or dismissed. Mouse and keyboard remain available.",
        status: "denied",
      };
    case "ERROR":
      return {
        errorMessage:
          event.message ??
          "The camera could not start. Mouse and keyboard remain available.",
        status: "error",
      };
    case "UNSUPPORTED":
      return {
        errorMessage:
          "This browser does not expose local camera access on this page.",
        status: "unsupported",
      };
    case "DISABLE":
      return { errorMessage: null, status: "disabled" };
    case "RESET":
      return initialCameraAccessState;
  }
}

export function cameraAccessCopy(state: CameraAccessState): CameraAccessCopy {
  const handModelUnavailable = state.errorMessage
    ?.toLowerCase()
    .includes("hand model");

  switch (state.status) {
    case "requesting":
      return {
        actionLabel: null,
        description:
          "The browser prompt is open. Frames remain local and are not uploaded.",
        statusLabel: "camera requesting",
        title: "Waiting for camera permission",
      };
    case "active":
      return {
        actionLabel: "Disable camera",
        description:
          "Camera is active for local hand tracking. Frames remain local and are not uploaded.",
        statusLabel: "camera active / local only",
        title: "Hand camera active",
      };
    case "denied":
      return {
        actionLabel: "Retry camera",
        description:
          state.errorMessage ??
          "Camera access is unavailable. Mouse and keyboard remain active.",
        statusLabel: "camera unavailable",
        title: "Camera access unavailable",
      };
    case "error":
      return {
        actionLabel: "Retry camera",
        description:
          state.errorMessage ??
          "The camera could not start. Mouse and keyboard remain active.",
        statusLabel: handModelUnavailable
          ? "hand model unavailable"
          : "camera error",
        title: handModelUnavailable
          ? "Hand tracking unavailable"
          : "Camera failed to start",
      };
    case "unsupported":
      return {
        actionLabel: null,
        description:
          state.errorMessage ??
          "This browser does not support local camera access here. Mouse and keyboard remain active.",
        statusLabel: "camera unsupported",
        title: "Camera unavailable",
      };
    case "disabled":
      return {
        actionLabel: "Enable hand camera",
        description:
          "Hand input is disabled. Enable it only when you want local webcam-based control.",
        statusLabel: "camera disabled",
        title: "Hand camera disabled",
      };
    case "idle":
      return {
        actionLabel: "Enable hand camera",
        description:
          "Hand input needs camera access to estimate a fingertip cursor. Frames remain local and are not uploaded.",
        statusLabel: "camera inactive",
        title: "Optional hand input",
      };
  }
}

export function classifyCameraAccessError(error: unknown): CameraAccessEvent {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return {
      message:
        "Camera permission was denied or dismissed. Mouse and keyboard remain available.",
      type: "DENIED",
    };
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return {
      message: "No camera was found. Mouse and keyboard remain available.",
      type: "ERROR",
    };
  }
  if (error instanceof Error) {
    return {
      message: `Camera startup failed: ${error.message}. Mouse and keyboard remain available.`,
      type: "ERROR",
    };
  }
  return { type: "ERROR" };
}
