import Link from "next/link";

type RoutePlaceholderProps = {
  eyebrow: string;
  title: string;
  description: string;
  status: string;
};

const routes = [
  { href: "/", label: "home" },
  { href: "/demo", label: "demo" },
  { href: "/perform", label: "perform" },
  { href: "/studio", label: "studio" },
  { href: "/calibration", label: "calibration" },
  { href: "/debug", label: "debug" },
] as const;

export function RoutePlaceholder({
  eyebrow,
  title,
  description,
  status,
}: RoutePlaceholderProps) {
  return (
    <main className="route-shell">
      <div className="constellation" aria-hidden="true">
        <span className="constellation__line constellation__line--one" />
        <span className="constellation__line constellation__line--two" />
        <span className="constellation__node constellation__node--one" />
        <span className="constellation__node constellation__node--two" />
        <span className="constellation__node constellation__node--three" />
      </div>

      <header className="route-shell__header">
        <Link className="wordmark" href="/">
          touch traversal
        </Link>
        <p className="mode-label">foundation / {eyebrow}</p>
      </header>

      <section className="route-shell__content" aria-labelledby="route-title">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="route-title">{title}</h1>
        <p className="description">{description}</p>
        <p className="status">
          <span className="status__dot" aria-hidden="true" />
          {status}
        </p>
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
