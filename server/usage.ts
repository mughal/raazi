import { AsyncLocalStorage } from "node:async_hooks";
import { LocalDB } from "./db.js";
import type { RequestJSON } from "./knowledge.js";
export class Usage {
  context = new AsyncLocalStorage<number>();
  constructor(private db: LocalDB) {
    db.raw
      .exec(`CREATE TABLE IF NOT EXISTS usage_questions(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL,created_at TEXT NOT NULL,status INTEGER);
    CREATE INDEX IF NOT EXISTS usage_questions_created ON usage_questions(created_at);
    CREATE TABLE IF NOT EXISTS usage_inference(id INTEGER PRIMARY KEY,question_id INTEGER NOT NULL REFERENCES usage_questions(id),kind TEXT NOT NULL,model TEXT NOT NULL,success INTEGER NOT NULL,input_tokens INTEGER,output_tokens INTEGER);`);
  }
  begin(userId: string) {
    return Number(
      this.db.run(
        "INSERT INTO usage_questions(user_id,created_at) VALUES(?,?)",
        userId,
        new Date().toISOString(),
      ).lastInsertRowid,
    );
  }
  finish(id: number, status: number) {
    this.db.run("UPDATE usage_questions SET status=? WHERE id=?", status, id);
  }
  wrap(kind: "chat" | "decision", request: RequestJSON): RequestJSON {
    return async (url, body, key) => {
      const id = this.context.getStore();
      let response: any,
        success = false;
      try {
        response = await request(url, body, key);
        success = true;
        return response;
      } finally {
        if (id) {
          const token = (value: unknown) =>
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 0
              ? value
              : null;
          const usage = response?.usage;
          const model =
            typeof (body as any)?.model === "string"
              ? (body as any).model.slice(0, 200)
              : "";
          this.db.run(
            "INSERT INTO usage_inference(question_id,kind,model,success,input_tokens,output_tokens) VALUES(?,?,?,?,?,?)",
            id,
            kind,
            model,
            Number(success),
            token(usage?.prompt_tokens ?? usage?.input_tokens),
            token(usage?.completion_tokens ?? usage?.output_tokens),
          );
        }
      }
    };
  }
  report(days: number) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const users = this.db.all(
      `SELECT q.user_id,COALESCE(u.name,q.user_id) AS name,COALESCE(u.email,'') AS email,
      COUNT(*) AS questions,SUM(CASE WHEN q.status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS answered_requests,
      SUM(CASE WHEN q.status>=400 THEN 1 ELSE 0 END) AS failed_requests,
      COALESCE(SUM(m.input_tokens),0) AS input_tokens,COALESCE(SUM(m.output_tokens),0) AS output_tokens,
      COALESCE(SUM(m.calls),0) AS model_calls,COALESCE(SUM(m.reported),0) AS reported_calls,
      COALESCE(SUM(m.decision_calls),0) AS decision_calls,MAX(q.created_at) AS last_question
      FROM usage_questions q LEFT JOIN users u ON u.id=q.user_id LEFT JOIN (
        SELECT question_id,SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens,COUNT(*) AS calls,
        SUM(CASE WHEN input_tokens IS NOT NULL AND output_tokens IS NOT NULL THEN 1 ELSE 0 END) AS reported,
        SUM(CASE WHEN kind='decision' THEN 1 ELSE 0 END) AS decision_calls FROM usage_inference GROUP BY question_id
      ) m ON m.question_id=q.id WHERE q.created_at>=? GROUP BY q.user_id ORDER BY questions DESC`,
      since,
    );
    const totals = {
      questions: 0,
      answered_requests: 0,
      failed_requests: 0,
      input_tokens: 0,
      output_tokens: 0,
      model_calls: 0,
      reported_calls: 0,
      decision_calls: 0,
    };
    for (const row of users)
      for (const key of Object.keys(totals) as (keyof typeof totals)[])
        totals[key] += Number(row[key]);
    return { days, since, totals, users };
  }
}
