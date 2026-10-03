# Admin guide

## Configure the local model

1. Open **Administration → Models**.
2. Enter the base URL, such as `http://llm.internal:8000/v1`.
3. Enter the model name.
4. Enter an API key if the service requires one.
5. Set the system prompt.
6. Select **Save model settings**.

Raazi calls `/chat/completions` with `stream: false`.

Enable **This model accepts image input** only for a vision model. The service must accept OpenAI-compatible `image_url` message parts with base64 data URLs. Test a real image before rollout.

## Configure S3 object storage

Use **Administration → Storage**. Raazi supports an S3-compatible endpoint, including a suitably configured Huawei OceanStor Pacific service.

1. Create a private bucket on the storage service.
2. Create credentials for Raazi.
3. Select **Enable file uploads**.
4. Enter the S3 endpoint and bucket.
5. Enter the region required by your service.
6. Set an object prefix, such as `raazi`.
7. Start with **Use path-style bucket addresses** enabled.
8. Enter the access key and secret key.
9. Select **Test bucket**.
10. Check the result. Then select **Save storage settings**.

The test uses the values in the form. It does not save them.

The test checks bucket access, writes a temporary object, reads its bytes, and deletes it. Save runs the same test before it changes the configuration. A failed test leaves the saved configuration unchanged.

Permit bucket access and object write, read, and delete operations. For a versioned bucket, permit access to the saved object version. The test deletes its returned version if the service returns a version ID.

If cleanup fails, the error shows the test object key. Remove that object before you retry. A service timeout can leave an object behind. Configure a cleanup policy for old objects under `_checks/`.

The endpoint uses AWS Signature Version 4. Uploads send a Content-MD5 value. Optional AWS streaming checksum behavior is disabled for compatibility. Confirm the required region, signing, certificate, and address style with your storage admin.

Use HTTPS in production. For a private certificate authority, set `NODE_EXTRA_CA_CERTS` to the trusted PEM certificate file before Node starts.

New uploads require enabled object storage. This includes admin repository uploads. Text entered with **Add text directly** remains in SQLite.

## Keep storage credentials and old files

Both S3 keys are encrypted in SQLite. The API returns saved-key indicators. It does not return plaintext keys.

Leave the key fields blank to keep saved keys on the same endpoint. A different endpoint requires both keys.

A new endpoint or bucket affects new uploads. Existing files keep their original storage reference. Raazi keeps the old storage configuration so it can read and delete those originals.

Do not remove an old bucket or revoke its credentials while files still use it. To rotate keys for an old endpoint and bucket, save that target with its new keys. Then restore the desired active target.

Turning uploads off blocks new uploads. Existing files remain readable and can still be deleted.

## Configure embeddings

1. Open **Embeddings**.
2. Select **Use an embedding model**.
3. Enter the base URL, model name, and optional API key.
4. Enter the model's actual vector dimensions.
5. Select **Save embedding settings**.

Saving tests `/embeddings`. Raazi checks response indices, dimensions, finite numbers, and nonzero vectors. It accepts dimensions from 1 to 2,000. It does not request vector truncation.

Changing the endpoint, model, dimensions, or vector backend requires reindexing. Key-only changes keep valid vectors. Reindex shared repositories in **Knowledge**. Users reindex private uploads in **Your files**.

Keep embeddings disabled to use SQLite FTS5 keyword search.

## Create shared knowledge

1. Open **Knowledge**.
2. Create a repository.
3. Enter the exact allowed identity-provider group IDs.
4. Select the repository in the upload form.
5. Upload a PDF, DOCX, TXT, or Markdown file.
6. Check its status.

An empty group list permits all signed-in users. Admins can access all shared repositories. Private chat uploads remain restricted to their owner, including when another user is an admin.

An index failure keeps the original and extracted text. Use **Retry** or **Reindex**. An invalid repository file is rejected before it creates a document.

Raazi retrieves only authorized, ready passages. It combines private files and the selected repositories. Answers can cite up to eight passages.

## Manage users

Users receive name, email, groups, and optional department or job title from identity claims. Add enterprise context through the admin user controls.

Disable a user to block subsequent requests. Group membership refreshes at sign-in. Sessions expire after eight hours.

Automated enterprise profile synchronization, workflow execution, repository editing, and connectors are not implemented yet.

## Storage references

Huawei describes Pacific object storage as compatible with Amazon S3. Compatibility still needs a test on your appliance and firmware. See the [Huawei Pacific product brochure](https://e-file.huawei.com/en/material/MaterialDownload?materialid=62dc143d87474955a82a43cb23d9567c).

For AWS SDK checksum settings, see the [AWS JavaScript SDK guide](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html).

For the writing standard, see [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf).
