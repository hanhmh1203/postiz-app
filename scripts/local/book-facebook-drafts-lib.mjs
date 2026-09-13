import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_BATCH_LIMIT = 10;
export const MAX_BATCH_LIMIT = 10;
export const STATE_VERSION = 1;

export function parseBatchArgs(argv) {
  const options = {
    batchRoot: '',
    dryRun: false,
    limit: DEFAULT_BATCH_LIMIT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (value === '--limit') {
      const rawLimit = argv[index + 1];
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_LIMIT) {
        throw new Error(`--limit must be an integer from 1 through ${MAX_BATCH_LIMIT}`);
      }
      options.limit = limit;
      index += 1;
      continue;
    }
    if (value.startsWith('-')) {
      throw new Error(`Unknown option: ${value}`);
    }
    if (options.batchRoot) {
      throw new Error('Only one batch root may be provided');
    }
    options.batchRoot = value;
  }

  if (!options.batchRoot) throw new Error('An absolute batch root is required');
  if (!path.isAbsolute(options.batchRoot)) {
    throw new Error('The batch root must be an absolute path');
  }
  return options;
}

export function isLongYoutubeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if ((host === 'youtube.com' || host === 'www.youtube.com') && url.pathname === '/watch') {
      return /^[A-Za-z0-9_-]+$/.test(url.searchParams.get('v') || '');
    }
    return host === 'youtu.be' && /^\/[A-Za-z0-9_-]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isPathInside(root, child) {
  const relative = path.relative(path.resolve(root), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function toDirectorySlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

async function indexDirectoriesBySlug(root) {
  const directories = new Map();
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const slug = toDirectorySlug(path.basename(directory));
    if (slug) directories.set(slug, [...(directories.get(slug) || []), directory]);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) pending.push(path.join(directory, entry.name));
    }
  }
  return directories;
}

export async function selectLatestReview(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('-phan-tich.md')) continue;
    const filePath = path.join(directory, entry.name);
    const metadata = await stat(filePath);
    if (metadata.size === 0) continue;
    candidates.push({ filePath, modifiedAt: metadata.mtimeMs });
  }
  candidates.sort(
    (left, right) =>
      right.modifiedAt - left.modifiedAt || left.filePath.localeCompare(right.filePath)
  );
  return candidates[0]?.filePath ?? null;
}

export async function discoverPortalCandidates({ databasePath, batchRoot }) {
  const resolvedRoot = await realpath(batchRoot);
  const directoriesBySlug = await indexDirectoriesBySlug(resolvedRoot);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database
      .prepare(`
        SELECT
          p.id AS productionId,
          p.book_id AS bookId,
          b.title AS title,
          p.workflow_dir AS workflowDirectory,
          p.youtube_uploaded_at AS youtubeUploadedAt,
          l.url AS videoUrl,
          l.published_at AS publishedAt,
          l.id AS publicationId
        FROM book_productions p
        JOIN books b ON b.id = p.book_id
        JOIN publication_links l ON l.book_id = p.book_id
        WHERE p.status = 'youtube_uploaded'
          AND lower(l.platform) = 'youtube'
        ORDER BY
          COALESCE(p.youtube_uploaded_at, p.id),
          p.book_id,
          p.id,
          COALESCE(l.published_at, '') DESC,
          l.id DESC
      `)
      .all();

    const candidates = [];
    const seenProductions = new Set();
    for (const row of rows) {
      if (seenProductions.has(row.productionId) || !isLongYoutubeUrl(row.videoUrl)) continue;
      let resolvedDirectory;
      try {
        resolvedDirectory = await realpath(row.workflowDirectory);
      } catch {
        resolvedDirectory = null;
      }
      if (!resolvedDirectory || !isPathInside(resolvedRoot, resolvedDirectory)) {
        const matches = directoriesBySlug.get(toDirectorySlug(row.title)) || [];
        if (matches.length !== 1) continue;
        [resolvedDirectory] = matches;
      }
      seenProductions.add(row.productionId);
      candidates.push({
        bookId: String(row.bookId),
        productionId: String(row.productionId),
        title: String(row.title),
        workflowDirectory: resolvedDirectory,
        youtubeUploadedAt: row.youtubeUploadedAt ? String(row.youtubeUploadedAt) : '',
        videoUrl: String(row.videoUrl),
      });
    }
    return candidates;
  } finally {
    database.close();
  }
}

export async function computeSourceChecksum(candidate, pageName, templateVersion) {
  const [review, image] = await Promise.all([
    readFile(candidate.reviewPath),
    readFile(candidate.imagePath),
  ]);
  const hash = createHash('sha256');
  for (const value of [
    candidate.bookId,
    candidate.productionId,
    candidate.videoUrl,
    pageName,
    templateVersion,
  ]) {
    hash.update(String(value));
    hash.update('\0');
  }
  hash.update(review);
  hash.update('\0');
  hash.update(image);
  return hash.digest('hex');
}

export function classifyCandidate(candidate, state, checksum) {
  const existing = state.entries.find((entry) => entry.bookId === candidate.bookId);
  if (!existing) return 'new';
  return existing.checksum === checksum ? 'skipped' : 'source_changed';
}

export async function loadState(statePath) {
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8'));
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.entries)) {
      throw new Error('Draft state has an unsupported format');
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: STATE_VERSION, entries: [] };
    throw error;
  }
}

async function atomicJsonWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function writeState(statePath, state) {
  await atomicJsonWrite(statePath, state);
}

function safeReportEntry(entry) {
  const allowedKeys = [
    'bookId',
    'productionId',
    'title',
    'status',
    'reason',
    'draftId',
    'group',
    'reviewPath',
    'imagePath',
    'videoUrl',
    'checksum',
    'previewPath',
  ];
  return Object.fromEntries(
    allowedKeys.filter((key) => entry?.[key] !== undefined).map((key) => [key, entry[key]])
  );
}

function markdownSection(title, entries) {
  const lines = [`## ${title}`, ''];
  if (entries.length === 0) return [...lines, '- None', ''];
  for (const entry of entries) {
    const suffix = entry.reason ? ` — ${entry.reason}` : entry.draftId ? ` — draft ${entry.draftId}` : '';
    lines.push(`- ${entry.title || entry.bookId}${suffix}`);
  }
  lines.push('');
  return lines;
}

export async function writeRunArtifacts({ outputDirectory, runId, report }) {
  const runsDirectory = path.join(outputDirectory, 'runs');
  await mkdir(runsDirectory, { recursive: true });
  const safeReport = {
    runId,
    created: (report.created || []).map(safeReportEntry),
    skipped: (report.skipped || []).map(safeReportEntry),
    sourceChanged: (report.sourceChanged || []).map(safeReportEntry),
    failed: (report.failed || []).map(safeReportEntry),
  };
  const jsonPath = path.join(runsDirectory, `${runId}.json`);
  const markdownPath = path.join(runsDirectory, `${runId}.md`);
  await atomicJsonWrite(jsonPath, safeReport);
  const markdown = [
    '# Facebook Draft Batch Report',
    '',
    `Run: ${runId}`,
    '',
    ...markdownSection('Created', safeReport.created),
    ...markdownSection('Skipped', safeReport.skipped),
    ...markdownSection('Source changed', safeReport.sourceChanged),
    ...markdownSection('Failed', safeReport.failed),
  ].join('\n');
  await writeFile(markdownPath, markdown, { mode: 0o600 });
  return { json: jsonPath, markdown: markdownPath };
}
