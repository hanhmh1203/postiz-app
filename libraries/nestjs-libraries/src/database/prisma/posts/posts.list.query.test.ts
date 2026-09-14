import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPostsListQuery } from './posts.list.query.ts';

const now = new Date('2026-09-14T04:00:00.000Z');

test('draft query has no publish-date cutoff and sorts newest updates first', () => {
  const result = buildPostsListQuery('org-1', { state: 'draft' }, now);

  assert.equal(result.where.state, 'DRAFT');
  assert.equal(result.where.publishDate, undefined);
  assert.deepEqual(result.orderBy, { updatedAt: 'desc' });
});

test('scheduled query includes only future queue posts in publish order', () => {
  const result = buildPostsListQuery('org-1', { state: 'scheduled' }, now);

  assert.equal(result.where.state, 'QUEUE');
  assert.deepEqual(result.where.publishDate, { gte: now });
  assert.deepEqual(result.orderBy, { publishDate: 'asc' });
});

test('all and published have no date cutoff and use descending recency', () => {
  const all = buildPostsListQuery('org-1', { state: 'all' }, now);
  const published = buildPostsListQuery('org-1', { state: 'published' }, now);

  assert.equal(all.where.publishDate, undefined);
  assert.deepEqual(all.orderBy, { updatedAt: 'desc' });
  assert.equal(published.where.publishDate, undefined);
  assert.deepEqual(published.orderBy, { publishDate: 'desc' });
});

test('query scopes root posts to the organization and optional customer', () => {
  const result = buildPostsListQuery(
    'org-1',
    { state: 'draft', customer: 'customer-1' },
    now
  );

  assert.equal(result.where.organizationId, 'org-1');
  assert.equal(result.where.parentPostId, null);
  assert.equal(result.where.intervalInDays, null);
  assert.deepEqual(result.where.integration, {
    deletedAt: null,
    organizationId: 'org-1',
    customerId: 'customer-1',
  });
});
