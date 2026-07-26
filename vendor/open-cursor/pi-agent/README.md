# @open-cursor/pi-agent

Cursor agent provider extension for [pi](https://pi.dev) — use Cursor's models and agent directly from pi's interface.

## Features

- **Full Cursor model access** — Claude, GPT, Gemini, Grok, Kimi, and Composer models via Cursor's API
- **OAuth login** — `/login cursor` to authenticate with your Cursor account
- **Tool relay** — Relays Cursor tool requests directly through pi's execution sandbox
- **Session persistence** — Saves and resumes agent session state using disk-backed protobuf checkpoints
- **Thinking levels** — Maps thinking variants and reasoning levels (minimal to max) dynamically

## Requirements

- pi >= 0.74.0 (`@earendil-works/pi-coding-agent`)
- A Cursor account with agent access

## Install

```bash
# Install from npm (published package)
pi install npm:@open-cursor/pi-agent

# Or load as a one-off extension
pi -e npm:@open-cursor/pi-agent
```

## Configuration

### Environment Variables

The extension uses Cursor's built-in OAuth flow — no manual API key needed. Run `/login cursor` inside pi to authenticate.

If you have an existing `CURSOR_ACCESS_TOKEN`, you can set it directly:

```bash
export CURSOR_ACCESS_TOKEN="your-token-here"
```

### Manual OAuth Login

Inside pi interactive mode:

```
/login cursor
```

This opens the Cursor OAuth flow in your browser. After authorization, credentials are stored in `~/.pi/agent/auth.json`.

## Caveats

- **Fable 5 privacy policy** — Claude Fable 5 requires accepting Cursor's data retention policy in your [Cursor settings](https://cursor.com/settings) before it generates responses
- **Vendored Cursor protocol code** — The `@open-cursor/client` and `@open-cursor/protocol` packages contain reverse-engineered ConnectRPC definitions that may drift from Cursor's server protocol

## Models

| Canonical ID                   | Model                      | Thinking               |
| ------------------------------ | -------------------------- | ---------------------- |
| `claude-sonnet-4-0`            | Claude 4 Sonnet            | off / thinking         |
| `claude-sonnet-4-5`            | Claude 4.5 Sonnet          | off / thinking         |
| `claude-sonnet-4-1m`           | Claude 4 Sonnet 1M         | off / thinking         |
| `claude-sonnet-4-6`            | Claude 4.6 Sonnet          | off / thinking         |
| `claude-opus-4-5`              | Claude 4.5 Opus            | off / thinking         |
| `claude-opus-4-6`              | Claude 4.6 Opus            | off / thinking         |
| `claude-opus-4-6-fast`         | Claude 4.6 Opus (fast)     | off / thinking         |
| `claude-opus-4-6-max`          | Claude 4.6 Opus Max        | off / thinking         |
| `claude-opus-4-6-max-fast`     | Claude 4.6 Opus Max (fast) | off / thinking         |
| `claude-opus-4-7`              | Claude Opus 4.7            | high / max             |
| `claude-opus-4-7-fast`         | Claude Opus 4.7 (fast)     | high / max             |
| `claude-opus-4-7-max`          | Claude Opus 4.7 Max        | high / max             |
| `claude-opus-4-7-max-fast`     | Claude Opus 4.7 Max (fast) | high / max             |
| `claude-opus-4-8`              | Claude Opus 4.8            | medium / high / max    |
| `claude-opus-4-8-fast`         | Claude Opus 4.8 (fast)     | medium / high / xhigh  |
| `claude-opus-4-8-max`          | Claude Opus 4.8 Max        | medium / high / max    |
| `claude-opus-4-8-max-fast`     | Claude Opus 4.8 Max (fast) | medium / high / max    |
| `claude-fable-5`               | Claude Fable 5             | off → max (6 levels)   |
| `composer-1.5`                 | Composer 1.5               | —                      |
| `composer-2`                   | Composer 2                 | —                      |
| `composer-2-fast`              | Composer 2 Fast            | —                      |
| `composer-2.5`                 | Composer 2.5               | —                      |
| `composer-2.5-fast`            | Composer 2.5 Fast          | —                      |
| `gpt-5-mini`                   | GPT-5 Mini                 | —                      |
| `gpt-5.1`                      | GPT-5.1                    | low / high             |
| `gpt-5.1-codex-mini`           | GPT-5.1 Codex Mini         | low / high             |
| `gpt-5.1-codex-max`            | GPT-5.1 Codex Max          | low → xhigh (5 levels) |
| `gpt-5.1-codex-max-fast`       | GPT-5.1 Codex Max Fast     | low → xhigh (5 levels) |
| `gpt-5.2`                      | GPT-5.2                    | low → xhigh (4 levels) |
| `gpt-5.2-fast`                 | GPT-5.2 Fast               | low → xhigh (4 levels) |
| `gpt-5.2-codex`                | GPT-5.2 Codex              | low → xhigh (4 levels) |
| `gpt-5.2-codex-fast`           | GPT-5.2 Codex Fast         | low → xhigh (4 levels) |
| `gpt-5.3-codex`                | GPT-5.3 Codex              | low → xhigh (4 levels) |
| `gpt-5.3-codex-fast`           | GPT-5.3 Codex Fast         | low → xhigh (4 levels) |
| `gpt-5.3-codex-spark`          | GPT-5.3 Codex Spark        | low → xhigh (4 levels) |
| `gpt-5.4`                      | GPT-5.4                    | low → xhigh (5 levels) |
| `gpt-5.4-fast`                 | GPT-5.4 Fast               | low → xhigh (4 levels) |
| `gpt-5.4-mini`                 | GPT-5.4 Mini               | off → xhigh (6 levels) |
| `gpt-5.4-nano`                 | GPT-5.4 Nano               | off → xhigh (6 levels) |
| `gpt-5.4-pro`                  | GPT-5.4 Pro                | low → xhigh (5 levels) |
| `gpt-5.4-pro-fast`             | GPT-5.4 Pro Fast           | low → xhigh (4 levels) |
| `gpt-5.5`                      | GPT-5.5                    | medium / high / xhigh  |
| `gpt-5.5-pro`                  | GPT-5.5 Pro                | medium / high / xhigh  |
| `gpt-5.5-fast`                 | GPT-5.5 Fast               | high / xhigh           |
| `gemini-3-pro-preview`         | Gemini 3 Pro               | —                      |
| `gemini-3-flash-preview`       | Gemini 3 Flash             | —                      |
| `gemini-3.1-pro-preview`       | Gemini 3.1 Pro             | —                      |
| `gemini-3.5-pro-preview`       | Gemini 3.5 Pro             | —                      |
| `gemini-3.5-flash-preview`     | Gemini 3.5 Flash           | —                      |
| `grok-4.20-0309-non-reasoning` | Grok 4.20                  | —                      |
| `grok-4.20-0309-reasoning`     | Grok 4.20 (reasoning)      | —                      |
| `grok-4.3`                     | Grok 4.3                   | —                      |
| `grok-build-0.1`               | Grok Build 0.1             | —                      |
| `kimi-k2.5`                    | Kimi K2.5                  | —                      |

> Cursor exposes 141+ model variants. Run `cursor agent models` for the authoritative list.

## Development

```bash
# Type-check
npm run typecheck

# Lint
npm run lint

# Test
npm run test
```

## Local Development

Link your local checkout to test changes without publishing to npm:

```bash
./scripts/develop.sh link    # symlink local copy + remove npm version
./scripts/develop.sh unlink  # remove symlink + reinstall npm version
```

Then run `/reload` inside pi to pick up the changes.
