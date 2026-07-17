import type { Metadata } from "next";

import { RoutePlaceholder } from "@/app/_components/route-placeholder";

export const metadata: Metadata = {
  title: "Debug",
};

export default function DebugPage() {
  return (
    <RoutePlaceholder
      eyebrow="debug"
      title="Graph diagnostics will live here."
      description="Pipeline statistics, relation evidence, performance measurements, and hand landmarks will remain separate from the cinematic experience."
      status="diagnostics unavailable"
    />
  );
}
