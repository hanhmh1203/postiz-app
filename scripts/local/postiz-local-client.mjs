import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const COMMENT_PREFIX = 'Để nghe review trọn vẹn, bạn xem tại đây: ';

export class PostizClientError extends Error {
  constructor(message, { code = 'postiz_error', transient = false, status = 0 } = {}) {
    super(message);
    this.name = 'PostizClientError';
    this.code = code;
    this.transient = transient;
    this.status = status;
  }
}

export async function readPostizCredentials(filePath) {
  const values = {};
  for (const rawLine of (await readFile(filePath, 'utf8')).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  if (!values.POSTIZ_EMAIL) throw new Error('Postiz credential file is missing POSTIZ_EMAIL');
  if (!values.POSTIZ_PASSWORD) throw new Error('Postiz credential file is missing POSTIZ_PASSWORD');
  return { email: values.POSTIZ_EMAIL, password: values.POSTIZ_PASSWORD };
}

function uuidFromText(value) {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deterministicPostIds(marker) {
  if (typeof marker !== 'string' || marker.length < 8) {
    throw new Error('A stable draft marker is required');
  }
  return {
    rootId: uuidFromText(`root:${marker}`),
    commentId: uuidFromText(`comment:${marker}`),
  };
}

export function buildFacebookResearchBrief({ title, review }) {
  return `Viết một bài review Facebook bằng tiếng Việt cho cuốn sách “${title}”.

Yêu cầu bắt buộc:
- Tổng độ dài từ 700 đến 1.200 ký tự, tính cả hashtag.
- Mở đầu bằng một câu gợi tò mò có căn cứ trong review nguồn.
- Chọn 2-3 ý đáng chú ý nhất và một giá trị thực tế người đọc có thể nhận được.
- Kết bằng lời mời xem review đầy đủ trong bình luận.
- Không chèn URL, không bịa trích dẫn, không bịa dữ kiện, không sao chép đoạn dài.
- Dùng 3-5 hashtag phù hợp và bắt buộc có #WillReadBook.
- Viết tự nhiên, rõ ràng, tránh giọng quảng cáo chung chung.

Review nguồn:
${review}`;
}

export function validateFacebookCaption(caption) {
  if (typeof caption !== 'string') throw new Error('Facebook caption must be text');
  const trimmed = caption.trim();
  const length = Array.from(trimmed).length;
  if (length < 700 || length > 1200) {
    throw new Error(`Facebook caption must contain 700 through 1,200 characters; received ${length}`);
  }
  if (/(?:https?:\/\/|www\.)/i.test(trimmed)) {
    throw new Error('Facebook caption must not contain a URL');
  }
  const hashtags = trimmed.match(/(?:^|\s)#[\p{L}\p{N}_]+/gu) || [];
  if (hashtags.length < 3 || hashtags.length > 5) {
    throw new Error('Facebook caption must contain 3 through 5 hashtags');
  }
  if (!hashtags.some((tag) => tag.trim() === '#WillReadBook')) {
    throw new Error('Facebook caption must contain #WillReadBook');
  }
  return trimmed;
}

function authFromSetCookie(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/(?:^|,\s*)auth=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export class PostizLocalClient {
  constructor({ baseUrl, credentials, timeoutMs = 30_000, generationTimeoutMs = 280_000 }) {
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.credentials = credentials;
    this.timeoutMs = timeoutMs;
    this.generationTimeoutMs = generationTimeoutMs;
    this.auth = '';
    this.showorg = '';
  }

  async login() {
    const response = await this.#fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: this.credentials.email,
        password: this.credentials.password,
        provider: 'LOCAL',
        providerToken: '',
      }),
      authenticated: false,
      timeoutMs: this.timeoutMs,
    });
    this.auth = response.headers.get('auth') || authFromSetCookie(response);
    this.showorg = response.headers.get('showorg') || '';
    if (!this.auth) {
      throw new PostizClientError('Postiz login did not return an authentication token', {
        code: 'postiz_auth_token_missing',
      });
    }
  }

  async preflight(pageName) {
    const response = await this.#fetch('/integrations/list');
    const body = await this.#json(response);
    const matches = (body.integrations || []).filter(
      (integration) =>
        integration.name === pageName &&
        integration.identifier === 'facebook' &&
        integration.inBetweenSteps === false &&
        integration.disabled !== true
    );
    if (matches.length !== 1) {
      throw new PostizClientError(
        `Expected exactly one complete Facebook integration named “${pageName}”; found ${matches.length}`,
        { code: 'target_integration_ambiguous' }
      );
    }
    return matches[0];
  }

  async generateCaption({ title, review }) {
    const response = await this.#fetch('/posts/generator', {
      method: 'POST',
      body: JSON.stringify({
        research: buildFacebookResearchBrief({ title, review }),
        format: 'one_long',
        tone: 'personal',
        isPicture: false,
      }),
      timeoutMs: this.generationTimeoutMs,
    });
    const ndjson = await response.text();
    let output;
    for (const line of ndjson.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new PostizClientError('Postiz generator returned malformed NDJSON', {
          code: 'generator_malformed_response',
        });
      }
      if (event?.error) {
        throw new PostizClientError('Postiz generator reported an error', {
          code: 'generator_error',
          transient: true,
        });
      }
      if (event?.data?.output) output = event.data.output;
    }
    if (!output || typeof output.hook !== 'string' || output.content?.length !== 1) {
      throw new PostizClientError('Postiz generator did not return one complete post', {
        code: 'generator_incomplete_response',
        transient: true,
      });
    }
    return validateFacebookCaption(`${output.hook.trim()}\n\n${output.content[0].content.trim()}`);
  }

  async uploadMedia(imagePath) {
    const form = new FormData();
    form.append('file', new Blob([await readFile(imagePath)], { type: 'image/png' }), path.basename(imagePath));
    const response = await this.#fetch('/media/upload-simple', {
      method: 'POST',
      body: form,
      json: false,
      timeoutMs: this.timeoutMs,
    });
    const media = await this.#json(response);
    if (!media?.id || !media?.path) {
      throw new PostizClientError('Postiz media upload returned an invalid object', {
        code: 'media_upload_invalid',
        transient: true,
      });
    }
    return { id: String(media.id), path: String(media.path) };
  }

  async createDraft({ integrationId, caption, comment, media, marker }) {
    const validCaption = validateFacebookCaption(caption);
    if (!comment.startsWith(COMMENT_PREFIX)) {
      throw new Error('The first comment does not match the required template');
    }
    const videoUrl = comment.slice(COMMENT_PREFIX.length).trim();
    const parsedVideo = new URL(videoUrl);
    if (parsedVideo.protocol !== 'https:' || !/^(?:www\.)?(?:youtube\.com|youtu\.be)$/.test(parsedVideo.hostname)) {
      throw new Error('The first comment must contain a valid YouTube URL');
    }
    if (!media?.id || !media?.path) throw new Error('A saved Postiz media object is required');
    const ids = deterministicPostIds(marker);
    const payload = {
      type: 'draft',
      shortLink: false,
      date: new Date().toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: integrationId },
          value: [
            { id: ids.rootId, content: validCaption, image: [{ id: media.id, path: media.path }] },
            { id: ids.commentId, content: comment, image: [] },
          ],
        },
      ],
    };
    if (payload.type !== 'draft') throw new Error('Refusing to create a non-draft Postiz post');
    const response = await this.#fetch('/posts', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: this.timeoutMs,
      headers: { 'x-request-id': ids.rootId },
    });
    const created = await this.#json(response);
    if (!Array.isArray(created) || !created[0]?.postId) {
      throw new PostizClientError('Postiz draft creation returned an invalid response', {
        code: 'draft_create_invalid',
        transient: true,
      });
    }
    return { postId: ids.rootId, commentId: ids.commentId };
  }

  async findDraftByMarker(marker) {
    const ids = deterministicPostIds(marker);
    const response = await this.#fetch(`/posts/${ids.rootId}`, { allowNotFound: true });
    if (response.status === 404) return null;
    const post = await this.#json(response);
    return post ? { postId: ids.rootId, commentId: ids.commentId, post } : null;
  }

  async #fetch(
    pathname,
    {
      method = 'GET',
      body,
      authenticated = true,
      json = true,
      timeoutMs = this.timeoutMs,
      allowNotFound = false,
      headers = {},
    } = {}
  ) {
    const requestHeaders = { ...headers };
    if (json && body !== undefined) requestHeaders['content-type'] = 'application/json';
    if (authenticated) {
      if (!this.auth) throw new PostizClientError('Postiz client is not authenticated', { code: 'not_authenticated' });
      requestHeaders.auth = this.auth;
      if (this.showorg) requestHeaders.showorg = this.showorg;
    }
    let response;
    try {
      response = await fetch(`${this.baseUrl}${pathname}`, {
        method,
        body,
        headers: requestHeaders,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PostizClientError('Could not reach local Postiz', {
        code: 'postiz_unreachable',
        transient: true,
      });
    }
    if (!response.ok && !(allowNotFound && response.status === 404)) {
      throw new PostizClientError(`Local Postiz returned HTTP ${response.status}`, {
        code: response.status === 401 || response.status === 403 ? 'postiz_auth_failed' : 'postiz_http_error',
        transient: response.status === 408 || response.status === 429 || response.status >= 500,
        status: response.status,
      });
    }
    return response;
  }

  async #json(response) {
    try {
      return await response.json();
    } catch {
      throw new PostizClientError('Local Postiz returned invalid JSON', {
        code: 'postiz_invalid_json',
        transient: response.status >= 500,
      });
    }
  }
}
