import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PostizLocalClient,
  buildFacebookResearchBrief,
  deterministicPostIds,
  readPostizCredentials,
  validateFacebookCaption,
} from './postiz-local-client.mjs';

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function startServer(handler) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      response.statusCode = 500;
      response.end(error.message);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function validGeneratedOutput() {
  const body = Array.from(
    { length: 10 },
    (_, index) => `Ý ${index + 1} giúp người đọc nhìn lại cách mình lựa chọn và hành động mỗi ngày.`
  ).join(' ');
  return {
    hook: 'Có những cuốn sách khiến ta phải dừng lại và tự hỏi mình đang sống thế nào.',
    content: [
      {
        content: `${body}\n\nHãy xem phần review đầy đủ trong bình luận.\n\n#WillReadBook #ReviewSach #SachHay`,
      },
    ],
    category: 'Sách',
    topic: 'Review sách',
    date: '2026-09-13T00:00:00.000Z',
  };
}

test('reads local Postiz credentials without accepting an incomplete file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'postiz-credentials-'));
  const validPath = path.join(directory, 'credentials');
  await writeFile(validPath, 'POSTIZ_EMAIL=reader@example.com\nPOSTIZ_PASSWORD=safe-local-value\n');
  assert.deepEqual(await readPostizCredentials(validPath), {
    email: 'reader@example.com',
    password: 'safe-local-value',
  });
  await writeFile(validPath, 'POSTIZ_EMAIL=reader@example.com\n');
  await assert.rejects(readPostizCredentials(validPath), /password/i);
});

test('logs in and resolves exactly one complete Facebook Page integration', async () => {
  const requests = [];
  const server = await startServer(async (request, response) => {
    requests.push({ url: request.url, auth: request.headers.auth, showorg: request.headers.showorg });
    if (request.url === '/auth/login') {
      assert.deepEqual(JSON.parse((await requestBody(request)).toString()), {
        email: 'reader@example.com',
        password: 'safe-local-value',
        provider: 'LOCAL',
        providerToken: '',
      });
      response.setHeader('auth', 'jwt-value');
      response.setHeader('showorg', 'org-value');
      response.end(JSON.stringify({ login: true }));
      return;
    }
    if (request.url === '/integrations/list') {
      response.end(JSON.stringify({
        integrations: [
          {
            id: 'page-integration',
            name: 'Vì cuộc sống là ko chờ đợi',
            identifier: 'facebook',
            inBetweenSteps: false,
            disabled: false,
          },
        ],
      }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'reader@example.com', password: 'safe-local-value' },
    });
    await client.login();
    const integration = await client.preflight('Vì cuộc sống là ko chờ đợi');
    assert.equal(integration.id, 'page-integration');
    assert.deepEqual(requests[1], {
      url: '/integrations/list',
      auth: 'jwt-value',
      showorg: 'org-value',
    });
  } finally {
    await server.close();
  }
});

test('rejects ambiguous Page integration matches', async () => {
  const server = await startServer(async (request, response) => {
    if (request.url === '/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    response.end(JSON.stringify({
      integrations: [
        { id: 'one', name: 'Target', identifier: 'facebook', inBetweenSteps: false, disabled: false },
        { id: 'two', name: 'Target', identifier: 'facebook', inBetweenSteps: false, disabled: false },
      ],
    }));
  });
  try {
    const client = new PostizLocalClient({ baseUrl: server.baseUrl, credentials: { email: 'a@b.com', password: 'secret' } });
    await client.login();
    await assert.rejects(client.preflight('Target'), /exactly one/i);
  } finally {
    await server.close();
  }
});

test('generates and validates one Facebook caption through Postiz NDJSON', async () => {
  let generatorBody;
  const server = await startServer(async (request, response) => {
    if (request.url === '/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    generatorBody = JSON.parse((await requestBody(request)).toString());
    response.setHeader('content-type', 'application/x-ndjson');
    response.write(`${JSON.stringify({ name: 'agent' })}\n`);
    response.end(`${JSON.stringify({ name: 'codex-complete', data: { output: validGeneratedOutput() } })}\n`);
  });
  try {
    const client = new PostizLocalClient({ baseUrl: server.baseUrl, credentials: { email: 'a@b.com', password: 'secret' } });
    await client.login();
    const caption = await client.generateCaption({ title: 'Một cuốn sách', review: 'Nội dung review đủ dài để tạo bài Facebook.' });
    assert.equal(generatorBody.format, 'one_long');
    assert.equal(generatorBody.tone, 'personal');
    assert.equal(generatorBody.isPicture, false);
    assert.match(generatorBody.research, /700.*1\.200/);
    assert.doesNotThrow(() => validateFacebookCaption(caption));
  } finally {
    await server.close();
  }
});

test('caption validation rejects URLs, missing hashtag, and out-of-range length', () => {
  assert.throws(() => validateFacebookCaption('Bài quá ngắn #WillReadBook'), /700/);
  const longEnough = `${'Một nhận xét có căn cứ từ nội dung sách. '.repeat(18)}#ReviewSach #SachHay #DocSach`;
  assert.throws(() => validateFacebookCaption(longEnough), /WillReadBook/);
  assert.throws(
    () => validateFacebookCaption(`${'Một nhận xét có căn cứ. '.repeat(30)} https://example.com #WillReadBook #SachHay #DocSach`),
    /URL/i
  );
});

test('marks invalid generated captions as transient so the batch can retry', async () => {
  const server = await startServer(async (request, response) => {
    if (request.url === '/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    await requestBody(request);
    response.end(`${JSON.stringify({
      name: 'codex-complete',
      data: {
        output: {
          hook: 'Quá ngắn',
          content: [{ content: 'Nội dung quá ngắn #WillReadBook #SachHay #DocSach' }],
        },
      },
    })}\n`);
  });
  try {
    const client = new PostizLocalClient({ baseUrl: server.baseUrl, credentials: { email: 'a@b.com', password: 'secret' } });
    await client.login();
    await assert.rejects(
      client.generateCaption({ title: 'Tên sách', review: 'Review nguồn đủ dài để gửi tới generator.' }),
      (error) => error.code === 'generator_content_invalid' && error.transient === true
    );
  } finally {
    await server.close();
  }
});

test('uploads land.png and creates an idempotent draft with a first comment', async () => {
  const received = {};
  const server = await startServer(async (request, response) => {
    if (request.url === '/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    if (request.url === '/media/upload-simple') {
      received.mediaContentType = request.headers['content-type'];
      received.mediaBody = await requestBody(request);
      response.end(JSON.stringify({ id: 'media-id', path: '/uploads/land.png' }));
      return;
    }
    if (request.url === '/posts') {
      received.draft = JSON.parse((await requestBody(request)).toString());
      response.end(JSON.stringify([{ postId: received.draft.posts[0].value[0].id, integration: 'page-id' }]));
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  const directory = await mkdtemp(path.join(tmpdir(), 'postiz-media-'));
  const imagePath = path.join(directory, 'land.png');
  await writeFile(imagePath, Buffer.from([137, 80, 78, 71]));
  try {
    const client = new PostizLocalClient({ baseUrl: server.baseUrl, credentials: { email: 'a@b.com', password: 'secret' } });
    await client.login();
    const media = await client.uploadMedia(imagePath);
    const marker = 'wrb:book-1:checksum-1';
    const caption = validGeneratedOutput().hook + '\n\n' + validGeneratedOutput().content[0].content;
    const result = await client.createDraft({
      integrationId: 'page-id',
      caption,
      comment: 'Để nghe review trọn vẹn, bạn xem tại đây: https://youtu.be/abc123',
      media,
      marker,
    });
    const ids = deterministicPostIds(marker);
    assert.match(received.mediaContentType, /^multipart\/form-data;/);
    assert.ok(received.mediaBody.length > 4);
    assert.equal(received.draft.type, 'draft');
    assert.equal(received.draft.posts[0].value.length, 2);
    assert.equal(received.draft.posts[0].value[0].id, ids.rootId);
    assert.equal(received.draft.posts[0].value[1].id, ids.commentId);
    assert.deepEqual(received.draft.posts[0].value[0].image, [{ id: 'media-id', path: '/uploads/land.png' }]);
    assert.deepEqual(received.draft.posts[0].value[1].image, []);
    assert.equal(result.postId, ids.rootId);
  } finally {
    await server.close();
  }
});

test('builds a grounded Vietnamese brief without putting the YouTube URL in it', () => {
  const brief = buildFacebookResearchBrief({ title: 'Tên sách', review: 'Nội dung phân tích nguồn.' });
  assert.match(brief, /Tên sách/);
  assert.match(brief, /Nội dung phân tích nguồn/);
  assert.match(brief, /#WillReadBook/);
  assert.doesNotMatch(brief, /youtu/);
});
