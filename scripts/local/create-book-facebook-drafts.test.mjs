import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { computeSourceChecksum } from './book-facebook-drafts-lib.mjs';

import {
  retryTransient,
  runBookFacebookDraftBatch,
} from './create-book-facebook-drafts.mjs';

const PAGE_NAME = 'Vì cuộc sống là ko chờ đợi';

function validCaption(title) {
  const sentences = Array.from(
    { length: 10 },
    (_, index) =>
      `${title}: ý ${
        index + 1
      } cho thấy một lựa chọn nhỏ có thể thay đổi cách ta nhìn và hành động mỗi ngày.`
  ).join(' ');
  return `${sentences}\n\nXem phần review đầy đủ trong bình luận.\n\n#WillReadBook #ReviewSach #SachHay`;
}

async function createBook(root, name, { review = true, image = true } = {}) {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  if (review)
    await writeFile(
      path.join(directory, `${name}-phan-tich.md`),
      `Review nguồn cho ${name}. `.repeat(20)
    );
  if (image)
    await writeFile(
      path.join(directory, 'land.png'),
      Buffer.from([137, 80, 78, 71])
    );
  return {
    bookId: name,
    productionId: `${name}-production`,
    title: name,
    workflowDirectory: directory,
    youtubeUploadedAt: '2026-01-01T00:00:00.000Z',
    videoUrl: `https://youtu.be/${
      name.replace(/[^A-Za-z0-9_-]/g, '') || 'video'
    }`,
  };
}

async function addShorts(candidate, definitions) {
  await writeFile(
    path.join(candidate.workflowDirectory, 'shorts.txt'),
    definitions.map(({ name }) => `${name} 15 15`).join('\n')
  );
  const metadata = [];
  for (const definition of definitions) {
    const shortNumber = definition.name.match(/^short_(\d{2})/)?.[1];
    if (definition.metadata !== false) {
      metadata.push(
        `### Short ${shortNumber} - Test`,
        '#### Description',
        definition.description || `Mô tả ${definition.name}`,
        '#### Hashtag',
        definition.hashtags || 'Shorts, TomTatSach, WillReadBook',
        ''
      );
    }
    if (definition.video !== false) {
      const shortDirectory = path.join(
        candidate.workflowDirectory,
        'output',
        'shorts',
        definition.name
      );
      await mkdir(shortDirectory, { recursive: true });
      await writeFile(
        path.join(shortDirectory, `${definition.name}.mp4`),
        Buffer.from(`video-${definition.name}`)
      );
    }
  }
  await writeFile(
    path.join(candidate.workflowDirectory, 'youtube_metadata_short.md'),
    metadata.join('\n')
  );
}

function createFakeClient({
  generationFailures = new Map(),
  draftFailures = new Map(),
  shortDraftFailures = new Map(),
} = {}) {
  const calls = {
    login: 0,
    preflight: 0,
    generate: [],
    upload: [],
    draft: [],
    shortDraft: [],
  };
  return {
    calls,
    async login() {
      calls.login += 1;
    },
    async preflight(pageName) {
      calls.preflight += 1;
      assert.equal(pageName, PAGE_NAME);
      return { id: 'facebook-page-id', name: pageName };
    },
    async generateCaption(candidate) {
      calls.generate.push(candidate.title);
      const failures = generationFailures.get(candidate.title) || [];
      if (failures.length) throw failures.shift();
      return validCaption(candidate.title);
    },
    async uploadMedia(imagePath) {
      calls.upload.push(imagePath);
      return {
        id: `media-${calls.upload.length}`,
        path: `/uploads/${calls.upload.length}${path.extname(imagePath)}`,
      };
    },
    async createDraft(input) {
      calls.draft.push(input);
      const failures = draftFailures.get(input.title) || [];
      if (failures.length) throw failures.shift();
      return {
        postId: `draft-${calls.draft.length}`,
        commentId: `comment-${calls.draft.length}`,
      };
    },
    async createShortDraft(input) {
      calls.shortDraft.push(input);
      const failures = shortDraftFailures.get(input.shortName) || [];
      if (failures.length) throw failures.shift();
      return {
        postId: `short-draft-${calls.shortDraft.length}`,
        commentId: `short-comment-${calls.shortDraft.length}`,
      };
    },
    async findDraftByMarker() {
      return null;
    },
  };
}

test('retries transient operations twice and does not retry permanent errors', async () => {
  let transientAttempts = 0;
  const value = await retryTransient(
    async () => {
      transientAttempts += 1;
      if (transientAttempts < 3)
        throw Object.assign(new Error('temporary'), { transient: true });
      return 'ok';
    },
    { retries: 2, delayMs: 0 }
  );
  assert.equal(value, 'ok');
  assert.equal(transientAttempts, 3);

  let permanentAttempts = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        permanentAttempts += 1;
        throw new Error('permanent');
      },
      { retries: 2, delayMs: 0 }
    ),
    /permanent/
  );
  assert.equal(permanentAttempts, 1);
});

test('dry-run generates a preview without uploading media, creating a draft, or writing state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'book-draft-dry-run-'));
  const outputDirectory = path.join(root, 'outputs');
  const candidate = await createBook(root, 'BookOne');
  const client = createFakeClient();

  const report = await runBookFacebookDraftBatch({
    databasePath: path.join(root, 'unused.sqlite3'),
    batchRoot: root,
    outputDirectory,
    pageName: PAGE_NAME,
    limit: 1,
    dryRun: true,
    client,
    discoverCandidates: async () => [candidate],
    now: () => new Date('2026-09-13T12:00:00.000Z'),
    retryDelayMs: 0,
  });

  assert.equal(report.created.length, 1);
  assert.equal(report.created[0].status, 'dry_run');
  assert.equal(client.calls.upload.length, 0);
  assert.equal(client.calls.draft.length, 0);
  assert.equal(client.calls.generate.length, 1);
  await access(report.created[0].previewPath);
  await assert.rejects(access(path.join(outputDirectory, 'state.json')));
});

test('skips invalid resources and keeps scanning until the success limit is reached', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'book-draft-limit-'));
  const outputDirectory = path.join(root, 'outputs');
  const candidates = [
    await createBook(root, 'MissingReview', { review: false }),
    await createBook(root, 'BookOne'),
    await createBook(root, 'BookTwo'),
    await createBook(root, 'BookThree'),
  ];
  const client = createFakeClient();

  const report = await runBookFacebookDraftBatch({
    databasePath: path.join(root, 'unused.sqlite3'),
    batchRoot: root,
    outputDirectory,
    pageName: PAGE_NAME,
    limit: 2,
    dryRun: false,
    client,
    discoverCandidates: async () => candidates,
    now: () => new Date('2026-09-13T12:00:00.000Z'),
    retryDelayMs: 0,
  });

  assert.deepEqual(
    report.created.map(({ title }) => title),
    ['BookOne', 'BookTwo']
  );
  assert.equal(report.skipped[0].reason, 'review_missing');
  assert.deepEqual(client.calls.generate, ['BookOne', 'BookTwo']);
  const state = JSON.parse(
    await readFile(path.join(outputDirectory, 'state.json'), 'utf8')
  );
  assert.equal(state.entries.length, 2);
});

test('reports changed sources without generating a duplicate draft', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'book-draft-changed-'));
  const outputDirectory = path.join(root, 'outputs');
  await mkdir(outputDirectory);
  const candidate = await createBook(root, 'BookOne');
  await writeFile(
    path.join(outputDirectory, 'state.json'),
    JSON.stringify({
      version: 1,
      entries: [{ bookId: 'BookOne', checksum: 'old-checksum' }],
    })
  );
  const client = createFakeClient();

  const report = await runBookFacebookDraftBatch({
    databasePath: path.join(root, 'unused.sqlite3'),
    batchRoot: root,
    outputDirectory,
    pageName: PAGE_NAME,
    limit: 1,
    dryRun: false,
    client,
    discoverCandidates: async () => [candidate],
    now: () => new Date('2026-09-13T12:00:00.000Z'),
    retryDelayMs: 0,
  });

  assert.equal(report.sourceChanged.length, 1);
  assert.equal(client.calls.generate.length, 0);
  assert.equal(client.calls.draft.length, 0);
});

test('records a failed book and continues to the next valid book', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'book-draft-failure-'));
  const outputDirectory = path.join(root, 'outputs');
  const first = await createBook(root, 'BrokenBook');
  const second = await createBook(root, 'GoodBook');
  const failure = Object.assign(new Error('generation failed'), {
    code: 'generator_failed',
    transient: false,
  });
  const client = createFakeClient({
    generationFailures: new Map([['BrokenBook', [failure]]]),
  });

  const report = await runBookFacebookDraftBatch({
    databasePath: path.join(root, 'unused.sqlite3'),
    batchRoot: root,
    outputDirectory,
    pageName: PAGE_NAME,
    limit: 1,
    dryRun: false,
    client,
    discoverCandidates: async () => [first, second],
    now: () => new Date('2026-09-13T12:00:00.000Z'),
    retryDelayMs: 0,
  });

  assert.equal(report.failed.length, 1);
  assert.equal(report.failed[0].reason, 'generator_failed');
  assert.deepEqual(
    report.created.map(({ title }) => title),
    ['GoodBook']
  );
});

test('does not write completed state when draft creation fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'book-draft-state-'));
  const outputDirectory = path.join(root, 'outputs');
  const candidate = await createBook(root, 'BookOne');
  const failure = Object.assign(new Error('draft failed'), {
    code: 'draft_failed',
    transient: false,
  });
  const client = createFakeClient({
    draftFailures: new Map([['BookOne', [failure]]]),
  });

  const report = await runBookFacebookDraftBatch({
    databasePath: path.join(root, 'unused.sqlite3'),
    batchRoot: root,
    outputDirectory,
    pageName: PAGE_NAME,
    limit: 1,
    dryRun: false,
    client,
    discoverCandidates: async () => [candidate],
    now: () => new Date('2026-09-13T12:00:00.000Z'),
    retryDelayMs: 0,
  });

  assert.equal(report.failed.length, 1);
  const state = JSON.parse(
    await readFile(path.join(outputDirectory, 'state.json'), 'utf8')
  );
  assert.equal(state.entries.length, 0);
});

test('creates missing Short drafts when the review is already in state', async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), 'book-draft-existing-review-')
  );
  const outputDirectory = path.join(root, 'outputs');
  await mkdir(outputDirectory);
  const candidate = await createBook(root, 'BookOne');
  await addShorts(candidate, [
    { name: 'short_01_hook' },
    { name: 'short_02_lesson' },
  ]);
  const reviewCandidate = {
    ...candidate,
    reviewPath: path.join(candidate.workflowDirectory, 'BookOne-phan-tich.md'),
    imagePath: path.join(candidate.workflowDirectory, 'land.png'),
  };
  const reviewChecksum = await computeSourceChecksum(
    reviewCandidate,
    PAGE_NAME,
    'book-facebook-v1'
  );
  await writeFile(
    path.join(outputDirectory, 'state.json'),
    JSON.stringify({
      version: 2,
      entries: [
        {
          bookId: candidate.bookId,
          variant: 'review',
          checksum: reviewChecksum,
        },
      ],
    })
  );
  const client = createFakeClient();

  const report = await runBookFacebookDraftBatch({
    databasePath: path.join(root, 'unused.sqlite3'),
    batchRoot: root,
    outputDirectory,
    pageName: PAGE_NAME,
    limit: 1,
    client,
    discoverCandidates: async () => [candidate],
    now: () => new Date('2026-09-13T12:00:00.000Z'),
    retryDelayMs: 0,
  });

  assert.equal(client.calls.generate.length, 0);
  assert.equal(client.calls.draft.length, 0);
  assert.deepEqual(
    client.calls.shortDraft.map(({ shortName }) => shortName),
    ['short_01_hook', 'short_02_lesson']
  );
  assert.deepEqual(
    report.created.map(({ variant }) => variant),
    ['short', 'short']
  );
  const state = JSON.parse(
    await readFile(path.join(outputDirectory, 'state.json'), 'utf8')
  );
  assert.deepEqual(
    state.entries.map(({ variant, shortName }) => ({ variant, shortName })),
    [
      { variant: 'review', shortName: undefined },
      { variant: 'short', shortName: 'short_01_hook' },
      { variant: 'short', shortName: 'short_02_lesson' },
    ]
  );
});

test('skips one incomplete Short and continues other Shorts and books', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'book-draft-short-skip-'));
  const outputDirectory = path.join(root, 'outputs');
  const first = await createBook(root, 'BookOne', {
    review: false,
    image: false,
  });
  const second = await createBook(root, 'BookTwo');
  await addShorts(first, [
    { name: 'short_01_missing', video: false },
    { name: 'short_02_ready' },
  ]);
  const client = createFakeClient();

  const report = await runBookFacebookDraftBatch({
    databasePath: path.join(root, 'unused.sqlite3'),
    batchRoot: root,
    outputDirectory,
    pageName: PAGE_NAME,
    limit: 2,
    client,
    discoverCandidates: async () => [first, second],
    now: () => new Date('2026-09-13T12:00:00.000Z'),
    retryDelayMs: 0,
  });

  assert.equal(
    report.skipped.some(
      ({ variant, shortName, reason }) =>
        variant === 'short' &&
        shortName === 'short_01_missing' &&
        reason === 'video_missing'
    ),
    true
  );
  assert.deepEqual(
    report.created.map(({ title, variant }) => `${title}:${variant}`),
    ['BookOne:short', 'BookTwo:review']
  );
});

test('records one Short failure and still creates later Shorts from the same book', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'book-draft-short-failure-'));
  const outputDirectory = path.join(root, 'outputs');
  const candidate = await createBook(root, 'BookOne', {
    review: false,
    image: false,
  });
  await addShorts(candidate, [
    { name: 'short_01_broken' },
    { name: 'short_02_ready' },
  ]);
  const failure = Object.assign(new Error('short draft failed'), {
    code: 'short_draft_failed',
    transient: false,
  });
  const client = createFakeClient({
    shortDraftFailures: new Map([['short_01_broken', [failure]]]),
  });

  const report = await runBookFacebookDraftBatch({
    databasePath: path.join(root, 'unused.sqlite3'),
    batchRoot: root,
    outputDirectory,
    pageName: PAGE_NAME,
    limit: 1,
    client,
    discoverCandidates: async () => [candidate],
    now: () => new Date('2026-09-13T12:00:00.000Z'),
    retryDelayMs: 0,
  });

  assert.equal(report.failed[0].shortName, 'short_01_broken');
  assert.equal(report.failed[0].reason, 'short_draft_failed');
  assert.equal(report.created[0].shortName, 'short_02_ready');
  assert.equal(client.calls.shortDraft.length, 2);
});
