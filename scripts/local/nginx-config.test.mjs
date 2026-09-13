import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = await readFile(
  new URL('../../var/docker/nginx.conf', import.meta.url),
  'utf8'
);
const apiLocation =
  config.match(/location \/api\/ \{([\s\S]*?)\n\s*\}/)?.[1] || '';

test('allows long-running AI generation through the API proxy', () => {
  assert.match(apiLocation, /proxy_read_timeout\s+300s;/);
  assert.match(apiLocation, /proxy_send_timeout\s+300s;/);
});

test('streams generator progress without nginx response buffering', () => {
  assert.match(apiLocation, /proxy_buffering\s+off;/);
});
