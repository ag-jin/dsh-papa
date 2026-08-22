/** Electron Forge configuration for the ad-hoc signed macOS arm64 desktop package. */

const { basename, join } = require('node:path')

const electronProcessEntitlements = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.disable-library-validation',
]
const pluginHelperEntitlements = [
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.cs.allow-unsigned-executable-memory',
]

module.exports = {
  outDir: process.env.DSH_DESKTOP_FORGE_OUT ?? join(__dirname, 'out'),
  packagerConfig: {
    appBundleId: 'ai.deepseek.dsh',
    appCategoryType: 'public.app-category.developer-tools',
    derefSymlinks: true,
    asar: {
      unpack: 'package.json',
      unpackDir: 'node_modules',
    },
    extraResource: ['config', 'renderer'],
    name: 'DSH',
    osxSign: {
      identity: '-',
      identityValidation: false,
      preAutoEntitlements: false,
      optionsForFile: filePath => {
        if (!filePath.endsWith('.app')) return {}
        return {
          entitlements: basename(filePath) === 'DSH Helper (Plugin).app'
            ? pluginHelperEntitlements
            : electronProcessEntitlements,
        }
      },
    },
    prune: false,
  },
  rebuildConfig: {
    force: true,
    mode: 'sequential',
  },
  makers: [],
}
