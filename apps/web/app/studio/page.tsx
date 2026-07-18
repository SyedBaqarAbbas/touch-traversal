import type { Metadata } from "next";

import { StudioIntake } from "@/app/_components/studio-intake";

export const metadata: Metadata = {
  title: "Studio intake",
  description:
    "Privately preview local Markdown and text notes before building a personal graph.",
};

export default function StudioPage() {
  return <StudioIntake />;
}
