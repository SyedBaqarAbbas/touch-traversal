import type { Metadata } from "next";
import Link from "next/link";

import graph from "@/public/data/graph.json";
import report from "@/public/data/pipeline-report.json";

export const metadata: Metadata = {
  title: "Debug",
};

const routes = [
  { href: "/", label: "home" },
  { href: "/demo", label: "demo" },
  { href: "/calibration", label: "calibration" },
  { href: "/debug", label: "debug" },
] as const;

const edgeEntries = Object.entries(report.edgeCounts).filter(
  ([, count]) => count > 0,
);

const firstNode = graph.nodes[0] ?? null;

export default function DebugPage() {
  return (
    <main className="debug-shell">
      <header className="debug-header">
        <Link className="wordmark" href="/">
          touch traversal
        </Link>
        <p className="mode-label">foundation / debug</p>
      </header>

      <section className="debug-hero" aria-labelledby="debug-title">
        <p className="eyebrow">debug</p>
        <h1 id="debug-title">Graph diagnostics</h1>
        <p className="description">
          Pipeline output, relation counts, and raw node payloads stay visible
          here while the demo route remains focused on traversal.
        </p>
      </section>

      <section className="debug-grid" aria-label="Pipeline summary">
        <article className="debug-stat">
          <span>nodes</span>
          <strong>{report.nodeCount}</strong>
        </article>
        <article className="debug-stat">
          <span>edges</span>
          <strong>{report.edgeCount}</strong>
        </article>
        <article className="debug-stat">
          <span>avg degree</span>
          <strong>{report.averageDegree.toFixed(2)}</strong>
        </article>
        <article className="debug-stat">
          <span>clusters</span>
          <strong>{report.clusterCount}</strong>
        </article>
      </section>

      <section className="debug-panels" aria-label="Artifact details">
        <article className="debug-panel">
          <h2>Edge types</h2>
          <dl className="debug-edge-list">
            {edgeEntries.map(([type, count]) => (
              <div key={type}>
                <dt>{type}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
        </article>

        <article className="debug-panel debug-panel--wide">
          <h2>Raw node</h2>
          <pre>{JSON.stringify(firstNode, null, 2)}</pre>
        </article>
      </section>

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
