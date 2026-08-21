# macOS Desktop GUI Design

English | [中文](2026-08-17-macos-desktop-gui-design.zh.md)

## Objective

Deliver an installable Mac-first DSH desktop application for local independent developers.

The application provides native windowing, menus, keyboard access, lifecycle management, notifications, file dialogs, and workspace restoration while preserving DSH's existing Cordis runtime and plugin-composed React client.

The browser GUI remains the cross-platform surface. The desktop application must not become a separate implementation of sessions, agent execution, tools, or conversation rendering.

## Product Decisions

The first release targets Apple silicon systems running macOS 14 or later, matching the repository's existing macOS runtime distribution. Intel support, mobile clients, Mac App Store distribution, automatic updates, cross-device synchronization, and custom themes are outside this release.

DSH Desktop is distributed as an ad-hoc signed application and compressed disk image, without Developer ID signing or notarization. The Mac App Store sandbox is incompatible with the broad local filesystem and shell access that DSH exposes under explicit user-controlled permissions.

A workspace is the primary window identity. Sessions belong to a workspace. A developer can open several workspace windows, and the application restores their workspace, selected session, sidebar state, inspector state, and panel widths after relaunch.

The first release optimizes a local development loop: open a workspace, create or resume a session, configure a run, execute work, review files and changes, approve or stop operations, and resume interrupted work. Team, SSH, task-board, and other plugin capabilities remain available as explicit destinations or contextual inspector views rather than defining the default navigation.

## Architecture

A new apps/desktop Electron application owns the macOS application lifecycle and loads the packaged renderer through the privileged `dsh-app://renderer/` scheme; authorized client bundles load through `dsh-client://bundle/`.

The Electron main process owns a single application-level DesktopRuntimeSupervisor. It activates a desktop Cordis composition that retains DSH's session persistence, agent loop, API dispatcher, and enabled tools but omits the HTTP web server and frontend static server. The desktop composition never exposes an application LAN listener.

The main process owns native menus, window creation and restoration, file and directory dialogs, Finder actions, notifications, shutdown coordination, and runtime diagnostics. It is the only desktop layer with Node and Electron privileges.

A context-isolated preload script exposes a small, versioned bridge. It has one request-response operation for the existing API envelope protocol and two downlink subscriptions corresponding to the established session and host event streams. The bridge carries data, cancellation, and lifecycle signals only. It does not provide arbitrary IPC, filesystem paths, shell execution, or Electron module access to the renderer.

The renderer adds a desktop implementation of the existing API-client transport abstraction. It adapts the preload request-response operation and downlinks to the same client connection service used by the browser UI. Session projection, streaming accumulation, conversation nodes, UI slots, tool views, and feature plugins remain unchanged above that transport.

The desktop runtime lives in the Electron main process for the first release. It remains application-scoped rather than window-scoped, so a renderer reload or one window closing cannot terminate another window's active run. Moving it to a child process is a later architectural choice requiring a separate lifecycle and authentication design.

## Request and Event Flow

A renderer action creates an existing client RPC request through the desktop API client.

The preload bridge forwards the serializable request to the Electron main process.

The main process dispatches the request to DSH's in-process API handler and returns the serialized response through the preload bridge.

DSH session and host events travel in the opposite direction through the main-process subscriptions, preload bridge, desktop API client, connection service, and existing session manager. The renderer rebuilds its visible state only from these events and the established session projections.

Each window owns its connection generation. A disconnect clears live assumptions for that window, preserves already projected history, and requires a fresh host description plus both event streams before the window reports readiness again.

## State and Persistence

DSH remains the owner of agent configuration, credentials references, session logs, workspace records, tool results, background jobs, and durable run facts. The desktop application must reuse the configured DSH home so the CLI, browser surface, and desktop surface can access the same user-owned settings and sessions.

Electron user-data storage holds only desktop-local state: window geometry, window-to-workspace restoration, selected session, expanded navigation groups, panel visibility, panel widths, and notification preferences. Desktop-owned state excludes DSH credentials, session transcript copies, and tool output caches.

Desktop credential storage is not exposed to the renderer. The first release continues through the configured DSH credentials provider. A future Keychain integration is a credentials-provider implementation, so it preserves existing credential references and avoids a renderer-specific secrets API.

An active run has one visible state: running, waiting for approval, waiting for user, completed, failed, or cancelled. Its next possible action is visible with the state. A crash or forced exit records no invented successful completion; an unsettled run is restored as interrupted and can be inspected or resumed only through DSH's real lifecycle data.

## Mac Workbench Experience

The window uses a hideable source list, primary conversation area, and hideable contextual inspector.

The source list groups workspaces and their sessions. Stable plugin destinations, such as SSH or the task board, live in a deliberate secondary section rather than competing with workspace and session navigation.

The conversation area contains the execution timeline and a focused composer. The composer accepts input, attachments, and send or stop actions. Preset or mode, model, expert or team selection, permission, and workspace scope appear in one compact execution-context row or inspector. Each setting states whether it applies to the next run, the current session, the workspace, or the user profile.

The inspector presents Files, Changes, tool output, activity, and applicable expert or team information. It follows the selected conversation item, can be shown or hidden with a command, supports a persistent width, and remains secondary to the conversation by default.

The toolbar contains only high-frequency actions: toggle source list, workspace or session title, run state, command search, inspector toggle, and one clear primary action. The native menu bar contains the complete command set, including workspace and session actions, navigation commands, stop or cancel, and standard edit actions.

Keyboard access follows macOS conventions and Full Keyboard Access. Application shortcuts use the Cmd family only for frequent DSH commands. A command palette supplements menus and never replaces them.

The interface follows system light or dark appearance, accessibility text sizing, contrast settings, reduced motion, and VoiceOver. It uses system typography and semantic theme tokens. Translucency is reserved for window chrome; conversation, code, diffs, and tool output remain high-contrast working surfaces.

When DSH is not frontmost, notifications announce only runs that completed, failed, or require approval. They never expose model output, prompts, tool arguments, credentials, or file contents.

## Plugin Integration

Browser-side feature plugins continue to compose UI through the existing client slot system. A desktop-aware feature can contribute a destination, a command, or an inspector view through declared integration points; it cannot create its own window chrome, unrestricted Electron bridge, or persistent renderer singleton.

The desktop shell curates menu and toolbar commands from declared commands. A plugin menu contribution carries a stable command identity, visible label, enabled condition, and invocation callback. The main process owns placement into native macOS menus and refuses unrecognized bridge operations.

Existing plugin surfaces remain compatible. The browser GUI continues to render them without desktop-only behavior, while desktop-specific enhancements are capability-checked rather than assumed from user-agent detection.

## Security and Recovery

The BrowserWindow uses context isolation, no Node integration, sandboxed renderer settings, and a restrictive Content Security Policy. The preload script is the sole renderer-to-main path.

The Electron main process validates bridge operation names, request fields, sender window identity, cancellation ownership, and event subscription kinds before dispatching to DSH. It does not accept renderer-supplied file paths for privileged host actions when the API can use existing capability references instead.

DSH permission policy remains authoritative for shell execution, filesystem access, and tool approval. The desktop UI explains the target workspace, selected permission level, scope, and expected persistence before the user approves an escalation. The desktop shell cannot broaden a DSH permission decision.

Startup failures show a diagnostics screen with a redacted error summary and the actions Retry, Open Local Logs, and Quit. Renderer failures restart only the renderer and reconnect it to the existing runtime. Runtime failures transition every window to a recoverable unavailable state; the supervisor can restart the runtime after recording the failure and invalidating stale event subscriptions.

Application shutdown first rejects new work, records window state, asks the runtime to settle durable state within a bounded interval, then closes windows and disposes the runtime. A forced quit interrupts active work but must never report an interrupted operation as complete.

## Verification

Unit coverage verifies the runtime supervisor lifecycle, startup failure handling, bounded shutdown, window restoration, native-menu command dispatch, preload request mapping, event ordering, cancellation, and rejection of unrecognized IPC channels.

Client coverage continues through pnpm run test:gui. It includes desktop connection status, execution-context scope labels, run-state actions, inspector visibility, restored layout state, approval presentation, and no-access fallback behavior.

Desktop integration tests launch the Electron application against a fixture DSH composition. They create and resume a session, exercise streaming events, run a controlled tool, open the Files and Changes inspector, deliver an approval request, stop a run, simulate a renderer reload, and verify that no LAN socket is opened.

macOS smoke coverage launches the packaged application on Apple silicon, checks application startup, standard keyboard commands, native file selection, window restoration, recovery after a runtime restart, ad-hoc signature integrity, and disk-image integrity.

## Acceptance Criteria

A local developer can install and launch the application without manually starting dsh web.

The application can open a workspace, create or resume a session, run DSH tools under the existing permission policy, and display streaming output in the primary conversation view.

No listening TCP or UDP port is owned by DSH Desktop.

Closing one window does not terminate active work in another window. Relaunch restores windows and preserves durable DSH sessions without duplicating transcript data into Electron storage.

A renderer process has no Node access and cannot invoke an undeclared native or DSH operation.

The browser GUI remains a supported cross-platform client of the same DSH runtime and session data.
