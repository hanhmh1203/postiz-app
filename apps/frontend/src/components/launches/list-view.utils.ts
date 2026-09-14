import dayjs, { type Dayjs } from 'dayjs';

export type ListMedia = {
  id?: string;
  path: string;
  thumbnail?: string;
};

type ListTag = {
  tag: {
    id: string;
    name: string;
  };
};

type PostGroup = {
  group: string;
  integration: string;
  settings?: Record<string, unknown>;
  posts: Array<{
    id: string;
    content: string;
    image?: ListMedia[];
    delay?: number;
    state: string;
  }>;
};

export function parseListMedia(value: unknown): ListMedia[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is ListMedia =>
            !!item && typeof item.path === 'string' && item.path.length > 0
        )
      : [];
  } catch {
    return [];
  }
}

export function isVideoPath(mediaPath: string) {
  return /\.(mp4|mov|webm)(?:$|[?#])/i.test(mediaPath);
}

function buildDraftActionPayload<T extends 'schedule' | 'now'>(
  group: PostGroup,
  tags: ListTag[],
  date: Dayjs,
  type: T
) {
  const root = group.posts?.[0];
  if (!root || root.state !== 'DRAFT') {
    throw new Error('This post is no longer a draft');
  }

  return {
    type,
    shortLink: false,
    date: date.utc().toISOString(),
    tags: (tags || []).map(({ tag }) => ({
      value: tag.id,
      label: tag.name,
    })),
    posts: [
      {
        integration: { id: group.integration },
        group: group.group,
        settings: group.settings || {},
        value: group.posts.map((post) => ({
          id: post.id,
          content: post.content,
          image: post.image || [],
          delay: post.delay || 0,
        })),
      },
    ],
  };
}

export function buildDraftSchedulePayload(
  group: PostGroup,
  tags: ListTag[],
  date: Dayjs
) {
  return buildDraftActionPayload(group, tags, date, 'schedule');
}

export function buildDraftNowPayload(
  group: PostGroup,
  tags: ListTag[],
  date: Dayjs
) {
  return buildDraftActionPayload(group, tags, date, 'now');
}

export function selectPostsForDay<T extends { publishDate: string | Date }>(
  posts: T[],
  selectedDate: Dayjs
): T[] {
  const selectedDay = selectedDate.format('YYYY-MM-DD');
  return posts
    .filter(
      (post) => dayjs(post.publishDate).format('YYYY-MM-DD') === selectedDay
    )
    .slice()
    .sort(
      (left, right) =>
        dayjs(left.publishDate).valueOf() - dayjs(right.publishDate).valueOf()
    );
}
