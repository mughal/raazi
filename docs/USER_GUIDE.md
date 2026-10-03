# User guide

## Start a chat

1. Sign in.
2. Select **New chat**.
3. Select a knowledge repository if you need shared information.
4. Type your question.
5. Select **Send message**.

Raazi uses the local model that your admin configured. It sends your question, recent chat context, profile context, and selected source passages to that model.

## Read and reuse answers

Answers support headings, lists, tables, quotes, and code blocks. Select **Copy response** to copy the original Markdown. Use **Copy code** for a code block.

Use **Edit question** to change a saved question. Select **Save and resend**. After a successful answer, Raazi replaces that question and its later replies. Earlier messages remain. A failed model request leaves the saved chat intact.

Use **Resend question** to ask a saved question again. The same replacement rule applies. If another request changes the chat while the model answers, reload the chat before you retry.

The model menu appears on the right of the composer. An admin selects the available model.

## Organize chats

Use the history panel on the left. Search by chat title.

Use a chat menu to rename, pin, move, or delete a chat. Use **+** beside **Folders** to create a folder. Use the folder menu to rename or delete it.

Deleting a folder keeps its chats. Folder membership does not change knowledge access. Each user has a private history.

Draft text and selected files remain when you change pages. Drafts do not remain after a browser reload. Saved messages and folder collapse settings do remain.

## Choose your colors

Open **Your profile → Color palette**. Select Forest, Ocean, Indigo, Plum, Amber, or Slate.

Choose a **Composer shade**: Mist, Ivory, Mint, Sky, or Lavender. The preview shows its light background. The composer shade is independent from the workspace accent color.

Raazi saves both choices to your account. The workspace palette applies to buttons, links, tabs, and chat accents. The choice remains after reload and sign-in on another browser.

## Upload a file

1. Select **+** beside the repository selector in chat.
2. Select up to five files.
3. Wait for processing to finish.
4. Check the file status.
5. Type a question about the files.
6. Send the question.

If **+** is disabled, ask an admin to enable S3 object storage.

Chat uploads stay private to your account. They do not enter a shared repository. Original files keep their original format in object storage.

| File               | Support                                            | Limit                       |
| ------------------ | -------------------------------------------------- | --------------------------- |
| PDF                | Readable text, search, and physical page citations | 20 MB                       |
| DOCX               | Body paragraphs and tables, with section citations | 20 MB                       |
| TXT or Markdown    | UTF-8 text search                                  | 20 MB                       |
| PNG, JPEG, or WebP | Questions through a vision model                   | 10 MB and 16 million pixels |

Image input must be enabled by an admin. Raazi sends the image to the configured local model. Image knowledge indexing is not supported yet. Animated images are not supported.

Readable documents become private knowledge. Raazi uses embeddings if they are configured. Otherwise, it uses keyword search. A model service failure does not switch search modes.

Scanned PDFs need OCR before use. Raazi does not provide OCR yet. It keeps an unreadable chat document's original file and shows **unsupported**. Remove the file from the message before you send a question.

Other formats, including old `.doc` files, are not supported yet.

## Check the status

| Status          | Action                                                  |
| --------------- | ------------------------------------------------------- |
| `ready`         | Ask a question                                          |
| `failed`        | Check the error. Select **Retry** or **Reindex**        |
| `needs_reindex` | Reindex after an embedding configuration change         |
| `unsupported`   | Download the original. Convert it to a supported format |

A failed index keeps the original file. Reindexing does not upload it again.

The model can use up to five recent files in the active chat context. Recent images are sent again for follow-up questions. Combined image bytes must not exceed 20 MB.

## Open a citation

Select **[1]**, or a source card below the answer. Raazi opens the source excerpt.

For a PDF, select **Open original PDF at page N**. The link uses the physical page number. The PDF viewer must support page links.

DOCX citations use headings, paragraphs, or tables. Raazi does not assign PDF-style page numbers to DOCX content.

Source links check current access. A deleted source can no longer open. Saved chat answers remain.

## Manage uploaded files

Open **Knowledge → Your files**.

- Select a filename to open or download the original.
- Select **Use in chat** to start a new chat with that file.
- Select **Reindex** to rebuild its search passages.
- Select **Delete file** to remove its original and private knowledge.

Removing a file chip from a draft does not delete the stored file. Deleting a chat also keeps uploaded files. Use **Your files** to delete them.

## Know the current limits

Raazi does not stream answers. A response appears when the model finishes.

Document extraction accepts up to 500,000 characters and 500 PDF pages. DOCX extraction excludes images, headers, footers, and text boxes. Mixed PDFs can report pages without readable text.

Check important answers against the source. A citation shows the retrieved evidence. It does not prove that every part of an answer is correct.
