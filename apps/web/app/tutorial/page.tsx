import type { Metadata } from "next";
import { TutorialExperience } from "@/app/_components/tutorial-experience";

export const metadata: Metadata = {
  title: "Tutorial",
  description: "A local, resumable orientation to Touch Traversal.",
};
export default function TutorialPage() {
  return <TutorialExperience />;
}
