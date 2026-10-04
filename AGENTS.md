# Working on Raazi

Read `docs/HANDOFF.md` and `docs/ARCHITECTURE.md` before substantive changes. They record the current design, completed work, setup, and outstanding checks. Update them when behavior changes.

- Work on `dev` unless the user requests another branch. Inspect Git status before editing.
- Keep application code in TypeScript with React and Node.js. The Python application is historical.
- The product name is Raazi. Use the bundled SNGPL identity. No rename was approved.
- Keep the composer light, compact by default, and visible at the bottom. Messages scroll independently.
- Preserve the local database, encryption key, signing secret, workspace namespace, and referenced objects. Code checkout alone does not transfer workspace data.
- Never commit `.env`, `data/`, provider keys, or real credentials.
- Use concise documentation with approximately 80% ASD-STE100 principles. Do not claim formal STE certification.
- Run relevant build/tests for each change. Browser tests use Microsoft Edge and isolated fixtures. Live PostgreSQL checks require a disposable `RAAZI_TEST_DATABASE_URL`.
- Report live integrations separately from fixture verification. Real Jev, AD, Huawei S3, and production rollout still need target-environment checks.
- Follow `docs/PRODUCTION.md` for deployment. The current architecture supports one app replica.
