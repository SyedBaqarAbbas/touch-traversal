import type { Metadata } from "next";

import { RoutePlaceholder } from "@/app/_components/route-placeholder";

export const metadata: Metadata = {
  title: "Calibration",
};

export default function CalibrationPage() {
  return (
    <RoutePlaceholder
      eyebrow="calibration"
      title="Camera calibration comes later."
      description="The eventual flow will verify permission, fingertip motion, and pinch thresholds while keeping every frame on this device."
      status="camera inactive"
    />
  );
}
