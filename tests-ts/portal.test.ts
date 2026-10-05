import { afterEach, beforeEach, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../server/app";
import { PortalAuth } from "../server/portal-auth";

let root: string, service: Awaited<ReturnType<typeof createApp>>;
const fetcher = vi.fn<typeof fetch>();
beforeEach(async () => {
  fetcher.mockReset();
  fetcher.mockImplementation(async (input, init) => {
    const body = JSON.parse(init!.body as string);
    expect(init!.redirect).toBe("error");
    if (String(input).endsWith("validateUserFromLdap"))
      return Response.json({
        executedSuccessfully: body.password === "correct",
        groups: ["admins"],
      });
    expect(String(input)).toBe(
      "https://portal.test/api/authenticator/validateOtp",
    );
    expect(body.employeeNumber).toMatch(/^(admin|employee)$/);
    return Response.json({ executedSuccessfully: body.otp === "123456" });
  });
  vi.stubGlobal("fetch", fetcher);
  root = mkdtempSync(join(tmpdir(), "raazi-portal-test-"));
  service = await createApp({
    database: join(root, "db.sqlite"),
    secret: "portal-test-secret-at-least-32-characters",
    mode: "portal",
    secure: false,
    encryptionKey: randomBytes(32).toString("base64url"),
    adminGroup: "admins",
    portalURL: "https://portal.test/api",
    portalAdmins: ["ADMIN"],
  });
});
afterEach(async () => {
  await service.close();
  vi.unstubAllGlobals();
  if (
    !resolve(root).startsWith(resolve(tmpdir()) + sep) ||
    !root.includes("raazi-portal-test-")
  )
    throw new Error("Unsafe cleanup path");
  rmSync(root, { recursive: true, force: true });
});
async function pending(username = "employee") {
  const agent = request.agent(service.app);
  const session = await agent.get("/api/session");
  expect(session.body.auth_mode).toBe("portal");
  const csrf = session.body.csrf;
  expect(
    (
      await agent
        .post("/auth/portal/login")
        .set("X-CSRF-Token", csrf)
        .send({ username, password: "correct" })
    ).status,
  ).toBe(200);
  return { agent, csrf };
}
it("requires both factors, rotates CSRF, grants only configured admins, and rejects replay", async () => {
  const { agent, csrf } = await pending("ADMIN");
  expect((await agent.get("/api/workspace")).status).toBe(401);
  expect(
    (
      await agent
        .post("/auth/portal/otp")
        .set("X-CSRF-Token", csrf)
        .send({ code: "000000" })
    ).status,
  ).toBe(401);
  expect(
    (
      await agent
        .post("/auth/portal/otp")
        .set("X-CSRF-Token", csrf)
        .send({ code: "123456" })
    ).status,
  ).toBe(200);
  const session = await agent.get("/api/session");
  expect(session.body.user.id).toBe("portal|admin");
  expect(session.body.user.role).toBe("admin");
  expect(session.body.csrf).not.toBe(csrf);
  expect(
    (
      await agent
        .post("/auth/portal/otp")
        .set("X-CSRF-Token", session.body.csrf)
        .send({ code: "123456" })
    ).status,
  ).toBe(401);
  expect(
    (
      await agent
        .post("/auth/development")
        .set("X-CSRF-Token", session.body.csrf)
    ).status,
  ).toBe(404);
  const employee = await pending();
  await employee.agent
    .post("/auth/portal/otp")
    .set("X-CSRF-Token", employee.csrf)
    .send({ code: "123456" });
  expect((await employee.agent.get("/api/session")).body.user.role).toBe(
    "user",
  );
  expect((await employee.agent.get("/api/admin")).status).toBe(403);
  service.db.run("UPDATE users SET disabled=1 WHERE id='portal|employee'");
  expect((await employee.agent.get("/api/workspace")).status).toBe(401);
  const disabled = await pending();
  expect(
    (
      await disabled.agent
        .post("/auth/portal/otp")
        .set("X-CSRF-Token", disabled.csrf)
        .send({ code: "123456" })
    ).status,
  ).toBe(403);
});
it("rejects CSRF violations, bad passwords and exhausted OTP challenges", async () => {
  const agent = request.agent(service.app),
    session = await agent.get("/api/session"),
    csrf = session.body.csrf;
  expect(
    (
      await agent
        .post("/auth/portal/login")
        .send({ username: "admin", password: "correct" })
    ).status,
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    (
      await agent
        .post("/auth/portal/login")
        .set("X-CSRF-Token", csrf)
        .send({ username: "admin", password: "wrong" })
    ).status,
  ).toBe(401);
  const challenge = await pending();
  for (let n = 0; n < 5; n++)
    expect(
      (
        await challenge.agent
          .post("/auth/portal/otp")
          .set("X-CSRF-Token", challenge.csrf)
          .send({ code: "000000" })
      ).status,
    ).toBe(401);
  expect(
    (
      await challenge.agent
        .post("/auth/portal/otp")
        .set("X-CSRF-Token", challenge.csrf)
        .send({ code: "123456" })
    ).status,
  ).toBe(401);
});
it("fails closed for malformed or unavailable Portal responses", async () => {
  const agent = request.agent(service.app),
    session = await agent.get("/api/session");
  fetcher.mockResolvedValueOnce(
    Response.json({ executedSuccessfully: "true" }),
  );
  expect(
    (
      await agent
        .post("/auth/portal/login")
        .set("X-CSRF-Token", session.body.csrf)
        .send({ username: "admin", password: "correct" })
    ).status,
  ).toBe(503);
  fetcher.mockRejectedValueOnce(new Error("network failure"));
  expect(
    (
      await agent
        .post("/auth/portal/login")
        .set("X-CSRF-Token", session.body.csrf)
        .send({ username: "admin", password: "correct" })
    ).status,
  ).toBe(503);
  expect((await agent.get("/api/session")).body.user).toBeNull();
});
it("binds challenges to their session, expires them, and limits password attempts", async () => {
  let now = 1000;
  const auth = new PortalAuth("https://portal.test/api", fetcher, () => now);
  const token = await auth.begin(
    "employee",
    "correct",
    "127.0.0.1",
    "session-one",
  );
  await expect(
    auth.finish(token, "session-two", "123456"),
  ).rejects.toMatchObject({ status: 401 });
  now += 300000;
  await expect(
    auth.finish(token, "session-one", "123456"),
  ).rejects.toMatchObject({ status: 401 });
  for (let n = 0; n < 10; n++)
    await expect(
      auth.begin("employee", "wrong", "127.0.0.1", "csrf"),
    ).rejects.toMatchObject({ status: 401 });
  await expect(
    auth.begin("employee", "correct", "127.0.0.1", "csrf"),
  ).rejects.toMatchObject({ status: 429 });
  expect(() => new PortalAuth("http://portal.test/api")).toThrow("HTTPS");
});
