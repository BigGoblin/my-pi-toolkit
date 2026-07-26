# @open-cursor/protocol

Cursor agent protocol definitions, generated protobuf code, and ConnectRPC client services.

This package contains the protobuf definitions (`.proto` files), TypeScript classes generated from them, and high-level ConnectRPC client wrappers for interacting with Cursor's backend services (Agent, AI, and Auth).

## Install

```sh
npm install @open-cursor/protocol
```

Requires Node.js 18+.

## Usage

```ts
import { Auth, AgentService, CURSOR_API_URL } from "@open-cursor/protocol";

// 1. Authenticate with Cursor's auth endpoints
const auth = new Auth(CURSOR_API_URL);
const tokens = await auth.poll({ uuid, verifier });

// 2. Instantiate the agent service client
const service = new AgentService(CURSOR_API_URL, {
  accessToken: tokens.accessToken,
  clientType: "cli",
  clientVersion: "cli-2026.06.04-5fd875e",
});
const rpcClient = service.rpcClient;
```

## Provenance

- `proto/`: Original protobuf definitions reverse-engineered from Cursor.
- `src/__generated__/`: Generated TypeScript definitions (`protoc-gen-es` and `protoc-gen-connect-es`).
- `src/agent.ts`, `src/ai.ts`, `src/auth.ts`: Client wrappers around ConnectRPC transport.

## Updating

To regenerate TypeScript files after modifying the `.proto` files under `proto/`:

```sh
npm run generate
```
