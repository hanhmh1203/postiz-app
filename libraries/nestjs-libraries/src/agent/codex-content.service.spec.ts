import { ServiceUnavailableException } from '@nestjs/common';
import { CodexContentService } from './codex-content.service';

describe('CodexContentService', () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.CODEX_BRIDGE_URL;
  const originalToken = process.env.CODEX_BRIDGE_TOKEN;

  beforeEach(() => {
    process.env.CODEX_BRIDGE_URL = 'http://host.docker.internal:4111';
    process.env.CODEX_BRIDGE_TOKEN = 'bridge-secret';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.CODEX_BRIDGE_URL = originalUrl;
    process.env.CODEX_BRIDGE_TOKEN = originalToken;
    jest.restoreAllMocks();
  });

  it('maps a Postiz generator request to the authenticated bridge', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hook: 'Một cách làm nội dung mới',
        content: [{ content: 'Nội dung chính' }],
        category: 'Educational',
        topic: 'Marketing',
      }),
    }) as typeof fetch;

    const service = new CodexContentService();
    await expect(
      service.generate({
        research: 'Viết bài giới thiệu sản phẩm mới',
        format: 'one_long',
        tone: 'company',
        isPicture: false,
      })
    ).resolves.toEqual({
      hook: 'Một cách làm nội dung mới',
      content: [{ content: 'Nội dung chính' }],
      category: 'Educational',
      topic: 'Marketing',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://host.docker.internal:4111/v1/generate-social-posts',
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: 'Bearer bridge-secret',
          'content-type': 'application/json',
        },
      })
    );
  });

  it('rejects missing local bridge configuration', async () => {
    delete process.env.CODEX_BRIDGE_TOKEN;
    await expect(
      new CodexContentService().generate({
        research: 'Viết bài giới thiệu sản phẩm mới',
        format: 'one_long',
        tone: 'company',
        isPicture: false,
      })
    ).rejects.toThrow('CODEX_BRIDGE_TOKEN');
  });

  it('converts bridge failures into a safe service error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'private command output' }),
    }) as typeof fetch;

    await expect(
      new CodexContentService().generate({
        research: 'Viết bài giới thiệu sản phẩm mới',
        format: 'one_long',
        tone: 'company',
        isPicture: false,
      })
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects malformed successful responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hook: '', content: [] }),
    }) as typeof fetch;

    await expect(
      new CodexContentService().generate({
        research: 'Viết bài giới thiệu sản phẩm mới',
        format: 'one_long',
        tone: 'company',
        isPicture: false,
      })
    ).rejects.toThrow('invalid content');
  });

  it('streams progress events and a Postiz-compatible final output', async () => {
    const service = new CodexContentService();
    jest.spyOn(service, 'generate').mockResolvedValue({
      hook: 'Hook',
      content: [{ content: 'Generated copy' }],
      category: 'Educational',
      topic: 'Marketing',
    });

    const events = [];
    for await (const event of service.stream(
      {
        research: 'Viết bài giới thiệu sản phẩm mới',
        format: 'one_long',
        tone: 'company',
        isPicture: false,
      },
      async () => '2026-09-14T09:00:00.000Z'
    )) {
      events.push(event);
    }

    expect(events.map((event) => event.name)).toEqual([
      'agent',
      'generate-hook',
      'generate-content',
      'post-time',
      'codex-complete',
    ]);
    expect(events.at(-1)).toEqual({
      name: 'codex-complete',
      data: {
        output: {
          hook: 'Hook',
          content: [{ content: 'Generated copy' }],
          category: 'Educational',
          topic: 'Marketing',
          date: '2026-09-14T09:00:00.000Z',
        },
      },
    });
  });
});
