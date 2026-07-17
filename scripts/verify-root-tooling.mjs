import { readFileSync } from "node:fs";

const failures = [];

const read = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    failures.push(`${path}: ${error.message}`);
    return "";
  }
};

const expectIncludes = (path, content, expected) => {
  if (!content.includes(expected)) {
    failures.push(`${path}: expected to include ${JSON.stringify(expected)}`);
  }
};

const packageJsonText = read("package.json");
let packageJson = {};

try {
  packageJson = JSON.parse(packageJsonText);
} catch (error) {
  failures.push(`package.json: ${error.message}`);
}

if (packageJson.private !== true) {
  failures.push("package.json: the workspace root must remain private");
}

if (packageJson.packageManager !== "pnpm@10.14.0") {
  failures.push("package.json: packageManager must pin pnpm@10.14.0");
}

for (const script of [
  "dev",
  "build",
  "test",
  "test:e2e",
  "lint",
  "typecheck",
  "format",
  "format:check",
]) {
  if (!packageJson.scripts?.[script]) {
    failures.push(`package.json: missing ${script} script`);
  }
}

const workspace = read("pnpm-workspace.yaml");
expectIncludes("pnpm-workspace.yaml", workspace, '  - "apps/*"');

const makefile = read("Makefile");
expectIncludes(
  "Makefile",
  makefile,
  "install --frozen-lockfile --optimistic-repeat-install",
);
for (const target of [
  "install",
  "dev",
  "build-graph",
  "test",
  "test-e2e",
  "lint",
  "format",
  "format-check",
]) {
  expectIncludes("Makefile", makefile, `${target}:`);
}

const editorConfig = read(".editorconfig");
expectIncludes(".editorconfig", editorConfig, "root = true");
expectIncludes(".editorconfig", editorConfig, "end_of_line = lf");

const gitAttributes = read(".gitattributes");
expectIncludes(".gitattributes", gitAttributes, "* text=auto eol=lf");

const gitignore = read(".gitignore");
for (const ignored of [
  "node_modules/",
  ".next/",
  "private-notes/",
  "pipeline/.cache/",
  "apps/web/public/data/private-*",
]) {
  expectIncludes(".gitignore", gitignore, ignored);
}

if (read(".nvmrc").trim() !== "22") {
  failures.push(".nvmrc: expected Node.js major version 22");
}

if (read(".python-version").trim() !== "3.11") {
  failures.push(".python-version: expected Python 3.11");
}

if (failures.length > 0) {
  console.error("Root tooling verification failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Root tooling verification passed.");
