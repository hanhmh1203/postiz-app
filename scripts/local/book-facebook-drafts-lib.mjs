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
export const STATE_VERSION = 2;

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
        throw new Error(
          `--limit must be an integer from 1 through ${MAX_BATCH_LIMIT}`
        );
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
    if (
      (host === 'youtube.com' || host === 'www.youtube.com') &&
      url.pathname === '/watch'
    ) {
      return /^[A-Za-z0-9_-]+$/.test(url.searchParams.get('v') || '');
    }
    return host === 'youtu.be' && /^\/[A-Za-z0-9_-]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isPathInside(root, child) {
  const relative = path.relative(path.resolve(root), path.resolve(child));
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
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
    if (slug)
      directories.set(slug, [...(directories.get(slug) || []), directory]);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) pending.push(path.join(directory, entry.name));
    }
  }
  return directories;
}

function uniqueDirectoryMatching(directoriesBySlug, predicate) {
  const matches = new Set();
  for (const [slug, directories] of directoriesBySlug) {
    if (!predicate(slug)) continue;
    for (const directory of directories) matches.add(directory);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function remapWorkflowDirectory(row, directoriesBySlug) {
  const titleSlug = toDirectorySlug(row.title);
  const workflowSlug = toDirectorySlug(
    path.basename(String(row.workflowDirectory || ''))
  );
  const strategies = [
    (slug) => slug === titleSlug,
    (slug) => workflowSlug && slug === workflowSlug,
    (slug) => titleSlug.length >= 5 && slug.startsWith(`${titleSlug}-`),
    (slug) =>
      workflowSlug.length >= 5 &&
      (slug.startsWith(`${workflowSlug}-`) ||
        workflowSlug.startsWith(`${slug}-`)),
  ];
  for (const strategy of strategies) {
    const match = uniqueDirectoryMatching(directoriesBySlug, strategy);
    if (match) return match;
  }
  return null;
}

export async function selectLatestReview(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = [];
  const addCandidate = async (filePath) => {
    try {
      const metadata = await stat(filePath);
      if (!metadata.isFile() || metadata.size === 0) return;
      candidates.push({ filePath, modifiedAt: metadata.mtimeMs });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  };
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('-phan-tich.md')) continue;
    await addCandidate(path.join(directory, entry.name));
  }
  for (const relativePath of ['documentary.md', 'output/documentary.md']) {
    await addCandidate(path.join(directory, relativePath));
  }
  candidates.sort(
    (left, right) =>
      right.modifiedAt - left.modifiedAt ||
      left.filePath.localeCompare(right.filePath)
  );
  return candidates[0]?.filePath ?? null;
}

export function formatFacebookHashtags(value) {
  return String(value || '')
    .split(',')
    .map((tag) =>
      tag
        .trim()
        .replace(/^#+/, '')
        .replace(/[^\p{L}\p{N}_]+/gu, '')
    )
    .filter(Boolean)
    .map((tag) => `#${tag}`)
    .join(' ');
}

function parseShortMetadata(markdown) {
  const sections = new Map();
  let current;
  let field;
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const sectionMatch = line.match(/^###\s+Short\s+(\d{2})\b/i);
    if (sectionMatch) {
      current = { description: [], hashtags: [] };
      sections.set(sectionMatch[1], current);
      field = undefined;
      continue;
    }
    if (/^####\s+Description\s*$/i.test(line)) {
      field = current ? 'description' : undefined;
      continue;
    }
    if (/^####\s+Hashtag\s*$/i.test(line)) {
      field = current ? 'hashtags' : undefined;
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      field = undefined;
      continue;
    }
    if (current && field) current[field].push(line);
  }
  return new Map(
    [...sections].map(([number, section]) => [
      number,
      {
        description: section.description.join('\n').trim(),
        hashtags: formatFacebookHashtags(section.hashtags.join('\n').trim()),
      },
    ])
  );
}

export async function discoverShortResources(workflowDirectory) {
  const shortsPath = path.join(workflowDirectory, 'shorts.txt');
  let rows;
  try {
    rows = (await readFile(shortsPath, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const metadataPath = path.join(
    workflowDirectory,
    'youtube_metadata_short.md'
  );
  let metadata = new Map();
  try {
    metadata = parseShortMetadata(await readFile(metadataPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const results = [];
  for (const row of rows) {
    const shortName = row.split(/\s+/)[0];
    const shortNumber = shortName.match(/^short_(\d{2})(?:_|$)/i)?.[1] || '';
    const videoPath = path.join(
      workflowDirectory,
      'output',
      'shorts',
      shortName,
      `${shortName}.mp4`
    );
    const section = metadata.get(shortNumber);
    if (!shortNumber || !section?.description || !section?.hashtags) {
      results.push({
        shortName,
        shortNumber,
        videoPath,
        metadataPath,
        status: 'metadata_missing',
      });
      continue;
    }
    try {
      const video = await stat(videoPath);
      if (!video.isFile() || video.size === 0)
        throw Object.assign(new Error(), { code: 'ENOENT' });
    } catch {
      results.push({
        shortName,
        shortNumber,
        videoPath,
        metadataPath,
        description: section.description,
        hashtags: section.hashtags,
        status: 'video_missing',
      });
      continue;
    }
    results.push({
      shortName,
      shortNumber,
      videoPath,
      metadataPath,
      description: section.description,
      hashtags: section.hashtags,
      status: 'ready',
    });
  }
  return results;
}

export async function discoverPortalCandidates({ databasePath, batchRoot }) {
  const resolvedRoot = await realpath(batchRoot);
  const directoriesBySlug = await indexDirectoriesBySlug(resolvedRoot);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        `
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
      `
      )
      .all();

    const candidates = [];
    const seenProductions = new Set();
    const seenDirectories = new Set();
    for (const row of rows) {
      if (
        seenProductions.has(row.productionId) ||
        !isLongYoutubeUrl(row.videoUrl)
      )
        continue;
      let resolvedDirectory;
      try {
        resolvedDirectory = await realpath(row.workflowDirectory);
      } catch {
        resolvedDirectory = null;
      }
      if (
        !resolvedDirectory ||
        !isPathInside(resolvedRoot, resolvedDirectory)
      ) {
        resolvedDirectory = remapWorkflowDirectory(row, directoriesBySlug);
        if (!resolvedDirectory) continue;
      }
      if (seenDirectories.has(resolvedDirectory)) continue;
      seenProductions.add(row.productionId);
      seenDirectories.add(resolvedDirectory);
      candidates.push({
        bookId: String(row.bookId),
        productionId: String(row.productionId),
        title: String(row.title),
        workflowDirectory: resolvedDirectory,
        youtubeUploadedAt: row.youtubeUploadedAt
          ? String(row.youtubeUploadedAt)
          : '',
        videoUrl: String(row.videoUrl),
      });
    }
    return candidates;
  } finally {
    database.close();
  }
}

export async function computeSourceChecksum(
  candidate,
  pageName,
  templateVersion
) {
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

export async function computeShortChecksum(
  candidate,
  short,
  pageName,
  templateVersion
) {
  const video = await readFile(short.videoPath);
  const hash = createHash('sha256');
  for (const value of [
    candidate.bookId,
    candidate.productionId,
    candidate.videoUrl,
    pageName,
    templateVersion,
    short.shortName,
    short.shortNumber,
    short.description,
    short.hashtags,
  ]) {
    hash.update(String(value));
    hash.update('\0');
  }
  hash.update(video);
  return hash.digest('hex');
}

export function computeIdeaChecksum(sourceChecksum, ideaNumber, content) {
  if (!Number.isInteger(ideaNumber) || ideaNumber < 1) {
    throw new Error('Idea number must be a positive integer');
  }
  const hash = createHash('sha256');
  for (const value of [sourceChecksum, ideaNumber, content]) {
    hash.update(String(value));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function classifyCandidate(
  candidate,
  state,
  checksum,
  identity = { variant: 'review' }
) {
  const existing = state.entries.find((entry) => {
    if (entry.bookId !== candidate.bookId) return false;
    const entryVariant = entry.variant || 'review';
    if (entryVariant !== identity.variant) return false;
    if (identity.variant === 'short') {
      return entry.shortName === identity.shortName;
    }
    if (identity.variant === 'idea') {
      return entry.ideaNumber === identity.ideaNumber;
    }
    return true;
  });
  if (!existing) return 'new';
  return existing.checksum === checksum ? 'skipped' : 'source_changed';
}

export async function loadState(statePath) {
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8'));
    if (!Array.isArray(parsed?.entries)) {
      throw new Error('Draft state has an unsupported format');
    }
    if (parsed.version === 1) {
      return {
        version: STATE_VERSION,
        entries: parsed.entries.map((entry) => ({
          ...entry,
          variant: 'review',
        })),
      };
    }
    if (parsed.version !== STATE_VERSION) {
      throw new Error('Draft state has an unsupported format');
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT')
      return { version: STATE_VERSION, entries: [] };
    throw error;
  }
}

async function atomicJsonWrite(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

export async function writeState(statePath, state) {
  await atomicJsonWrite(statePath, state);
}

export async function loadIdeaArtifact(
  artifactPath,
  { sourceChecksum, count }
) {
  try {
    const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
    if (
      artifact?.version !== 1 ||
      artifact.sourceChecksum !== sourceChecksum ||
      !Array.isArray(artifact.ideas) ||
      artifact.ideas.length !== count
    ) {
      return null;
    }
    const valid = artifact.ideas.every((idea, index) => {
      if (
        idea?.ideaNumber !== index + 1 ||
        typeof idea.content !== 'string' ||
        typeof idea.checksum !== 'string'
      ) {
        return false;
      }
      return (
        idea.checksum ===
        computeIdeaChecksum(sourceChecksum, idea.ideaNumber, idea.content)
      );
    });
    return valid ? artifact : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeIdeaArtifact(artifactPath, artifact) {
  await atomicJsonWrite(artifactPath, artifact);
}

function safeReportEntry(entry) {
  const allowedKeys = [
    'bookId',
    'productionId',
    'variant',
    'shortName',
    'shortNumber',
    'ideaNumber',
    'title',
    'status',
    'reason',
    'draftId',
    'group',
    'reviewPath',
    'imagePath',
    'videoPath',
    'metadataPath',
    'videoUrl',
    'checksum',
    'previewPath',
    'ideaArtifactPath',
  ];
  return Object.fromEntries(
    allowedKeys
      .filter((key) => entry?.[key] !== undefined)
      .map((key) => [key, entry[key]])
  );
}

function markdownSection(title, entries) {
  const lines = [`## ${title}`, ''];
  if (entries.length === 0) return [...lines, '- None', ''];
  for (const entry of entries) {
    const suffix = entry.reason
      ? ` — ${entry.reason}`
      : entry.draftId
      ? ` — draft ${entry.draftId}`
      : '';
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
