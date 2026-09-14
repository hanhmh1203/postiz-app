import assert from 'node:assert/strict';
import test from 'node:test';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

import {
  buildDraftSchedulePayload,
  isVideoPath,
  parseListMedia,
} from './list-view.utils.ts';

dayjs.extend(utc);

test('parses supported media without throwing on malformed values', () => {
  assert.deepEqual(parseListMedia('[{"id":"m1","path":"/short.mp4"}]'), [
    { id: 'm1', path: '/short.mp4' },
  ]);
  assert.deepEqual(parseListMedia([{ id: 'm2', path: '/land.png' }]), [
    { id: 'm2', path: '/land.png' },
  ]);
  assert.deepEqual(parseListMedia('{bad json'), []);
  assert.deepEqual(parseListMedia([{ id: 'missing-path' }, null]), []);
});

test('recognizes video paths case-insensitively with query strings', () => {
  assert.equal(isVideoPath('/short.MP4?cache=1'), true);
  assert.equal(isVideoPath('/short.webm#frame'), true);
  assert.equal(isVideoPath('/land.png'), false);
});

test('builds an explicit schedule request with comments and UTC date', () => {
  const payload = buildDraftSchedulePayload(
    {
      group: 'group-1',
      integration: 'facebook-1',
      settings: { __type: 'facebook', post_type: 'post' },
      posts: [
        { id: 'root', content: 'Post', image: [], delay: 0, state: 'DRAFT' },
        {
          id: 'comment',
          content: 'Comment',
          image: [],
          delay: 0,
          state: 'DRAFT',
        },
      ],
    },
    [{ tag: { id: 'tag-1', name: 'Books' } }],
    dayjs('2026-09-15T09:30:00+07:00')
  );

  assert.equal(payload.type, 'schedule');
  assert.equal(payload.shortLink, false);
  assert.equal(payload.date, '2026-09-15T02:30:00.000Z');
  assert.deepEqual(payload.tags, [{ value: 'tag-1', label: 'Books' }]);
  assert.equal(payload.posts[0].group, 'group-1');
  assert.deepEqual(payload.posts[0].integration, { id: 'facebook-1' });
  assert.deepEqual(payload.posts[0].settings, {
    __type: 'facebook',
    post_type: 'post',
  });
  assert.deepEqual(
    payload.posts[0].value.map((post) => post.id),
    ['root', 'comment']
  );
});

test('refuses to build a schedule request unless the current root is a draft', () => {
  const base = {
    group: 'group-1',
    integration: 'facebook-1',
    settings: { __type: 'facebook' },
    posts: [
      {
        id: 'root',
        content: 'Post',
        image: [],
        delay: 0,
        state: 'QUEUE',
      },
    ],
  };

  assert.throws(
    () => buildDraftSchedulePayload(base, [], dayjs().add(1, 'day')),
    /no longer a draft/i
  );
});
