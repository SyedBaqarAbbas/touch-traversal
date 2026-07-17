import type { LayoutName } from "@/lib/artifacts/schema";

export type TopologyMode = {
  description: string;
  key: "1" | "2" | "3" | "4";
  label: string;
  layoutName: LayoutName;
  title: string;
};

export const topologyModes: readonly TopologyMode[] = [
  {
    description: "semantic similarity",
    key: "1",
    label: "semantic",
    layoutName: "semantic",
    title: "semantic topology",
  },
  {
    description: "cluster islands",
    key: "2",
    label: "communities",
    layoutName: "clusters",
    title: "community topology",
  },
  {
    description: "dated sequence",
    key: "3",
    label: "temporal",
    layoutName: "temporal",
    title: "temporal topology",
  },
  {
    description: "settled force map",
    key: "4",
    label: "force",
    layoutName: "force",
    title: "force topology",
  },
] as const;

export const topologyModesByLayout = Object.fromEntries(
  topologyModes.map((mode) => [mode.layoutName, mode]),
) as Record<LayoutName, TopologyMode>;

export function topologyLayoutForKey(
  event: Pick<
    KeyboardEvent,
    "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
): LayoutName | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }

  const key = event.key === " " ? event.code : event.key;
  return (
    topologyModes.find((mode) => key === mode.key || key === `Digit${mode.key}`)
      ?.layoutName ?? null
  );
}

export function isTopologyAvailable(
  layoutName: LayoutName,
  temporalAvailable: boolean,
): boolean {
  return layoutName !== "temporal" || temporalAvailable;
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (
    typeof HTMLElement === "undefined" ||
    typeof HTMLInputElement === "undefined" ||
    typeof HTMLTextAreaElement === "undefined" ||
    typeof HTMLSelectElement === "undefined"
  ) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
