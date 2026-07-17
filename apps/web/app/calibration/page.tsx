import type { Metadata } from "next";
import Link from "next/link";

import { HandCalibrationPanel } from "@/app/_components/hand-calibration-panel";

export const metadata: Metadata = {
  title: "Calibration",
};

const routes = [
  { href: "/", label: "home" },
  { href: "/demo", label: "demo" },
  { href: "/calibration", label: "calibration" },
  { href: "/debug", label: "debug" },
] as const;

export default function CalibrationPage() {
  return (
    <main className="calibration-shell">
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
          Verify camera permission, mirrored fingertip motion, and pinch
          thresholds before using hand input in the graph demo.
        </p>
      </section>

      <HandCalibrationPanel mode="calibration" />

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
