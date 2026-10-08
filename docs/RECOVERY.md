# Recover files and rebuild Raazi

## Keep these items separately

Keep the source release, environment configuration, ENCRYPTION_KEY, SECRET_KEY, AD settings, bucket credentials and private CA certificate in an approved secure location. The file catalogue and metadata do not contain keys. Protect the bucket and exported catalogue with the same access controls as the original documents. Enable bucket versioning and storage-level disaster recovery with the storage administrator; Raazi does not change bucket policies.

## Record the stored files

New uploads have `<original-object-key>.metadata.json` beside the original. It records the filename/title, MIME type, original object path and version, SHA-256, size, workspace and private owner or repository/group labels. No prompt content or credentials are added. Original names do not appear in object keys.

In Administration > Backups, use **Write file metadata** for older files or after changing repository permissions. Then use **Export file catalogue** and keep the JSON in a secure location. New database backup sets also include `file-catalogue.json`. These controls use the retained original store configuration, even if the current bucket has changed. Check the reported failures and retry. Legacy documents with only a SQLite original are not in the object catalogue; preserve their SQLite backup.

Access labels are recovery hints, not authorization grants. Do not publish private files or automatically trust group labels from a downloaded JSON file. A storage administrator can alter metadata; verify the catalogue against a trusted backup and confirm permissions independently. SHA-256 detects changes against the recorded hash, but does not authenticate the metadata itself. Metadata contains private filenames and owner identifiers: keep it private.

## Recover individual originals for another system

1. Use the catalogue, or list `.metadata.json` objects under the workspace uploads/knowledge prefixes with an approved S3 tool.
2. Parse the JSON as data. Reject unsafe filenames and paths; use a separate recovery directory and avoid overwriting files with duplicate names.
3. Download the exact bucket key and version in `original`, using separately supplied authorized credentials. Avoid substituting the latest version when a recorded version exists.
4. Check byte size and SHA-256 before reuse. Quarantine missing, changed or inconsistent files. For example, use `sha256sum recovered-file.pdf` on Linux.
5. Confirm ownership and repository access in the target system. Private uploads remain private to the recorded owner; if that owner cannot be resolved, keep the file inaccessible for administrator review.

No Raazi database is required to identify originals that have companion metadata. The object bytes remain in their original format. This is file recovery, not recovery of conversations, sessions, provider keys or vector indexes.

## Restore a full workspace elsewhere

Use the database backup set and manifest. Follow the isolated SQLite/PostgreSQL steps in [PRODUCTION.md](PRODUCTION.md#deploy-and-test-administration-backups). Preserve the original encryption key and namespace. Disable the copied daily schedule before starting an isolated restore, and prevent it from deleting objects in the live bucket. Restore matching PostgreSQL dumps and SQLite snapshots from one set. Original object versions must still exist. A database backup cannot recreate deleted bucket originals.

## Rebuild when databases are lost

1. Install the approved release and runtime in a new directory with fresh, separate databases and environment secrets. Configure authentication, storage, chat and embeddings. Keep automatic backups disabled during recovery.
2. Use companion metadata or the trusted catalogue to recover and verify original files as described above.
3. Recreate repository names and independently approved group access in Administration > Knowledge. Re-upload shared manuals into their matching repositories. New IDs and object keys are expected. Re-upload creates new stored originals; it does not attach the old object directly.
4. Reindex with the current embedding model. Wait for Ready and verify citations with representative questions. Recovered PDFs may still need OCR if extraction fails.
5. Resolve private owners through the identity system. Owners can upload their recovered files into their own workspace. Do not upload their documents into shared repositories. Keep unresolved files private pending review.
6. Reconfigure provider/storage credentials from the secure credential store, since metadata cannot recover them. Set new permissions and review administrator access before opening the rebuilt service.
7. Export a new catalogue and create a new manual backup. Enable daily scheduling after that backup completes.

Original documents can rebuild knowledge. Object metadata cannot rebuild lost chat history, usage records, preferences, extraction corrections, sessions or encrypted configuration. A full database restore is required for those records. Recovery remains a deliberate administrator operation; this release does not automatically import arbitrary bucket metadata.

## Deletion and stale metadata

Deleting a managed original also deletes its recorded metadata companion/version. Keep independent backups and storage retention if deleted files must remain recoverable. After changing repository access, refresh companions before exporting the catalogue. Exported catalogues and old metadata versions are snapshots; they may still refer to files that have since been deleted. Never treat their existence as proof that an object is still available or that access remains approved.
