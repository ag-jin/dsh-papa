/** Embedded DSH runtime and fixed desktop bridge authority exports. */

export type {
  ApiProxyAdapter,
  DesktopBridgeRuntime,
  DesktopDownlinkPublisher,
  DesktopRequest,
  DesktopResponse,
  DesktopRuntimeFactory,
  DesktopRuntimeOptions,
  DesktopRuntimeSnapshot,
  DesktopRuntimeState,
} from './runtime.ts'
export { DesktopRuntimeSupervisor } from './runtime.ts'
export type {
  DesktopApiFetchHandler,
  DesktopApiResponder,
} from './api-proxy-adapter.ts'
export {
  createApiProxyAdapter,
  createEmbeddedApiProxyAdapter,
} from './api-proxy-adapter.ts'
export type { DesktopBridgeAuthorityRuntime } from './bridge.ts'
export { DesktopBridgeAuthority } from './bridge.ts'
export { apply, inject, name } from './plugin.ts'
