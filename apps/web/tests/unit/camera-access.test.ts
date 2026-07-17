import { describe, expect, it } from "vitest";

import {
  cameraAccessCopy,
  classifyCameraAccessError,
  initialCameraAccessState,
  reduceCameraAccess,
} from "../../lib/camera-access";

describe("camera access flow", () => {
  it("requests camera only through an explicit state transition", () => {
    const requesting = reduceCameraAccess(initialCameraAccessState, {
      type: "REQUEST",
    });
    const active = reduceCameraAccess(requesting, { type: "ACTIVE" });
    const disabled = reduceCameraAccess(active, { type: "DISABLE" });

    expect(requesting.status).toBe("requesting");
    expect(active.status).toBe("active");
    expect(disabled.status).toBe("disabled");
    expect(cameraAccessCopy(initialCameraAccessState)).toMatchObject({
      actionLabel: "Enable hand camera",
      statusLabel: "camera inactive",
    });
  });

  it("keeps mouse access explicit in denial and retry copy", () => {
    const denied = reduceCameraAccess(initialCameraAccessState, {
      type: "DENIED",
    });
    const copy = cameraAccessCopy(denied);

    expect(copy).toMatchObject({
      actionLabel: "Retry camera",
      statusLabel: "camera unavailable",
    });
    expect(copy.description).toContain("Mouse and keyboard remain available");
  });

  it("classifies browser camera failures without blocking fallback input", () => {
    expect(
      classifyCameraAccessError(new DOMException("blocked", "NotAllowedError")),
    ).toMatchObject({ type: "DENIED" });
    expect(
      classifyCameraAccessError(new DOMException("missing", "NotFoundError")),
    ).toMatchObject({ type: "ERROR" });
    expect(classifyCameraAccessError(new Error("boom"))).toMatchObject({
      message:
        "Camera startup failed: boom. Mouse and keyboard remain available.",
      type: "ERROR",
    });
  });

  it("distinguishes hand-model failure from camera permission failure", () => {
    const failed = reduceCameraAccess(initialCameraAccessState, {
      message:
        "Hand model could not load. Mouse and keyboard remain available.",
      type: "ERROR",
    });

    expect(cameraAccessCopy(failed)).toMatchObject({
      actionLabel: "Retry camera",
      statusLabel: "hand model unavailable",
      title: "Hand tracking unavailable",
    });
    expect(cameraAccessCopy(failed).description).toContain(
      "Mouse and keyboard remain available",
    );
  });

  it("states local-only processing in idle, requesting, and active states", () => {
    const requesting = reduceCameraAccess(initialCameraAccessState, {
      type: "REQUEST",
    });
    const active = reduceCameraAccess(requesting, { type: "ACTIVE" });

    expect(cameraAccessCopy(initialCameraAccessState).description).toContain(
      "Frames remain local and are not uploaded",
    );
    expect(cameraAccessCopy(requesting).description).toContain(
      "Frames remain local and are not uploaded",
    );
    expect(cameraAccessCopy(active).description).toContain(
      "Frames remain local and are not uploaded",
    );
  });
});
