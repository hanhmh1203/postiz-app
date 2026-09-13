# Codex bridge for local Postiz

This bridge lets the Postiz container request text generation from the Codex CLI running as the signed-in macOS user. It never exposes or copies Codex credentials into the container.

The server listens on port `4111`. Generation requests require `Authorization: Bearer <CODEX_BRIDGE_TOKEN>`. The `/health` endpoint reports whether Codex is authenticated.

Run it through the installed LaunchAgent:

```bash
scripts/local/install-codex-bridge.sh
scripts/local/postiz-local.sh bridge-status
scripts/local/postiz-local.sh test-ai
```

The bridge is intended for a trusted personal Mac. Do not expose port `4111` through a router or public tunnel.
