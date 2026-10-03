import { it, expect, vi } from "vitest";
import request from "supertest";
import { generateKeyPair, exportJWK, SignJWT, decodeJwt } from "jose";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { createApp } from "../server/app";
const issuer = "https://identity.example.test";
it("verifies the OIDC code flow, PKCE, signed claims, nonce, exact groups and disabled accounts", async () => {
  const root = mkdtempSync(join(tmpdir(), "raazi-oidc-test-")),
    secret = "oidc-test-session-secret-at-least-32-characters",
    keys = await generateKeyPair("RS256"),
    jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test-key";
  let nonce = "",
    wrongNonce = false,
    codeVerifier = "",
    groups = ["admins"];
  let session: any;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/discovery"))
        return Response.json({
          issuer,
          authorization_endpoint: issuer + "/authorize",
          token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/jwks",
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        });
      if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
      if (url.endsWith("/token")) {
        const form = new URLSearchParams(init?.body as string);
        codeVerifier = form.get("code_verifier") ?? "";
        expect(form.get("client_secret")).toBe("test-client-secret");
        const id_token = await new SignJWT({
          nonce: wrongNonce ? "wrong" : nonce,
          name: "Employee",
          email: "employee@test",
          groups,
          department: "Finance",
          job_title: "Analyst",
        })
          .setProtectedHeader({ alg: "RS256", kid: "test-key" })
          .setIssuer(issuer)
          .setSubject("employee")
          .setAudience("raazi-client")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(keys.privateKey);
        return Response.json({ id_token });
      }
      throw new Error("Unexpected identity request");
    },
  );
  const service = await createApp({
    database: join(root, "db.sqlite"),
    secret,
    mode: "oidc",
    secure: false,
    adminGroup: "admins",
    encryptionKey: randomBytes(32).toString("base64url"),
    discoveryURL: issuer + "/discovery",
    clientId: "raazi-client",
    clientSecret: "test-client-secret",
    redirectURI: "https://raazi.example.test/auth/callback",
  });
  try {
    const agent = request.agent(service.app);
    const login = async () => {
      const start = await agent.get("/auth/login");
      expect(start.status).toBe(302);
      const url = new URL(start.headers.location);
      nonce = url.searchParams.get("nonce")!;
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      const pending = start.headers["set-cookie"][0]
          .split(";")[0]
          .split("=")[1],
        state = decodeJwt(pending);
      expect(state.nonce).toBe(nonce);
      return {
        response: await agent
          .get("/auth/callback")
          .query({ state: url.searchParams.get("state"), code: "test-code" }),
        challenge: url.searchParams.get("code_challenge"),
      };
    };
    const success = await login();
    expect(success.response.status).toBe(302);
    expect(codeVerifier.length).toBeGreaterThan(30);
    expect(createHash("sha256").update(codeVerifier).digest("base64url")).toBe(
      success.challenge,
    );
    session = (await agent.get("/api/session")).body;
    expect(session.user).toMatchObject({
      role: "admin",
      department: "Finance",
      job_title: "Analyst",
    });
    expect((await agent.get("/api/admin")).status).toBe(200);
    wrongNonce = true;
    expect((await login()).response.status).toBe(403);
    wrongNonce = false;
    groups = ["admins-lookalike"];
    expect((await login()).response.status).toBe(302);
    expect((await agent.get("/api/admin")).status).toBe(403);
    service.db.run(
      "UPDATE users SET disabled=1 WHERE id=?",
      issuer + "|employee",
    );
    expect((await agent.get("/api/workspace")).status).toBe(401);
    expect((await login()).response.status).toBe(403);
    expect(
      (await agent.get("/auth/callback").query({ state: "wrong", code: "x" }))
        .status,
    ).toBe(403);
  } finally {
    vi.unstubAllGlobals();
    await service.close();
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep))
      throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
