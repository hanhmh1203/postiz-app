import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { FacebookProvider } from './facebook.provider';

describe('FacebookProvider local media uploads', () => {
  const originalStorageProvider = process.env.STORAGE_PROVIDER;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalUploadDirectory = process.env.UPLOAD_DIRECTORY;

  afterEach(() => {
    process.env.STORAGE_PROVIDER = originalStorageProvider;
    process.env.FRONTEND_URL = originalFrontendUrl;
    process.env.UPLOAD_DIRECTORY = originalUploadDirectory;
    jest.restoreAllMocks();
  });

  it('uploads a locally stored image as multipart bytes before publishing the feed post', async () => {
    const uploadDirectory = mkdtempSync(
      path.join(tmpdir(), 'postiz-facebook-')
    );
    const datedDirectory = path.join(uploadDirectory, '2026', '09', '13');
    const imagePath = path.join(datedDirectory, 'review.png');
    mkdirSync(datedDirectory, { recursive: true });
    writeFileSync(imagePath, Buffer.from('fake-image-bytes'));

    process.env.STORAGE_PROVIDER = 'local';
    process.env.FRONTEND_URL = 'http://localhost:4007';
    process.env.UPLOAD_DIRECTORY = uploadDirectory;

    const provider = new FacebookProvider();
    const multipartPost = jest.fn().mockResolvedValue({
      data: { id: 'photo-1' },
    });
    jest
      .spyOn(provider as any, 'getSsrfSafeAxios')
      .mockReturnValue({ post: multipartPost });

    const graphFetch = jest
      .spyOn(provider, 'fetch')
      .mockImplementation(async (url: string) => {
        if (url.includes('/feed?')) {
          return {
            json: async () => ({
              id: 'page-1_post-1',
              permalink_url: 'https://facebook.example/post-1',
            }),
          } as Response;
        }

        if (url.includes('/photos?')) {
          return { json: async () => ({ id: 'photo-from-url' }) } as Response;
        }

        throw new Error(`Unexpected Facebook request: ${url}`);
      });

    await expect(
      provider.postPending(
        'page-1',
        'page-token',
        [
          {
            id: 'post-1',
            message: 'Review sách',
            media: [
              {
                path: 'http://localhost:4007/uploads/2026/09/13/review.png',
              },
            ],
            settings: { post_type: 'post' },
          },
        ] as any,
        {} as any
      )
    ).resolves.toEqual([
      {
        id: 'post-1',
        postId: 'page-1_post-1',
        releaseURL: 'https://facebook.example/post-1',
        status: 'success',
      },
    ]);

    expect(multipartPost).toHaveBeenCalledTimes(1);
    const [photoUrl, form, config] = multipartPost.mock.calls[0];
    expect(photoUrl).toContain('/page-1/photos?access_token=page-token');
    expect(form.getHeaders()['content-type']).toMatch(/^multipart\/form-data/);
    expect(config.headers['content-type']).toMatch(/^multipart\/form-data/);
    expect(
      graphFetch.mock.calls.some(([url]) => url.includes('/photos?'))
    ).toBe(false);
  });

  it('uploads a locally stored MP4 as multipart bytes to the Page videos endpoint', async () => {
    const uploadDirectory = mkdtempSync(
      path.join(tmpdir(), 'postiz-facebook-video-')
    );
    const datedDirectory = path.join(uploadDirectory, '2026', '09', '13');
    const videoPath = path.join(datedDirectory, 'short_01.mp4');
    mkdirSync(datedDirectory, { recursive: true });
    writeFileSync(videoPath, Buffer.from('fake-video-bytes'));

    process.env.STORAGE_PROVIDER = 'local';
    process.env.FRONTEND_URL = 'http://localhost:4007';
    process.env.UPLOAD_DIRECTORY = uploadDirectory;

    const provider = new FacebookProvider();
    const multipartPost = jest.fn().mockResolvedValue({
      data: { id: 'video-1', permalink_url: '/page-1/videos/video-1' },
    });
    jest
      .spyOn(provider as any, 'getSsrfSafeAxios')
      .mockReturnValue({ post: multipartPost });
    const graphFetch = jest
      .spyOn(provider, 'fetch')
      .mockRejectedValue(new Error('Local video must not use Graph URL fetch'));

    await expect(
      provider.postPending(
        'page-1',
        'page-token',
        [
          {
            id: 'post-1',
            message: 'Mô tả Short\n\n#Shorts #WillReadBook',
            media: [
              {
                path: 'http://localhost:4007/uploads/2026/09/13/short_01.mp4',
              },
            ],
            settings: { post_type: 'post' },
          },
        ] as any,
        {} as any
      )
    ).resolves.toEqual([
      {
        id: 'post-1',
        postId: 'video-1',
        releaseURL: 'https://www.facebook.com/reel/video-1',
        status: 'success',
      },
    ]);

    expect(multipartPost).toHaveBeenCalledTimes(1);
    const [videoUrl, form, config] = multipartPost.mock.calls[0];
    expect(videoUrl).toContain(
      '/page-1/videos?access_token=page-token&fields=id,permalink_url'
    );
    expect(form.getHeaders()['content-type']).toMatch(/^multipart\/form-data/);
    expect(config.headers['content-type']).toMatch(/^multipart\/form-data/);
    expect(graphFetch).not.toHaveBeenCalled();
  });

  it('keeps file_url publishing for a publicly reachable MP4', async () => {
    process.env.STORAGE_PROVIDER = 'local';
    process.env.FRONTEND_URL = 'http://localhost:4007';
    process.env.UPLOAD_DIRECTORY = '/tmp/postiz-uploads';

    const provider = new FacebookProvider();
    let requestBody: Record<string, unknown> | undefined;
    const graphFetch = jest
      .spyOn(provider, 'fetch')
      .mockImplementation(async (url: string, options?: RequestInit) => {
        expect(url).toContain(
          '/page-1/videos?access_token=page-token&fields=id,permalink_url'
        );
        requestBody = JSON.parse(String(options?.body));
        return {
          json: async () => ({ id: 'video-remote' }),
        } as Response;
      });

    await provider.postPending(
      'page-1',
      'page-token',
      [
        {
          id: 'post-remote',
          message: 'Remote Short description',
          media: [{ path: 'https://cdn.example/short.mp4' }],
          settings: { post_type: 'post' },
        },
      ] as any,
      {} as any
    );

    expect(graphFetch).toHaveBeenCalledTimes(1);
    expect(requestBody).toEqual({
      file_url: 'https://cdn.example/short.mp4',
      description: 'Remote Short description',
      published: true,
    });
  });
});
