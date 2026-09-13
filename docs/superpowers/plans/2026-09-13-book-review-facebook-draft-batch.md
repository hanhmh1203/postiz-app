# Book Review Facebook Draft Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local batch command that creates up to ten Postiz Facebook drafts from completed Will Read Book review projects, with `land.png` and the matching long YouTube URL as the first comment.

**Architecture:** A Node.js CLI reads the `book_library` SQLite database in read-only mode, intersects uploaded YouTube productions with a user-supplied batch root, validates local review resources, and delegates copy generation plus draft storage to the local Postiz API. Focused modules separate discovery/state, Postiz HTTP operations, and orchestration; a Bash wrapper provides the only user-facing entrypoint.

**Tech Stack:** Node.js 22 ESM, built-in `node:sqlite`, built-in `fetch`/`FormData`, `node:test`, Bash, Postiz REST endpoints, local Codex bridge.

## Global Constraints

- Always target the active Facebook integration named `Vì cuộc sống là ko chờ đợi`.
- Always create `type: draft`; never expose a `now` or `schedule` option.
- Process at most 10 successfully created drafts per run; skipped or failed candidates do not consume the limit.
- Source review is the newest `*-phan-tich.md`; never use `review_profile.md` or YouTube metadata as review text.
- Require the existing `land.png`; never generate a replacement image.
- Require a long `https://www.youtube.com/watch?v=...` or `https://youtu.be/...` URL; reject playlist and Shorts URLs.
- Main post is Vietnamese, approximately 700–1,200 characters, contains 3–5 hashtags including `#WillReadBook`, and contains no URL.
- First comment is `Để nghe review trọn vẹn, bạn xem tại đây: <long-video-url>`.
- Keep credentials, tokens, cookies, review contents, and full API responses out of state, reports, and logs.
- Store state and reports below the visible `book_reader/outputs/facebook-postiz-drafts/` directory.

## File Structure

- Create `scripts/local/book-facebook-drafts-lib.mjs`: CLI parsing, path containment, YouTube URL checks, resource selection, portal discovery, checksums, state, and reports.
- Create `scripts/local/book-facebook-drafts-lib.test.mjs`: pure and SQLite-backed tests for discovery, validation, ordering, limits, and idempotency.
- Create `scripts/local/postiz-local-client.mjs`: Postiz authentication, preflight, NDJSON generation, media upload, and draft creation.
- Create `scripts/local/postiz-local-client.test.mjs`: fake-server contract tests for all Postiz operations and draft-only enforcement.
- Create `scripts/local/create-book-facebook-drafts.mjs`: batch orchestration, retry policy, dry-run behavior, and exit codes.
- Create `scripts/local/create-book-facebook-drafts.test.mjs`: end-to-end fixture tests with a fake Postiz server.
- Create `scripts/local/create-book-facebook-drafts.sh`: user-facing Bash wrapper.
- Modify `.env.codex-local.example`: document non-secret batch paths and target Page name.
- Modify `package.json`: add focused test and batch scripts.
- Modify `docs/superpowers/specs/2026-09-13-book-review-facebook-draft-batch-design.md` only if implementation evidence requires a factual API clarification.

---

### Task 1: Discovery, Resource Validation, and Persistent State

**Files:**
- Create: `scripts/local/book-facebook-drafts-lib.mjs`
- Create: `scripts/local/book-facebook-drafts-lib.test.mjs`

**Interfaces:**
- Produces: `parseBatchArgs(argv)`, `isLongYoutubeUrl(url)`, `isPathInside(root, child)`, `selectLatestReview(directory)`, `discoverPortalCandidates(options)`, `computeSourceChecksum(candidate, pageName, templateVersion)`, `loadState(path)`, `classifyCandidate(candidate, state, checksum)`, and `writeRunArtifacts(options)`.
- `discoverPortalCandidates({ databasePath, batchRoot })` returns ordered candidate objects with `bookId`, `productionId`, `title`, `workflowDirectory`, `youtubeUploadedAt`, and `videoUrl`.

- [ ] **Step 1: Write failing tests for argument bounds, URL rules, path containment, newest review selection, and SQLite discovery**

```js
test('orders uploaded books oldest first and keeps only paths inside the batch root', () => {
  const candidates = discoverPortalCandidates({ databasePath, batchRoot });
  assert.deepEqual(candidates.map(({ title }) => title), ['Older valid book', 'Newer valid book']);
});

test('accepts only long YouTube video URLs', () => {
  assert.equal(isLongYoutubeUrl('https://www.youtube.com/watch?v=abc123'), true);
  assert.equal(isLongYoutubeUrl('https://youtu.be/abc123'), true);
  assert.equal(isLongYoutubeUrl('https://www.youtube.com/shorts/abc123'), false);
  assert.equal(isLongYoutubeUrl('https://www.youtube.com/playlist?list=PL1'), false);
});
```

- [ ] **Step 2: Run the tests and verify they fail because the module does not exist**

Run: `node --test scripts/local/book-facebook-drafts-lib.test.mjs`

Expected: non-zero exit with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the pure helpers, read-only SQLite query, deterministic review resolution, checksum, state classification, and atomic report writes**

```js
export function parseBatchArgs(argv) {
  const options = { dryRun: false, limit: 10, batchRoot: '' };
  // Parse one absolute positional path plus --dry-run and --limit N.
  // Reject missing/non-absolute roots and limits outside 1..10.
  return options;
}

export function isLongYoutubeUrl(value) {
  const url = new URL(value);
  return (
    (url.hostname === 'www.youtube.com' && url.pathname === '/watch' && url.searchParams.has('v')) ||
    (url.hostname === 'youtu.be' && /^\/[A-Za-z0-9_-]+$/.test(url.pathname))
  );
}
```

The database query must join `book_productions`, `books`, and `publication_links`, require `book_productions.status='youtube_uploaded'`, select a valid YouTube watch publication for the same `book_id`, and order by `youtube_uploaded_at, book_id, production_id`. Open SQLite with `{ readOnly: true }` and close it in `finally`.

- [ ] **Step 4: Run the focused tests and verify all cases pass**

Run: `node --test scripts/local/book-facebook-drafts-lib.test.mjs`

Expected: all tests pass with zero failures.

- [ ] **Step 5: Commit the discovery and state layer**

```bash
git add scripts/local/book-facebook-drafts-lib.mjs scripts/local/book-facebook-drafts-lib.test.mjs
git commit -m "feat: discover eligible book review drafts"
```

### Task 2: Authenticated Postiz Client and Draft Contract

**Files:**
- Create: `scripts/local/postiz-local-client.mjs`
- Create: `scripts/local/postiz-local-client.test.mjs`

**Interfaces:**
- Consumes: a base URL, credential path, target Page name, source review, and image path.
- Produces: class `PostizLocalClient` with `login()`, `preflight(pageName)`, `generateCaption(input)`, `uploadMedia(path)`, `createDraft(input)`, and `findDraftByMarker(marker)`.
- `createDraft({ integrationId, caption, comment, media, marker })` returns `{ group, postIds }` and rejects any type other than the internally fixed `draft`.

- [ ] **Step 1: Write fake-server tests for login headers, exact integration matching, generator NDJSON, image upload, and draft payload**

```js
test('creates one draft post with an image and first comment', async () => {
  const result = await client.createDraft({
    integrationId: 'facebook-page-id',
    caption: validCaption,
    comment: 'Để nghe review trọn vẹn, bạn xem tại đây: https://youtu.be/abc123',
    media: { id: 'media-id', path: '/uploads/land.png' },
    marker: 'wrb:book-1:checksum-1',
  });
  assert.equal(receivedPayload.type, 'draft');
  assert.equal(receivedPayload.posts[0].value.length, 2);
  assert.deepEqual(receivedPayload.posts[0].value[0].image, [{ id: 'media-id', path: '/uploads/land.png' }]);
});
```

- [ ] **Step 2: Run the tests and verify they fail with `ERR_MODULE_NOT_FOUND`**

Run: `node --test scripts/local/postiz-local-client.test.mjs`

Expected: non-zero exit.

- [ ] **Step 3: Implement authentication and HTTP request handling**

Login with `POST /auth/login` and `{ email, password, provider: 'LOCAL', providerToken: '' }`. Capture the local `auth` response header and optional `showorg` header, then send them on every authenticated request. Parse `.postiz-local-credentials` as `KEY=VALUE` without logging values.

- [ ] **Step 4: Implement preflight, generation, upload, and draft creation**

Use `GET /integrations/list`, `POST /posts/generator`, `POST /media/upload-simple`, and `POST /posts`. Parse generator output as newline-delimited JSON and select the final `data.output` event. Build the caption from `hook` and exactly one content item, validate its character count, hashtags, and absence of URLs, and retry generation through the orchestrator when validation fails.

Create the draft payload with `shortLink: false`, `tags: []`, an ISO date, and one Facebook post whose `value` array is `[rootPost, firstComment]`. The marker is appended to a local-only request correlation header and never inserted into visible post text.

- [ ] **Step 5: Run the contract tests and verify all pass**

Run: `node --test scripts/local/postiz-local-client.test.mjs`

Expected: all tests pass with zero failures.

- [ ] **Step 6: Commit the Postiz client**

```bash
git add scripts/local/postiz-local-client.mjs scripts/local/postiz-local-client.test.mjs
git commit -m "feat: add local Postiz draft client"
```

### Task 3: Batch Orchestrator, Retry Policy, and Reports

**Files:**
- Create: `scripts/local/create-book-facebook-drafts.mjs`
- Create: `scripts/local/create-book-facebook-drafts.test.mjs`

**Interfaces:**
- Consumes: Task 1 helpers and `PostizLocalClient` from Task 2.
- Produces: `runBookFacebookDraftBatch(options)` returning `{ created, skipped, sourceChanged, failed, reportPaths }` and CLI exit codes 0 for a completed run, 1 for a global preflight failure, and 2 when the run completes with per-book failures.

- [ ] **Step 1: Write end-to-end fixture tests**

Cover dry-run mutation blocking, ten-success limiting, continued scanning after invalid candidates, two transient retries, no retry for validation/auth errors, state writes only after complete draft creation, duplicate skip, and `source_changed`.

- [ ] **Step 2: Run the orchestrator tests and verify they fail before implementation**

Run: `node --test scripts/local/create-book-facebook-drafts.test.mjs`

Expected: non-zero exit with missing exports.

- [ ] **Step 3: Implement the batch loop and bounded retry helper**

```js
export async function retryTransient(operation, { retries = 2, delayMs = 250 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await operation(attempt); }
    catch (error) {
      lastError = error;
      if (!error.transient || attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** attempt));
    }
  }
  throw lastError;
}
```

For each eligible candidate, build the fixed Vietnamese writing brief, generate and validate the caption, then either record a dry-run preview or upload media and create the draft. Store only checksums, paths, IDs, status, and safe error codes.

- [ ] **Step 4: Run all three focused test files**

Run: `node --test scripts/local/book-facebook-drafts-lib.test.mjs scripts/local/postiz-local-client.test.mjs scripts/local/create-book-facebook-drafts.test.mjs`

Expected: all tests pass with zero failures.

- [ ] **Step 5: Commit the orchestrator**

```bash
git add scripts/local/create-book-facebook-drafts.mjs scripts/local/create-book-facebook-drafts.test.mjs
git commit -m "feat: orchestrate book review draft batches"
```

### Task 4: User Wrapper and Configuration

**Files:**
- Create: `scripts/local/create-book-facebook-drafts.sh`
- Modify: `.env.codex-local.example`
- Modify: `package.json`
- Test: `scripts/local/book-facebook-drafts-lib.test.mjs`

**Interfaces:**
- Produces user command: `bash scripts/local/create-book-facebook-drafts.sh /absolute/batch/path [--dry-run] [--limit N]`.

- [ ] **Step 1: Add a failing wrapper/config contract test**

Assert the wrapper rejects relative paths, loads `.env.codex-local` without printing it, and forwards `--dry-run`/`--limit` unchanged.

- [ ] **Step 2: Implement the Bash wrapper**

The wrapper uses `set -euo pipefail`, resolves the repository directory before changing directories, exports variables from `.env.codex-local`, checks Node.js and required files, and executes the Node CLI with the original absolute batch path.

- [ ] **Step 3: Add non-secret configuration keys**

```dotenv
POSTIZ_URL=http://localhost:4007
POSTIZ_CREDENTIAL_FILE=.postiz-local-credentials
POSTIZ_FACEBOOK_PAGE_NAME=Vì cuộc sống là ko chờ đợi
BOOK_LIBRARY_DATABASE=/absolute/path/to/book_library/.book-library-data/library.sqlite3
BOOK_FACEBOOK_DRAFT_OUTPUT=/absolute/path/to/book_reader/outputs/facebook-postiz-drafts
```

- [ ] **Step 4: Add package scripts and run the focused suite**

Add `test:book-facebook-drafts` and `book-facebook-drafts` scripts. Run `pnpm test:book-facebook-drafts` and expect zero failures.

- [ ] **Step 5: Commit wrapper and configuration**

```bash
git add scripts/local/create-book-facebook-drafts.sh .env.codex-local.example package.json scripts/local/book-facebook-drafts-lib.test.mjs
git commit -m "feat: expose book review draft batch command"
```

### Task 5: Real Dry Run, One-Draft Gate, and Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-book-review-facebook-draft-batch-design.md` only for verified API clarifications.
- Create: a safe run report under the ignored external `book_reader/outputs/facebook-postiz-drafts/` directory.

**Interfaces:**
- Consumes the complete wrapper from Task 4.
- Produces evidence that dry-run and one real Postiz draft work without publishing.

- [ ] **Step 1: Run the complete automated verification**

Run:

```bash
pnpm test:book-facebook-drafts
node --test tools/codex-bridge/codex-bridge.test.mjs
pnpm exec jest --runInBand --config tools/jest.codex.config.cjs
pnpm --filter ./apps/backend run build
git diff --check
```

Expected: all tests and build pass; `git diff --check` emits no output.

- [ ] **Step 2: Identify one real eligible book without mutating Postiz**

Run the wrapper against the user-supplied or verified batch root with `--dry-run --limit 1`. Confirm the report contains one safe preview, a valid long-video URL classification, the intended `land.png`, and no Postiz draft ID.

- [ ] **Step 3: Create exactly one real draft**

Run the same root with `--limit 1`. Confirm the report contains one `created` entry and a Postiz draft ID. Query Postiz to verify `type/state` is draft, the integration is `Vì cuộc sống là ko chờ đợi`, the root item has one image, and the second item is the YouTube comment. Do not publish or schedule it.

- [ ] **Step 4: Verify through the Postiz UI**

Open the local Postiz Calendar, inspect the single draft, and confirm the caption, `land.png`, comment, and Page. Stop before running the ten-book batch if any visible result differs from the contract.

- [ ] **Step 5: Commit verified documentation updates and push**

```bash
git add docs/superpowers/specs/2026-09-13-book-review-facebook-draft-batch-design.md
git commit -m "docs: record verified book draft workflow"
git push
```

Skip the documentation commit when no tracked documentation changed. Push all implementation commits to `hanhmh1203/local/codex-chatgpt-auth`; never add ignored local credentials or reports.
