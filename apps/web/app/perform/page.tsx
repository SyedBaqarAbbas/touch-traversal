import type { Metadata } from "next";

import { ArtifactBoundary } from "@/app/_components/artifact-boundary";

export const metadata: Metadata = {
  title: "Performance mode",
};

export default function PerformancePage() {
  return <ArtifactBoundary performanceMode />;
}
