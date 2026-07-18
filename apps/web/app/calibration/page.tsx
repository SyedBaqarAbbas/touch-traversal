import type { Metadata } from "next";
import Link from "next/link";

import { HandCalibrationPanel } from "@/app/_components/hand-calibration-panel";
import { HelpTutorialLinks } from "@/app/_components/tutorial-links";
import { TutorialCoach } from "@/app/_components/tutorial-coach";

export const metadata: Metadata = {
  title: "Calibration",
};

const routes = [
  { href: "/", label: "home" },
  { href: "/demo", label: "demo" },
  { href: "/perform", label: "perform" },
  { href: "/studio", label: "studio" },
  { href: "/calibration", label: "calibration" },
  { href: "/debug", label: "debug" },
] as const;

export default function CalibrationPage() {
  return (
    <main className="calibration-shell">
      <HelpTutorialLinks />
      <header className="debug-header">
        <Link className="wordmark" href="/">
          touch traversal
        </Link>
        <p className="mode-label">hand / calibration</p>
      </header>

      <section className="debug-hero" aria-labelledby="calibration-title">
        <p className="eyebrow">calibration</p>
        <h1 id="calibration-title">Calibrate hand traversal.</h1>
        <p className="description">
          Verify framing and thresholds, then rehearse point, pinch, open-palm
          return, horizontal sweep, orbit, pan, depth zoom, and release with the
          production recognizers.
        </p>
      </section>

      <HandCalibrationPanel mode="calibration" />
      <TutorialCoach context="calibration" />

      <nav className="route-shell__nav" aria-label="Prototype routes">
        {routes.map((route) => (
          <Link href={route.href} key={route.href}>
            {route.label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
