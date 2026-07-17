import type { Metadata } from "next";

import { ArtifactBoundary } from "@/app/_components/artifact-boundary";

export const metadata: Metadata = {
  title: "Demo",
};

export default function DemoPage() {
  return <ArtifactBoundary />;
}
