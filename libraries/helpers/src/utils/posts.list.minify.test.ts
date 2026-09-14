import assert from 'node:assert/strict';
import test from 'node:test';

import { expandPostsList, minifyPostsList } from './posts.list.minify.ts';

test('list minification preserves attached media under a compact key', () => {
  const source = {
    posts: [
      {
        id: 'post-1',
        image: '[{"id":"m1","path":"/a.mp4"}]',
      },
    ],
    total: 1,
    page: 0,
    limit: 100,
    hasMore: false,
  };

  const minified = minifyPostsList(source);

  assert.equal(minified.p[0].im, source.posts[0].image);
  assert.equal('image' in minified.p[0], false);
  assert.equal(expandPostsList(minified).posts[0].image, source.posts[0].image);
});
