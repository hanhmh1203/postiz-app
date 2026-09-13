# Book Facebook Idea Drafts Design

## Goal

Extend the existing book Facebook batch so each eligible book also produces ten standalone text drafts for the Facebook Page `Vì cuộc sống là ko chờ đợi`. The drafts are derived from the latest review Markdown file, reuse the book's `land.png`, and include a first comment linking to the long YouTube review.

The command remains the existing entrypoint:

```bash
bash scripts/local/create-book-facebook-drafts.sh /absolute/book/root --limit 10
```

## Result per book

When the required resources exist, the batch can create:

- one long Facebook review draft with `land.png`;
- ten standalone idea drafts with the same `land.png`;
- zero or more Short video drafts when complete Short resources exist.

Missing or invalid resources for one variant do not stop the other variants or later books. The command creates drafts only. Publishing and scheduling remain manual actions in Postiz.

## Idea generation

The batch sends the source review to the existing Postiz generator backed by the local Codex bridge and requests exactly ten distinct standalone Facebook posts in one generation call.

Every idea post must:

- contain 350 through 700 Unicode characters;
- open with its own hook;
- develop one concrete lesson, observation, question, or practical application grounded in the source review;
- invite the reader to open the full review link in the first comment;
- contain no URL;
- contain three through five hashtags, including `#WillReadBook`.

The client rejects the whole generated set unless it contains exactly ten valid posts. Transient or malformed generation is retried using the batch's existing retry policy.

## Durable generated artifact

AI output is saved before any idea draft is created:

```text
<output>/generated-ideas/<book-id>/<source-checksum>.json
```

The artifact contains the source checksum and ten numbered posts. A rerun after a partial failure reuses this artifact, so it resumes with the same text instead of generating a different set.

The source checksum covers the book identifiers, long YouTube URL, Page name, template version, review file, and `land.png`. Each idea also has its own checksum derived from the source checksum, idea number, and generated content.

## Idempotency and failure isolation

State entries use `variant: "idea"` and `ideaNumber: 1..10`. Draft markers also contain the book ID, variant, idea number, and checksum. This gives every idea a stable identity and prevents duplicate drafts after retries or reruns.

Draft creation runs independently for each idea. A failed idea is reported and the batch continues with the remaining ideas, Shorts, and books. State is written after every successful draft. If all ten current idea state entries already exist, generation is skipped entirely.

When the source review, image, YouTube URL, Page, or template changes, existing idea entries are reported as `source_changed`; the batch does not silently create duplicates.

## Media and comments

The batch uploads `land.png` lazily and reuses the returned Postiz media object for the long review and all ten idea drafts during the same run. Each idea receives this first comment:

```text
Để nghe review trọn vẹn, bạn xem tại đây: <long-youtube-url>
```

The YouTube URL must already pass the existing long-video URL validation.

## Reports and dry runs

JSON and Markdown run reports include `variant: "idea"` and `ideaNumber`. Draft text is excluded from reports. In dry-run mode, the generated artifact and per-idea Markdown previews are written, but no media is uploaded, no Postiz draft is created, and no completed state entry is stored.

`--limit` continues to count books that create at least one draft, regardless of how many variants that book creates.
