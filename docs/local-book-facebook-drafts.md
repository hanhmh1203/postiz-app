# Local book Facebook drafts

The local book batch prepares Postiz drafts for the Facebook Page `Vì cuộc sống là ko chờ đợi`. It never publishes posts by itself.

## Run the batch

```bash
bash scripts/local/create-book-facebook-drafts.sh /absolute/path/to/book-resources --limit 10
```

Use `--dry-run` to generate local previews without uploading media or creating Postiz drafts.

The batch scans eligible books from the book portal database and can create three variants for each book:

- one long review draft from the latest review Markdown file plus `land.png`;
- ten shorter standalone idea drafts derived from the same review, each using `land.png`;
- one video draft for every complete Short resource it finds.

Every root draft has a first comment with the long YouTube review URL. A missing review, image, Short video, or Short metadata entry is reported for that variant while the remaining work continues.

## Required book resources

The image variants require:

```text
<book-directory>/
  *-phan-tich.md
  land.png
```

Short video drafts additionally use `shorts.txt`, `youtube_metadata_short.md`, and the matching MP4 files under `output/shorts/`.

## Generated idea set

Postiz uses the configured local Codex bridge to generate exactly ten Vietnamese Facebook posts in one request. Each post is 350–700 characters, uses a distinct angle grounded in the source review, includes 3–5 hashtags with `#WillReadBook`, contains no URL, and directs readers to the first comment.

The generated set is saved under:

```text
<BOOK_FACEBOOK_DRAFT_OUTPUT>/generated-ideas/<book-id>/<source-checksum>.json
```

This file lets a later run resume a partially failed set without changing the generated copy.

## Idempotency

Completed work is recorded in `<BOOK_FACEBOOK_DRAFT_OUTPUT>/state.json`.

- Review drafts use `variant: "review"`.
- Idea drafts use `variant: "idea"` plus `ideaNumber: 1..10`.
- Short drafts use `variant: "short"` plus `shortName`.

Running the same batch again skips every current state entry. If source material changes, the item is reported as `source_changed` so the batch does not create an unreviewed duplicate.

## Review drafts in Postiz

Open `http://localhost:4007`, sign in, and open the Calendar or Posts area. Filter for the Facebook Page `Vì cuộc sống là ko chờ đợi` and status **Draft**. Each idea appears as a separate image post with its YouTube link in the first comment. You can edit, publish now, or schedule each draft from Postiz.

Run reports and dry-run previews are stored below `<BOOK_FACEBOOK_DRAFT_OUTPUT>/runs/` and `<BOOK_FACEBOOK_DRAFT_OUTPUT>/previews/`.
