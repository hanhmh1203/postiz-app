import { fallbackDateWithoutPostingTimes } from '../database/prisma/posts/posts.schedule';

describe('Post schedule fallback', () => {
  it('returns the next UTC hour when a new organization has no posting times', () => {
    expect(
      fallbackDateWithoutPostingTimes([], new Date('2026-09-13T06:26:00Z'))
    ).toBe('2026-09-13T07:00:00');
  });

  it('lets configured posting times use the normal scheduler', () => {
    expect(
      fallbackDateWithoutPostingTimes(
        [540, 1020],
        new Date('2026-09-13T06:26:00Z')
      )
    ).toBeNull();
  });
});
