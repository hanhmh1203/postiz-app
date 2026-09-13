import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCodexArgs,
  buildPrompt,
  isChatGptAuthenticated,
  normalizeResult,
  validateBearerToken,
  validateGenerationRequest,
} from './codex-bridge-lib.mjs';

const request = {
  research: 'Giới thiệu một ứng dụng quản lý nội dung mạng xã hội mới.',
  format: 'thread_short',
  tone: 'company',
  isPicture: true,
};

test('accepts only the configured bearer token', () => {
  assert.equal(validateBearerToken('Bearer secret-value', 'secret-value'), true);
  assert.equal(validateBearerToken('Bearer wrong', 'secret-value'), false);
  assert.equal(validateBearerToken(undefined, 'secret-value'), false);
});

test('recognizes Codex login status written to stderr', () => {
  assert.equal(isChatGptAuthenticated('', 'Logged in using ChatGPT\n'), true);
  assert.equal(isChatGptAuthenticated('', 'Not logged in\n'), false);
});

test('validates supported generation requests', () => {
  assert.deepEqual(validateGenerationRequest(request), request);
  assert.throws(
    () => validateGenerationRequest({ ...request, research: 'short' }),
    /at least 10 characters/
  );
  assert.throws(
    () => validateGenerationRequest({ ...request, format: 'carousel' }),
    /Unsupported format/
  );
});

test('builds a Vietnamese-aware social content prompt', () => {
  const prompt = buildPrompt(request);
  assert.match(prompt, /same language as the user's brief/i);
  assert.match(prompt, /thread with at least 2 items/i);
  assert.match(prompt, /company voice/i);
  assert.match(prompt, /image prompt/i);
  assert.match(prompt, /Giới thiệu một ứng dụng/);
});

test('builds a non-interactive read-only Codex command', () => {
  assert.deepEqual(
    buildCodexArgs('/tmp/schema.json', '/tmp/output.json', 'prompt text'),
    [
      'exec',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--model',
      'gpt-5.6-luna',
      '--config',
      'model_reasoning_effort="low"',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--output-schema',
      '/tmp/schema.json',
      '--output-last-message',
      '/tmp/output.json',
      'prompt text',
    ]
  );
});

test('normalizes single content objects and removes empty optional values', () => {
  assert.deepEqual(
    normalizeResult({
      hook: 'A useful hook',
      content: { content: 'Main copy', website: '', prompt: null },
      category: 'Educational',
      topic: 'Marketing',
    }),
    {
      hook: 'A useful hook',
      content: [{ content: 'Main copy' }],
      category: 'Educational',
      topic: 'Marketing',
    }
  );
});

test('rejects empty or malformed Codex output', () => {
  assert.throws(
    () => normalizeResult({ hook: '', content: [] }),
    /non-empty hook/
  );
  assert.throws(
    () => normalizeResult({ hook: 'Hook', content: [{ content: '' }] }),
    /non-empty content/
  );
});
