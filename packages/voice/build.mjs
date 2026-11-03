import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

const PKG_ID = '@dsh-voice/voice'
mkdirSync('lib', { recursive: true })

const shared = {
  bundle: true,
  sourcemap: true,
  target: 'es2022',
  logLevel: 'info',
}

await build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  platform: 'node',
  format: 'esm',
  external: ['@deepseek-ai/*', 'sherpa-onnx-node', 'ws'],
})

await build({
  ...shared,
  entryPoints: ['src/client.tsx'],
  outfile: 'lib/client.js',
  platform: 'browser',
  format: 'cjs',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/*'],
  banner: {
    js:
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG_ID)}, factory: (require) => {\n` +
      'var module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: 'return module.exports; } });',
  },
})

console.log('built lib/index.js and lib/client.js')
