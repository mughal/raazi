import { randomBytes } from "node:crypto";
import { LocalDB } from "./db.js";

export class Sessions {
  constructor(private db: LocalDB) {
    db.raw.exec(`CREATE TABLE IF NOT EXISTS login_sessions(
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
      revoked_at INTEGER,user_agent TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS login_sessions_user ON login_sessions(user_id,expires_at);`);
  }
  create(uid: string, userAgent = "") {
    const now = Date.now(),
      id = randomBytes(24).toString("base64url");
    this.db.run(
      "DELETE FROM login_sessions WHERE expires_at<?",
      now - 30 * 86400000,
    );
    this.db.run(
      "INSERT INTO login_sessions(id,user_id,created_at,last_seen_at,expires_at,user_agent) VALUES(?,?,?,?,?,?)",
      id,
      uid,
      now,
      now,
      now + 8 * 3600000,
      userAgent.slice(0, 300),
    );
    return id;
  }
  valid(id: unknown, uid: unknown) {
    return (
      typeof id === "string" &&
      typeof uid === "string" &&
      !!this.db.get(
        "SELECT id FROM login_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?",
        id,
        uid,
        Date.now(),
      )
    );
  }
  touch(id: string) {
    const now = Date.now();
    this.db.run(
      "UPDATE login_sessions SET last_seen_at=? WHERE id=? AND revoked_at IS NULL AND expires_at>? AND last_seen_at<?",
      now,
      id,
      now,
      now - 30000,
    );
  }
  revoke(id: string) {
    return this.db.run(
      "UPDATE login_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL AND expires_at>?",
      Date.now(),
      id,
      Date.now(),
    ).changes;
  }
  revokeUser(uid: string) {
    return this.db.run(
      "UPDATE login_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND expires_at>?",
      Date.now(),
      uid,
      Date.now(),
    ).changes;
  }
  list(currentId: string) {
    const now = Date.now();
    return this.db
      .all(
        "SELECT s.*,u.name,u.email,u.role,u.disabled FROM login_sessions s JOIN users u ON u.id=s.user_id WHERE s.revoked_at IS NULL AND s.expires_at>? ORDER BY s.last_seen_at DESC",
        now,
      )
      .map((s) => ({
        id: s.id,
        user_id: s.user_id,
        name: s.name,
        email: s.email,
        role: s.role,
        disabled: !!s.disabled,
        current: s.id === currentId,
        recently_active: !s.disabled && s.last_seen_at >= now - 5 * 60000,
        created_at: new Date(s.created_at).toISOString(),
        last_seen_at: new Date(s.last_seen_at).toISOString(),
        expires_at: new Date(s.expires_at).toISOString(),
        user_agent: s.user_agent,
      }));
  }
}
