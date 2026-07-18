import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showDirectoryPicker");
  });
  await page.goto("/studio");
});

test("standard multi-file fallback previews metadata without transport or body disclosure", async ({
  page,
}) => {
  const noteBodyMarker = "PRIVATE_BROWSER_BODY_MARKER";
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  const input = page.locator("#studio-files");
  await expect(input).toHaveAttribute("multiple", "");
  await input.setInputFiles([
    {
      name: "zeta.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`${noteBodyMarker} zeta`),
    },
    {
      name: "alpha.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(`# Alpha\n${noteBodyMarker}`),
    },
  ]);

  const previewTitle = page.getByRole("heading", {
    name: "Review before continuing",
  });
  await expect(previewTitle).toBeFocused();
  await expect(page.getByRole("status")).toContainText(
    "2 accepted, 0 excluded",
  );
  await expect(page.locator(".studio-file-list strong")).toHaveText([
    "alpha.md",
    "zeta.txt",
  ]);
  await expect(page.getByText(noteBodyMarker)).toHaveCount(0);
  expect(requests).toEqual([]);

  await page
    .getByRole("button", { name: "Continue to graph generation" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "2 notes confirmed in memory",
  );
  expect(requests).toEqual([]);
});

test("folder-shaped drop keeps relative paths ordered and reports exclusions", async ({
  page,
}) => {
  await page.locator(".studio-dropzone").evaluate((dropzone) => {
    const transfer = new DataTransfer();
    const add = (
      name: string,
      relativePath: string,
      body: string,
      type: string,
    ) => {
      const file = new File([body], name, {
        type,
        lastModified: 1_784_377_800_000,
      });
      Object.defineProperty(file, "webkitRelativePath", {
        value: relativePath,
      });
      transfer.items.add(file);
    };
    add("zeta.txt", "zeta/zeta.txt", "Zeta", "text/plain");
    add("origin.md", "alpha/origin.md", "# Origin", "text/markdown");
    add("AGENTS.md", "alpha/AGENTS.md", "Agent instructions", "text/markdown");
    add("photo.png", "alpha/photo.png", "not supported", "image/png");
    dropzone.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  });

  await expect(page.getByRole("status")).toContainText(
    "2 accepted, 2 excluded",
  );
  await expect(
    page.locator(".studio-file-list").first().locator("strong"),
  ).toHaveText(["alpha/origin.md", "zeta/zeta.txt"]);
  await expect(
    page.getByText("Excluded by the public pipeline corpus rules."),
  ).toBeVisible();
  await expect(
    page.getByText("Only .md, .markdown, and .txt files are supported."),
  ).toBeVisible();
});

test("duplicate and unsafe paths are actionable, removal revalidates, and clear restores focus", async ({
  page,
}) => {
  await page.locator(".studio-dropzone").evaluate((dropzone) => {
    const transfer = new DataTransfer();
    const paths = ["notes/Origin.md", "notes/origin.md", "../private.md"];
    for (const [index, path] of paths.entries()) {
      const name = path.split("/").at(-1) ?? `note-${index}.md`;
      const file = new File([`Note ${index}`], name, { type: "text/markdown" });
      Object.defineProperty(file, "webkitRelativePath", { value: path });
      transfer.items.add(file);
    }
    dropzone.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  });

  await expect(page.getByRole("status")).toContainText(
    "0 accepted, 3 excluded",
  );
  await expect(page.getByText(/same relative path ignoring case/)).toHaveCount(
    2,
  );
  await expect(
    page.getByText(/Path cannot contain empty, dot, traversal/),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Remove notes/Origin.md", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "1 accepted, 1 excluded",
  );
  await expect(
    page.getByText("notes/origin.md", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(
    page.getByRole("button", { name: "Choose files" }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Review before continuing" }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Selection cleared");
});

test("sample navigation releases intake state", async ({ page }) => {
  await page.locator("#studio-files").setInputFiles({
    name: "temporary.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Temporary\nThis selection should be released."),
  });
  await expect(page.getByRole("status")).toContainText("1 accepted");

  await page
    .getByRole("link", { name: "Explore the fictional sample instead" })
    .click();
  await expect(page).toHaveURL(/\/demo\/?\?input=mouse$/);
  await page.goBack();

  await expect(page).toHaveURL(/\/studio\/?$/);
  await expect(
    page.getByRole("heading", { name: "Review before continuing" }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "No personal files selected",
  );
});
