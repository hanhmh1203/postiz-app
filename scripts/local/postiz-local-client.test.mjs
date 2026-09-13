import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PostizLocalClient,
  buildFacebookIdeaBatchBrief,
  buildFacebookResearchBrief,
  deterministicPostIds,
  readPostizCredentials,
  validateFacebookCaption,
  validateFacebookIdeaPost,
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
    (_, index) =>
      `Ý ${
        index + 1
      } giúp người đọc nhìn lại cách mình lựa chọn và hành động mỗi ngày.`
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

function validIdeaPost(number) {
  const body = `Ý tưởng ${number}: ${'Một chi tiết trong cuốn sách gợi ra cách nhìn cụ thể để người đọc suy nghĩ lại về lựa chọn và hành động hằng ngày. '.repeat(
    4
  )}`;
  return `${body}Xem review đầy đủ ở bình luận.\n\n#WillReadBook #ReviewSach #SachHay`;
}

function validIdeaGeneratedOutput(count = 10) {
  return {
    hook: 'Metadata only',
    content: Array.from({ length: count }, (_, index) => ({
      content: validIdeaPost(index + 1),
    })),
    category: 'Sách',
    topic: 'Ý tưởng từ sách',
    date: '2026-09-14T00:00:00.000Z',
  };
}

test('reads local Postiz credentials without accepting an incomplete file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'postiz-credentials-'));
  const validPath = path.join(directory, 'credentials');
  await writeFile(
    validPath,
    'POSTIZ_EMAIL=reader@example.com\nPOSTIZ_PASSWORD=safe-local-value\n'
  );
  assert.deepEqual(await readPostizCredentials(validPath), {
    email: 'reader@example.com',
    password: 'safe-local-value',
  });
  await writeFile(validPath, 'POSTIZ_EMAIL=reader@example.com\n');
  await assert.rejects(readPostizCredentials(validPath), /password/i);
});

test('uses the Postiz /api prefix when configured with the public app origin', async () => {
  const server = await startServer(async (request, response) => {
    await requestBody(request);
    if (request.url === '/api/auth/login') {
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'a@b.com', password: 'secret' },
    });
    await client.login();
  } finally {
    await server.close();
  }
});

test('logs in and resolves exactly one complete Facebook Page integration', async () => {
  const requests = [];
  const server = await startServer(async (request, response) => {
    requests.push({
      url: request.url,
      auth: request.headers.auth,
      showorg: request.headers.showorg,
    });
    if (request.url === '/api/auth/login') {
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
    if (request.url === '/api/integrations/list') {
      response.end(
        JSON.stringify({
          integrations: [
            {
              id: 'page-integration',
              name: 'Vì cuộc sống là ko chờ đợi',
              identifier: 'facebook',
              inBetweenSteps: false,
              disabled: false,
            },
          ],
        })
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: {
        email: 'reader@example.com',
        password: 'safe-local-value',
      },
    });
    await client.login();
    const integration = await client.preflight('Vì cuộc sống là ko chờ đợi');
    assert.equal(integration.id, 'page-integration');
    assert.deepEqual(requests[1], {
      url: '/api/integrations/list',
      auth: 'jwt-value',
      showorg: 'org-value',
    });
  } finally {
    await server.close();
  }
});

test('rejects ambiguous Page integration matches', async () => {
  const server = await startServer(async (request, response) => {
    if (request.url === '/api/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    response.end(
      JSON.stringify({
        integrations: [
          {
            id: 'one',
            name: 'Target',
            identifier: 'facebook',
            inBetweenSteps: false,
            disabled: false,
          },
          {
            id: 'two',
            name: 'Target',
            identifier: 'facebook',
            inBetweenSteps: false,
            disabled: false,
          },
        ],
      })
    );
  });
  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'a@b.com', password: 'secret' },
    });
    await client.login();
    await assert.rejects(client.preflight('Target'), /exactly one/i);
  } finally {
    await server.close();
  }
});

test('generates and validates one Facebook caption through Postiz NDJSON', async () => {
  let generatorBody;
  const server = await startServer(async (request, response) => {
    if (request.url === '/api/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    generatorBody = JSON.parse((await requestBody(request)).toString());
    response.setHeader('content-type', 'application/x-ndjson');
    response.write(`${JSON.stringify({ name: 'agent' })}\n`);
    response.end(
      `${JSON.stringify({
        name: 'codex-complete',
        data: { output: validGeneratedOutput() },
      })}\n`
    );
  });
  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'a@b.com', password: 'secret' },
    });
    await client.login();
    const caption = await client.generateCaption({
      title: 'Một cuốn sách',
      review: 'Nội dung review đủ dài để tạo bài Facebook.',
    });
    assert.equal(generatorBody.format, 'one_long');
    assert.equal(generatorBody.tone, 'personal');
    assert.equal(generatorBody.isPicture, false);
    assert.match(generatorBody.research, /850.*1\.050/);
    assert.match(generatorBody.research, /không được vượt quá 1\.200/i);
    assert.doesNotThrow(() => validateFacebookCaption(caption));
  } finally {
    await server.close();
  }
});

test('caption validation rejects URLs, missing hashtag, and out-of-range length', () => {
  assert.throws(
    () => validateFacebookCaption('Bài quá ngắn #WillReadBook'),
    /700/
  );
  const longEnough = `${'Một nhận xét có căn cứ từ nội dung sách. '.repeat(
    18
  )}#ReviewSach #SachHay #DocSach`;
  assert.throws(() => validateFacebookCaption(longEnough), /WillReadBook/);
  assert.throws(
    () =>
      validateFacebookCaption(
        `${'Một nhận xét có căn cứ. '.repeat(
          30
        )} https://example.com #WillReadBook #SachHay #DocSach`
      ),
    /URL/i
  );
});

test('draft creation rejects YouTube Shorts and playlist comments', async () => {
  const client = new PostizLocalClient({
    baseUrl: 'http://127.0.0.1:1',
    credentials: { email: 'a@b.com', password: 'secret' },
  });
  const caption = `${'Một nhận xét có căn cứ từ nội dung sách. '.repeat(
    18
  )}#WillReadBook #ReviewSach #SachHay`;
  for (const videoUrl of [
    'https://www.youtube.com/shorts/abc123',
    'https://www.youtube.com/playlist?list=PL123',
  ]) {
    await assert.rejects(
      client.createDraft({
        integrationId: 'page-id',
        caption,
        comment: `Để nghe review trọn vẹn, bạn xem tại đây: ${videoUrl}`,
        media: { id: 'media-id', path: '/uploads/land.png' },
        marker: 'stable-marker-123',
      }),
      /long YouTube/i
    );
  }
});

test('marks invalid generated captions as transient so the batch can retry', async () => {
  const server = await startServer(async (request, response) => {
    if (request.url === '/api/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    await requestBody(request);
    response.end(
      `${JSON.stringify({
        name: 'codex-complete',
        data: {
          output: {
            hook: 'Quá ngắn',
            content: [
              { content: 'Nội dung quá ngắn #WillReadBook #SachHay #DocSach' },
            ],
          },
        },
      })}\n`
    );
  });
  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'a@b.com', password: 'secret' },
    });
    await client.login();
    await assert.rejects(
      client.generateCaption({
        title: 'Tên sách',
        review: 'Review nguồn đủ dài để gửi tới generator.',
      }),
      (error) =>
        error.code === 'generator_content_invalid' && error.transient === true
    );
  } finally {
    await server.close();
  }
});

test('generates exactly ten standalone Facebook idea posts through Postiz', async () => {
  let generatorBody;
  const server = await startServer(async (request, response) => {
    if (request.url === '/api/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    generatorBody = JSON.parse((await requestBody(request)).toString());
    response.end(
      `${JSON.stringify({
        name: 'codex-complete',
        data: { output: validIdeaGeneratedOutput() },
      })}\n`
    );
  });
  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'a@b.com', password: 'secret' },
    });
    await client.login();
    const ideas = await client.generateIdeaPosts({
      title: 'Tên sách',
      review: 'Review nguồn đủ dài.',
    });

    assert.equal(generatorBody.format, 'thread_long');
    assert.equal(generatorBody.tone, 'personal');
    assert.match(generatorBody.research, /chính xác 10/i);
    assert.equal(ideas.length, 10);
    ideas.forEach((idea) =>
      assert.doesNotThrow(() => validateFacebookIdeaPost(idea))
    );
  } finally {
    await server.close();
  }
});

test('marks an incomplete idea set as transient generator content', async () => {
  const server = await startServer(async (request, response) => {
    if (request.url === '/api/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    await requestBody(request);
    response.end(
      `${JSON.stringify({
        name: 'codex-complete',
        data: { output: validIdeaGeneratedOutput(9) },
      })}\n`
    );
  });
  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'a@b.com', password: 'secret' },
    });
    await client.login();
    await assert.rejects(
      client.generateIdeaPosts({ title: 'Tên sách', review: 'Review nguồn.' }),
      (error) =>
        error.code === 'generator_content_invalid' && error.transient === true
    );
  } finally {
    await server.close();
  }
});

test('rejects ten duplicate idea posts as invalid generator content', async () => {
  const duplicateOutput = validIdeaGeneratedOutput();
  duplicateOutput.content = duplicateOutput.content.map(() => ({
    content: validIdeaPost(1),
  }));
  const server = await startServer(async (request, response) => {
    if (request.url === '/api/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    await requestBody(request);
    response.end(
      `${JSON.stringify({
        name: 'codex-complete',
        data: { output: duplicateOutput },
      })}\n`
    );
  });
  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'a@b.com', password: 'secret' },
    });
    await client.login();
    await assert.rejects(
      client.generateIdeaPosts({ title: 'Tên sách', review: 'Review nguồn.' }),
      (error) => error.code === 'generator_content_invalid'
    );
  } finally {
    await server.close();
  }
});

test('creates an image idea draft with its long-review first comment', async () => {
  let draft;
  const server = await startServer(async (request, response) => {
    if (request.url === '/api/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    if (request.url === '/api/posts') {
      draft = JSON.parse((await requestBody(request)).toString());
      response.end(JSON.stringify([{ postId: draft.posts[0].value[0].id }]));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'a@b.com', password: 'secret' },
    });
    await client.login();
    const content = validIdeaPost(1);
    await client.createIdeaDraft({
      integrationId: 'page-id',
      content,
      comment:
        'Để nghe review trọn vẹn, bạn xem tại đây: https://youtu.be/abc123',
      media: { id: 'image-id', path: '/uploads/land.png' },
      marker: 'wrb:book-1:idea:1:checksum',
    });

    assert.equal(draft.type, 'draft');
    assert.equal(draft.posts[0].value[0].content, content);
    assert.deepEqual(draft.posts[0].value[0].image, [
      { id: 'image-id', path: '/uploads/land.png' },
    ]);
    assert.match(draft.posts[0].value[1].content, /youtu\.be\/abc123$/);
  } finally {
    await server.close();
  }
});

test('uploads land.png and creates an idempotent draft with a first comment', async () => {
  const received = {};
  const server = await startServer(async (request, response) => {
    if (request.url === '/api/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    if (request.url === '/api/media/upload-simple') {
      received.mediaContentType = request.headers['content-type'];
      received.mediaBody = await requestBody(request);
      response.end(
        JSON.stringify({ id: 'media-id', path: '/uploads/land.png' })
      );
      return;
    }
    if (request.url === '/api/posts') {
      received.draft = JSON.parse((await requestBody(request)).toString());
      response.end(
        JSON.stringify([
          {
            postId: received.draft.posts[0].value[0].id,
            integration: 'page-id',
          },
        ])
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  const directory = await mkdtemp(path.join(tmpdir(), 'postiz-media-'));
  const imagePath = path.join(directory, 'land.png');
  await writeFile(imagePath, Buffer.from([137, 80, 78, 71]));
  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'a@b.com', password: 'secret' },
    });
    await client.login();
    const media = await client.uploadMedia(imagePath);
    const marker = 'wrb:book-1:checksum-1';
    const caption =
      validGeneratedOutput().hook +
      '\n\n' +
      validGeneratedOutput().content[0].content;
    const result = await client.createDraft({
      integrationId: 'page-id',
      caption,
      comment:
        'Để nghe review trọn vẹn, bạn xem tại đây: https://youtu.be/abc123',
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
    assert.deepEqual(received.draft.posts[0].value[0].image, [
      { id: 'media-id', path: '/uploads/land.png' },
    ]);
    assert.deepEqual(received.draft.posts[0].value[1].image, []);
    assert.equal(result.postId, ids.rootId);
  } finally {
    await server.close();
  }
});

test('uploads an MP4 with its video MIME type', async () => {
  let mediaContentType;
  let mediaBody;
  const server = await startServer(async (request, response) => {
    if (request.url === '/api/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    if (request.url === '/api/media/upload-simple') {
      mediaContentType = request.headers['content-type'];
      mediaBody = (await requestBody(request)).toString('latin1');
      response.end(
        JSON.stringify({ id: 'video-id', path: '/uploads/short_01.mp4' })
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  const directory = await mkdtemp(path.join(tmpdir(), 'postiz-video-'));
  const videoPath = path.join(directory, 'short_01.mp4');
  await writeFile(videoPath, Buffer.from('fake-video-bytes'));
  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'a@b.com', password: 'secret' },
    });
    await client.login();
    await client.uploadMedia(videoPath);

    assert.match(mediaContentType, /^multipart\/form-data;/);
    assert.match(mediaBody, /filename="short_01\.mp4"/);
    assert.match(mediaBody, /Content-Type: video\/mp4/i);
  } finally {
    await server.close();
  }
});

test('creates an idempotent video Short draft from approved metadata text', async () => {
  let draft;
  const server = await startServer(async (request, response) => {
    if (request.url === '/api/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    if (request.url === '/api/posts') {
      draft = JSON.parse((await requestBody(request)).toString());
      response.end(
        JSON.stringify([
          { postId: draft.posts[0].value[0].id, integration: 'page-id' },
        ])
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'a@b.com', password: 'secret' },
    });
    await client.login();
    const marker = 'wrb:book-1:short:01:checksum';
    const content =
      'Một ý quan trọng từ cuốn sách.\n\n#Shorts #TomTatSach #WillReadBook';
    const result = await client.createShortDraft({
      integrationId: 'page-id',
      content,
      comment:
        'Để nghe review trọn vẹn, bạn xem tại đây: https://youtu.be/abc123',
      media: { id: 'video-id', path: '/uploads/short_01.mp4' },
      marker,
    });

    const ids = deterministicPostIds(marker);
    assert.equal(draft.type, 'draft');
    assert.equal(draft.posts[0].value[0].id, ids.rootId);
    assert.equal(draft.posts[0].value[0].content, content);
    assert.deepEqual(draft.posts[0].value[0].image, [
      { id: 'video-id', path: '/uploads/short_01.mp4' },
    ]);
    assert.equal(draft.posts[0].value[1].id, ids.commentId);
    assert.equal(result.postId, ids.rootId);
  } finally {
    await server.close();
  }
});

test('rejects draft creation when Postiz does not preserve the requested id', async () => {
  const server = await startServer(async (request, response) => {
    if (request.url === '/api/auth/login') {
      await requestBody(request);
      response.setHeader('auth', 'jwt-value');
      response.end('{}');
      return;
    }
    if (request.url === '/api/posts') {
      await requestBody(request);
      response.end(
        JSON.stringify([
          { postId: 'different-server-id', integration: 'page-id' },
        ])
      );
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  try {
    const client = new PostizLocalClient({
      baseUrl: server.baseUrl,
      credentials: { email: 'a@b.com', password: 'secret' },
    });
    await client.login();
    const caption = `${'Một nhận xét có căn cứ từ nội dung sách. '.repeat(
      18
    )}#WillReadBook #ReviewSach #SachHay`;
    await assert.rejects(
      client.createDraft({
        integrationId: 'page-id',
        caption,
        comment:
          'Để nghe review trọn vẹn, bạn xem tại đây: https://youtu.be/abc123',
        media: { id: 'media-id', path: '/uploads/land.png' },
        marker: 'stable-marker-123',
      }),
      (error) => error.code === 'draft_idempotency_mismatch'
    );
  } finally {
    await server.close();
  }
});

test('builds a grounded Vietnamese brief without putting the YouTube URL in it', () => {
  const brief = buildFacebookResearchBrief({
    title: 'Tên sách',
    review: 'Nội dung phân tích nguồn.',
  });
  assert.match(brief, /Tên sách/);
  assert.match(brief, /Nội dung phân tích nguồn/);
  assert.match(brief, /#WillReadBook/);
  assert.doesNotMatch(brief, /youtu/);
});

test('builds an exact ten-item idea brief grounded in the source review', () => {
  const brief = buildFacebookIdeaBatchBrief({
    title: 'Tên sách',
    review: 'Nội dung phân tích nguồn.',
  });
  assert.match(brief, /chính xác 10/i);
  assert.match(brief, /350.*700/);
  assert.match(brief, /Tên sách/);
  assert.match(brief, /Nội dung phân tích nguồn/);
  assert.match(brief, /#WillReadBook/);
  assert.doesNotMatch(brief, /youtu/);
});
