# Book Facebook Idea Drafts Implementation Plan

**Goal:** Add ten review-derived Facebook image drafts per eligible book to the existing Postiz batch, with durable generation, independent state, and a long-video first comment.

**Architecture:** Reuse Postiz's `/posts/generator` endpoint with `thread_long` to generate one exact ten-item set. Validate it in `PostizLocalClient`, persist the set as an atomic JSON artifact, and process each numbered idea through the existing media-draft and state/report pipeline. Keep review and Short behavior unchanged.

**Tech stack:** Node.js ESM, built-in `node:test`, Postiz REST API, local Codex bridge, JSON state/artifacts.

---

### Task 1: Define idea identity and generated artifact helpers

**Files:**

- Modify: `scripts/local/book-facebook-drafts-lib.test.mjs`
- Modify: `scripts/local/book-facebook-drafts-lib.mjs`

1. Add failing tests proving `classifyCandidate` distinguishes `ideaNumber` values.
2. Add failing tests for deterministic per-idea checksums and atomic generated-artifact round trips.
3. Implement idea identity matching, checksum generation, artifact validation/read/write, and safe report fields.
4. Run the library test file and confirm it passes.

### Task 2: Generate and validate ten standalone idea posts

**Files:**

- Modify: `scripts/local/postiz-local-client.test.mjs`
- Modify: `scripts/local/postiz-local-client.mjs`

1. Add failing tests for the exact generator request, exactly ten returned items, and per-item content rules.
2. Add a failing test that malformed or incomplete idea sets raise a retryable `generator_content_invalid` error.
3. Add failing tests for creating an idea draft with image media and the required first comment.
4. Implement the idea brief, validator, NDJSON parsing reuse, `generateIdeaPosts`, and `createIdeaDraft`.
5. Run the client test file and confirm it passes.

### Task 3: Integrate ideas into the book batch

**Files:**

- Modify: `scripts/local/create-book-facebook-drafts.test.mjs`
- Modify: `scripts/local/create-book-facebook-drafts.mjs`

1. Preserve existing focused tests by disabling idea generation explicitly in those test cases.
2. Add failing orchestration tests for ten drafts, one shared image upload, per-idea comments, artifact persistence, state entries, and dry-run previews.
3. Add failing tests for rerun idempotency, partial-failure resume, missing image/review isolation, and one failed idea continuing through later ideas.
4. Implement idea generation/reuse, source-change handling, per-item processing, shared land-media caching, and report fields.
5. Run the orchestration test file and confirm it passes.

### Task 4: Document the expanded batch behavior

**Files:**

- Modify: `docs/local-book-facebook-drafts.md`

1. Describe all three output variants and the exact ten-idea behavior.
2. Document the generated artifact, state identity, rerun behavior, and how to inspect idea drafts in Postiz.
3. Keep the command and draft-only safety boundary explicit.

### Task 5: Verify locally and with a real book

1. Run Prettier on changed Markdown and JavaScript files.
2. Run all local batch/client/library tests.
3. Run relevant Postiz provider tests and builds only if shared provider code changed.
4. Confirm local Postiz and Codex bridge services are healthy.
5. Run the real batch for one eligible book and verify ten new idea root drafts plus ten first-comment records are `DRAFT`, use `land.png`, and contain the long YouTube URL.
6. Rerun the batch and verify zero duplicate idea drafts are created.
7. Review the diff for secrets, then commit and push the feature branch.
