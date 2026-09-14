# Postiz List Post Now and Detailed Day View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user publish a draft immediately from a detailed row and use the same readable row layout for all posts on a selected Calendar day.

**Architecture:** Extend the existing pure List payload utilities with a `now` action and a selected-day filter, then reuse `ListViewItem` in both List and Day modes. A shared hook in `calendar.tsx` loads the current group and submits Schedule or Post now through the existing validated `POST /posts` endpoint while the row owns confirmation and pending UI state.

**Tech Stack:** Next.js 16, React, TypeScript, Day.js, Mantine modal infrastructure, NestJS/Postiz post API, Node 22 test runner, Docker Compose.

## Global Constraints

- Post now is shown only for `DRAFT` roots and requires an explicit in-app confirmation.
- Schedule and Post now preserve root/comment ids, content, media, delays, integration, settings, group, and tags.
- A stale row whose current root is no longer `DRAFT` must fail before mutation and refresh server state.
- Day mode shows only posts on the selected local date, ordered by local publish time.
- Week and Month layouts remain unchanged.
- Automated browser verification must not publish a real Facebook draft.
- List and Calendar caches refresh after successful state-changing actions.

---

### Task 1: Define Post now and Day-selection behavior

**Files:**

- Modify: `apps/frontend/src/components/launches/list-view.utils.ts`
- Modify: `apps/frontend/src/components/launches/list-view.utils.test.ts`

**Interfaces:**

- Produces: `buildDraftNowPayload(group, tags, date)` with the same preserved post-group structure as `buildDraftSchedulePayload` and `type: "now"`.
- Produces: `selectPostsForDay(posts, selectedDate)` returning posts on the selected local calendar day in ascending timestamp order.

- [ ] **Step 1: Write failing tests for the now payload and selected-day filter**

Add tests that assert `buildDraftNowPayload` preserves root and comment ids/media, sets `type` to `now`, converts the supplied date to UTC, and rejects a root whose state is not `DRAFT`. Add a filter test with posts before, inside, and after one local day and assert only the two inside posts remain in chronological order.

- [ ] **Step 2: Run the utility test and verify RED**

```bash
node --experimental-strip-types --test apps/frontend/src/components/launches/list-view.utils.test.ts
```

Expected: FAIL because `buildDraftNowPayload` and `selectPostsForDay` are not exported.

- [ ] **Step 3: Implement one shared draft payload builder and the two exported wrappers**

Create a private `buildDraftActionPayload(group, tags, date, type)` used by both existing Schedule and new Post now wrappers. Keep the current `DRAFT` root guard and mapping of every post value. Implement `selectPostsForDay` by comparing local `YYYY-MM-DD` keys and sorting copied results by timestamp.

- [ ] **Step 4: Run the utility test and verify GREEN**

```bash
node --experimental-strip-types --test apps/frontend/src/components/launches/list-view.utils.test.ts
```

Expected: all utility tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/frontend/src/components/launches/list-view.utils.ts apps/frontend/src/components/launches/list-view.utils.test.ts
git commit -m "test: define post now and detailed day behavior"
```

---

### Task 2: Add confirmed Post now to the shared detailed row

**Files:**

- Modify: `apps/frontend/src/components/launches/list-view-item.tsx`
- Modify: `apps/frontend/src/components/launches/calendar.tsx`

**Interfaces:**

- `ListViewItem` adds `postNow(post): Promise<boolean>`.
- `useDraftRowActions()` returns stable `schedulePost(post, date)` and `postNow(post)` callbacks used by List and Day.

- [ ] **Step 1: Generalize the authenticated draft action in `calendar.tsx`**

Extract List's current schedule request into `useDraftRowActions`. Both callbacks load `/posts/group/:group`, build the appropriate payload, post to `/posts`, show action-specific success/warning toasts, and call `reloadCalendarView()`.

- [ ] **Step 2: Add one pending state for both row mutations**

Replace `scheduling: boolean` with `pendingAction: 'schedule' | 'now' | null`. Disable both mutation buttons while either action runs, while leaving Preview and Edit available.

- [ ] **Step 3: Add the in-app Post now confirmation**

Use `useModals()` to open a confirmation containing the target Page name and the fact that the first comment is included. Cancel closes without calling `postNow`; Confirm resolves first, closes the modal, and calls the callback exactly once. Render **Post now** beside **Schedule** only for `DRAFT`.

- [ ] **Step 4: Run frontend build and utility tests**

```bash
node --experimental-strip-types --test apps/frontend/src/components/launches/list-view.utils.test.ts
pnpm build:frontend
```

Expected: tests PASS and Next.js production build exits 0.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/frontend/src/components/launches/list-view-item.tsx apps/frontend/src/components/launches/calendar.tsx
git commit -m "feat: publish drafts now from detailed rows"
```

---

### Task 3: Replace Day timeline cells with detailed rows

**Files:**

- Modify: `apps/frontend/src/components/launches/calendar.tsx`
- Modify: `docs/local-book-facebook-drafts.md`

**Interfaces:**

- `DayView` consumes Calendar `posts` and `startDate`, then passes each selected-day `ListViewPost` to `ListViewItem` with shared Edit, Schedule, and Post now callbacks.

- [ ] **Step 1: Render selected-day posts with the shared row**

Remove Day mode's integration/time-slot option construction. Call `selectPostsForDay(posts, newDayjs(startDate))`, render the formatted date heading and one `ListViewItem` per result, and display `No posts on this day` when empty.

- [ ] **Step 2: Keep the surrounding Calendar navigation intact**

Change only `DayView`; leave `WeekView`, `MonthView`, toolbar filters, channel selection, and Calendar context fetching unchanged.

- [ ] **Step 3: Document Post now and detailed Day mode**

Update `docs/local-book-facebook-drafts.md` to explain that List and Day share detailed rows, Post now asks for confirmation, and Day shows the posts belonging to its selected date.

- [ ] **Step 4: Run focused and regression verification**

```bash
node --experimental-strip-types --test \
  apps/frontend/src/components/launches/list-view.utils.test.ts \
  libraries/helpers/src/utils/posts.list.minify.test.ts \
  libraries/nestjs-libraries/src/database/prisma/posts/posts.list.query.test.ts
pnpm build:frontend
pnpm build:backend
pnpm test:book-facebook-drafts
git diff --check
```

Expected: all focused tests, 52 batch tests, both production builds, and diff checks PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/frontend/src/components/launches/calendar.tsx docs/local-book-facebook-drafts.md
git commit -m "feat: show detailed posts in day view"
```

---

### Task 4: Deploy and verify the local workflow

**Files:** No production source changes expected.

- [ ] **Step 1: Rebuild the local Docker deployment**

```bash
zsh scripts/local/postiz-local.sh restart
zsh scripts/local/postiz-local.sh status
zsh scripts/local/postiz-local.sh bridge-status
```

Expected: Postiz and dependencies are running and the Codex bridge reports `authenticated: true`.

- [ ] **Step 2: Verify List without publishing a real draft**

Open `http://localhost:4007/launches?display=list`, select Draft, and confirm every draft row contains Schedule and Post now, image/video media is explicit, and opening then cancelling the Post now confirmation creates no request or database change.

- [ ] **Step 3: Verify detailed Day mode**

Select Day and confirm only posts for the selected date appear, each uses the detailed row, video Shorts retain a visible play badge, and Preview/Edit work. Switch to Week and Month to confirm their grid layouts still render.

- [ ] **Step 4: Verify action payload with an isolated fixture**

Use a cloned local draft whose outbound action is intercepted or scheduled safely, verify the now payload preserves root/comment ids and media, and terminate/delete the fixture and workflow before any external publish can occur. Do not click Post now on a real Page draft.

- [ ] **Step 5: Scan and push**

```bash
git status --short --branch
git diff --check hanhmh1203/local/codex-chatgpt-auth..HEAD
git push hanhmh1203 local/codex-chatgpt-auth
```

Expected: clean worktree and the remote branch resolves to local `HEAD`.
