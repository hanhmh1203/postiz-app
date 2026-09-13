import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FORMATS = new Map([
  ['one_short', 'one post with no more than 200 characters after the hook'],
  ['one_long', 'one detailed post'],
  [
    'thread_short',
    'a thread with at least 2 items, each no more than 200 characters',
  ],
  ['thread_long', 'a detailed thread with at least 2 items'],
]);

const TONES = new Map([
  ['personal', 'personal voice and first person'],
  ['company', 'company voice and first person plural'],
]);

export function validateBearerToken(authorization, expectedToken) {
  if (!expectedToken || typeof authorization !== 'string') return false;
  return authorization === `Bearer ${expectedToken}`;
}

export function isChatGptAuthenticated(stdout, stderr) {
  return /logged in using chatgpt/i.test(`${stdout || ''}\n${stderr || ''}`);
}

export function validateGenerationRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request body must be a JSON object');
  }

  const { research, format, tone, isPicture } = value;
  if (typeof research !== 'string' || research.trim().length < 10) {
    throw new Error('Research must contain at least 10 characters');
  }
  if (!FORMATS.has(format)) {
    throw new Error(`Unsupported format: ${String(format)}`);
  }
  if (!TONES.has(tone)) {
    throw new Error(`Unsupported tone: ${String(tone)}`);
  }
  if (typeof isPicture !== 'boolean') {
    throw new Error('isPicture must be a boolean');
  }

  return { research: research.trim(), format, tone, isPicture };
}

export function buildPrompt(request) {
  const validated = validateGenerationRequest(request);
  const imageInstruction = validated.isPicture
    ? 'For every content item, include a detailed image prompt without brand names or text rendered inside the image.'
    : 'Set prompt to null for every content item.';

  return `You are the content engine for a self-hosted social media scheduler.

Create ${FORMATS.get(validated.format)} in ${TONES.get(validated.tone)}.
Write in the same language as the user's brief unless the user explicitly asks for another language.
Return only the JSON object required by the provided schema.

Requirements:
- Write a distinct 1-2 sentence hook that is not repeated in the content body.
- Do not add hashtags unless the user asks for them.
- Keep the writing clear, natural, engaging, and free of generic hype.
- Include a useful call to action when it fits the brief.
- Set website to a root-domain URL only when the brief identifies a real relevant website; otherwise set it to null.
- Choose a concise category and topic.
- ${imageInstruction}

User brief:
${validated.research}`;
}

export function buildCodexArgs(schemaPath, outputPath, prompt) {
  return [
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
    schemaPath,
    '--output-last-message',
    outputPath,
    prompt,
  ];
}

export function normalizeResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Codex output must be a JSON object');
  }
  if (typeof value.hook !== 'string' || !value.hook.trim()) {
    throw new Error('Codex output must contain a non-empty hook');
  }

  const items = Array.isArray(value.content) ? value.content : [value.content];
  if (items.length === 0) {
    throw new Error('Codex output must contain at least one content item');
  }

  const content = items.map((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.content !== 'string' ||
      !item.content.trim()
    ) {
      throw new Error('Every Codex output item must contain non-empty content');
    }
    return {
      content: item.content.trim(),
      ...(typeof item.website === 'string' && item.website.trim()
        ? { website: item.website.trim() }
        : {}),
      ...(typeof item.prompt === 'string' && item.prompt.trim()
        ? { prompt: item.prompt.trim() }
        : {}),
    };
  });

  return {
    hook: value.hook.trim(),
    content,
    category:
      typeof value.category === 'string' && value.category.trim()
        ? value.category.trim()
        : 'General',
    topic:
      typeof value.topic === 'string' && value.topic.trim()
        ? value.topic.trim()
        : 'General',
  };
}

export async function runCodex({
  request,
  codexBin,
  schemaPath,
  timeoutMs = 240_000,
}) {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'postiz-codex-'));
  const outputPath = path.join(workingDirectory, 'output.json');
  const args = buildCodexArgs(schemaPath, outputPath, buildPrompt(request));

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(codexBin, args, {
        cwd: workingDirectory,
        env: process.env,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 16_384) stderr += chunk.toString();
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Codex generation timed out'));
      }, timeoutMs);

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `Codex exited with ${code ?? signal}: ${stderr
                .trim()
                .slice(-1000)}`
            )
          );
      });
    });

    const raw = await readFile(outputPath, 'utf8');
    return normalizeResult(JSON.parse(raw));
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}
