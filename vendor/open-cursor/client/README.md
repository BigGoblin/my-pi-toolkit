# @open-cursor/client

Cursor agent protocol client — ConnectRPC client, executor resources, KV store, git helpers, and authentication.

This package provides the low-level protocol implementation for communicating with Cursor's agent API. It's the shared foundation used by `@open-cursor/pi-agent` and can also be used standalone or by other integrations.

## Install

```sh
npm install @open-cursor/client @open-cursor/protocol
```

## Usage

```ts
import { Auth, CURSOR_API_URL, CURSOR_WEBSITE_URL } from "@open-cursor/protocol";
import { AuthManager, ConnectClient, SessionStore } from "@open-cursor/client";

// 1. Authenticate with Cursor (OAuth PKCE)
const auth = new AuthManager(new Auth(CURSOR_API_URL), CURSOR_WEBSITE_URL);
const credentials = await auth.login({
  onAuth: ({ url, instructions }) => console.log(`${instructions}: ${url}`),
});

// 2. Setup state persistence
const store = new SessionStore(blobStore, metadataStore);

// 3. Connect to the agent and start the execution loop
const client = new ConnectClient(rpcClient);
await client.run(initialRequest, {
  interactionListener,
  resources,
  blobStore,
  checkpointHandler: store,
});
```

## Provenance

Most of this code was extracted from Cursor's minified JS bundle (`cursor-agent` npm package) to enable standalone usage without the Cursor IDE.

| Source dir                  | Cursor bundle origin                   | Notes                                          |
| --------------------------- | -------------------------------------- | ---------------------------------------------- |
| `conn/`                     | `agent-client/`                        | ConnectRPC client, stream mux, controllers     |
| `exec/`                     | `agent-exec/`                          | Executor registry, resources, serialization    |
| `kv/`                       | `agent-kv/`                            | KV blob store, serde                           |
| `git/`                      | `local-exec/`                          | Git executor + utilities (renamed for clarity) |
| `interaction-conversion.ts` | `agent-core/interaction-conversion.ts` | Flattened from single-file dir                 |
| `map-writable.ts`           | `utils/map-writable.ts`                | Flattened from single-file dir                 |
| `auth.ts`                   | First-party                            | Cursor PKCE OAuth — written by hand            |

## Updating

When the `cursor-agent` npm package updates:

```bash
# Check for drift
python3 scripts/extract-models.py
python3 scripts/diff-protos.py
python3 scripts/diff-protocol.py

# Re-extract protocol protos
# See ../protocol/ for proto extraction procedure
```
