import { useState, type FormEvent } from "react";
import { api } from "./api";

export function PortalLogin({ onLogin }: { onLogin: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otp, setOTP] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (otp) {
        await api("/auth/portal/otp", "POST", { code });
        await onLogin();
      } else {
        await api("/auth/portal/login", "POST", { username, password });
        setPassword("");
        setOTP(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {otp ? (
        <label>
          Authenticator code
          <input
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
      ) : (
        <>
          <label>
            Windows/Domain User Name
            <input
              autoComplete="username"
              maxLength={128}
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              maxLength={1024}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        </>
      )}
      <button className="primary" disabled={busy} type="submit">
        {busy ? "Checking…" : otp ? "Verify and sign in" : "Continue"}
      </button>
      {otp && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOTP(false);
            setCode("");
            setError("");
          }}
        >
          Start again
        </button>
      )}
    </form>
  );
}
