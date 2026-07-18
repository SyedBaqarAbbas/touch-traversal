const publicBasePath = normalizePublicBasePath(
  process.env.NEXT_PUBLIC_BASE_PATH,
);

export const PUBLIC_BASE_PATH = publicBasePath;

export function normalizePublicBasePath(value: string | undefined): string {
  const candidate = value?.trim() ?? "";
  if (candidate === "" || candidate === "/") {
    return "";
  }

  const normalized = `/${candidate.replace(/^\/+|\/+$/g, "")}`;
  if (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(normalized)) {
    throw new Error(
      `NEXT_PUBLIC_BASE_PATH must be an absolute URL path without a trailing slash: ${candidate}`,
    );
  }
  return normalized;
}

export function publicAssetUrl(
  path: string,
  basePath: string = PUBLIC_BASE_PATH,
): string {
  const normalizedPath = `/${path.replace(/^\/+/, "")}`;
  if (
    normalizedPath === "/" ||
    normalizedPath.includes("?") ||
    normalizedPath.includes("#") ||
    normalizedPath.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(
      `public asset path must identify a local static file: ${path}`,
    );
  }
  return `${normalizePublicBasePath(basePath)}${normalizedPath}`;
}
