# Book Facebook Short Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing book Facebook batch so every complete local Short becomes its own Postiz draft with MP4, approved Short copy, and a first comment linking to the long YouTube review, while incomplete Shorts are skipped independently.

**Architecture:** Keep `book-facebook-drafts` as the only entrypoint. Add pure helpers for Short discovery, metadata parsing, checksums, and state identity; keep Postiz transport concerns in the local client; orchestrate review and Short variants independently per book; and stream local MP4 files directly to Meta when a draft is later published.

**Tech Stack:** Node.js ESM scripts and `node:test`, TypeScript/NestJS Facebook provider and Jest, Postiz REST API, local filesystem resources, JSON state version 2, Docker Compose.

## Global Constraints

- `--limit` remains an integer from 1 through 10 and counts books that create at least one new draft.
- Missing `shorts.txt`, MP4 files, or Short metadata must never stop another Short or book.
- Short post text is the exact trimmed `#### Description`, followed by a blank line and converted `#### Hashtag` tokens.
- Every Short first comment is `Để nghe review trọn vẹn, bạn xem tại đây: <long YouTube URL>`.
- All created Postiz posts must use type `draft`; this batch must never publish or schedule.
- Existing version 1 state entries migrate in memory to version 2 review entries.
- Existing review state must not prevent missing Short drafts from being created.
- Local Facebook MP4 publishing uses multipart `source`; publicly reachable media continues using `file_url`.
- Do not write credentials, access tokens, generated post bodies, or media bytes to reports.

---

### Task 1: Short resource model, parsing, checksums, and state migration

**Files:**
- Modify: `scripts/local/book-facebook-drafts-lib.test.mjs`
- Modify: `scripts/local/book-facebook-drafts-lib.mjs`

**Interfaces:**
- Produces: `discoverShortResources(workflowDirectory): Promise<ShortResource[]>`.
- Produces: `formatFacebookHashtags(value): string`.
- Produces: `computeShortChecksum(candidate, short, pageName, templateVersion): Promise<string>`.
- Changes: `STATE_VERSION` to `2`, `loadState()` migrates version 1 entries with `variant: 'review'`.
- Changes: `classifyCandidate(candidate, state, checksum, identity?)` matches review or Short identity without conflating variants.

- [ ] **Step 1: Write failing parser and discovery tests**

Add tests that build a temporary book directory containing `shorts.txt`, `youtube_metadata_short.md`, one valid MP4, one missing MP4, and one incomplete metadata section. Assert every row produces one result with `ready`, `video_missing`, or `metadata_missing`, and assert comma separated hashtags become `#Shorts #TomTatSach #WillReadBook`.

```js
const shorts = await discoverShortResources(bookDirectory);
assert.deepEqual(shorts.map(({ shortName, status }) => ({ shortName, status })), [
  { shortName: 'short_01_ready', status: 'ready' },
  { shortName: 'short_02_no_video', status: 'video_missing' },
  { shortName: 'short_03_no_metadata', status: 'metadata_missing' },
]);
assert.equal(formatFacebookHashtags('Shorts, Tom Tat Sach, #WillReadBook'), '#Shorts #TomTatSach #WillReadBook');
```

- [ ] **Step 2: Run the library tests and verify RED**

Run: `NODE_NO_WARNINGS=1 node --test scripts/local/book-facebook-drafts-lib.test.mjs`

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement parsing and discovery**

Parse `### Short NN` sections and collect non-empty `#### Description` and `#### Hashtag` bodies. Parse non-comment `shorts.txt` rows, derive `shortNumber` from `short_NN_`, validate the expected MP4 with `stat`, and return one non-throwing result per row. Treat missing `shorts.txt` as an empty list.

```js
export async function discoverShortResources(workflowDirectory) {
  // Read optional shorts.txt, parse metadata once, and classify every row.
}
```

- [ ] **Step 4: Write failing state and checksum tests**

Assert version 1 state becomes version 2 with review variants, review and Short entries with the same `bookId` classify independently, and changing MP4 bytes or metadata changes a Short checksum.

```js
assert.equal(migrated.version, 2);
assert.equal(migrated.entries[0].variant, 'review');
assert.equal(classifyCandidate(candidate, state, checksum, { variant: 'short', shortName }), 'new');
```

- [ ] **Step 5: Run tests and verify RED**

Run: `NODE_NO_WARNINGS=1 node --test scripts/local/book-facebook-drafts-lib.test.mjs`

Expected: FAIL on state version, variant identity, or missing Short checksum behavior.

- [ ] **Step 6: Implement version 2 state and independent identity**

Set `STATE_VERSION = 2`; migrate only valid version 1 state; include `variant`, `shortName`, and `shortNumber` in safe report fields; hash Short identity, long URL, Page, template version, MP4 bytes, description, and hashtags.

- [ ] **Step 7: Run tests and commit**

Run: `NODE_NO_WARNINGS=1 node --test scripts/local/book-facebook-drafts-lib.test.mjs`

Expected: PASS.

```bash
git add scripts/local/book-facebook-drafts-lib.mjs scripts/local/book-facebook-drafts-lib.test.mjs
git commit -m "feat: discover optional book short resources"
```

### Task 2: MIME aware uploads and Short draft payloads

**Files:**
- Modify: `scripts/local/postiz-local-client.test.mjs`
- Modify: `scripts/local/postiz-local-client.mjs`

**Interfaces:**
- Changes: `uploadMedia(mediaPath)` derives MIME from `.png`, `.jpg`, `.jpeg`, and `.mp4`.
- Produces: `createShortDraft({ integrationId, content, comment, media, marker })`.
- Keeps: `createDraft(...)` behavior and long caption validation unchanged.

- [ ] **Step 1: Write failing MIME upload test**

Intercept `/media/upload-simple`, inspect the submitted `FormData`, and assert an `.mp4` file has `video/mp4` and its basename.

```js
const file = request.body.get('file');
assert.equal(file.type, 'video/mp4');
assert.equal(file.name, 'short_01.mp4');
```

- [ ] **Step 2: Run client tests and verify RED**

Run: `NODE_NO_WARNINGS=1 node --test scripts/local/postiz-local-client.test.mjs`

Expected: FAIL because upload currently labels all files `image/png`.

- [ ] **Step 3: Implement MIME detection**

Use a closed extension map for `.png`, `.jpg`, `.jpeg`, and `.mp4`; reject unsupported extensions before upload.

- [ ] **Step 4: Write failing Short draft test**

Call `createShortDraft` with short copy and MP4 media. Assert the root and comment use deterministic IDs, root media is attached, `type` is `draft`, and the existing long-caption length contract is not applied to approved Short copy.

- [ ] **Step 5: Run tests and verify RED**

Run: `NODE_NO_WARNINGS=1 node --test scripts/local/postiz-local-client.test.mjs`

Expected: FAIL because `createShortDraft` is absent.

- [ ] **Step 6: Implement a shared draft creator and Short validation**

Extract the existing payload/response logic to one private method. Keep `createDraft` as the compatible review wrapper and add `createShortDraft`, requiring non-empty URL-free Short text, a valid media object, and the established comment template with a long YouTube URL.

- [ ] **Step 7: Run tests and commit**

Run: `NODE_NO_WARNINGS=1 node --test scripts/local/postiz-local-client.test.mjs`

Expected: PASS.

```bash
git add scripts/local/postiz-local-client.mjs scripts/local/postiz-local-client.test.mjs
git commit -m "feat: create Postiz video short drafts"
```

### Task 3: Independent review and Short batch orchestration

**Files:**
- Modify: `scripts/local/create-book-facebook-drafts.test.mjs`
- Modify: `scripts/local/create-book-facebook-drafts.mjs`

**Interfaces:**
- Consumes: `discoverShortResources`, `computeShortChecksum`, variant-aware `classifyCandidate`, and `client.createShortDraft`.
- Changes: one book runs review work and all Short work independently.
- Changes: report entries and previews identify `variant`, `shortName`, and `shortNumber`.

- [ ] **Step 1: Write failing orchestration tests**

Cover these behaviors with temporary resources and a recording client:

```text
1. Existing review state plus two ready Shorts creates two Short drafts.
2. Missing shorts.txt creates only the review draft.
3. One missing Short video is skipped while another Short and the next book proceed.
4. One Short client failure is recorded while later Shorts proceed.
5. limit=1 allows one book to create a review plus all its Shorts, then stops before the next creating book.
```

Assert state is written after every successful draft and all Short report rows include their variant identity.

- [ ] **Step 2: Run orchestration tests and verify RED**

Run: `NODE_NO_WARNINGS=1 node --test scripts/local/create-book-facebook-drafts.test.mjs`

Expected: FAIL because the loop currently exits after the review classification and counts individual drafts.

- [ ] **Step 3: Split review and Short processing**

Create focused helpers inside the script for review resources, variant previews, and Short content. The outer loop tracks `createdBooks` and only stops before evaluating another book once `createdBooks.size === limit`. Review skips or failures must not `continue` past Short processing.

- [ ] **Step 4: Persist independent state entries**

Write review entries with `variant: 'review'`. Write every completed Short immediately with `variant: 'short'`, `shortName`, `shortNumber`, MP4 path, long video URL, checksum, IDs, and `book-facebook-short-v1` template version.

- [ ] **Step 5: Run the complete Node batch suite and commit**

Run: `pnpm run test:book-facebook-drafts`

Expected: all tests PASS.

```bash
git add scripts/local/create-book-facebook-drafts.mjs scripts/local/create-book-facebook-drafts.test.mjs
git commit -m "feat: add optional shorts to book draft batches"
```

### Task 4: Stream local MP4 files to Facebook

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts`

**Interfaces:**
- Produces: private `uploadVideo(pageId, accessToken, mediaPath, description, identifier)`.
- Keeps: public HTTP media uses Graph API JSON `file_url`.
- Changes: local `/uploads/` MP4 uses multipart `source`, `description`, and `published=true`.

- [ ] **Step 1: Write failing local video multipart test**

Create a temporary MP4 under `UPLOAD_DIRECTORY`, call `postPending`, and assert `getSsrfSafeAxios().post()` receives a `/videos` URL and multipart headers. Assert `provider.fetch()` is not called for `/videos`.

- [ ] **Step 2: Write remote URL regression test**

Call `postPending` with `https://cdn.example/short.mp4` and assert Graph `fetch` receives JSON containing `file_url`, description, and `published: true`.

- [ ] **Step 3: Run Jest and verify RED**

Run: `NODE_OPTIONS=--max-old-space-size=6144 pnpm exec jest libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts --runInBand --config /tmp/postiz-facebook-jest.config.cjs`

Expected: local video test FAIL because the provider still submits localhost as `file_url`.

- [ ] **Step 4: Implement streamed video upload**

Mirror the protected photo upload path: resolve the local path through `localUploadPath`, add multipart text fields, add a bounded file stream with MIME and size, send with SSRF-safe Axios, and wrap through `runStreamedUpload`. Retain the current JSON request for non-local paths.

- [ ] **Step 5: Run provider tests and builds**

Run:

```bash
NODE_OPTIONS=--max-old-space-size=6144 pnpm exec jest libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts --runInBand --config /tmp/postiz-facebook-jest.config.cjs
pnpm run build:backend
pnpm run build:orchestrator
```

Expected: provider tests and both builds PASS.

- [ ] **Step 6: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts
git commit -m "fix: stream local Facebook video uploads"
```

### Task 5: End-to-end verification with six real Shorts

**Files:**
- Verify: `/Users/william/Workspace/mwrks/Projects/book_reader/sach-hoan-thanh/2026-07-11/tu-tot-den-vi-dai`
- Verify: `/Users/william/Workspace/mwrks/Projects/book_reader/outputs/facebook-postiz-drafts/state.json`
- Verify: generated run reports under `/Users/william/Workspace/mwrks/Projects/book_reader/outputs/facebook-postiz-drafts`

**Interfaces:**
- Consumes: the complete batch command and local Postiz API.
- Produces: six unpublished Short drafts and six first comments for the target book.

- [ ] **Step 1: Run final automated verification**

```bash
pnpm run test:book-facebook-drafts
NODE_OPTIONS=--max-old-space-size=6144 pnpm exec jest libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts --runInBand --config /tmp/postiz-facebook-jest.config.cjs
pnpm exec prettier --check scripts/local/book-facebook-drafts-lib.mjs scripts/local/book-facebook-drafts-lib.test.mjs scripts/local/postiz-local-client.mjs scripts/local/postiz-local-client.test.mjs scripts/local/create-book-facebook-drafts.mjs scripts/local/create-book-facebook-drafts.test.mjs libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts libraries/nestjs-libraries/src/integrations/social/facebook.provider.spec.ts
```

Expected: all checks PASS.

- [ ] **Step 2: Rebuild the local Postiz service**

```bash
/Users/william/.orbstack/bin/docker compose -p postiz-codex --env-file .env.codex-local -f docker-compose.yaml -f docker-compose.codex-local.yaml up -d --build postiz
```

Expected: `postiz-postiz-1` becomes healthy at `http://localhost:4007`.

- [ ] **Step 3: Run the exact book batch**

```bash
bash scripts/local/create-book-facebook-drafts.sh /Users/william/Workspace/mwrks/Projects/book_reader/sach-hoan-thanh/2026-07-11/tu-tot-den-vi-dai --limit 10
```

Expected: existing review is skipped and six Short drafts are created; zero operational failures.

- [ ] **Step 4: Verify Postiz records without exposing secrets**

Query only post IDs, parent IDs, state, media paths, and boolean content checks. Confirm six roots plus six children, all `DRAFT`, every root has `.mp4`, and every child contains the expected long YouTube URL.

- [ ] **Step 5: Commit generated source changes and push the feature branch**

Generated run artifacts remain outside the Postiz repository and are not committed.

```bash
git status --short
git push hanhmh1203 local/codex-chatgpt-auth
```

Expected: remote branch contains the design, plan, implementation, and tests.
