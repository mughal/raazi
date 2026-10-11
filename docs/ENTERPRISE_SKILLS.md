# Enterprise consistency skills: design brief

Date: 11 October 2026. Status: proposed design for later skill development.

This document defines a skill family for enterprise application consistency. It does not install skills or change Raazi behavior. Use approximately 80% ASD-STE100 style. Relax the wording where strict application would reduce technical accuracy or clarity. This is a writing target, not a measured compliance score or formal certification.

## Writing rules

Apply these rules to this brief, future skill instructions, and reports from this skill family:

- Use short sentences, active voice, and familiar words.
- Give each sentence one main purpose. Give each procedure step one main action.
- Use the same term for the same item. Define abbreviations on first use.
- State requirements, instructions, and examples separately.
- Use precise technical names when simpler words would change the meaning.
- Preserve code, API names, identifiers, and source titles exactly.
- Relax a style rule when needed for accuracy. Keep the resulting text concise and clear.
- Do not claim formal ASD-STE100 compliance or certification.

The Markdown file is the maintained source. The PDF is a review copy. Generate a new PDF after source changes. Keep the PDF out of Git.

## 1. Purpose and design

AI coding agents can build many applications. Each application still needs clear ownership, stable interfaces, and common enterprise controls.

Use one enterprise baseline. Allow controlled differences for business needs. Make each check repeatable and support its result with evidence.

Use one coordinating skill, `consistency-check`, and focused skills for each control area. A skill guides an agent. It does not enforce a control by itself.

| Layer             | Purpose                                        | Example                                           |
| ----------------- | ---------------------------------------------- | ------------------------------------------------- |
| Policy            | Define required results and approved versions. | Required audit events and theme version.          |
| Shared capability | Supply tested code or services.                | UI package, identity adapter, or storage adapter. |
| Skill and checks  | Inspect, repair within scope, and verify.      | Agent instructions plus repeatable CI checks.     |

Keep shared code in versioned packages. Keep policy and skill releases in a controlled catalog. Use shared runtime services where they have a clear operational purpose. Do not create one large runtime dependency for all controls.

Apply the baseline to new applications from the start. Introduce it to existing applications in stages. A modular application can run as one deployment. Create separate services only when business or operational needs require them.

The enterprise must select its approved providers, design system, and policy values. This proposal does not make those selections.

## 2. Skill catalog

Proposed skill names use lowercase letters and hyphens. User-facing labels can retain names such as consistencyCheck and changeLook.

| Proposed skill      | Purpose                                                          | Main output                                             |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| `consistency-check` | Coordinate applicable checks and report gaps.                    | Evidence report and repair plan.                        |
| `modular-design`    | Check feature boundaries and shared service interfaces.          | Dependency findings and scoped refactor.                |
| `look-and-feel`     | Check visual and interaction consistency.                        | UI findings and verified component changes.             |
| `change-look`       | Apply an approved design-system update to selected applications. | Per-application patches, previews, and rollout record.  |
| `log-to-siem`       | Connect security events to the approved SIEM path.               | Event mapping and delivery evidence.                    |
| `object-store`      | Store durable file content in approved object storage.           | Storage adapter, metadata contract, and migration plan. |
| `user-access`       | Apply enterprise sign-in and server access rules.                | Identity mapping and access test results.               |
| `add-ai-assistant`  | Add an optional assistant within existing access rules.          | Integration and evaluation results.                     |

The baseline also needs these focused skills. They can share packages when their workflows overlap.

| Proposed skill             | Purpose                                                      | Main output                                        |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| `backup-and-restore`       | Protect application state and verify recovery.               | Backup plan, alerts, and restore evidence.         |
| `secrets-and-config`       | Apply approved secret and configuration handling.            | Configuration contract and secret-handling checks. |
| `api-conventions`          | Apply common request and response rules.                     | API contract and behavior checks.                  |
| `monitor-and-health`       | Apply common health, metrics, and alert rules.               | Health endpoints, metrics, and alert evidence.     |
| `data-lifecycle`           | Apply classification, retention, export, and deletion rules. | Data inventory and lifecycle checks.               |
| `build-and-release`        | Apply repeatable builds, migrations, and rollback.           | Release evidence and rollback procedure.           |
| `test-and-verify`          | Apply required checks and evidence rules.                    | Verification report with fixture and live results. |
| `ownership-and-operations` | Record owners, dependencies, and support procedures.         | Application record and operating guide.            |

SIEM means Security Information and Event Management. JSON means JavaScript Object Notation. OIDC means OpenID Connect. CI means continuous integration.

AI assistance is optional. An application without AI must not fail the baseline for that reason. Provider adapters are implementation choices within each focused skill.

## 3. Common skill contract

Each skill must define its trigger, scope, inputs, outputs, checks, and failure conditions. It must identify required references and preserve user intent and existing data.

### Inputs

- Application ID, owner, repository, and exact source revision.
- Application profile and pinned policy release.
- Approved package versions and integration endpoints.
- Requested mode and permitted change scope.
- Test commands and available isolated fixtures.
- Existing exceptions and their expiry dates.

Obtain credentials through the approved secret mechanism. Do not include credential values in profiles or reports.

### Modes

| Mode    | Behavior                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------- |
| Inspect | Read code and configuration. Run applicable checks that do not change live systems. Report evidence and gaps. |
| Plan    | Prepare scoped changes, dependencies, migration steps, and checks.                                            |
| Apply   | Make authorized changes in the selected checkout. Preserve unrelated changes.                                 |
| Verify  | Check the changed revision. Separate fixture results from live results.                                       |

Use Inspect when the request is only to check consistency. A request to repair a named area can include Apply and Verify. Inspection does not authorize deployment, account changes, or data migration.

For each run:

1. Read repository guidance and inspect Git status.
2. Load the profile and exact policy release.
3. Select applicable rules. Record reasons for exclusions.
4. Run repeatable checks. Use agent review where judgment is needed.
5. Record findings, evidence, and repair scope.
6. Apply requested repairs and verify the changed revision.
7. Report unresolved items, exceptions, and live checks still required.

Mark unavailable checks as Blocked or Not verified. Missing evidence is not Pass. Resolve conflicts with task or repository guidance explicitly. Report a policy gap; do not silently discard data or change product identity to satisfy it.

## 4. Policy and application profiles

Give each rule a stable ID, owner, severity, applicability condition, evidence requirement, and repair guidance. Publish policy releases with versions and content digests. Pin the release in each profile.

Use one baseline with profiles such as internal web, public web, API, or batch job. A batch job can exclude UI checks with a reason. It still needs applicable access, storage, logging, and operation checks.

This JSON is an illustrative profile. Names and versions are examples. The implementation must define and validate a JSON Schema.

```json
{
  "schemaVersion": "1.0",
  "applicationId": "sample-orders",
  "owner": "orders-team",
  "profile": "internal-web",
  "policyVersion": "1.0.0",
  "designSystemVersion": "1.0.0",
  "capabilities": {
    "identity": "enterprise-oidc",
    "audit": "enterprise-collector",
    "fileStorage": "s3-compatible",
    "aiAssistant": false
  },
  "dataClassification": "internal",
  "exceptions": []
}
```

Check declarations against the application. A declared capability is not proof that it works. Keep thresholds in policy, not in an agent's memory.

## 5. Modular design

**Goal:** A team can change one feature without changing unrelated features. Teams or agents can work on different features through documented interfaces.

Check these requirements:

- Group code by feature or clear responsibility. Give each module an owner and public interface.
- Separate UI, business rules, and infrastructure where the application needs them.
- Route identity, audit, storage, configuration, and AI calls through common interfaces.
- Keep business rules in feature modules. Keep reusable services in shared packages or a defined shared folder.
- Detect dependency cycles, forbidden imports, and repeated control implementations.
- Define data ownership. Do not let modules write to another module's tables without an approved contract.
- Test public interfaces and important behavior. Use size or complexity limits only where policy defines them.

Example TypeScript layout:

```text
client/features/orders/
server/features/orders/
shared/contracts/
platform/identity/
platform/audit/
platform/storage/
platform/ai/
```

This is an example, not a required directory rename. Other layouts can meet the rules. Share code when its responsibility and contract are stable. Similar code is not sufficient reason to create a shared package.

**Evidence:** dependency checks, interface tests, ownership records, and specific review findings. A folder list alone does not prove modular design.

## 6. Look and feel

**Goal:** Applications use approved identity, components, and interaction rules.

- Use versioned design tokens for color, type, spacing, borders, and themes.
- Use approved components for common controls. Define loading, empty, error, and success states.
- Keep navigation, labels, validation messages, and keyboard behavior consistent.
- Check focus visibility, accessible names, contrast, and supported screen sizes against enterprise acceptance criteria.
- Preserve approved product names, logos, content, and application-specific behavior.
- Identify local overrides and their reasons. Avoid uncontrolled copies of CSS and components.

JSON design tokens can provide a common interchange format. The [Design Tokens Format Module](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/) describes such a format. The enterprise still needs to select its components and interaction rules.

**Evidence:** package versions, token checks, representative screenshots, and keyboard or browser checks. Screenshots alone do not prove accessibility or behavior.

### changeLook across many applications

Treat `change-look` as a coordinated version update:

1. Identify selected applications and their current versions.
2. Publish the approved token and component release with migration notes.
3. Generate one scoped patch per repository. Show before and after views.
4. Verify affected pages, forms, error states, keyboard use, and screen sizes.
5. Pilot on a small representative group.
6. Release in batches. Stop a batch when its acceptance checks fail.
7. Record versions, outcomes, and rollback procedures per application.

A token change cannot resolve all component API differences. Test both. Pin production versions. Do not use a floating latest version to change all applications at once. Rollback includes the prior package version and required migration reversal. Deployment needs authorization within the current task.

## 7. Logging to SIEM

**Goal:** Required security events reach the approved SIEM with useful context and controlled disclosure.

Check sign-in results, access denial, role changes, administrative changes, sensitive file operations, and AI tool actions where applicable. Policy defines the final event list.

Use a shared event API. Include UTC time, event ID, event type, application ID, environment, source version, outcome, and correlation ID. Include a controlled actor reference and tenant or workspace ID when applicable. Do not log secrets, access tokens, full documents, or raw AI conversations by default.

Map events to the collector and SIEM schema. The [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) defines timestamp, severity, resource, and trace-context fields. It does not prove delivery or retention.

Define bounded buffering, retry limits, duplicate handling, and alerts. For each critical action, policy must define behavior when the audit path is unavailable. Do not silently drop required events or create an unbounded local spool.

**Evidence:** schema validation, redaction tests, outage tests, and a target-SIEM query that finds a synthetic event by event ID. Collector fixtures prove the adapter path only. Protect events against unauthorized changes and apply approved retention.

## 8. Object storage and JSON metadata

**Goal:** Durable user file content is in approved object storage. Required metadata stays linked to its exact object version.

Interpret objectStoreNoLocalFiles as a rule for durable user files. It does not prohibit source assets, configuration, or all database storage. Policy can permit bounded temporary processing files. These need restricted access, size limits, a cleanup deadline, and crash cleanup. Do not use local disk as an outage fallback for durable uploads.

Use one interface for upload, download, delete, and metadata access. Check file type and size. Apply approved malware-check and quarantine rules. Use private objects and check authorization before download. Use short-lived signed links when needed.

Keep a validated JSON record in the approved metadata store. Link it to the object key and exact version. Store a small policy-selected subset as native tags.

Example metadata; all identifiers and dates are synthetic:

```json
{
  "schemaVersion": "1.0",
  "applicationId": "sample-orders",
  "workspaceId": "workspace-example",
  "ownerId": "user-example",
  "classification": "internal",
  "retentionPolicyId": "approved-policy-example",
  "contentType": "application/pdf",
  "sizeBytes": 12345,
  "checksum": {
    "algorithm": "sha256",
    "value": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "createdAt": "2026-10-11T00:00:00Z",
  "object": {
    "bucket": "example-private-bucket",
    "key": "workspace-example/objects/object-example",
    "versionId": "example-version"
  }
}
```

Native tags are not arbitrary JSON documents. [Amazon S3 object tagging](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.html) uses key-value pairs and permits up to ten tags per object. Check the actual S3-compatible provider's limits and behavior. An AWS fixture does not prove Huawei compatibility.

Define upload states such as pending, available, quarantined, and failed. Reconcile incomplete writes between metadata and storage. Test retries, orphan cleanup, version access, and retention. Enforce access on the server. Do not trust user-editable tags as an access decision.

**Evidence:** isolated upload/read/delete tests, metadata validation, interruption tests, and target-provider checks. A migration must copy, verify, and reconcile files before approved deletion. Preserve keys, workspace IDs, object references, and backups.

## 9. User access

**Goal:** The application uses approved identity and checks access on every protected operation.

Use an enterprise identity adapter. For OIDC, test issuer, audience, signature, session, and sign-in flow validation. Use server permission checks for routes, background work, exports, object links, and AI tools. A hidden button does not enforce permission.

Define roles and group mappings with stable IDs. Deny access when no rule permits it. Keep tenant, workspace, owner, and repository scopes explicit. Define how group changes, disabled accounts, session expiry, and provider outages affect access.

Use negative tests. A user must not read another user's records or files, change roles without permission, cross workspace boundaries, or access resources after effective permission removal. Keep development sign-in disabled in production.

**Evidence:** permission matrix, allowed and denied operation tests, session tests, and target-identity checks. Fixture tokens do not prove production group mappings or account revocation.

## 10. Optional AI assistant

**Goal:** The assistant supports the business task within existing access rules.

Use approved provider adapters and models. Define what data can leave the enterprise boundary. Keep retrieval within user permissions. Treat prompts, files, and responses as untrusted input.

- Identify the assistant as AI. Provide source links when supported answers are required.
- Keep credentials and unrelated user data out of model context.
- Define limits, timeouts, cancellation, and cost controls.
- Separate answer generation from action execution.
- Validate tool arguments and permissions on the server. Model output is not authorization.
- Require configured review for consequential actions. Make repeated requests safe.
- Record approved operational events without full prompts by default.
- Preserve the main workflow when an optional provider is unavailable.

**Evidence:** evaluations for task quality, source access, unsupported claims, prompt injection, data leakage, and tool abuse. Use synthetic fixtures first. Report live results separately with model version and date. A chat panel alone does not meet these requirements.

## 11. Other baseline controls

The first catalog covers the requested areas. The baseline must also check these controls. Use the focused skills in the catalog where their workflows apply.

| Area                      | Proposed minimum check                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| Secrets and configuration | No committed secrets. Validate production configuration. Use approved secret storage.             |
| Supply chain              | Use lockfiles, approved sources, dependency checks, and an inventory of shipped components.       |
| API and input handling    | Validate inputs, limit uploads and requests, and return controlled errors.                        |
| Operations                | Define health checks, owner, backup, restore, and outage procedures.                              |
| Delivery                  | Build the exact revision, run relevant checks, and record artifact provenance and rollback steps. |
| Data lifecycle            | Define classification, retention, deletion, and restore behavior across stores.                   |

Set exact thresholds and evidence requirements in enterprise policy. Do not claim certification from this checklist.

### Backup and restore

**Goal:** Recover the complete application state within approved business limits.

Define two targets per application:

- **Recovery point objective (RPO):** the maximum permitted loss of recent data, measured as time.
- **Recovery time objective (RTO):** the maximum permitted time to restore the required service.

The business owner approves these targets. Set backup frequency, retention, and recovery capacity to meet them. Do not use one fixed schedule for all applications.

The skill must check these requirements:

1. Inventory each database, object store, configuration record, and external dependency needed for recovery.
2. Define a consistent recovery point across databases and object versions. Record their linked references in a backup manifest.
3. Back up configuration without exposing secrets. Make required encryption keys and secret versions recoverable through a separate approved process.
4. Encrypt backups. Keep an isolated or immutable copy with separate access and deletion controls.
5. Define schedules, retention, location, and data-residency rules. Replication alone does not prove recoverability.
6. Alert on failed jobs, missing backups, and backups older than the permitted limit. Assign an owner to each alert.
7. Restore into an isolated environment at the approved test interval. Keep production integrations disabled during the test.
8. Verify records, files, object versions, permissions, and application behavior after restore. Measure recovery time and the actual recovery point.
9. Record results and repair failed recovery steps. Keep a current recovery procedure and support contact.

A successful backup job and a successful restore test are separate results. Checksums alone do not prove that the application can recover. Do not overwrite a live workspace to test recovery.

Offline encrypted backups and regular recovery testing are supported by the [CISA StopRansomware Guide](https://www.cisa.gov/stopransomware/ransomware-guide). The enterprise must select the actual backup service and approved targets.

**Evidence:** backup manifest, job record, failure-alert test, access checks, and dated restore report. The restore report must state the tested source versions, achieved RPO and RTO, and unresolved gaps.

### Uniform API and operational behavior

Use common error codes, validation messages, pagination, and API version rules. Define safe retries and duplicate-request handling for mutations. Set timeouts and rate limits in policy.

Separate operational monitoring from SIEM events. Monitoring tracks availability, latency, errors, resource use, and queue delays. SIEM supports security detection and investigation. Link both with correlation IDs where applicable.

Define health and readiness checks that match the deployment model. Do not expose secrets in health responses. Route alerts to the recorded owner and test delivery.

Record service-to-service identity as part of access control. Apply accessibility checks as part of UI consistency. Define database migration and rollback behavior as part of release verification.

## 12. Findings, exceptions, and release decisions

Use these states per check:

| State          | Meaning                                            |
| -------------- | -------------------------------------------------- |
| Pass           | Required evidence meets the rule.                  |
| Fail           | Evidence shows that the rule is not met.           |
| Not applicable | The rule does not apply. Give a reason.            |
| Not verified   | Required evidence is missing or stale.             |
| Blocked        | Missing access or a dependency prevents the check. |

Keep evidence state separate from exception state. An accepted exception does not turn Fail into Pass.

Each finding needs rule ID, severity, description, source location, evidence, impact, owner, and repair. Each exception needs rule ID, scope, reason, compensating control, approver, and expiry date. Recheck expired exceptions.

Example finding:

```json
{
  "schemaVersion": "1.0",
  "applicationId": "sample-orders",
  "sourceRevision": "example-revision",
  "policyVersion": "1.0.0",
  "ruleId": "STORE-001",
  "status": "fail",
  "severity": "high",
  "location": "server/features/orders/upload.ts:42",
  "summary": "Uploaded originals remain on local disk.",
  "evidence": ["fixture-upload-report.json"],
  "verificationScope": "fixture",
  "exceptionId": null,
  "owner": "orders-team"
}
```

The complete report also needs run ID, timestamp, skill and checker versions, policy digest, evidence references, and required-check coverage. Redact sensitive evidence before publication.

CI enforces deterministic release rules. A required Fail blocks release unless policy permits a valid exception. Not verified and Blocked do not satisfy a required control. Publish readable Markdown and machine-readable JSON. Do not hide failed required controls behind an average score.

Human reviewers decide findings that need judgment. The skill does not approve its own exception or prove production readiness.

## 13. Operation across the application estate

Maintain a registry with owner, repository, environment, risk class, policy release, shared package versions, and last verification result.

Run relevant checks on pull requests and before release. Run periodic checks for policy drift and expired evidence when an operator authorizes that schedule.

Cache results only for the same revision, policy digest, checker version, and relevant environment state. Use bounded queues and isolated workers at scale. Restrict evidence access to approved users.

Shared releases need compatibility notes and migration paths. Track adoption per application. Use pilots, batches, stop conditions, and individual rollback. Do not block unrelated applications unless policy requires it.

## 14. Skill packaging and acceptance

Proposed package layout:

```text
consistency-check/
  SKILL.md
  references/policy-contract.md
  references/report-schema.json
  scripts/check-profile.ts
```

Create only files needed by the workflow. `SKILL.md` contains a precise name and description, triggers, scope, modes, and reference links. Put long schemas and integration details in references. Use scripts for repeated deterministic checks.

Keep policy and report contracts common to the family. Declare and pin shared dependencies. A focused skill must work without loading unrelated skills. The coordinator loads only applicable skills.

Before publishing, test isolated applications that include:

- A compliant application and known defects.
- A rule that does not apply.
- Missing credentials, provider outages, and incomplete evidence.
- Existing data that must be preserved.
- A repair run twice without duplicate changes.
- A version update that fails and needs rollback.

Verify detection, preservation of unrelated work, and truthful reporting. Validate packaging separately from control behavior. Pin skill and checker versions in CI.

## 15. Development sequence

| Stage         | Deliverable                                      | Exit condition                                             |
| ------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| 1. Define     | Rules, profiles, report schema, and owners.      | Each required rule has evidence and a release decision.    |
| 2. Inspect    | Coordinator and baseline checks.                 | Compliant and defective fixtures produce correct results.  |
| 3. Foundation | Modular, identity, audit, and storage contracts. | Isolation, failure, and data-preservation checks pass.     |
| 4. UI         | Look-and-feel and change-look skills.            | Pilots pass UI and rollback checks.                        |
| 5. AI         | Optional assistant skill.                        | Access, data, action, and task-quality evaluations pass.   |
| 6. Estate     | Registry integration and staged adoption.        | Owners can track versions, gaps, exceptions, and outcomes. |

Start with inspection and reports. Add repairs after checks are reliable. Select representative pilots before wider use.

## 16. Raazi pilot boundaries

Raazi can be a pilot. This proposal is not an assessment result.

- Retain React, TypeScript, Node.js, the Raazi name, and bundled SNGPL identity.
- Retain the light, compact composer at the bottom and independent message scrolling.
- Preserve the database, encryption key, signing secret, workspace namespace, and object versions.
- Assess module boundaries before refactoring. Filenames alone do not prove failure.
- Existing audit entries do not prove SIEM delivery.
- Check S3 originals and legacy SQLite originals. Do not migrate or delete them during inspection.
- The object-store rule does not authorize removal of metadata databases or key files.
- Retain the one-replica limit until distributed coordination is designed and verified.
- Use Edge and isolated browser fixtures. Live PostgreSQL needs a disposable `RAAZI_TEST_DATABASE_URL`.
- Report live AD, Huawei S3, Jev, SIEM, model-provider, and production checks separately.

The next implementation step is a read-only baseline report against an agreed first policy release. Skill installation, repairs, and fleet deployment are later work.

## 17. Use in different projects

Maintain the skill family and policies in a central versioned repository. Publish approved releases. Each project selects a release and provides its own application profile. Keep credentials outside the profile.

The profile identifies the application type, owner, policy version, design system, integrations, data classification, recovery targets, and exceptions. Check profile declarations against evidence.

| Project type         | Typical applicable controls                                                             |
| -------------------- | --------------------------------------------------------------------------------------- |
| Internal portal      | UI, identity, access, SIEM, data, backup, and release controls.                         |
| Background processor | Module boundaries, service access, SIEM, storage, health, backup, and release controls. |
| Knowledge assistant  | Applicable baseline controls plus AI data, retrieval, and tool controls.                |

Start an existing project in Inspect mode. Produce a baseline report before repairs. For new projects, apply the baseline during initial development.

Example request after the skills are developed and installed:

```text
Use consistency-check to inspect this project.
Read the application profile and pinned enterprise policy.
Report evidence and gaps. Do not change code.
```

For an authorized repair, name the control and requested scope. Run relevant checks after the change. Record target-environment checks separately.

Run repeatable checks in CI for each project. Track policy and package adoption in the application registry. A central change-look request must identify the selected repositories, target version, pilot group, and stop conditions.
