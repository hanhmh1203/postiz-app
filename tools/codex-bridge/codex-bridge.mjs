#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  isChatGptAuthenticated,
  runCodex,
  validateBearerToken,
  validateGenerationRequest,
} from './codex-bridge-lib.mjs';

const execFileAsync = promisify(execFile);
const bridgeDirectory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.CODEX_BRIDGE_PORT || 4111);
const host = process.env.CODEX_BRIDGE_HOST || '0.0.0.0';
const token = process.env.CODEX_BRIDGE_TOKEN || '';
const codexBin = process.env.CODEX_BIN || 'codex';
const schemaPath = path.join(bridgeDirectory, 'post-output.schema.json');

if (!token) {
  console.error('CODEX_BRIDGE_TOKEN is required');
  process.exit(1);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65_536) throw new Error('Request body exceeds 64 KiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function isAuthenticated() {
  try {
    const { stdout, stderr } = await execFileAsync(
      codexBin,
      ['login', 'status'],
      {
        timeout: 10_000,
        maxBuffer: 16_384,
      }
    );
    return isChatGptAuthenticated(stdout, stderr);
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      provider: 'codex',
      authenticated: await isAuthenticated(),
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/v1/generate-social-posts') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (!validateBearerToken(req.headers.authorization, token)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  try {
    const request = validateGenerationRequest(await readJsonBody(req));
    const startedAt = Date.now();
    console.log(`[codex-bridge] generation started`);
    const result = await runCodex({
      request,
      codexBin,
      schemaPath,
      timeoutMs: Number(process.env.CODEX_BRIDGE_TIMEOUT_MS || 240_000),
    });
    console.log(
      `[codex-bridge] generation completed in ${Date.now() - startedAt}ms`
    );
    sendJson(res, 200, result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown bridge error';
    const isRequestError =
      /Request body|Research|Unsupported|isPicture|JSON/.test(message);
    console.error(`[codex-bridge] ${message}`);
    sendJson(res, isRequestError ? 400 : 502, {
      error: isRequestError
        ? message
        : 'Codex generation failed; inspect the local bridge log',
    });
  }
});

server.listen(port, host, () => {
  console.log(`[codex-bridge] listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
