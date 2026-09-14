# Postiz List Draft Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Postiz List view into a reliable draft queue where old drafts remain visible, media is recognizable, Preview/Edit are persistent, and a draft can be scheduled for a chosen future date.

**Architecture:** Move state-specific List filtering and ordering into a pure query helper, include stored media in the List response, and render a dedicated List row instead of reusing the dense calendar cell. Inline scheduling loads the current post group and submits it through Postiz's existing validated `POST /posts` path with `type: "schedule"`, avoiding a second scheduling implementation.

**Tech Stack:** NestJS, Prisma, Next.js/React, TypeScript, Day.js, Mantine date controls, Node 22 test runner, Docker Compose.

## Global Constraints

- List view must show every `DRAFT`, including drafts whose placeholder `publishDate` is in the past.
- Draft and All views sort by most recent update; Scheduled sorts by nearest future publish time; Published sorts by latest publish time.
- The row must never autoplay video and must keep Preview and Edit visible without hover.
- Choosing a date has no side effect; only pressing **Schedule** submits the post.
- Inline scheduling is available only for `DRAFT` roots and uses a future local date converted to UTC.
- Provider validation, child comments, pagination, customer filtering, Calendar views, and the full editor must continue to work.
- No bulk scheduling and no automatic publishing are introduced.

---

### Task 1: Make List visibility and ordering explicit

**Files:**

- Create: `libraries/nestjs-libraries/src/database/prisma/posts/posts.list.query.ts`
- Create: `libraries/nestjs-libraries/src/database/prisma/posts/posts.list.query.test.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts:218-309`

**Interfaces:**

- Consumes: `GetPostsListDto`, organization id, and a supplied current time for deterministic tests.
- Produces: `buildPostsListQuery(orgId, query, now)` returning `{ where, orderBy }` for Prisma `findMany` and `count`.

- [ ] **Step 1: Write failing query tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPostsListQuery } from './posts.list.query.ts';

const now = new Date('2026-09-14T04:00:00.000Z');

test('draft query has no publish-date cutoff and sorts newest updates first', () => {
  const result = buildPostsListQuery('org-1', { state: 'draft' }, now);
  assert.equal(result.where.state, 'DRAFT');
  assert.equal(result.where.publishDate, undefined);
  assert.deepEqual(result.orderBy, { updatedAt: 'desc' });
});

test('scheduled query includes only future queue posts in publish order', () => {
  const result = buildPostsListQuery('org-1', { state: 'scheduled' }, now);
  assert.equal(result.where.state, 'QUEUE');
  assert.deepEqual(result.where.publishDate, { gte: now });
  assert.deepEqual(result.orderBy, { publishDate: 'asc' });
});

test('all and published have no date cutoff and use descending recency', () => {
  assert.deepEqual(
    buildPostsListQuery('org-1', { state: 'all' }, now).orderBy,
    {
      updatedAt: 'desc',
    }
  );
  assert.deepEqual(
    buildPostsListQuery('org-1', { state: 'published' }, now).orderBy,
    { publishDate: 'desc' }
  );
});
```

- [ ] **Step 2: Run the query test and verify RED**

Run:

```bash
node --test libraries/nestjs-libraries/src/database/prisma/posts/posts.list.query.test.ts
```

Expected: FAIL because `posts.list.query.ts` does not exist.

- [ ] **Step 3: Implement the pure query builder**

```ts
import type { Prisma } from '@prisma/client';
import type { GetPostsListDto } from '../../../dtos/posts/get.posts.list.dto.ts';

export function buildPostsListQuery(
  orgId: string,
  query: Pick<GetPostsListDto, 'customer' | 'state'>,
  now = new Date()
): {
  where: Prisma.PostWhereInput;
  orderBy: Prisma.PostOrderByWithRelationInput;
} {
  const state = query.state || 'all';
  const where: Prisma.PostWhereInput = {
    organizationId: orgId,
    deletedAt: null,
    parentPostId: null,
    intervalInDays: null,
    integration: {
      deletedAt: null,
      organizationId: orgId,
      ...(query.customer ? { customerId: query.customer } : {}),
    },
    ...(state === 'draft'
      ? { state: 'DRAFT' }
      : state === 'scheduled'
      ? { state: 'QUEUE', publishDate: { gte: now } }
      : state === 'published'
      ? { state: 'PUBLISHED' }
      : { state: { in: ['QUEUE', 'DRAFT', 'PUBLISHED', 'ERROR'] } }),
  };
  return {
    where,
    orderBy:
      state === 'scheduled'
        ? { publishDate: 'asc' }
        : state === 'published'
        ? { publishDate: 'desc' }
        : { updatedAt: 'desc' },
  };
}
```

- [ ] **Step 4: Use the helper in the repository**

Replace the inline state/date/order construction with:

```ts
const { where, orderBy } = buildPostsListQuery(orgId, query);
```

Use the same `where` for `findMany` and `count`, use `orderBy` for `findMany`, and add `image: true` to the List select.

- [ ] **Step 5: Run query tests and the backend build**

```bash
node --test libraries/nestjs-libraries/src/database/prisma/posts/posts.list.query.test.ts
pnpm build:backend
```

Expected: all query tests PASS and the backend build exits 0.

- [ ] **Step 6: Commit Task 1**

```bash
git add libraries/nestjs-libraries/src/database/prisma/posts/posts.list.query.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.list.query.test.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts
git commit -m "fix: keep all drafts visible in list view"
```

---

### Task 2: Preserve media through List response minification

**Files:**

- Create: `libraries/helpers/src/utils/posts.list.minify.test.ts`
- Modify: `libraries/helpers/src/utils/posts.list.minify.ts:13-29`

**Interfaces:**

- Consumes: the repository's `image` JSON string.
- Produces: `minifyPostsList`/`expandPostsList` round trips that preserve `image`.

- [ ] **Step 1: Write a failing round-trip test**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { expandPostsList, minifyPostsList } from './posts.list.minify.ts';

test('list minification preserves attached media', () => {
  const source = {
    posts: [{ id: 'post-1', image: '[{"id":"m1","path":"/a.mp4"}]' }],
    total: 1,
    page: 0,
    limit: 100,
    hasMore: false,
  };
  const minified = minifyPostsList(source);
  assert.equal(minified.p[0].im, source.posts[0].image);
  assert.equal('image' in minified.p[0], false);
  assert.deepEqual(expandPostsList(minified), source);
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
node --test libraries/helpers/src/utils/posts.list.minify.test.ts
```

Expected: FAIL because the minified post contains `image` instead of `im`.

- [ ] **Step 3: Add the media key**

Add to `POST_ITEM_KEYS`:

```ts
image: 'im',
```

- [ ] **Step 4: Run both backend-focused tests**

```bash
node --test libraries/helpers/src/utils/posts.list.minify.test.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.list.query.test.ts
```

Expected: both test files PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add libraries/helpers/src/utils/posts.list.minify.ts libraries/helpers/src/utils/posts.list.minify.test.ts
git commit -m "fix: include media in list post responses"
```

---

### Task 3: Define safe List media and scheduling payload helpers

**Files:**

- Create: `apps/frontend/src/components/launches/list-view.utils.ts`
- Create: `apps/frontend/src/components/launches/list-view.utils.test.ts`

**Interfaces:**

- Produces: `parseListMedia(image): ListMedia[]`, `isVideoPath(path): boolean`, and `buildDraftSchedulePayload(group, tags, date): object`.
- Consumes: List media as JSON string or array, the current `/posts/group/:group` response, root tags, and a Day.js date.

- [ ] **Step 1: Write failing helper tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import {
  buildDraftSchedulePayload,
  isVideoPath,
  parseListMedia,
} from './list-view.utils.ts';

dayjs.extend(utc);

test('parses video media without throwing on malformed values', () => {
  assert.deepEqual(parseListMedia('[{"id":"m1","path":"/short.mp4"}]'), [
    { id: 'm1', path: '/short.mp4' },
  ]);
  assert.deepEqual(parseListMedia('{bad json'), []);
  assert.equal(isVideoPath('/short.MP4?cache=1'), true);
  assert.equal(isVideoPath('/land.png'), false);
});

test('builds an explicit schedule request with comments and UTC date', () => {
  const payload = buildDraftSchedulePayload(
    {
      group: 'group-1',
      integration: 'facebook-1',
      settings: { __type: 'facebook' },
      posts: [
        { id: 'root', content: 'Post', image: [], delay: 0 },
        { id: 'comment', content: 'Comment', image: [], delay: 0 },
      ],
    },
    [{ tag: { id: 'tag-1', name: 'Books' } }],
    dayjs('2026-09-15T09:30:00+07:00')
  );
  assert.equal(payload.type, 'schedule');
  assert.equal(payload.date, '2026-09-15T02:30:00.000Z');
  assert.deepEqual(
    payload.posts[0].value.map((post: { id: string }) => post.id),
    ['root', 'comment']
  );
});
```

- [ ] **Step 2: Run the helper test and verify RED**

```bash
node --test apps/frontend/src/components/launches/list-view.utils.test.ts
```

Expected: FAIL because `list-view.utils.ts` does not exist.

- [ ] **Step 3: Implement strict media parsing**

```ts
export type ListMedia = {
  id?: string;
  path: string;
  thumbnail?: string;
};

export function parseListMedia(value: unknown): ListMedia[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.path === 'string')
      : [];
  } catch {
    return [];
  }
}

export function isVideoPath(path: string) {
  return /\.(mp4|mov|webm)(?:$|[?#])/i.test(path);
}
```

Implement `buildDraftSchedulePayload` so it copies every root/comment `id`, `content`, `image`, and `delay`; preserves `group`, `settings`, and integration id; sets `type: "schedule"` and `shortLink: false`; maps tags to `{ value, label }`; and serializes `date.utc().toISOString()`.

- [ ] **Step 4: Run helper tests**

```bash
node --test apps/frontend/src/components/launches/list-view.utils.test.ts
```

Expected: all helper tests PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/frontend/src/components/launches/list-view.utils.ts apps/frontend/src/components/launches/list-view.utils.test.ts
git commit -m "test: define list draft media and schedule payloads"
```

---

### Task 4: Build a dedicated List row with persistent actions

**Files:**

- Create: `apps/frontend/src/components/launches/list-view-item.tsx`
- Modify: `apps/frontend/src/components/launches/calendar.tsx:489-565`

**Interfaces:**

- `ListViewItem` consumes `{ post, editPost, previewPost, schedulePost }` and renders one responsive row.
- `schedulePost(post, date)` loads the current group, builds the Task 3 payload, submits it, and refreshes List and Calendar caches.

- [ ] **Step 1: Add visible media and actions**

Use `parseListMedia(post.image)[0]` and `useMediaDirectory()`. Render a 112×64 paused video first frame with a play badge, an image thumbnail, or a neutral No media placeholder. The media button and visible **Preview** button call:

```ts
window.open(`/p/${post.id}?share=true`, '_blank');
```

Render a visible **Edit** button, two-line content excerpt, Page identity, state, and local date/time. Every nested action must call `event.stopPropagation()`.

- [ ] **Step 2: Add draft-only date and schedule controls**

Use the existing `DatePicker` with component-local state initialized to the later of the draft date or the next rounded hour. Render **Schedule** only for `post.state === 'DRAFT'`; disable it when the selected timestamp is not future or a request is active. Changing the picker only updates local state.

- [ ] **Step 3: Wire scheduling through the existing validated API**

In `ListView`, load `/posts/group/${post.group}` and verify the returned root still has state `DRAFT`. Call `buildDraftSchedulePayload(group, post.tags, date)`, then submit through the existing server-validated action:

```ts
const response = await fetch('/posts', {
  method: 'POST',
  body: JSON.stringify(payload),
});
if (!response.ok) throw new Error(await response.text());
toaster.show(t('scheduled_successfully', 'Scheduled successfully'), 'success');
reloadCalendarView();
```

Show a warning toast on validation/network failure and keep the chosen date for retry. Disable **Schedule** while the request is active. The payload preserves the existing post and comment ids, so a repeated request updates the same records and workflow instead of creating duplicates.

- [ ] **Step 4: Replace CalendarItem only inside ListView**

Keep Day/Week/Month rendering unchanged. Replace the List `CalendarItem` block with `ListViewItem`, preserving date grouping, filters, customer selection, and pagination.

- [ ] **Step 5: Run frontend checks**

```bash
node --test apps/frontend/src/components/launches/list-view.utils.test.ts
pnpm build:frontend
```

Expected: helper tests PASS and the Next.js production build exits 0.

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/frontend/src/components/launches/list-view-item.tsx apps/frontend/src/components/launches/calendar.tsx
git commit -m "feat: manage video drafts from list view"
```

---

### Task 5: Verify and deploy the local List workflow

**Files:**

- Modify: `docs/local-book-facebook-drafts.md`

- [ ] **Step 1: Document List review and scheduling**

Document that Draft List shows all drafts, the thumbnail/Preview opens full preview, Edit opens the full editor, and **Choose publish date → Schedule** is the explicit state-changing action.

- [ ] **Step 2: Format and run focused tests**

```bash
pnpm exec prettier --write \
  libraries/nestjs-libraries/src/database/prisma/posts/posts.list.query.ts \
  libraries/nestjs-libraries/src/database/prisma/posts/posts.list.query.test.ts \
  libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts \
  libraries/helpers/src/utils/posts.list.minify.ts \
  libraries/helpers/src/utils/posts.list.minify.test.ts \
  apps/frontend/src/components/launches/list-view.utils.ts \
  apps/frontend/src/components/launches/list-view.utils.test.ts \
  apps/frontend/src/components/launches/list-view-item.tsx \
  apps/frontend/src/components/launches/calendar.tsx \
  docs/local-book-facebook-drafts.md
node --test \
  libraries/nestjs-libraries/src/database/prisma/posts/posts.list.query.test.ts \
  libraries/helpers/src/utils/posts.list.minify.test.ts \
  apps/frontend/src/components/launches/list-view.utils.test.ts
pnpm build:backend
pnpm build:frontend
pnpm test:book-facebook-drafts
```

Expected: all focused tests, both builds, and all book batch tests exit 0.

- [ ] **Step 3: Rebuild local Postiz**

```bash
zsh scripts/local/postiz-local.sh restart
zsh scripts/local/postiz-local.sh status
zsh scripts/local/postiz-local.sh bridge-status
```

Expected: Postiz and dependencies are running, and bridge health returns `authenticated: true`.

- [ ] **Step 4: Verify List behavior without scheduling a real draft**

At `http://localhost:4007/launches?display=list`, select **Draft** and verify the generated image drafts remain visible after their placeholder time, existing Short drafts are identified as videos, Preview/Edit remain visible, a video thumbnail opens a working preview, picker changes do not mutate the database, and Calendar views still render.

Do not press **Schedule** on a real Page draft during automated verification.

- [ ] **Step 5: Verify schedule submission with an isolated fixture**

Create a temporary local draft, select a far-future date through the List control, and confirm in Postgres that the root and first comment become `QUEUE` with the same ids/content and selected UTC publish time. Immediately return the fixture to `DRAFT`, terminate its Temporal workflow, and delete the fixture so it cannot publish externally.

- [ ] **Step 6: Final verification and push**

```bash
git diff --check
git status --short --branch
```

Scan the changed diff for secrets, commit documentation adjustments, and push `local/codex-chatgpt-auth` to `hanhmh1203`.
