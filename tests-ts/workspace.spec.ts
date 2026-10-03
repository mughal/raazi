import { test, expect } from "@playwright/test";
import { policyPDF, policyDOCX } from "./fixtures";
test("React workspace: settings, real uploads, citations, folders, persisted chat and draft", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  await expect(
    page.getByRole("heading", { name: /How can I help/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .last()
    .click();
  await page.getByLabel("Model base URL").fill("http://fixture.test/v1");
  await page.getByLabel("Model name", { exact: true }).fill("fixture-model");
  await page.getByRole("button", { name: "Save model settings" }).click();
  await expect(page.getByRole("status")).toContainText("Model settings saved");
  await page.getByRole("tab", { name: "Storage" }).click();
  await page.getByLabel("Enable file uploads").check();
  await page.getByLabel("S3 endpoint").fill("http://s3.test");
  await page.getByLabel("S3 bucket").fill("test-bucket");
  await page.getByLabel("S3 access key").fill("test-access");
  await page.getByLabel("S3 secret key").fill("test-secret");
  await page.getByRole("button", { name: "Test bucket" }).click();
  await expect(
    page.getByText(
      "Bucket test passed. Access, write, read, and delete are available.",
    ),
  ).toBeVisible();
  await page.screenshot({ path: "data/react-storage.png", fullPage: true });
  await page.getByRole("button", { name: "Save storage settings" }).click();
  await expect(page.getByRole("status")).toContainText("Uploads are available");
  await page.getByRole("tab", { name: "Embeddings" }).click();
  await page.getByLabel("Use an embedding model").check();
  await page.getByLabel("Embedding base URL").fill("http://fixture.test/v1");
  await page
    .getByLabel("Embedding model", { exact: true })
    .fill("fixture-embedding");
  await page.getByLabel("Vector dimensions").fill("3");
  await page.getByRole("button", { name: "Save embedding settings" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Embedding settings saved",
  );
  await page.getByRole("tab", { name: "Knowledge", exact: true }).click();
  await page.getByLabel("Repository name").fill("Policies");
  await page.getByRole("button", { name: "Create repository" }).click();
  await expect(page.getByRole("status")).toContainText("Repository created");
  await page
    .getByLabel("Upload repository")
    .selectOption({ label: "Policies" });
  await page.getByLabel("Document file").setInputFiles({
    name: "policy.pdf",
    mimeType: "application/pdf",
    buffer: await policyPDF(),
  });
  await page.getByRole("button", { name: "Upload and index" }).click();
  await expect(page.getByText("ready", { exact: true })).toBeVisible();
  await page
    .getByLabel("Upload repository")
    .selectOption({ label: "Policies" });
  await page.getByLabel("Document file").setInputFiles({
    name: "travel.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: policyDOCX(),
  });
  await page.getByRole("button", { name: "Upload and index" }).click();
  await expect(page.getByText("ready", { exact: true })).toHaveCount(2);
  await page
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  await page.getByLabel("Folder name").fill("Finance");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "New chat in folder" }).click();
  await page
    .getByLabel("Message Raazi")
    .fill("Travel expenses manager approval");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toBeVisible();
  const citation = page.locator(".citation").first();
  await expect(citation).toHaveAttribute("href", /\/sources\/[a-f0-9]{32}/);
  const popupPromise = context.waitForEvent("page");
  await citation.click();
  const source = await popupPromise;
  await source.waitForLoadState();
  await expect(
    source.getByRole("heading", { name: "policy.pdf" }),
  ).toBeVisible();
  await expect(
    source.getByRole("link", { name: "Open original PDF at page 2" }),
  ).toHaveAttribute("href", /#page=2$/);
  await expect(source.locator("#source-excerpt")).toContainText(
    "Travel expenses",
  );
  await source.close();
  await page
    .getByRole("button", { name: "Manage conversation", exact: true })
    .click();
  await page.getByLabel("Chat title").fill("Travel approvals");
  await page.getByLabel("Pin this chat").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByLabel("Message Raazi").fill("Keep this draft");
  await page.getByRole("button", { name: "Your profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Your profile", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.getByLabel("Message Raazi")).toHaveValue("Keep this draft");
  await page.getByLabel("Search chats").fill("Travel approvals");
  await expect(page.locator(".chat-link")).toHaveCount(2);
  await page.getByLabel("Search chats").fill("");
  await page.reload();
  await page
    .getByRole("button", { name: "Travel approvals", exact: true })
    .first()
    .click();
  await expect(page.locator(".message.assistant")).toBeVisible();
  await expect(page.locator(".citation").first()).toBeVisible();
  await expect(page.locator(".folder-toggle")).toContainText("Finance");
  await page.screenshot({ path: "data/react-workspace.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("mobile drawer and folder collapse persist across reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  await page.getByRole("button", { name: "Open sidebar" }).click();
  const folder = page.locator(".folder-toggle").filter({ hasText: "Finance" });
  await expect(folder).toBeVisible();
  await folder.click();
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator(".layout")).not.toHaveClass(/mobile-open/);
  await page.reload();
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(async () =>
      Math.round((await page.locator(".sidebar").boundingBox())!.x),
    )
    .toBe(48);
  await page.screenshot({ path: "data/react-mobile.png", fullPage: true });
});

test("chat + uploads private PDFs and images, opens page citations, and restores file history", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .last()
    .click();
  await page.getByLabel("This model accepts image input").check();
  await page.getByRole("button", { name: "Save model settings" }).click();
  await expect(page.getByRole("status")).toContainText("Model settings saved");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload files" }).click();
  await (
    await picker
  ).setFiles({
    name: "private-policy.pdf",
    mimeType: "application/pdf",
    buffer: await policyPDF(),
  });
  await expect(page.locator(".composer .attachment-chip")).toContainText(
    "Private knowledge",
  );
  await page
    .getByLabel("Message Raazi")
    .fill("Travel expenses manager approval");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toBeVisible();
  await expect(page.locator(".message.user .attachment-chip")).toContainText(
    "private-policy.pdf",
  );
  const popup = context.waitForEvent("page");
  await page.locator(".citation").first().click();
  const source = await popup;
  await expect(
    source.getByRole("heading", { name: "private-policy.pdf" }),
  ).toBeVisible();
  await expect(
    source.getByRole("link", { name: "Open original PDF at page 2" }),
  ).toHaveAttribute("href", /\/api\/sources\/[a-f0-9]{32}\/file#page=2$/);
  await source.close();
  const sharp = (await import("sharp")).default;
  await page.getByLabel("Choose chat files").setInputFiles({
    name: "diagram.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#006b62" },
    })
      .png()
      .toBuffer(),
  });
  await expect(page.locator(".composer .attachment-chip img")).toBeVisible();
  await expect(page.locator(".composer")).toContainText(
    "Image knowledge indexing is not supported yet",
  );
  await page.getByLabel("Message Raazi").fill("Explain this diagram");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toHaveCount(2);
  await page.reload();
  await page
    .getByRole("button", {
      name: "Travel expenses manager approval",
      exact: true,
    })
    .click();
  await expect(
    page.locator(".message.user .attachment-chip img"),
  ).toBeVisible();
  await page.screenshot({ path: "data/react-uploads.png", fullPage: true });
  await page
    .getByRole("button", { name: "Knowledge", exact: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Your files" })).toBeVisible();
  await expect(page.locator(".your-files")).toContainText("private-policy.pdf");
  await expect(page.locator(".your-files")).toContainText("diagram.png");
  expect(errors).toEqual([]);
});

test("account palettes update the workspace and survive reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  await page.getByRole("button", { name: "Your profile" }).click();
  for (const [label, id] of [
    ["Forest", "forest"],
    ["Ocean", "ocean"],
    ["Indigo", "indigo"],
    ["Plum", "plum"],
    ["Amber", "amber"],
    ["Slate", "slate"],
  ]) {
    await page.getByRole("radio", { name: label, exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute("data-palette", id);
  }
  await page.getByRole("radio", { name: "Ocean", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean");
  await page.screenshot({ path: "data/react-palettes.png", fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: "Your profile" }).click();
  await expect(
    page.getByRole("radio", { name: "Ocean", exact: true }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean");
  await page.route("**/api/preferences", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Cannot save colors." }),
    }),
  );
  await page.getByRole("radio", { name: "Amber", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Cannot save colors.");
  await expect(
    page.getByRole("radio", { name: "Ocean", exact: true }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean");
  await page.unroute("**/api/preferences");
  const accent = await page
    .locator("html")
    .evaluate((e) => getComputedStyle(e).getPropertyValue("--green").trim());
  expect(accent).toBe("#126783");
  expect(errors).toEqual([]);
});
