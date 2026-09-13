# Book Review Facebook Draft Batch Design

**Date:** 2026-09-13

**Status:** Approved design, pending user review of the written specification

**Target Facebook Page:** `Vì cuộc sống là ko chờ đợi`

## Purpose

Create Facebook review drafts in Postiz from completed Will Read Book projects. Each draft summarizes an existing long-form book review, attaches the book's existing `land.png`, and carries the matching long YouTube review URL as the first comment. The workflow processes up to ten eligible books per run and never publishes content automatically.

## Scope

The first version is a standalone local batch tool under `postiz-app/scripts/local/`. It accepts an absolute batch-directory path, reads book and production data from the local `book_library` portal in read-only mode, reads review resources from `book_reader`, asks Postiz to generate the Facebook copy through the configured Codex bridge, and saves drafts to the selected Facebook Page.

The first version does not add a portal button, publish posts, schedule posts, generate new images, edit book reviews, upload YouTube videos, or manage Facebook Pages. The user reviews every draft in Postiz and chooses whether to publish it immediately or schedule it.

## System Context

The workflow joins three existing local systems:

1. `book_library` is the catalog and production source of truth. An eligible production has status `youtube_uploaded` and resolves to a completed long-video receipt with a non-empty `video_url`.
2. `book_reader` contains the review resources. The source review is the newest matching `*-phan-tich.md` for the book. `review_profile.md`, YouTube metadata files, TTS text, and other Markdown files are never selected as review input. The Facebook image is the existing `land.png` in the same book project.
3. `postiz-app` generates the social copy through its configured `AI_PROVIDER=codex` path and stores the post, media, and first comment as a Postiz draft for the Facebook integration named `Vì cuộc sống là ko chờ đợi`.

All paths remain local. Real Postiz credentials, Meta secrets, access tokens, and the Codex bridge token remain in ignored files and are never written to reports or committed to Git.

## Components

### Batch entrypoint

A Bash wrapper accepts the absolute batch-directory path and optional execution flags, then invokes the Node.js batch program from a known repository root. This follows the `book_reader` convention of giving the user one Bash file to run instead of a sequence of shell commands.

The supported modes are:

- `--dry-run`: perform discovery, validation, generation, and reporting without creating anything in Postiz.
- `--limit 1`: create or preview one eligible book for the first real integration test.
- `--limit N`: process up to `N` eligible books, where `1 <= N <= 10`.
- No explicit limit: use the default limit of 10.

No option may select `now` or `schedule`. The Postiz client always sends `type: draft`.

### Portal reader

The portal reader opens the configured `book_library` database in read-only mode. It selects productions with status `youtube_uploaded`, resolves their local edition/book paths, upload time, manifest path, and long-video URL, and keeps only records whose resolved project directory is inside the requested batch root.

It does not update portal metadata. Records are ordered by `youtube_uploaded_at` ascending, with stable book identity as the tie-breaker, so older uploaded reviews are drafted first.

### Resource resolver

For each portal candidate, the resolver:

1. Resolves and validates the canonical book project directory.
2. Selects the newest `*-phan-tich.md` by modification time, then by normalized path as a deterministic tie-breaker.
3. Requires a readable, non-empty `land.png` in the book project directory.
4. Requires a completed long-video receipt and a valid HTTPS YouTube video URL.
5. Rejects playlist URLs, Shorts URLs, missing files, paths outside the requested batch root, and symlink escapes.

Skipped candidates do not consume the ten-book success limit. The scan continues until ten drafts are created or no eligible candidates remain.

### Postiz client

The Postiz client authenticates only against the local Postiz deployment using credentials from an ignored local credential file. It performs a preflight check before processing any book:

- Postiz is reachable.
- The Codex bridge reports healthy and authenticated.
- Exactly one active Facebook integration matches `Vì cuộc sống là ko chờ đợi`.
- The resolved integration is complete and is not an in-between OAuth record.

The client sends the source review and a fixed Facebook-writing brief through the Postiz generator. It validates the generated response, uploads `land.png` to Postiz media storage, and creates one draft whose first item is the Facebook post and whose second item is the supported Facebook comment. This preserves the comment in Postiz so it is published after the root post when the user later publishes or schedules the draft.

The client refuses to send a payload unless its type is exactly `draft` and its integration ID matches the preflight result.

### State and reports

Persistent state lives in the visible directory:

`book_reader/outputs/facebook-postiz-drafts/`

The state records a stable book/edition identity, source paths, source checksum, long-video URL, target integration identity, Postiz draft ID, creation time, and template version. The checksum covers the review contents, `land.png`, video URL, target Page identity, and content-template version.

Each run also writes a timestamped JSON report and a readable Markdown report with four groups:

- `created`: a new Postiz draft was saved successfully.
- `skipped`: the candidate was ineligible or already has the same completed draft checksum.
- `source_changed`: a prior draft exists but its tracked source checksum differs.
- `failed`: generation, media upload, validation, or draft creation failed.

Reports never contain credentials, access tokens, session cookies, full Postiz API responses, or full review contents.

## Eligibility and Duplicate Rules

A book is eligible only when all of these conditions hold:

- The portal production status is `youtube_uploaded`.
- The production resolves to a completed long-video URL.
- Its canonical local project directory is inside the supplied batch root.
- A readable, non-empty `*-phan-tich.md` exists.
- A readable, non-empty `land.png` exists.
- No completed state entry exists with the same source checksum and target Page.

If a completed entry has the same identity but a different checksum, the candidate is reported as `source_changed`. The tool does not create a second draft automatically. The user can inspect or remove the earlier draft and explicitly clear or replace its state entry in a later workflow.

State is written only after Postiz confirms the complete draft, media attachment, and first-comment structure. A failed or interrupted operation remains retryable. When a request outcome is uncertain, the tool queries Postiz using the recorded correlation marker before retrying so it does not create a duplicate draft.

## Facebook Content Contract

The generated post is Vietnamese prose between approximately 700 and 1,200 characters. Natural paragraph breaks count toward the target; the limit is a quality target rather than byte truncation.

The content follows this structure:

1. One short opening hook grounded in the source review.
2. Two or three of the book's most useful or interesting ideas.
3. One practical observation about what the reader may gain from the book.
4. A closing invitation to find the complete review in the first comment.
5. Three to five relevant hashtags, always including `#WillReadBook`.

The generator must paraphrase the source, avoid extended quotations, avoid invented quotations or facts, preserve the review's actual judgment, and avoid presenting unsupported claims as facts. The main post contains no YouTube URL.

The first comment uses this template:

`Để nghe review trọn vẹn, bạn xem tại đây: <long-video-url>`

The comment contains the matching long-video URL only. It must not use a playlist URL or Shorts URL.

## Failure Handling

Discovery and validation failures are isolated per book. One invalid book does not abort the batch. Generation and Postiz operations are retried at most twice for transient network, timeout, or server errors, using bounded backoff. Permanent validation or authentication failures are not retried.

The whole run stops before creating drafts when a global preflight fails, including ambiguous/missing target integration, unhealthy Postiz, unavailable Codex authentication, or unreadable state storage. Per-book failures are recorded and processing continues until the success limit is reached or candidates are exhausted.

Temporary media or generation artifacts are placed in a visible run directory beneath `outputs/facebook-postiz-drafts/` and removed after a successful run. Failed-run artifacts needed for diagnosis remain referenced by the report and contain no secrets.

## Operational Flow

The rollout sequence is fixed:

1. Run automated unit and contract tests.
2. Run `--dry-run --limit 1` against a real eligible book and inspect its generated caption, image selection, comment URL, and report.
3. Run `--limit 1` to create one real Postiz draft.
4. Open Postiz and verify the target Page, caption, `land.png`, first comment, and draft state. Nothing is published.
5. Run a normal batch with the default limit of 10.
6. Review the batch report and then review, schedule, or publish drafts manually in Postiz.

## Testing Strategy

Unit tests cover:

- Portal filtering and oldest-upload-first ordering.
- Batch-root containment and symlink escape rejection.
- Deterministic selection of the newest `*-phan-tich.md`.
- Exclusion of profile, metadata, and unrelated Markdown files.
- Missing or empty review and `land.png` handling.
- Long-video URL acceptance and playlist/Short rejection.
- Maximum limit enforcement and the rule that skipped candidates do not consume it.
- Caption length, required `#WillReadBook`, URL exclusion, and comment-template validation.
- Draft-only payload enforcement and exact Facebook integration matching.
- Retry classification, partial-failure reporting, idempotent recovery, duplicate skipping, and `source_changed` behavior.
- Secret redaction in logs and reports.

Contract tests use temporary fixtures and a fake Postiz server to verify generator, media, draft, comment, authentication, timeout, and retry interactions. The final integration test creates exactly one real local Postiz draft and verifies it through the Postiz API and user interface before the ten-book batch is allowed.

## Success Criteria

The design is successful when a user can run one Bash wrapper with an absolute batch directory and receive up to ten new Postiz drafts for `Vì cuộc sống là ko chờ đợi`, each containing a grounded Vietnamese review, the correct `land.png`, and a first comment linking to the correct long YouTube review. No post is published automatically, repeat runs do not create duplicates, one bad book does not block valid books, and the final report explains every candidate outcome without exposing secrets.
