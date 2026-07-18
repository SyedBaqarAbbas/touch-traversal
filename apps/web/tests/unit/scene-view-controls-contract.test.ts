import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "app/_components/scene-view-controls.tsx"),
  "utf8",
);

describe("scene view control accessibility contract", () => {
  it("exposes every manipulation and reset action as a real named button", () => {
    expect(source).toContain('aria-label="View manipulation"');
    for (const label of [
      "Orbit view left",
      "Orbit view right",
      "Pan view left",
      "Pan view up",
      "Pan view down",
      "Pan view right",
      "Zoom view in",
      "Zoom view out",
      "Reset view",
    ]) {
      expect(source).toContain(`label: "${label}"`);
    }
    expect(source).toContain('type="button"');
    expect(source).toContain("isEditableKeyboardTarget(event.target)");
  });
});
