import { useEffect, useState } from "react";
import { api } from "./api";
type Counts = {
  questions: number;
  answered_requests: number;
  failed_requests: number;
  input_tokens: number;
  output_tokens: number;
  model_calls: number;
  reported_calls: number;
  decision_calls: number;
};
type Report = {
  totals: Counts;
  users: (Counts & {
    user_id: string;
    name: string;
    email: string;
    last_question: string;
  })[];
};
export function AdminUsage() {
  const [days, setDays] = useState(30),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState("");
  const load = () =>
    api<Report>("/api/admin/usage?days=" + days)
      .then((result) => {
        setReport(result);
        setError("");
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [days]);
  const number = (n: number) => n.toLocaleString();
  return (
    <section className="card usage-dashboard">
      <div className="page-header">
        <h2>User usage</h2>
        <label>
          Period{" "}
          <select
            aria-label="Usage period"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <button onClick={() => void load()}>Refresh usage</button>
      </div>
      {error && <p role="alert">{error}</p>}
      <p className="help">
        Usage starts when this version is deployed. Questions count
        authenticated chat submissions, including retries and edits. Token
        totals include chat and decision calls, use provider-reported values
        only, and exclude embeddings. Missing usage is not estimated. No
        question text is shown.
      </p>
      {report && (
        <>
          <div className="grid">
            {[
              ["Questions", report.totals.questions],
              ["Input tokens", report.totals.input_tokens],
              ["Output tokens", report.totals.output_tokens],
              ["Users", report.users.length],
            ].map(([label, value]) => (
              <div className="card" key={label}>
                <small>{label}</small>
                <h3>{number(Number(value))}</h3>
              </div>
            ))}
          </div>
          <p>
            {report.totals.reported_calls} of {report.totals.model_calls} model
            calls reported both token counts. {report.totals.decision_calls}{" "}
            decision calls.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Questions</th>
                  <th>Completed</th>
                  <th>Failed</th>
                  <th>Input tokens</th>
                  <th>Output tokens</th>
                  <th>Token coverage</th>
                  <th>Last question</th>
                </tr>
              </thead>
              <tbody>
                {report.users.map((u) => (
                  <tr key={u.user_id}>
                    <td>
                      {u.name}
                      <small>{u.email}</small>
                    </td>
                    <td>{number(u.questions)}</td>
                    <td>{number(u.answered_requests)}</td>
                    <td>{number(u.failed_requests)}</td>
                    <td>{number(u.input_tokens)}</td>
                    <td>{number(u.output_tokens)}</td>
                    <td>
                      {u.reported_calls}/{u.model_calls} calls
                    </td>
                    <td>{new Date(u.last_question).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!report.users.length && <p>No usage recorded in this period.</p>}
        </>
      )}
    </section>
  );
}
