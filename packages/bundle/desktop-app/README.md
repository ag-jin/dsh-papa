# @deepseek-ai/dsh-desktop-app

English | [中文](README.zh.md)

Desktop application patch layer over `@deepseek-ai/dsh-base`. It composes the existing storage, workspace, API, client feature, and desktop-runtime rows without a DSH HTTP listener, static-file fallback, browser startup, browser runtime, client HMR owner, or HTTP-origin trust configuration. The Electron application owns packaged-resource delivery and renderer process lifecycle. The patch selects the native directory-picker provider directly, keeps the connection core while omitting its browser transport effects, and mounts the `standard` agent preset while disabling base model-facing rows so each desktop session owns its agent plane.

## Model Experience

### Embedded transport

#### What the model sees

None. `@deepseek-ai/dsh-desktop-app` selects application composition only; the composed agent and provider packages own model requests.

#### Token effect

None. The patch adds no prompt content or provider request fields.

#### KV Cache effect

None. The patch does not alter model-visible request prefixes.

## Known Limitations and Deferred Work

- **Electron process ownership** — packaged renderer delivery, preload IPC, and macOS window lifecycle live in the desktop application package rather than this Cordis patch.
- **Browser development workflow** — browser serving and client HMR remain a browser-surface concern and are intentionally absent from the desktop composition.
