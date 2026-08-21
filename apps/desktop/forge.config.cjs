/** Electron Forge configuration for the unsigned macOS arm64 desktop package. */

const { join } = require('node:path')

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
        if (!filePath.includes('.app/')) {
          return {
            entitlements: [
              'com.apple.security.cs.allow-jit',
              'com.apple.security.cs.disable-library-validation',
            ],
          }
        }
        return {}
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
