# Book Review Facebook Draft Batch With Optional Shorts

**Date:** 2026-09-13

**Target Facebook Page:** `Vì cuộc sống là ko chờ đợi`

## Goal

Extend the existing book review Facebook draft batch so one run can create the existing long review image draft and any complete Facebook video Short drafts found for the same book. Short resources are optional and failures are isolated per Short.

## User-visible behavior

The existing `book-facebook-drafts` command remains the only batch entrypoint. For each eligible book, it evaluates the long review draft and the available Shorts independently:

- The long review draft keeps its current caption, `land.png`, and first comment containing the long YouTube review URL.
- Every complete Short becomes a separate Postiz Facebook draft with its MP4, the matching YouTube Short description and hashtags, and the same long YouTube review URL in the first comment.
- If the book has no Short resources, the batch still processes the long review draft and continues normally.
- If one Short lacks its MP4 or metadata section, only that Short is skipped. Other Shorts and books continue.
- If upload or draft creation fails for one Short, the run records that failure and continues.
- The batch never publishes or schedules. The user reviews each draft in Postiz.

The existing `--limit 10` continues to count successfully processed books rather than individual drafts. A book may therefore create one long review draft plus multiple Short drafts.

## Resource discovery and pairing

Short order and identity come from non-comment rows in `shorts.txt`. A row such as:

```text
short_03_lanh_dao_cap_do_5 15 15
```

maps to:

```text
output/shorts/short_03_lanh_dao_cap_do_5/short_03_lanh_dao_cap_do_5.mp4
```

The numeric position maps to `### Short 03 - ...` in `youtube_metadata_short.md`. Each metadata section must contain non-empty `#### Description` and `#### Hashtag` values. Hashtags are stored in the existing comma-separated YouTube format and converted to Facebook tokens such as `#Shorts #TomTatSach #WillReadBook`.

The Facebook post text is the exact trimmed description followed by a blank line and the converted hashtags. Postiz does not call the AI generator for Short copy because approved Short metadata already exists.

Discovery returns a result for every `shorts.txt` row:

- `ready`: MP4 and metadata are both valid.
- `video_missing`: the expected MP4 is missing or empty.
- `metadata_missing`: the metadata file or matching Short section is absent or incomplete.

Missing `shorts.txt` means the book has no Shorts and produces no Short result rows.

## Independent state and idempotency

State advances to version 2. Each entry identifies one variant:

- `variant: "review"` for the existing long image draft.
- `variant: "short"` plus `shortName` and `shortNumber` for a Short draft.

Version 1 entries migrate in memory to `variant: "review"`. Existing review drafts remain recognized, so rerunning a book whose review was already drafted or published can still create missing Short drafts.

Each Short checksum includes the book and production IDs, long YouTube URL, target Page, template version, Short identity, MP4 bytes, description, and hashtags. Its deterministic Postiz IDs use a marker derived from the Short checksum. A completed Short is never recreated by a repeated run.

State is written immediately after every successful draft. A crash therefore cannot lose all progress from a book containing several Shorts.

## Batch accounting

The run report keeps the current top-level categories and adds `variant`, `shortName`, and `shortNumber` where applicable. A missing Short resource is recorded in `skipped`; an upload or Postiz failure is recorded in `failed`.

A book counts toward `--limit` when its available work has been evaluated and at least one review or Short draft was newly created. Already completed books and books containing only invalid resources do not consume the success limit, allowing the scanner to continue until ten books create work or the candidate list ends.

## Postiz client changes

The local client gains a generic media upload that derives the MIME type from the file extension and accepts PNG, JPEG, and MP4 resources used by this batch. Draft creation accepts one media object and a variant-specific deterministic marker. The existing long review API remains compatible.

Short draft creation sends two values in one Facebook post group:

1. Root value: Short description, Facebook hashtags, and the MP4.
2. Child value: `Để nghe review trọn vẹn, bạn xem tại đây: <long YouTube URL>`.

## Facebook local video publishing

Self-hosted Postiz stores media behind a localhost URL that Meta cannot fetch. The Facebook provider therefore uploads locally stored videos as streamed multipart `source` data to the Page `/videos` endpoint, including the post description and `published=true`. Publicly reachable media URLs keep the existing `file_url` behavior.

Local-path resolution must require `STORAGE_PROVIDER=local`, match the configured `FRONTEND_URL` origin, require the `/uploads/` prefix, and reject traversal outside `UPLOAD_DIRECTORY`.

## Error handling

- Missing optional Short resources never throw a batch-level error.
- A malformed metadata section affects only its matching Short.
- Transient Postiz upload and draft creation failures keep the existing bounded retry policy.
- After an uncertain draft response, the client checks the deterministic Short ID before reporting failure.
- The Facebook provider classifies Meta errors through the existing streamed-upload error path.
- No secret, token, generated content, or media bytes are written to reports.

## Verification

Automated tests cover metadata parsing, resource pairing, version 1 state migration, per-Short skip behavior, independent idempotency, MIME-aware uploads, draft payloads, local multipart Facebook video upload, and unchanged remote `file_url` behavior.

The integration gate uses `Từ tốt đến vĩ đại`, which currently contains six Short MP4 files and six metadata sections. With its review entry already present in state, a real run must skip the review and create six Short drafts without publishing them. API verification must confirm six root drafts, six comments, MP4 media on each root, the expected description and hashtags, the long YouTube URL in each comment, and `DRAFT` state for all twelve records.
