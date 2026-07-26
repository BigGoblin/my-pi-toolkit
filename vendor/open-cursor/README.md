# Vendored from https://github.com/open-cursor/open-cursor (MIT)

Copied locally so we can modify the Cursor↔Pi bridge without depending on
`npm:@open-cursor/pi-agent` at runtime.

Layout:

- `pi-agent/` — Pi extension (`registerProvider("cursor-agent", …)`)
- `client/` — ConnectRPC client, auth, resources
- `protocol/` — protobuf / generated Cursor agent protocol

Upstream source was npm `@open-cursor/*@0.1.0`.

Edit `pi-agent/src` for usage/checkpoint/stream behavior. Keep
`extensions/cursor-models` for UX (model fold, Fast, footer).
