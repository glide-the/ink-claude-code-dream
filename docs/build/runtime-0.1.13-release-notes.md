<!-- [Input] The four native qualification jobs, the five qualified npm archives, and the public registry. -->
<!-- [Output] Runtime 0.1.13 release identity, public integrity values, and JSON Read verification. -->
<!-- [Pos] Immutable release record for the Notion snapshot Read correction. -->

# Runtime 0.1.13

The built-in Read tool accepts an empty or whitespace-only `pages` field for non-PDF files. Explicit PDF page ranges use the existing validation. The SDK process test calls Read on a thread-local `.notion/snapshot.json` with `pages: ""` and checks that the tool result contains the expected file content.

Source commit `02d31066d39914fd804c3ee41bc2a8eba78abfbf` passed native qualification on Darwin and Linux, on both Arm64 and x64. The selector and four platform archives downloaded from npm matched the qualified archives byte for byte. [Qualification](https://github.com/glide-the/ink-claude-code-dream/actions/runs/45653341410) · [Publication](https://github.com/glide-the/ink-claude-code-dream/actions/runs/45655556883)

| npm package | Integrity |
| --- | --- |
| `@glide-the/ink-claude-code-dream` | `sha512-6vs/8Pj7JWw+ZxieIRln2LjJfLU/rkNIkvnQc+VgmIdj2oyeTXHMRVDSKYCQ10j0+J7gbVruT1ScJcAJopUvVg==` |
| `@glide-the/ink-claude-code-dream-darwin-arm64` | `sha512-O+l4mTi2Mm/b2QUFuayCGx1yZWXG9y1w9HaoOCJFzNGrGP1fB4bx3Zle6bavuTEbitouduG6QJqtFm9X6ZjcTw==` |
| `@glide-the/ink-claude-code-dream-darwin-x64` | `sha512-B4ojA8SubyAZMnuX2LOUaPbKR7+ncxkZlicaKLW/7HxvN/6ypqZjyvaoiY3mrJx4nm4YdwkDwMPB075Up0/Peg==` |
| `@glide-the/ink-claude-code-dream-linux-arm64` | `sha512-SYCfcUFIrGojFjlDrL3TdOJ9u8kd2FuVeW7bQPDoHee7pJ1FOtxNnUgCoh2/G+iuuuotpfym3YqJT1i7zoNFrw==` |
| `@glide-the/ink-claude-code-dream-linux-x64` | `sha512-D9T3eysxXQtqPJ1qC1QYx4varUbbcuNVOhybVjh7+GmaZ0H/ZmWh/P28K2vMRi4QrUb9UVztzpr4yYcmLZDZgQ==` |
