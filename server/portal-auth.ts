import { createHash, randomBytes } from "node:crypto";
import { Failure } from "./db.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Challenge = {
  username: string;
  csrf: string;
  until: number;
  attempts: number;
  busy: boolean;
};

/** Portal AD password validation, followed by the same authenticator API as Aigate. */
export class PortalAuth {
  private challenges = new Map<string, Challenge>();
  private limits = new Map<string, { until: number; attempts: number }>();
  constructor(
    private base: string,
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
  ) {
    const url = new URL(base);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "PORTAL_API_URL must be an HTTPS base URL without credentials, query, or fragment.",
      );
    this.base = base.replace(/\/+$/, "");
  }
  private prune() {
    for (const store of [this.challenges, this.limits])
      for (const [key, value] of store)
        if (value.until <= this.now()) store.delete(key);
  }
  private limit(key: string, max: number) {
    this.prune();
    let entry = this.limits.get(key);
    if (!entry) {
      if (this.limits.size >= 10000) throw new Failure(429, "Try again later.");
      entry = { until: this.now() + 300000, attempts: 0 };
      this.limits.set(key, entry);
    }
    if (++entry.attempts > max)
      throw new Failure(429, "Too many sign-in attempts. Wait five minutes.");
  }
  private async validate(path: string, body: unknown) {
    try {
      const response = await this.fetcher(this.base + "/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (typeof result?.executedSuccessfully !== "boolean") throw new Error();
      return result.executedSuccessfully as boolean;
    } catch {
      throw new Failure(
        503,
        "The Portal authentication service is unavailable.",
      );
    }
  }
  async begin(username: string, password: string, ip: string, csrf: string) {
    username = username.trim().toLowerCase();
    if (
      !/^[a-z0-9_.-]{1,128}$/.test(username) ||
      !password ||
      password.length > 1024
    )
      throw new Failure(400, "Enter a valid Portal username and password.");
    this.limit("ip:" + ip, 100);
    this.limit("user:" + username, 10);
    if (!(await this.validate("validateUserFromLdap", { username, password })))
      throw new Failure(401, "Portal rejected the username or password.");
    if (this.challenges.size >= 1000)
      throw new Failure(429, "Try again later.");
    const token = randomBytes(32).toString("base64url");
    this.challenges.set(digest(token), {
      username,
      csrf,
      until: this.now() + 300000,
      attempts: 0,
      busy: false,
    });
    return token;
  }
  cancel(token: string) {
    this.challenges.delete(digest(token));
  }
  async finish(token: string, csrf: string, code: string) {
    this.prune();
    const key = digest(token),
      challenge = this.challenges.get(key);
    if (!challenge || challenge.busy || challenge.csrf !== csrf)
      throw new Failure(401, "Sign in again.");
    if (++challenge.attempts >= 5) this.challenges.delete(key);
    if (!/^\d{6}$/.test(code))
      throw new Failure(400, "Enter the six-digit authenticator code.");
    challenge.busy = true;
    try {
      if (
        !(await this.validate("authenticator/validateOtp", {
          employeeNumber: challenge.username,
          otp: code,
        }))
      )
        throw new Failure(401, "Invalid authenticator code.");
      this.challenges.delete(key);
      return challenge.username;
    } finally {
      challenge.busy = false;
    }
  }
}
