import type { Metadata } from "next";

import { RoutePlaceholder } from "@/app/_components/route-placeholder";

export const metadata: Metadata = {
  title: "Demo",
};

export default function DemoPage() {
  return (
    <RoutePlaceholder
      eyebrow="demo"
      title="The graph will emerge here."
      description="This route is reserved for the polished, mouse-first constellation before hand tracking is introduced."
      status="scene not implemented"
    />
  );
}
