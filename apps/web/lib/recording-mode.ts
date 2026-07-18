import type { LayoutName } from "@/lib/artifacts/schema";

export const RECORDING_MODE_DURATION_MS = 25_000;
export const RECORDING_MODE_AUDIO_ENABLED = false;

export type RecordingBeatName =
  | "reveal"
  | "hand-acquisition"
  | "select"
  | "traverse"
  | "topology-morph"
  | "closing";

export type RecordingBeat = {
  atMs: number;
  label: string;
  name: RecordingBeatName;
};

export const recordingBeats: readonly RecordingBeat[] = [
  { atMs: 0, label: "constellation / reveal", name: "reveal" },
  {
    atMs: 3_200,
    label: "hand / acquiring locally",
    name: "hand-acquisition",
  },
  { atMs: 6_000, label: "gesture / select", name: "select" },
  { atMs: 11_000, label: "gesture / traverse", name: "traverse" },
  {
    atMs: 16_000,
    label: "topology / communities",
    name: "topology-morph",
  },
  { atMs: 22_000, label: "thoughts remain connected", name: "closing" },
] as const;

export const recordingModeTopology: LayoutName = "clusters";

export function recordingBeatAt(elapsedMs: number): RecordingBeat {
  const boundedElapsed = Math.max(0, elapsedMs);
  let activeBeat = recordingBeats[0];
  for (const beat of recordingBeats) {
    if (beat.atMs > boundedElapsed) {
      break;
    }
    activeBeat = beat;
  }
  return activeBeat;
}

export function recordingModeEnabled(search: string): boolean {
  const value = new URLSearchParams(search).get("recording");
  return value === "1" || value === "true";
}
