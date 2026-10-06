import { test, expect } from "@playwright/test";
import { policyPDF, policyDOCX } from "./fixtures";
test("admin sessions can end another browser session and all sessions including their own", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  const other = await browser.newContext();
  try {
    const secondPage = await other.newPage();
    await secondPage.goto("http://127.0.0.1:8091");
    await secondPage
      .getByRole("button", { name: "Continue as local administrator" })
      .click();
    const otherSessions = await (
      await other.request.get("http://127.0.0.1:8091/api/admin/sessions")
    ).json();
    const otherId = otherSessions.sessions.find((s: any) => s.current).id;
    await page
      .getByRole("button", { name: "Administration", exact: true })
      .last()
      .click();
    await page.getByRole("tab", { name: "Sessions", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Logged-in users and sessions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: /This session/ }),
    ).toBeVisible();
    await page
      .locator(`[data-session-id="${otherId}"]`)
      .getByRole("button", { name: "End session", exact: true })
      .click();
    await page.getByRole("button", { name: "End now", exact: true }).click();
    await expect(page.locator(`[data-session-id="${otherId}"]`)).toHaveCount(0);
    await secondPage.reload();
    await expect(
      secondPage.getByRole("button", {
        name: "Continue as local administrator",
      }),
    ).toBeVisible();
    await page.screenshot({
      path: "data/react-admin-sessions.png",
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: "End all sessions for Local administrator",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(
        "This includes your current session. You will be signed out.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "End now", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Continue as local administrator" }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});
test("Portal sign-in requires password and authenticator before opening the workspace", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8092");
  await expect(
    page.getByRole("link", { name: "Sign in with your work account" }),
  ).toHaveCount(0);
  await page.getByLabel("Portal username").fill("employee");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Authenticator code")).toBeVisible();
  await page.screenshot({ path: "data/react-portal-otp.png", fullPage: true });
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByLabel("Authenticator code").fill("000000");
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid authenticator code",
  );
  await page.getByLabel("Authenticator code").fill("123456");
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(
    page
      .locator(".sidebar")
      .getByRole("button", { name: "Administration", exact: true }),
  ).toBeVisible();
});
test("composer stays in view on landing and while long demo chats scroll", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.locator(".login").getByRole("img", { name: "SNGPL", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".login img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  await expect(
    page.locator(".sidebar").getByRole("img", { name: "SNGPL", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".demo-notice")).toContainText("sample text only");
  const inView = async () => {
    const box = await page.locator(".composer-dock").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  };
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 600 },
    { width: 1024, height: 576 },
    { width: 768, height: 1024 },
    { width: 390, height: 660 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await inView();
    if (viewport.width >= 1024 && viewport.height >= 576) {
      const cards = (await page.locator(".suggestions").boundingBox())!;
      const dock = (await page.locator(".composer-dock").boundingBox())!;
      expect(cards.y + cards.height).toBeLessThanOrEqual(dock.y);
    }
    if (viewport.width === 1366) {
      await page.screenshot({ path: "data/react-laptop-layout.png" });
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByLabel("Message Raazi").fill("Demo scrolling test");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "End of demo response",
  );
  const scroller = page.getByRole("region", { name: "Chat messages" });
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  const dock = (await page.locator(".composer").boundingBox())!;
  await scroller.hover();
  await page.mouse.wheel(0, -10000);
  await expect
    .poll(() => scroller.evaluate((el) => Math.round(el.scrollTop)))
    .toBe(0);
  await inView();
  expect((await page.locator(".composer").boundingBox())!.y).toBeCloseTo(
    dock.y,
    0,
  );
  await page.screenshot({ path: "data/react-fixed-composer.png" });
  await page.setViewportSize({ width: 390, height: 660 });
  await inView();
  await page.getByLabel("Message Raazi").fill("Second demo message");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toHaveCount(2);
  await inView();
  await page.screenshot({ path: "data/react-fixed-composer-mobile.png" });
  await page.reload();
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await page
    .getByRole("button", { name: "Demo scrolling test", exact: true })
    .click();
  await expect(page.locator(".message.assistant")).toHaveCount(2);
  await inView();
});

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
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    page.getByText(
      "Connection successful: fixture-embedding, 3 dimensions. Settings were not saved.",
    ),
  ).toBeVisible();

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
    .getByLabel("Knowledge repository")
    .selectOption({ label: "Policies" });
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
  await expect(page.locator(".composer .attachment-chip")).toContainText(
    "Ready",
  );
  await expect(page.locator(".composer .attachment-chip")).toHaveCSS(
    "border-top-color",
    "rgb(39, 131, 75)",
  );
  await expect(
    page.getByRole("button", { name: "Upload files" }),
  ).toHaveAttribute("title", /PDF, DOCX, TXT, Markdown/);

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
  for (const [name, id] of [
    ["Mist", "mist"],
    ["Ivory", "ivory"],
    ["Mint", "mint"],
    ["Sky", "sky"],
    ["Lavender", "lavender"],
  ]) {
    await page.getByRole("radio", { name, exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute(
      "data-composer-shade",
      id,
    );
    await expect(page.locator("html")).toHaveAttribute("data-palette", "ocean");
  }
  await page.getByRole("radio", { name: "Sky", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute(
    "data-composer-shade",
    "sky",
  );
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
  await expect(
    page.getByRole("radio", { name: "Sky", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.locator(".composer")).toHaveCSS(
    "background-color",
    "rgb(240, 246, 252)",
  );
  expect(
    (await page.locator(".composer").boundingBox())!.width,
  ).toBeLessThanOrEqual(740);
  const accent = await page
    .locator("html")
    .evaluate((e) => getComputedStyle(e).getPropertyValue("--green").trim());
  expect(accent).toBe("#126783");
  expect(errors).toEqual([]);
});

test("polished composer formats Markdown, copies answers and code, and edits or resends questions", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  await page.getByLabel("Message Raazi").fill("Show formatted response");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant h2")).toHaveText(
    "Professional answer",
  );
  await expect(page.locator(".message.assistant strong")).toHaveText("clear");
  await expect(page.locator(".message.assistant table")).toContainText("Ready");
  await expect(
    page.locator(".message.assistant .code-block pre"),
  ).toContainText("const answer = 42;");
  expect(
    await page
      .locator(".message.assistant script,.message.assistant img")
      .count(),
  ).toBe(0);
  expect(
    await page.locator(".message.assistant a[href^='javascript:']").count(),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Copy response", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("## Professional answer");
  await page.getByRole("button", { name: "Copy code", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("const answer = 42;");
  await page
    .getByRole("button", { name: "Edit question", exact: true })
    .click();
  await page.getByLabel("Edit question").fill("Revised question");
  await page.getByRole("button", { name: "Save and resend" }).click();
  await expect(page.locator(".message.user .text")).toHaveText(
    "Revised question",
  );
  await expect(page.locator(".message.assistant")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Resend question", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeDisabled();
  await expect(page.locator(".message.assistant")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Resend question", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page
    .getByRole("button", { name: "Show formatted response", exact: true })
    .click();
  await expect(page.locator(".message.user .text")).toHaveText(
    "Revised question",
  );
  await expect(
    page.getByText(
      "AI can provide incorrect information. Check important answers and their sources.",
    ),
  ).toBeVisible();
  await page.getByLabel("Selected model").click();
  await expect(page.locator(".model-menu")).toContainText("fixture-model");
  await page.getByLabel("Selected model").click();
  await page.screenshot({
    path: "data/react-chat-controls.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "data/react-chat-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("composer size controls persist and compact halves the normal height", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  const height = async () =>
    (await page.locator(".composer").boundingBox())!.height;
  const compactHeight = await height();
  expect(compactHeight).toBeLessThanOrEqual(85);
  await page.getByRole("button", { name: "Your profile" }).click();
  await page.getByRole("radio", { name: "Comfortable", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute(
    "data-composer-size",
    "comfortable",
  );
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  const comfortableHeight = await height();
  expect(compactHeight / comfortableHeight).toBeLessThan(0.6);
  await page.getByRole("button", { name: "Your profile" }).click();
  await page.getByRole("radio", { name: "Spacious", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute(
    "data-composer-size",
    "spacious",
  );
  await page.reload();
  await page.getByRole("button", { name: "Your profile" }).click();
  await expect(
    page.getByRole("radio", { name: "Spacious", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  expect(await height()).toBeGreaterThan(comfortableHeight);
  await page.getByRole("button", { name: "Your profile" }).click();
  await page.getByRole("radio", { name: "Compact", exact: true }).check();
  await expect(page.locator("html")).toHaveAttribute(
    "data-composer-size",
    "compact",
  );
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.screenshot({ path: "data/react-compact-composer.png" });
  await page.setViewportSize({ width: 390, height: 660 });
  expect(await height()).toBeLessThanOrEqual(85);
  await page.screenshot({ path: "data/react-compact-composer-mobile.png" });
});

test("admins discover providers and users select models or enable Jev routing", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .last()
    .click();
  await page.getByRole("tab", { name: "Providers", exact: true }).click();
  await page.getByLabel("Provider name", { exact: true }).fill("Local test");
  await page.getByLabel("Provider base URL").fill("http://provider.test/v1");
  await page.getByLabel("Approved model names").fill("small");
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Provider saved");
  await page
    .getByRole("button", {
      name: "Discover models for Local test",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "expert", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "expert", exact: true }).check();
  await page
    .getByRole("button", { name: "Save provider", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add provider", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Provider name", { exact: true }).fill("Jev test");
  await page.getByLabel("Provider protocol").selectOption("typesafe");
  await page.getByLabel("Provider base URL").fill("http://jev.test/v1");
  await page.getByLabel("Approved model names").fill("jev-latest");
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit Jev test", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Enable decision routing", exact: true })
    .check();
  await page
    .getByLabel("Decision provider", { exact: true })
    .selectOption({ label: "Jev test" });
  await page.getByLabel("Decision model name").fill("jev-latest");
  await page
    .getByRole("button", { name: "Save decision routing", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Decision routing saved",
  );
  await page.screenshot({ path: "data/react-providers.png", fullPage: true });
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: /Use decision model/ }),
  ).toBeEnabled();
  await page.getByLabel("Selected model").click();
  await page
    .locator(".model-menu")
    .getByRole("button", { name: "Local test / small", exact: true })
    .click();
  await page.getByLabel("Message Raazi").fill("Provider selection check");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toHaveCount(1);
  await expect(page.locator(".message.assistant")).not.toContainText(
    "Decision route",
  );
  await page.getByRole("switch", { name: /Use decision model/ }).check();
  await page.getByLabel("Message Raazi").fill("Annual leave allowance");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant").last()).toContainText(
    "Decision route: direct",
  );
  await expect(page.locator(".message.assistant").last()).toContainText(
    "Local test / expert",
  );
  await expect(page.locator(".message.assistant").last()).toContainText(
    "confidence 95%",
  );
  await page.screenshot({ path: "data/react-routed-chat.png" });
  await page.reload();
  await page
    .getByRole("button", { name: "Provider selection check", exact: true })
    .click();
  await expect(page.locator(".message.assistant").last()).toContainText(
    "Decision route: direct",
  );
});

test("model display names and thinking switch keep reasoning separate across reload and copy", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .last()
    .click();
  await page.getByLabel("Model base URL").fill("http://fixture.test/v1");
  await page
    .getByLabel("Model name", { exact: true })
    .fill("cryptic-model-123");
  await page.getByLabel("Model display name").fill("Raazi Assistant");
  await page
    .getByLabel("Thinking control", { exact: true })
    .selectOption("enable_thinking");
  await page.getByRole("button", { name: "Save model settings" }).click();
  await expect(page.getByRole("status")).toContainText("Model settings saved");
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByLabel("Selected model").click();
  await page
    .locator(".model-menu")
    .getByRole("button", { name: "Raazi Assistant", exact: true })
    .click();
  await expect(page.getByLabel("Selected model")).toContainText(
    "Raazi Assistant",
  );
  await expect(
    page.getByRole("switch", { name: "Thinking", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("switch", { name: "Thinking", exact: true }).check();
  await page.getByLabel("Message Raazi").fill("Thinking fixture");
  await page.getByRole("button", { name: "Send message" }).click();
  const reply = page.locator(".message.assistant").last();
  await expect(reply.locator(".markdown")).toHaveText("Visible final answer.");
  await expect(reply.locator(".thinking-text")).toBeHidden();
  await expect(reply.locator(".message-thinking summary")).toHaveText(
    "Thoughts",
  );
  await reply.locator(".message-thinking summary").click();
  await expect(reply.locator(".thinking-text")).toHaveText(
    "Fixture model reasoning.",
  );
  await reply.getByRole("button", { name: "Copy response" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "Visible final answer.",
  );
  await page.screenshot({ path: "data/react-thinking.png", fullPage: true });
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Thinking", exact: true }),
  ).not.toBeChecked();
  await expect(page.locator(".message.assistant .thinking-text")).toBeHidden();
  // Reopen saved history explicitly; selected conversation is not stored across reload.
  await page
    .getByRole("button", { name: "Thinking fixture", exact: true })
    .click();
  await expect(page.locator(".message.assistant .markdown")).toHaveText(
    "Visible final answer.",
  );
  await page.locator(".message-thinking summary").click();
  await expect(page.locator(".thinking-text")).toHaveText(
    "Fixture model reasoning.",
  );
  await page.getByLabel("Message Raazi").fill("Thinking fixture");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.locator(".message.assistant").last().locator(".markdown"),
  ).toHaveText("Thinking disabled answer.");
  await expect(
    page.locator(".message.assistant").last().locator(".message-thinking"),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .last()
    .click();
  await page.getByRole("tab", { name: "Providers", exact: true }).click();
  await page.getByLabel("Provider name", { exact: true }).fill("Named engine");
  await page.getByLabel("Provider base URL").fill("http://fixture.test/v1");
  await page.getByLabel("Approved model names").fill("cryptic-provider-id");
  await page
    .getByLabel("Display name for cryptic-provider-id")
    .fill("SNGPL Expert");
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Provider saved");
  await page
    .getByRole("button", { name: "Edit Named engine", exact: true })
    .click();
  await expect(
    page.getByLabel("Display name for cryptic-provider-id"),
  ).toHaveValue("SNGPL Expert");
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByLabel("Selected model").click();
  await page
    .locator(".model-menu")
    .getByRole("button", { name: "SNGPL Expert", exact: true })
    .click();
  await expect(page.getByLabel("Selected model")).toContainText("SNGPL Expert");
  await expect(
    page.getByRole("switch", { name: "Thinking", exact: true }),
  ).toBeDisabled();
});

test("platform name updates workspace and anonymous login", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .last()
    .click();
  await page.getByRole("tab", { name: "Platform", exact: true }).click();
  await page
    .getByLabel("Platform name", { exact: true })
    .fill("SNGPL Assistant");
  await page.getByRole("button", { name: "Save platform settings" }).click();
  await expect(page).toHaveTitle(
    "SNGPL Assistant · SNGPL enterprise workspace",
  );
  await page.screenshot({ path: "data/platform-settings.png", fullPage: true });
  const context = await page.context().browser()!.newContext();
  try {
    const login = await context.newPage();
    await login.goto("http://127.0.0.1:8091");
    await expect(login.locator(".login .brand")).toContainText(
      "SNGPL Assistant",
    );
    await expect(login.locator(".login-logo")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await login.screenshot({ path: "data/platform-login.png", fullPage: true });
  } finally {
    await context.close();
  }

  await page.getByLabel("Platform name", { exact: true }).fill("Raazi");
  await page.getByRole("button", { name: "Save platform settings" }).click();
  await expect(page).toHaveTitle("Raazi · SNGPL enterprise workspace");
});

test("model connection can be checked without saving", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .last()
    .click();
  await page
    .getByLabel("Model base URL", { exact: true })
    .fill("http://fixture.test/v1");
  await page.getByLabel("Model name", { exact: true }).fill("fixture-chat");
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(
    page.getByText(
      "Connection successful: fixture-chat returned a text response. Settings were not saved.",
    ),
  ).toBeVisible();
});

test("knowledge shows live section progress and stale reindex notice", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  const admin = await (await page.request.get("/api/admin")).json();
  expect(admin.documents.length).toBeGreaterThan(0);
  let status = "processing";
  await page.route("**/api/admin/documents/status", (route) =>
    route.fulfill({
      json: {
        documents: admin.documents.map((d: any, n: number) =>
          n
            ? d
            : {
                ...d,
                status,
                index_stage: "Creating embeddings",
                index_completed: 32,
                index_total: 64,
              },
        ),
      },
    }),
  );
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .last()
    .click();
  await page.getByRole("tab", { name: "Knowledge", exact: true }).click();
  await expect(
    page.getByText("Creating embeddings · 32 of 64 sections"),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", {
      name: "Indexing " + admin.documents[0].title,
    }),
  ).toHaveAttribute("value", "32");
  status = "needs_reindex";
  await expect(page.getByText(/Knowledge is stale:/)).toBeVisible();
  await expect(
    page.getByText("Stale — reindex required", { exact: true }),
  ).toBeVisible();
  status = "ready";
  await expect(page.getByText(/Knowledge is stale:/)).toHaveCount(0);
});

test("selected empty knowledge base gives an apology instead of a general answer", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  const session = await (await page.request.get("/api/session")).json();
  const created = await page.request.post("/api/admin/repositories", {
    headers: { "X-CSRF-Token": session.csrf },
    data: { name: "Empty Manuals", groups: [] },
  });
  const { id } = await created.json();
  await page.reload();
  await page.getByLabel("Knowledge repository").selectOption(String(id));
  await expect(page.getByText(/Knowledge-only: answers/)).toBeVisible();
  await page
    .getByLabel("Message Raazi")
    .fill("What is the annual leave allowance?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "Sorry, I couldn't find relevant information in Empty Manuals.",
  );
});

test("knowledge multiselect and composer file drops accept several documents", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .last()
    .click();
  await page.getByRole("tab", { name: "Knowledge", exact: true }).click();
  await page
    .getByLabel("Upload repository")
    .selectOption({ label: "Policies" });
  await page.getByLabel("Document file").setInputFiles([
    {
      name: "manual-one.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Annual leave allowance is 25 days."),
    },
    {
      name: "manual-two.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Travel requires manager approval."),
    },
  ]);
  await page
    .getByRole("button", { name: "Upload and index", exact: true })
    .click();
  await expect(
    page.getByText("manual-one.txt: Ready", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("manual-two.txt: Ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  const transfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(
      new File(["Leave is 25 days."], "drop-one.txt", { type: "text/plain" }),
    );
    dt.items.add(
      new File(["Manager approves travel."], "drop-two.txt", {
        type: "text/plain",
      }),
    );
    return dt;
  });
  await page
    .locator(".composer")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator(".composer .attachment-ready")).toHaveCount(2);
  await expect(page.locator(".composer")).toContainText("drop-one.txt");
  await expect(page.locator(".composer")).toContainText("drop-two.txt");
});

test("general chat is default and named knowledge returns normal cited answers", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Continue as local administrator" })
    .click();
  const selector = page.getByLabel("Knowledge repository");
  await expect(selector).toHaveValue("");
  await expect(selector.locator("option:checked")).toHaveText("General chat");
  await page
    .getByLabel("Message Raazi")
    .fill("Travel expenses manager approval");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toBeVisible();
  await expect(page.locator(".message.assistant .citation")).toHaveCount(0);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await selector.selectOption({ label: "Policies" });
  await page
    .getByLabel("Message Raazi")
    .fill("Travel expenses manager approval");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "The answer is supported",
  );
  await expect(
    page.locator(".message.assistant .citation").first(),
  ).toHaveAttribute("href", /sources/);
});
