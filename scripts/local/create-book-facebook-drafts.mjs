#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  classifyCandidate,
  computeSourceChecksum,
  discoverPortalCandidates,
  loadState,
  parseBatchArgs,
  selectLatestReview,
  writeRunArtifacts,
  writeState,
} from './book-facebook-drafts-lib.mjs';
import { PostizLocalClient, readPostizCredentials } from './postiz-local-client.mjs';

export const TEMPLATE_VERSION = 'book-facebook-v1';
export const DEFAULT_PAGE_NAME = 'Vì cuộc sống là ko chờ đợi';
const COMMENT_PREFIX = 'Để nghe review trọn vẹn, bạn xem tại đây: ';

export async function retryTransient(
  operation,
  { retries = 2, delayMs = 250, wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {}
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!error?.transient || attempt === retries) throw error;
      await wait(delayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : 'unexpected_error';
  return /^[a-z0-9_]+$/.test(code) ? code : 'unexpected_error';
}

async function validateResources(candidate) {
  const reviewPath = await selectLatestReview(candidate.workflowDirectory);
  if (!reviewPath) return { reason: 'review_missing' };
  const imagePath = path.join(candidate.workflowDirectory, 'land.png');
  try {
    const image = await stat(imagePath);
    if (!image.isFile() || image.size === 0) return { reason: 'land_image_missing' };
  } catch {
    return { reason: 'land_image_missing' };
  }
  const review = (await readFile(reviewPath, 'utf8')).trim();
  if (!review) return { reason: 'review_missing' };
  return { reviewPath, imagePath, review };
}

async function writePreview({ outputDirectory, runId, candidate, caption, comment }) {
  const previewDirectory = path.join(outputDirectory, 'previews', runId);
  await mkdir(previewDirectory, { recursive: true });
  const safeName = candidate.bookId.replace(/[^A-Za-z0-9_-]+/g, '_');
  const previewPath = path.join(previewDirectory, `${safeName}.md`);
  const text = `# ${candidate.title}

## Facebook draft

${caption}

## First comment

${comment}

## Media

${candidate.imagePath}
`;
  await writeFile(previewPath, text, { mode: 0o600 });
  return previewPath;
}

export async function runBookFacebookDraftBatch({
  databasePath,
  batchRoot,
  outputDirectory,
  pageName = DEFAULT_PAGE_NAME,
  limit = 10,
  dryRun = false,
  client,
  discoverCandidates = discoverPortalCandidates,
  now = () => new Date(),
  retryDelayMs = 250,
}) {
  if (!client) throw new Error('A Postiz client is required');
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error('Batch limit must be an integer from 1 through 10');
  }
  await mkdir(outputDirectory, { recursive: true });
  const statePath = path.join(outputDirectory, 'state.json');
  const state = await loadState(statePath);
  const runId = now().toISOString().replace(/[:.]/g, '-');
  const report = { created: [], skipped: [], sourceChanged: [], failed: [] };

  await client.login();
  const integration = await client.preflight(pageName);
  const candidates = await discoverCandidates({ databasePath, batchRoot });

  for (const rawCandidate of candidates) {
    if (report.created.length >= limit) break;
    let candidate = rawCandidate;
    try {
      const resources = await validateResources(rawCandidate);
      if (resources.reason) {
        report.skipped.push({ ...rawCandidate, status: 'skipped', reason: resources.reason });
        continue;
      }
      candidate = { ...rawCandidate, ...resources };
      const checksum = await computeSourceChecksum(candidate, pageName, TEMPLATE_VERSION);
      const classification = classifyCandidate(candidate, state, checksum);
      if (classification === 'skipped') {
        report.skipped.push({ ...candidate, checksum, status: 'skipped', reason: 'already_drafted' });
        continue;
      }
      if (classification === 'source_changed') {
        report.sourceChanged.push({ ...candidate, checksum, status: 'source_changed', reason: 'source_changed' });
        continue;
      }

      const caption = await retryTransient(
        () => client.generateCaption({ title: candidate.title, review: candidate.review }),
        { retries: 2, delayMs: retryDelayMs }
      );
      const comment = `${COMMENT_PREFIX}${candidate.videoUrl}`;
      const marker = `wrb:${candidate.bookId}:${checksum}`;

      if (dryRun) {
        const previewPath = await writePreview({ outputDirectory, runId, candidate, caption, comment });
        report.created.push({
          ...candidate,
          checksum,
          status: 'dry_run',
          previewPath,
        });
        continue;
      }

      const media = await retryTransient(() => client.uploadMedia(candidate.imagePath), {
        retries: 2,
        delayMs: retryDelayMs,
      });
      let draft;
      try {
        draft = await retryTransient(
          () => client.createDraft({
            integrationId: integration.id,
            title: candidate.title,
            caption,
            comment,
            media,
            marker,
          }),
          { retries: 2, delayMs: retryDelayMs }
        );
      } catch (error) {
        const existing = await client.findDraftByMarker(marker).catch(() => null);
        if (!existing) throw error;
        draft = existing;
      }

      const stateEntry = {
        bookId: candidate.bookId,
        productionId: candidate.productionId,
        checksum,
        pageName,
        postId: draft.postId,
        commentId: draft.commentId,
        reviewPath: candidate.reviewPath,
        imagePath: candidate.imagePath,
        videoUrl: candidate.videoUrl,
        createdAt: now().toISOString(),
        templateVersion: TEMPLATE_VERSION,
      };
      state.entries.push(stateEntry);
      await writeState(statePath, state);
      report.created.push({
        ...candidate,
        checksum,
        status: 'created',
        draftId: draft.postId,
      });
    } catch (error) {
      report.failed.push({
        bookId: candidate.bookId,
        productionId: candidate.productionId,
        title: candidate.title,
        status: 'failed',
        reason: safeErrorCode(error),
      });
    }
  }

  if (!dryRun) await writeState(statePath, state);
  const reportPaths = await writeRunArtifacts({ outputDirectory, runId, report });
  return { ...report, reportPaths };
}

async function main() {
  const args = parseBatchArgs(process.argv.slice(2));
  const databasePath = process.env.BOOK_LIBRARY_DATABASE;
  const outputDirectory = process.env.BOOK_FACEBOOK_DRAFT_OUTPUT;
  const credentialPath = process.env.POSTIZ_CREDENTIAL_FILE || '.postiz-local-credentials';
  if (!databasePath) throw new Error('BOOK_LIBRARY_DATABASE is required');
  if (!outputDirectory) throw new Error('BOOK_FACEBOOK_DRAFT_OUTPUT is required');
  const credentials = await readPostizCredentials(path.resolve(credentialPath));
  const client = new PostizLocalClient({
    baseUrl: process.env.POSTIZ_URL || 'http://localhost:4007',
    credentials,
  });
  const report = await runBookFacebookDraftBatch({
    databasePath: path.resolve(databasePath),
    batchRoot: args.batchRoot,
    outputDirectory: path.resolve(outputDirectory),
    pageName: process.env.POSTIZ_FACEBOOK_PAGE_NAME || DEFAULT_PAGE_NAME,
    limit: args.limit,
    dryRun: args.dryRun,
    client,
  });
  process.stdout.write(`${JSON.stringify({
    created: report.created.length,
    skipped: report.skipped.length,
    sourceChanged: report.sourceChanged.length,
    failed: report.failed.length,
    reports: report.reportPaths,
  }, null, 2)}\n`);
  if (report.failed.length) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Book Facebook draft batch failed: ${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}
