import type { Prisma } from '@prisma/client';

import type { GetPostsListDto } from '../../../dtos/posts/get.posts.list.dto.ts';

export function buildPostsListQuery(
  orgId: string,
  query: Pick<GetPostsListDto, 'customer' | 'state'>,
  now = new Date()
): {
  where: Prisma.PostWhereInput;
  orderBy: Prisma.PostOrderByWithRelationInput;
} {
  const state = query.state || 'all';
  const where: Prisma.PostWhereInput = {
    organizationId: orgId,
    deletedAt: null,
    parentPostId: null,
    intervalInDays: null,
    integration: {
      deletedAt: null,
      organizationId: orgId,
      ...(query.customer ? { customerId: query.customer } : {}),
    },
    ...(state === 'draft'
      ? { state: 'DRAFT' }
      : state === 'scheduled'
      ? { state: 'QUEUE', publishDate: { gte: now } }
      : state === 'published'
      ? { state: 'PUBLISHED' }
      : { state: { in: ['QUEUE', 'DRAFT', 'PUBLISHED', 'ERROR'] } }),
  };

  return {
    where,
    orderBy:
      state === 'scheduled'
        ? { publishDate: 'asc' }
        : state === 'published'
        ? { publishDate: 'desc' }
        : { updatedAt: 'desc' },
  };
}
