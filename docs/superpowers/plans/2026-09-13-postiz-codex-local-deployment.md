# Postiz + Codex Local Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Postiz on this Mac and power its text post generator with the locally authenticated Codex account, without placing ChatGPT session tokens inside Postiz containers.

**Architecture:** Postiz and its PostgreSQL, Redis, and Temporal dependencies run in containers at `http://localhost:4007`. A small authenticated bridge runs as the macOS user, invokes `codex exec` with the existing ChatGPT login, and returns schema-validated social post content to Postiz over `http://host.docker.internal:4111`. The upstream OpenAI API path remains available by selecting `AI_PROVIDER=openai` and supplying `OPENAI_API_KEY`.

**Tech Stack:** Postiz monorepo, NestJS, Next.js, Node.js 22, Node built-in test runner, Codex CLI, Docker Compose via OrbStack, PostgreSQL, Redis, Temporal.

## Global Constraints

- Bind the Postiz UI only to the local Mac on port `4007`.
- Bind the Codex bridge on port `4111` and require a random bearer token for every generation request.
- Keep Codex OAuth credentials on the macOS host; never copy `~/.codex/auth.json` into an image or container.
- Use `AI_PROVIDER=codex` for text generation and leave `OPENAI_API_KEY` empty.
- Keep upstream behavior available when `AI_PROVIDER` is unset or set to `openai`.
- AI image generation continues to require an OpenAI API key; the Codex path generates text and optional image prompts only.
- Facebook and Instagram publishing requires Meta application credentials and interactive OAuth after the local app is running.

---

### Task 1: Establish a reproducible local checkout

**Files:**

- Create: `docs/superpowers/plans/2026-09-13-postiz-codex-local-deployment.md`
- Create: `.env.codex-local`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: Git commit `3cbe20b` from `gitroomhq/postiz-app`.
- Produces: branch `local/codex-chatgpt-auth` and a local-only environment file.

- [x] **Step 1: Clone the source and create the local integration branch**

  ```bash
  git clone --depth 1 --filter=blob:none https://github.com/gitroomhq/postiz-app.git postiz-app
  git -C postiz-app checkout -b local/codex-chatgpt-auth
  ```

- [x] **Step 2: Generate deployment secrets**

  ```bash
  umask 077
  JWT_SECRET="$(openssl rand -hex 48)"
  CODEX_BRIDGE_TOKEN="$(openssl rand -hex 48)"
  ```

- [x] **Step 3: Store non-public configuration in `.env.codex-local` and ignore it**

  The file contains `JWT_SECRET`, `CODEX_BRIDGE_TOKEN`, `AI_PROVIDER=codex`, `CODEX_BRIDGE_URL=http://host.docker.internal:4111`, and local URL settings. Social-provider secrets are added to the same ignored file when their developer applications are configured.

### Task 2: Add the host-side Codex bridge using TDD

**Files:**

- Create: `tools/codex-bridge/codex-bridge.test.mjs`
- Create: `tools/codex-bridge/codex-bridge-lib.mjs`
- Create: `tools/codex-bridge/codex-bridge.mjs`
- Create: `tools/codex-bridge/post-output.schema.json`
- Create: `tools/codex-bridge/README.md`

**Interfaces:**

- Consumes: `POST /v1/generate-social-posts` with bearer authentication and JSON `{ research, format, tone, isPicture }`.
- Produces: JSON `{ hook, content, category, topic }`, where `content` is always an array of `{ content, website?, prompt? }`.

- [x] **Step 1: Write failing tests for authentication, request validation, schema normalization, and Codex command construction**

  ```bash
  node --test tools/codex-bridge/codex-bridge.test.mjs
  ```

  Expected result: failure because the bridge module does not exist yet.

- [x] **Step 2: Implement the bridge with Node built-ins**

  The bridge validates the bearer token, limits request bodies to 64 KiB, invokes the Codex executable in a clean temporary directory with `exec --ephemeral --ignore-user-config --ignore-rules --model gpt-5.6-luna --config model_reasoning_effort="low" --sandbox read-only --skip-git-repo-check --output-schema`, applies a request timeout, validates the returned JSON, and never returns command stderr to the HTTP client.

- [x] **Step 3: Run the tests**

  ```bash
  node --test tools/codex-bridge/codex-bridge.test.mjs
  ```

  Expected result: all tests pass with zero failures.

### Task 3: Add a Codex provider to the Postiz generator using TDD

**Files:**

- Create: `libraries/nestjs-libraries/src/agent/codex-content.service.spec.ts`
- Create: `libraries/nestjs-libraries/src/agent/codex-content.service.ts`
- Modify: `libraries/nestjs-libraries/src/agent/agent.module.ts`
- Modify: `libraries/nestjs-libraries/src/agent/agent.graph.service.ts`

**Interfaces:**

- Consumes: `CodexContentService.generate(body: GeneratorDto)`.
- Produces: the same newline-delimited generator events already consumed by `apps/frontend/src/components/launches/generator/generator.tsx`.

- [x] **Step 1: Write a failing service test**

  ```bash
  pnpm exec jest libraries/nestjs-libraries/src/agent/codex-content.service.spec.ts --runInBand
  ```

  The test verifies request headers, payload mapping, success normalization, unauthorized bridge responses, and invalid bridge output.

- [x] **Step 2: Implement `CodexContentService`**

  The service reads `CODEX_BRIDGE_URL` and `CODEX_BRIDGE_TOKEN`, calls the bridge, validates the response with Zod, and returns clear local-configuration errors without leaking secrets.

- [x] **Step 3: Select the provider in `AgentGraphService.start`**

  When `AI_PROVIDER=codex`, return an async event stream containing progress events and a final `data.output` object with the generated content and a free Postiz schedule date. Otherwise, execute the existing LangGraph/OpenAI workflow unchanged.

- [x] **Step 4: Run targeted tests and type checks**

  ```bash
  pnpm exec jest --runInBand --config tools/jest.codex.config.cjs
  pnpm --filter ./apps/backend run build
  ```

### Task 4: Package and persist the local deployment

**Files:**

- Create: `docker-compose.codex-local.yaml`
- Create: `scripts/local/install-codex-bridge.sh`
- Create: `scripts/local/postiz-local.sh`
- Create: `scripts/local/nginx-config.test.mjs`
- Modify: `var/docker/nginx.conf`
- Create outside the repository: `~/Library/LaunchAgents/com.postiz.codex-bridge.plist`

**Interfaces:**

- Consumes: `.env.codex-local`, the checked-in bridge, and the system `codex` binary.
- Produces: a persistent bridge process plus the Postiz stack at `http://localhost:4007`.

- [x] **Step 1: Install and start the container runtime**

  ```bash
  brew install --cask orbstack
  open -a OrbStack
  docker info
  ```

- [x] **Step 2: Install the bridge LaunchAgent**

  ```bash
  scripts/local/install-codex-bridge.sh
  curl -fsS http://127.0.0.1:4111/health
  ```

  Expected result: JSON reports `status: ok` and `authenticated: true`.

- [x] **Step 3: Build and start Postiz**

  ```bash
  docker compose --env-file .env.codex-local \
    -f docker-compose.yaml -f docker-compose.codex-local.yaml up -d --build
  ```

- [x] **Step 4: Verify container health and HTTP availability**

  ```bash
  docker compose --env-file .env.codex-local \
    -f docker-compose.yaml -f docker-compose.codex-local.yaml ps
  curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:4007
  ```

  Expected result: required containers are running or healthy and the HTTP response is `200` or an expected redirect.

### Task 5: Verify generation with the logged-in ChatGPT account

**Files:**

- Update: `docs/superpowers/plans/2026-09-13-postiz-codex-local-deployment.md`

**Interfaces:**

- Consumes: live bridge and a Vietnamese social-media brief.
- Produces: valid structured caption/thread data, followed by a successful generation from the Postiz UI after local account registration.

- [x] **Step 1: Confirm Codex authentication**

  ```bash
  codex login status
  ```

  Expected result: `Logged in using ChatGPT`.

- [x] **Step 2: Exercise the bridge with a real generation request**

  ```bash
  scripts/local/postiz-local.sh test-ai
  ```

  Expected result: JSON with a non-empty `hook` and one or more non-empty content items.

- [x] **Step 3: Create the first local Postiz account and verify the generator endpoint used by the UI**

  The deployment creates or signs in the local admin account and submits a Vietnamese prompt with image generation disabled through `POST /api/posts/generator`. The response must contain the same newline-delimited progress and final `data.output` contract consumed by the UI.

### Task 6: Connect Facebook Pages and Instagram professional accounts

**Files:**

- Modify locally: `.env.codex-local`

**Interfaces:**

- Consumes: Meta developer app ID and secret, plus interactive account authorization.
- Produces: connected Facebook Page and Instagram professional account integrations in Postiz.

- [ ] **Step 1: Add Meta application credentials**

  Set `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `THREADS_APP_ID`, and `THREADS_APP_SECRET` in `.env.codex-local` as applicable, then recreate the Postiz container.

- [ ] **Step 2: Configure Meta callback URLs**

  For a public deployment, configure an HTTPS hostname and use the callback URLs displayed by Postiz. Meta cannot complete production OAuth callbacks to an inaccessible `localhost` URL.

- [ ] **Step 3: Complete interactive authorization in Postiz**

  Sign in to Meta through Postiz, select the Facebook Page and linked Instagram professional account, then publish a draft test post from the calendar.

## Operations

Use the helper for routine lifecycle commands:

```bash
scripts/local/postiz-local.sh status
scripts/local/postiz-local.sh logs
scripts/local/postiz-local.sh restart
scripts/local/postiz-local.sh stop
scripts/local/postiz-local.sh start
scripts/local/postiz-local.sh test-ai
```

The Postiz database and uploads live in named container volumes. Stopping or recreating containers does not erase them. Removing volumes is intentionally absent from the helper.

## Deployment Result — 2026-09-13

- Postiz is running at `http://localhost:4007` from image `postiz-codex-local:3cbe20b`.
- PostgreSQL, Redis, Temporal, Temporal Elasticsearch, Temporal PostgreSQL, and Temporal UI are running in the `postiz-codex` Compose project.
- OrbStack supplies the local Docker runtime.
- `com.postiz.codex-bridge` is installed as a per-user macOS LaunchAgent and reports `authenticated: true` for the existing ChatGPT login.
- A local Postiz administrator exists as `admin@postiz.local`; its generated password remains only in the ignored `.env.codex-local` file.
- Direct bridge generation and generation through `POST /api/posts/generator` both returned valid Vietnamese content.
- The API proxy permits five-minute AI requests and disables response buffering. A new organization with no configured posting times receives the next UTC hour instead of entering an infinite schedule search.
- Meta connection remains intentionally pending because it requires the owner's Meta developer credentials, an HTTPS callback reachable by Meta, and interactive authorization of the Facebook Page and linked Instagram professional account.
