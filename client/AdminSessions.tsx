import { useEffect, useState } from "react";
import type { LoginSession } from "../shared/types";
import { api } from "./api";
import { Modal } from "./ui";

export function AdminSessions({
  notify,
  onSessionEnded,
}: {
  notify: (text: string) => void;
  onSessionEnded: () => Promise<void>;
}) {
  const [rows, setRows] = useState<LoginSession[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [ending, setEnding] = useState<{
    session: LoginSession;
    all: boolean;
  } | null>(null);
  async function load() {
    const data = await api<{ sessions: LoginSession[] }>("/api/admin/sessions");
    setRows(data.sessions);
    setLoaded(true);
  }
  useEffect(() => {
    const refresh = () => {
      void load().catch((e) => setError(e.message));
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, []);
  async function end() {
    if (!ending) return;
    setBusy(true);
    setError("");
    try {
      const path = ending.all
        ? "/api/admin/users/" +
          encodeURIComponent(ending.session.user_id) +
          "/sessions"
        : "/api/admin/sessions/" + ending.session.id;
      const result = await api<{ current_ended: boolean }>(path, "DELETE");
      setEnding(null);
      if (result.current_ended) {
        await onSessionEnded();
        return;
      }
      await load();
      notify(ending.all ? "User sessions ended" : "Session ended");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const users = [...new Set(rows.map((s) => s.user_id))];
  const time = (value: string) => new Date(value).toLocaleString();
  const browserName = (agent: string) => {
    if (/Edg\//.test(agent)) return "Microsoft Edge";
    if (/Firefox\//.test(agent)) return "Firefox";
    if (/Chrome\//.test(agent)) return "Chrome";
    if (/Safari\//.test(agent)) return "Safari";
    return agent ? "Other browser/client" : "Not supplied";
  };
  return (
    <section className="session-settings">
      <div className="card">
        <h3>Logged-in users and sessions</h3>
        <p>
          Recently active means an authenticated request within five minutes.
          Signed-in browsers can be idle or closed. Updates every 30 seconds.
        </p>
        <p>
          {users.length} signed-in user(s) · {rows.length} unexpired session(s)
          · {rows.filter((s) => s.recently_active).length} recently active
        </p>
        <button
          disabled={busy}
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Refresh sessions
        </button>
        {!loaded && <p role="status">Loading sessions…</p>}
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
      </div>
      {users.map((uid) => {
        const sessions = rows.filter((s) => s.user_id === uid),
          user = sessions[0];
        return (
          <section className="card" key={uid}>
            <h3>
              {user.name} · {user.role}
            </h3>
            <p className="help">
              {user.email || user.user_id}
              {user.disabled ? " · Account disabled" : ""}
            </p>
            <button
              disabled={busy}
              onClick={() => setEnding({ session: user, all: true })}
            >
              End all sessions for {user.name}
            </button>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Signed in</th>
                    <th>Last activity</th>
                    <th>Expires</th>
                    <th>Browser</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} data-session-id={s.id}>
                      <td>
                        {s.disabled
                          ? "Account disabled"
                          : s.recently_active
                            ? "Recently active"
                            : "Idle"}
                        {s.current && " · This session"}
                      </td>
                      <td>{time(s.created_at)}</td>
                      <td>{time(s.last_seen_at)}</td>
                      <td>{time(s.expires_at)}</td>
                      <td className="session-browser" title={s.user_agent}>
                        {browserName(s.user_agent)}
                      </td>
                      <td>
                        <button
                          disabled={busy}
                          onClick={() => setEnding({ session: s, all: false })}
                        >
                          End session
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {ending && (
        <Modal
          title={ending.all ? "End all user sessions" : "End session"}
          onClose={() => !busy && setEnding(null)}
        >
          <p>
            {ending.all ? "End all sessions" : "End this session"} for{" "}
            {ending.session.name}? The user must sign in again.
          </p>
          {(ending.all
            ? ending.session.user_id === rows.find((s) => s.current)?.user_id
            : ending.session.current) && (
            <p>This includes your current session. You will be signed out.</p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="form-actions">
            <button disabled={busy} onClick={() => setEnding(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void end()}
            >
              End now
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
