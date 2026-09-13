import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  utimes,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  classifyCandidate,
  computeIdeaChecksum,
  computeShortChecksum,
  computeSourceChecksum,
  discoverPortalCandidates,
  discoverShortResources,
  formatFacebookHashtags,
  isLongYoutubeUrl,
  isPathInside,
  loadState,
  loadIdeaArtifact,
  parseBatchArgs,
  selectLatestReview,
  writeRunArtifacts,
  writeIdeaArtifact,
} from './book-facebook-drafts-lib.mjs';

async function makeTempDirectory() {
  return realpath(await mkdtemp(path.join(tmpdir(), 'book-facebook-drafts-')));
}

function createPortalDatabase(databasePath, rows) {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE book_productions (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      workflow_dir TEXT NOT NULL,
      status TEXT NOT NULL,
      youtube_uploaded_at TEXT
    );
    CREATE TABLE publication_links (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      channel_name TEXT,
      url TEXT NOT NULL,
      title TEXT,
      published_at TEXT,
      status TEXT NOT NULL
    );
  `);

  const insertBook = database.prepare(
    'INSERT INTO books (id,title) VALUES (?,?)'
  );
  const insertProduction = database.prepare(`
    INSERT INTO book_productions
      (id,book_id,workflow_dir,status,youtube_uploaded_at)
    VALUES (?,?,?,?,?)
  `);
  const insertPublication = database.prepare(`
    INSERT INTO publication_links
      (id,book_id,platform,channel_name,url,title,published_at,status)
    VALUES (?,?,?,?,?,?,?,?)
  `);

  for (const row of rows) {
    insertBook.run(row.bookId, row.title);
    insertProduction.run(
      row.productionId,
      row.bookId,
      row.workflowDirectory,
      row.productionStatus ?? 'youtube_uploaded',
      row.youtubeUploadedAt
    );
    insertPublication.run(
      `${row.bookId}-publication`,
      row.bookId,
      'youtube',
      'Will Read Book',
      row.videoUrl,
      row.title,
      row.youtubeUploadedAt,
      'public'
    );
  }
  database.close();
}

test('parses an absolute batch root and enforces a limit from 1 through 10', () => {
  assert.deepEqual(
    parseBatchArgs(['/tmp/books', '--dry-run', '--limit', '4']),
    {
      batchRoot: '/tmp/books',
      dryRun: true,
      limit: 4,
    }
  );
  assert.throws(() => parseBatchArgs(['relative/books']), /absolute/i);
  assert.throws(() => parseBatchArgs(['/tmp/books', '--limit', '0']), /1.*10/);
  assert.throws(() => parseBatchArgs(['/tmp/books', '--limit', '11']), /1.*10/);
  assert.throws(() => parseBatchArgs(['/tmp/books', '--unknown']), /unknown/i);
});

test('accepts long YouTube video URLs and rejects playlists and Shorts', () => {
  assert.equal(
    isLongYoutubeUrl('https://www.youtube.com/watch?v=abc_123-Z'),
    true
  );
  assert.equal(isLongYoutubeUrl('https://youtube.com/watch?v=abc_123-Z'), true);
  assert.equal(isLongYoutubeUrl('https://youtu.be/abc_123-Z'), true);
  assert.equal(
    isLongYoutubeUrl('https://www.youtube.com/shorts/abc_123-Z'),
    false
  );
  assert.equal(
    isLongYoutubeUrl('https://www.youtube.com/playlist?list=PL123'),
    false
  );
  assert.equal(isLongYoutubeUrl('http://youtu.be/abc123'), false);
  assert.equal(isLongYoutubeUrl('not a url'), false);
});

test('recognizes only resolved paths inside the batch root', () => {
  assert.equal(isPathInside('/tmp/books', '/tmp/books/one'), true);
  assert.equal(isPathInside('/tmp/books', '/tmp/books'), true);
  assert.equal(isPathInside('/tmp/books', '/tmp/books-other/one'), false);
});

test('selects the newest analysis Markdown and ignores profile and metadata files', async () => {
  const directory = await makeTempDirectory();
  const older = path.join(directory, 'older-phan-tich.md');
  const newer = path.join(directory, 'newer-phan-tich.md');
  await writeFile(older, 'older review');
  await writeFile(newer, 'newer review');
  await writeFile(path.join(directory, 'review_profile.md'), 'profile');
  await writeFile(path.join(directory, 'youtube_metadata_long.md'), 'metadata');
  await utimes(older, new Date('2026-01-01'), new Date('2026-01-01'));
  await utimes(newer, new Date('2026-02-01'), new Date('2026-02-01'));

  assert.equal(await selectLatestReview(directory), newer);
});

test('discovers every optional Short and isolates missing video or metadata', async () => {
  const directory = await makeTempDirectory();
  await writeFile(
    path.join(directory, 'shorts.txt'),
    [
      '# generated Shorts',
      'short_01_ready 15 15',
      'short_02_no_video 15 15',
      'short_03_no_metadata 15 15',
    ].join('\n')
  );
  await writeFile(
    path.join(directory, 'youtube_metadata_short.md'),
    [
      '### Short 01 - Ready',
      '#### Description',
      'Mô tả Short đã duyệt.',
      '#### Hashtag',
      'Shorts, Tom Tat Sach, #WillReadBook',
      '',
      '### Short 02 - Missing video',
      '#### Description',
      'Mô tả video bị thiếu.',
      '#### Hashtag',
      'Shorts, WillReadBook',
      '',
      '### Short 03 - Missing metadata',
      '#### Description',
      'Có description nhưng thiếu hashtag.',
    ].join('\n')
  );
  const readyDirectory = path.join(
    directory,
    'output',
    'shorts',
    'short_01_ready'
  );
  await mkdir(readyDirectory, { recursive: true });
  await writeFile(
    path.join(readyDirectory, 'short_01_ready.mp4'),
    Buffer.from('video-bytes')
  );

  const shorts = await discoverShortResources(directory);

  assert.deepEqual(
    shorts.map(({ shortName, shortNumber, status }) => ({
      shortName,
      shortNumber,
      status,
    })),
    [
      { shortName: 'short_01_ready', shortNumber: '01', status: 'ready' },
      {
        shortName: 'short_02_no_video',
        shortNumber: '02',
        status: 'video_missing',
      },
      {
        shortName: 'short_03_no_metadata',
        shortNumber: '03',
        status: 'metadata_missing',
      },
    ]
  );
  assert.equal(shorts[0].description, 'Mô tả Short đã duyệt.');
  assert.equal(shorts[0].hashtags, '#Shorts #TomTatSach #WillReadBook');
  assert.equal(
    formatFacebookHashtags('Shorts, Tom Tat Sach, #WillReadBook'),
    '#Shorts #TomTatSach #WillReadBook'
  );
  assert.deepEqual(
    await discoverShortResources(path.join(directory, 'missing-book')),
    []
  );
});

test('discovers uploaded books inside the root in oldest-first order', async () => {
  const root = await makeTempDirectory();
  const outside = await makeTempDirectory();
  const older = path.join(root, 'older');
  const newer = path.join(root, 'newer');
  await Promise.all([mkdir(older), mkdir(newer)]);
  const databasePath = path.join(root, 'library.sqlite3');

  createPortalDatabase(databasePath, [
    {
      bookId: 'newer',
      productionId: 'production-newer',
      title: 'Newer valid book',
      workflowDirectory: newer,
      youtubeUploadedAt: '2026-02-01T00:00:00.000Z',
      videoUrl: 'https://www.youtube.com/watch?v=newer123',
    },
    {
      bookId: 'older',
      productionId: 'production-older',
      title: 'Older valid book',
      workflowDirectory: older,
      youtubeUploadedAt: '2026-01-01T00:00:00.000Z',
      videoUrl: 'https://youtu.be/older123',
    },
    {
      bookId: 'outside',
      productionId: 'production-outside',
      title: 'Outside book',
      workflowDirectory: outside,
      youtubeUploadedAt: '2025-01-01T00:00:00.000Z',
      videoUrl: 'https://youtu.be/outside123',
    },
  ]);

  const candidates = await discoverPortalCandidates({
    databasePath,
    batchRoot: root,
  });
  assert.deepEqual(
    candidates.map(({ title }) => title),
    ['Older valid book', 'Newer valid book']
  );
});

test('remaps a stale portal workflow path to one exact title slug inside the batch root', async () => {
  const root = await makeTempDirectory();
  const mapped = path.join(root, 'archive', 'tu-tot-den-vi-dai');
  await mkdir(mapped, { recursive: true });
  const databasePath = path.join(root, 'library.sqlite3');

  createPortalDatabase(databasePath, [
    {
      bookId: 'book-1',
      productionId: 'production-1',
      title: 'Từ tốt đến vĩ đại',
      workflowDirectory: '/old-machine/books/tu-tot-den-vi-dai-jim-collins',
      youtubeUploadedAt: '2026-01-01T00:00:00.000Z',
      videoUrl: 'https://www.youtube.com/watch?v=abc123',
    },
  ]);

  const candidates = await discoverPortalCandidates({
    databasePath,
    batchRoot: root,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].workflowDirectory, await realpath(mapped));
});

test('remaps a title slug to a unique resource directory with an author suffix', async () => {
  const root = await makeTempDirectory();
  const mapped = path.join(root, 'dam-nghi-lon-david-schwartz');
  await mkdir(mapped);
  const databasePath = path.join(root, 'library.sqlite3');

  createPortalDatabase(databasePath, [
    {
      bookId: 'book-1',
      productionId: 'production-1',
      title: 'Dám Nghĩ Lớn',
      workflowDirectory: '/old-machine/books/unrelated-old-folder',
      youtubeUploadedAt: '2026-01-01T00:00:00.000Z',
      videoUrl: 'https://youtu.be/abc123',
    },
  ]);

  const candidates = await discoverPortalCandidates({
    databasePath,
    batchRoot: root,
  });
  assert.equal(candidates[0]?.workflowDirectory, await realpath(mapped));
});

test('remaps a verbose stale workflow slug to one shorter resource directory', async () => {
  const root = await makeTempDirectory();
  const mapped = path.join(root, 'chu-nghia-khac-ky');
  await mkdir(mapped);
  const databasePath = path.join(root, 'library.sqlite3');

  createPortalDatabase(databasePath, [
    {
      bookId: 'book-1',
      productionId: 'production-1',
      title: 'Một tiêu đề portal không đồng nhất',
      workflowDirectory:
        '/old-machine/books/chu-nghia-khac-ky-phong-cach-song-ban-linh',
      youtubeUploadedAt: '2026-01-01T00:00:00.000Z',
      videoUrl: 'https://www.youtube.com/watch?v=abc123',
    },
  ]);

  const candidates = await discoverPortalCandidates({
    databasePath,
    batchRoot: root,
  });
  assert.equal(candidates[0]?.workflowDirectory, await realpath(mapped));
});

test('does not guess when a title slug maps to more than one resource directory', async () => {
  const root = await makeTempDirectory();
  await Promise.all([
    mkdir(path.join(root, 'one', 'same-book'), { recursive: true }),
    mkdir(path.join(root, 'two', 'same-book'), { recursive: true }),
  ]);
  const databasePath = path.join(root, 'library.sqlite3');

  createPortalDatabase(databasePath, [
    {
      bookId: 'book-1',
      productionId: 'production-1',
      title: 'Same Book',
      workflowDirectory: '/old-machine/books/same-book',
      youtubeUploadedAt: '2026-01-01T00:00:00.000Z',
      videoUrl: 'https://youtu.be/abc123',
    },
  ]);

  assert.deepEqual(
    await discoverPortalCandidates({ databasePath, batchRoot: root }),
    []
  );
});

test('uses a remapped resource directory for only one portal production', async () => {
  const root = await makeTempDirectory();
  await mkdir(path.join(root, 'chu-nghia-khac-ky'));
  const databasePath = path.join(root, 'library.sqlite3');
  createPortalDatabase(databasePath, [
    {
      bookId: 'older-book',
      productionId: 'older-production',
      title: 'Chủ nghĩa khắc kỷ bản lĩnh',
      workflowDirectory: '/old/books/chu-nghia-khac-ky-ban-linh',
      youtubeUploadedAt: '2026-01-01T00:00:00.000Z',
      videoUrl: 'https://youtu.be/older123',
    },
    {
      bookId: 'newer-book',
      productionId: 'newer-production',
      title: 'Chủ nghĩa khắc kỷ bình an',
      workflowDirectory: '/old/books/chu-nghia-khac-ky-binh-an',
      youtubeUploadedAt: '2026-02-01T00:00:00.000Z',
      videoUrl: 'https://youtu.be/newer123',
    },
  ]);

  const candidates = await discoverPortalCandidates({
    databasePath,
    batchRoot: root,
  });
  assert.deepEqual(
    candidates.map(({ productionId }) => productionId),
    ['older-production']
  );
});

test('computes stable source checksums and classifies duplicate and changed sources', async () => {
  const root = await makeTempDirectory();
  const reviewPath = path.join(root, 'book-phan-tich.md');
  const imagePath = path.join(root, 'land.png');
  await writeFile(reviewPath, 'A grounded review');
  await writeFile(imagePath, Buffer.from([1, 2, 3, 4]));
  const candidate = {
    bookId: 'book-1',
    productionId: 'production-1',
    reviewPath,
    imagePath,
    videoUrl: 'https://youtu.be/abc123',
  };
  const checksum = await computeSourceChecksum(
    candidate,
    'Vì cuộc sống là ko chờ đợi',
    'v1'
  );
  assert.equal(
    checksum,
    await computeSourceChecksum(candidate, 'Vì cuộc sống là ko chờ đợi', 'v1')
  );
  assert.equal(classifyCandidate(candidate, { entries: [] }, checksum), 'new');
  assert.equal(
    classifyCandidate(
      candidate,
      { entries: [{ bookId: 'book-1', checksum }] },
      checksum
    ),
    'skipped'
  );
  assert.equal(
    classifyCandidate(
      candidate,
      { entries: [{ bookId: 'book-1', checksum: 'older' }] },
      checksum
    ),
    'source_changed'
  );
});

test('classifies review and Short state independently and hashes Short content', async () => {
  const root = await makeTempDirectory();
  const videoPath = path.join(root, 'short_01.mp4');
  await writeFile(videoPath, Buffer.from('video-one'));
  const candidate = {
    bookId: 'book-1',
    productionId: 'production-1',
    videoUrl: 'https://youtu.be/abc123',
  };
  const short = {
    shortName: 'short_01_hook',
    shortNumber: '01',
    videoPath,
    description: 'Mô tả Short',
    hashtags: '#Shorts #WillReadBook',
  };
  const checksum = await computeShortChecksum(
    candidate,
    short,
    PAGE_NAME,
    'short-v1'
  );
  assert.equal(
    checksum,
    await computeShortChecksum(candidate, short, PAGE_NAME, 'short-v1')
  );

  const reviewState = {
    entries: [
      { bookId: 'book-1', variant: 'review', checksum: 'review-checksum' },
    ],
  };
  assert.equal(
    classifyCandidate(candidate, reviewState, checksum, {
      variant: 'short',
      shortName: short.shortName,
    }),
    'new'
  );
  const shortState = {
    entries: [
      {
        bookId: 'book-1',
        variant: 'short',
        shortName: short.shortName,
        checksum,
      },
    ],
  };
  assert.equal(
    classifyCandidate(candidate, shortState, checksum, {
      variant: 'short',
      shortName: short.shortName,
    }),
    'skipped'
  );
  await writeFile(videoPath, Buffer.from('video-two'));
  assert.notEqual(
    checksum,
    await computeShortChecksum(candidate, short, PAGE_NAME, 'short-v1')
  );
});

test('classifies numbered idea drafts independently', () => {
  const candidate = { bookId: 'book-1' };
  const state = {
    entries: [
      {
        bookId: 'book-1',
        variant: 'idea',
        ideaNumber: 1,
        checksum: 'idea-one',
      },
    ],
  };

  assert.equal(
    classifyCandidate(candidate, state, 'idea-one', {
      variant: 'idea',
      ideaNumber: 1,
    }),
    'skipped'
  );
  assert.equal(
    classifyCandidate(candidate, state, 'idea-two', {
      variant: 'idea',
      ideaNumber: 2,
    }),
    'new'
  );
});

test('computes stable idea checksums and round-trips a generated artifact', async () => {
  const directory = await makeTempDirectory();
  const artifactPath = path.join(directory, 'generated', 'ideas.json');
  const ideas = Array.from({ length: 10 }, (_, index) => ({
    ideaNumber: index + 1,
    content: `Nội dung ý tưởng ${index + 1}`,
  }));
  const artifact = {
    version: 1,
    sourceChecksum: 'source-checksum',
    bookId: 'book-1',
    createdAt: '2026-09-14T00:00:00.000Z',
    ideas: ideas.map((idea) => ({
      ...idea,
      checksum: computeIdeaChecksum(
        'source-checksum',
        idea.ideaNumber,
        idea.content
      ),
    })),
  };

  assert.equal(
    artifact.ideas[0].checksum,
    computeIdeaChecksum('source-checksum', 1, 'Nội dung ý tưởng 1')
  );
  assert.notEqual(
    artifact.ideas[0].checksum,
    computeIdeaChecksum('source-checksum', 2, 'Nội dung ý tưởng 1')
  );

  await writeIdeaArtifact(artifactPath, artifact);
  assert.deepEqual(
    await loadIdeaArtifact(artifactPath, {
      sourceChecksum: 'source-checksum',
      count: 10,
    }),
    artifact
  );
  assert.equal(
    await loadIdeaArtifact(artifactPath, {
      sourceChecksum: 'changed-source',
      count: 10,
    }),
    null
  );
});

const PAGE_NAME = 'Vì cuộc sống là ko chờ đợi';

test('migrates version 1 review entries to version 2 state', async () => {
  const directory = await makeTempDirectory();
  const statePath = path.join(directory, 'state.json');
  await writeFile(
    statePath,
    JSON.stringify({
      version: 1,
      entries: [{ bookId: 'book-1', checksum: 'checksum-1' }],
    })
  );

  assert.deepEqual(await loadState(statePath), {
    version: 2,
    entries: [{ bookId: 'book-1', checksum: 'checksum-1', variant: 'review' }],
  });
});

test('loads missing state and atomically writes safe JSON and Markdown reports', async () => {
  const outputDirectory = path.join(await makeTempDirectory(), 'outputs');
  assert.deepEqual(await loadState(path.join(outputDirectory, 'state.json')), {
    version: 2,
    entries: [],
  });

  const paths = await writeRunArtifacts({
    outputDirectory,
    runId: '2026-09-13T12-00-00-000Z',
    report: {
      created: [{ bookId: 'book-1', title: 'Book One', draftId: 'draft-1' }],
      skipped: [],
      sourceChanged: [],
      failed: [],
    },
  });
  assert.match(paths.json, /2026-09-13T12-00-00-000Z\.json$/);
  assert.match(paths.markdown, /2026-09-13T12-00-00-000Z\.md$/);
});

test('ships one Bash wrapper that rejects relative batch paths', () => {
  const wrapper = path.resolve('scripts/local/create-book-facebook-drafts.sh');
  const result = spawnSync('bash', [wrapper, 'relative/books', '--dry-run'], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /absolute/i);
});

test('documents non-secret batch settings and exposes package scripts', async () => {
  const example = await readFile(
    path.resolve('.env.codex-local.example'),
    'utf8'
  );
  for (const key of [
    'POSTIZ_URL=',
    'POSTIZ_CREDENTIAL_FILE=',
    'POSTIZ_FACEBOOK_PAGE_NAME=',
    'BOOK_LIBRARY_DATABASE=',
    'BOOK_FACEBOOK_DRAFT_OUTPUT=',
  ]) {
    assert.match(example, new RegExp(`^${key}`, 'm'));
  }
  assert.match(
    example,
    /^POSTIZ_FACEBOOK_PAGE_NAME="Vì cuộc sống là ko chờ đợi"$/m
  );
  const packageJson = JSON.parse(
    await readFile(path.resolve('package.json'), 'utf8')
  );
  assert.equal(
    typeof packageJson.scripts['test:book-facebook-drafts'],
    'string'
  );
  assert.equal(typeof packageJson.scripts['book-facebook-drafts'], 'string');
});
