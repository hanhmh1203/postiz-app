import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldIncludeCalendarPostMedia } from './posts.calendar.query.ts';

test('day view includes post media for detailed cards', () => {
  assert.equal(shouldIncludeCalendarPostMedia('day'), true);
});

test('week and month views keep the compact calendar response', () => {
  assert.equal(shouldIncludeCalendarPostMedia('week'), false);
  assert.equal(shouldIncludeCalendarPostMedia('month'), false);
  assert.equal(shouldIncludeCalendarPostMedia(undefined), false);
});
