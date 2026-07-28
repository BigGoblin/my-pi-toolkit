# Repository Agent Guidelines

## Source file size

- Keep source files at or below 300 lines whenever practical.
- If a source file exceeds 300 lines, split it by responsibility into focused modules before adding more behavior.
- Prefer clear domain boundaries over arbitrary line-based splitting; keep public APIs small and avoid circular dependencies.
- Generated files, vendored code, lockfiles, and third-party sources are exempt.

## Documentation

- After completing each functional change, review whether the related README files, usage instructions, configuration examples, command references, or architecture documentation need to be updated, and update them in the same change when necessary.
