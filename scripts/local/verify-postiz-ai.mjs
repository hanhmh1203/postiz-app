#!/usr/bin/env node

const baseUrl = process.env.MAIN_URL || 'http://localhost:4007';
const email = process.env.POSTIZ_ADMIN_EMAIL;
const password = process.env.POSTIZ_ADMIN_PASSWORD;

if (!email || !password) {
  console.error('POSTIZ_ADMIN_EMAIL and POSTIZ_ADMIN_PASSWORD are required');
  process.exit(1);
}

async function authenticate() {
  const common = {
    provider: 'LOCAL',
    providerToken: '',
    email,
    password,
    datafast_visitor_id: '',
  };
  let response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...common, company: 'Local Postiz' }),
  });

  if (!response.ok) {
    response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(common),
    });
  }

  if (!response.ok) {
    throw new Error(
      `Could not register or log in to Postiz: HTTP ${response.status}`
    );
  }

  const auth = response.headers.get('auth');
  if (!auth) {
    throw new Error(
      'Postiz did not return the local auth header; verify NOT_SECURED=true'
    );
  }
  return auth;
}

const auth = await authenticate();
const response = await fetch(`${baseUrl}/api/posts/generator`, {
  method: 'POST',
  headers: {
    auth,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    research:
      'Viết một bài ngắn bằng tiếng Việt giới thiệu cách Postiz giúp quản lý Facebook, Instagram và LinkedIn.',
    format: 'one_short',
    tone: 'company',
    isPicture: false,
  }),
});

if (!response.ok) {
  throw new Error(`Postiz generator returned HTTP ${response.status}`);
}

const lines = (await response.text())
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const error = lines.find((line) => line.error);
if (error)
  throw new Error(error.message || 'Postiz generator reported an error');

const output = [...lines].reverse().find((line) => line?.data?.output)
  ?.data?.output;
if (
  !output?.hook ||
  !Array.isArray(output.content) ||
  !output.content[0]?.content
) {
  throw new Error('Postiz generator did not return usable content');
}

console.log(JSON.stringify(output, null, 2));
