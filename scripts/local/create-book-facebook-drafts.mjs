#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  classifyCandidate,
  computeShortChecksum,
  computeSourceChecksum,
  discoverPortalCandidates,
  discoverShortResources,
  loadState,
  parseBatchArgs,
  selectLatestReview,
  writeRunArtifacts,
  writeState,
} from './book-facebook-drafts-lib.mjs';
import {
  PostizLocalClient,
  readPostizCredentials,
} from './postiz-local-client.mjs';

export const TEMPLATE_VERSION = 'book-facebook-v1';
export const SHORT_TEMPLATE_VERSION = 'book-facebook-short-v1';
export const DEFAULT_PAGE_NAME = 'Vì cuộc sống là ko chờ đợi';
const COMMENT_PREFIX = 'Để nghe review trọn vẹn, bạn xem tại đây: ';

export async function retryTransient(
  operation,
  {
    retries = 2,
    delayMs = 250,
    wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}
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
  const code =
    typeof error?.code === 'string' ? error.code : 'unexpected_error';
  return /^[a-z0-9_]+$/.test(code) ? code : 'unexpected_error';
}

async function validateReviewResources(candidate) {
  const reviewPath = await selectLatestReview(candidate.workflowDirectory);
  if (!reviewPath) return { reason: 'review_missing' };
  const imagePath = path.join(candidate.workflowDirectory, 'land.png');
  try {
    const image = await stat(imagePath);
    if (!image.isFile() || image.size === 0)
      return { reason: 'land_image_missing' };
  } catch {
    return { reason: 'land_image_missing' };
  }
  const review = (await readFile(reviewPath, 'utf8')).trim();
  if (!review) return { reason: 'review_missing' };
  return { reviewPath, imagePath, review };
}

async function writePreview({
  outputDirectory,
  runId,
  candidate,
  content,
  comment,
  mediaPath,
  variant,
  shortName,
}) {
  const previewDirectory = path.join(outputDirectory, 'previews', runId);
  await mkdir(previewDirectory, { recursive: true });
  const safeName = candidate.bookId.replace(/[^A-Za-z0-9_-]+/g, '_');
  const suffix = variant === 'short' ? `-short-${shortName}` : '-review';
  const previewPath = path.join(previewDirectory, `${safeName}${suffix}.md`);
  const text = `# ${candidate.title}

## Facebook ${variant} draft

${content}

## First comment

${comment}

## Media

${mediaPath}
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
  const createdBooks = new Set();

  await client.login();
  const integration = await client.preflight(pageName);
  const candidates = await discoverCandidates({ databasePath, batchRoot });

  for (const rawCandidate of candidates) {
    if (createdBooks.size >= limit) break;
    let bookCreated = false;

    try {
      const resources = await validateReviewResources(rawCandidate);
      if (resources.reason) {
        report.skipped.push({
          ...rawCandidate,
          variant: 'review',
          status: 'skipped',
          reason: resources.reason,
        });
      } else {
        const candidate = { ...rawCandidate, ...resources, variant: 'review' };
        const checksum = await computeSourceChecksum(
          candidate,
          pageName,
          TEMPLATE_VERSION
        );
        const classification = classifyCandidate(candidate, state, checksum, {
          variant: 'review',
        });
        if (classification === 'skipped') {
          report.skipped.push({
            ...candidate,
            checksum,
            status: 'skipped',
            reason: 'already_drafted',
          });
        } else if (classification === 'source_changed') {
          report.sourceChanged.push({
            ...candidate,
            checksum,
            status: 'source_changed',
            reason: 'source_changed',
          });
        } else {
          const caption = await retryTransient(
            () =>
              client.generateCaption({
                title: candidate.title,
                review: candidate.review,
              }),
            { retries: 2, delayMs: retryDelayMs }
          );
          const comment = `${COMMENT_PREFIX}${candidate.videoUrl}`;
          const marker = `wrb:${candidate.bookId}:${checksum}`;

          if (dryRun) {
            const previewPath = await writePreview({
              outputDirectory,
              runId,
              candidate,
              content: caption,
              comment,
              mediaPath: candidate.imagePath,
              variant: 'review',
            });
            report.created.push({
              ...candidate,
              checksum,
              status: 'dry_run',
              previewPath,
            });
          } else {
            const media = await retryTransient(
              () => client.uploadMedia(candidate.imagePath),
              {
                retries: 2,
                delayMs: retryDelayMs,
              }
            );
            let draft;
            try {
              draft = await retryTransient(
                () =>
                  client.createDraft({
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
              const existing = await client
                .findDraftByMarker(marker)
                .catch(() => null);
              if (!existing) throw error;
              draft = existing;
            }
            state.entries.push({
              variant: 'review',
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
            });
            await writeState(statePath, state);
            report.created.push({
              ...candidate,
              checksum,
              status: 'created',
              draftId: draft.postId,
            });
          }
          bookCreated = true;
        }
      }
    } catch (error) {
      report.failed.push({
        bookId: rawCandidate.bookId,
        productionId: rawCandidate.productionId,
        title: rawCandidate.title,
        variant: 'review',
        status: 'failed',
        reason: safeErrorCode(error),
      });
    }

    let shorts;
    try {
      shorts = await discoverShortResources(rawCandidate.workflowDirectory);
    } catch (error) {
      report.failed.push({
        ...rawCandidate,
        variant: 'short',
        status: 'failed',
        reason: safeErrorCode(error),
      });
      shorts = [];
    }

    for (const short of shorts) {
      const candidate = { ...rawCandidate, ...short, variant: 'short' };
      if (short.status !== 'ready') {
        report.skipped.push({
          ...candidate,
          status: 'skipped',
          reason: short.status,
        });
        continue;
      }
      try {
        const checksum = await computeShortChecksum(
          rawCandidate,
          short,
          pageName,
          SHORT_TEMPLATE_VERSION
        );
        const classification = classifyCandidate(
          rawCandidate,
          state,
          checksum,
          {
            variant: 'short',
            shortName: short.shortName,
          }
        );
        if (classification === 'skipped') {
          report.skipped.push({
            ...candidate,
            checksum,
            status: 'skipped',
            reason: 'already_drafted',
          });
          continue;
        }
        if (classification === 'source_changed') {
          report.sourceChanged.push({
            ...candidate,
            checksum,
            status: 'source_changed',
            reason: 'source_changed',
          });
          continue;
        }

        const content = `${short.description}\n\n${short.hashtags}`.trim();
        const comment = `${COMMENT_PREFIX}${rawCandidate.videoUrl}`;
        const marker = `wrb:${rawCandidate.bookId}:short:${short.shortName}:${checksum}`;
        if (dryRun) {
          const previewPath = await writePreview({
            outputDirectory,
            runId,
            candidate,
            content,
            comment,
            mediaPath: short.videoPath,
            variant: 'short',
            shortName: short.shortName,
          });
          report.created.push({
            ...candidate,
            checksum,
            status: 'dry_run',
            previewPath,
          });
        } else {
          const media = await retryTransient(
            () => client.uploadMedia(short.videoPath),
            {
              retries: 2,
              delayMs: retryDelayMs,
            }
          );
          let draft;
          try {
            draft = await retryTransient(
              () =>
                client.createShortDraft({
                  integrationId: integration.id,
                  content,
                  comment,
                  media,
                  marker,
                  shortName: short.shortName,
                }),
              { retries: 2, delayMs: retryDelayMs }
            );
          } catch (error) {
            const existing = await client
              .findDraftByMarker(marker)
              .catch(() => null);
            if (!existing) throw error;
            draft = existing;
          }
          state.entries.push({
            variant: 'short',
            shortName: short.shortName,
            shortNumber: short.shortNumber,
            bookId: rawCandidate.bookId,
            productionId: rawCandidate.productionId,
            checksum,
            pageName,
            postId: draft.postId,
            commentId: draft.commentId,
            videoPath: short.videoPath,
            metadataPath: short.metadataPath,
            videoUrl: rawCandidate.videoUrl,
            createdAt: now().toISOString(),
            templateVersion: SHORT_TEMPLATE_VERSION,
          });
          await writeState(statePath, state);
          report.created.push({
            ...candidate,
            checksum,
            status: 'created',
            draftId: draft.postId,
          });
        }
        bookCreated = true;
      } catch (error) {
        report.failed.push({
          bookId: rawCandidate.bookId,
          productionId: rawCandidate.productionId,
          title: rawCandidate.title,
          variant: 'short',
          shortName: short.shortName,
          shortNumber: short.shortNumber,
          status: 'failed',
          reason: safeErrorCode(error),
        });
      }
    }

    if (bookCreated) createdBooks.add(rawCandidate.bookId);
  }

  if (!dryRun) await writeState(statePath, state);
  const reportPaths = await writeRunArtifacts({
    outputDirectory,
    runId,
    report,
  });
  return { ...report, reportPaths };
}

async function main() {
  const args = parseBatchArgs(process.argv.slice(2));
  const databasePath = process.env.BOOK_LIBRARY_DATABASE;
  const outputDirectory = process.env.BOOK_FACEBOOK_DRAFT_OUTPUT;
  const credentialPath =
    process.env.POSTIZ_CREDENTIAL_FILE || '.postiz-local-credentials';
  if (!databasePath) throw new Error('BOOK_LIBRARY_DATABASE is required');
  if (!outputDirectory)
    throw new Error('BOOK_FACEBOOK_DRAFT_OUTPUT is required');
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
  process.stdout.write(
    `${JSON.stringify(
      {
        created: report.created.length,
        skipped: report.skipped.length,
        sourceChanged: report.sourceChanged.length,
        failed: report.failed.length,
        reports: report.reportPaths,
      },
      null,
      2
    )}\n`
  );
  if (report.failed.length) process.exitCode = 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `Book Facebook draft batch failed: ${safeErrorCode(error)}\n`
    );
    process.exitCode = 1;
  });
}
