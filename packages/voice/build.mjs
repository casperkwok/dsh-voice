import { build } from 'esbuild'

const shared = {
  bundle: true,
  sourcemap: true,
  target: 'es2022',
  external: ['@deepseek-ai/*', 'react', 'react-dom'],
}

await build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  platform: 'node',
  format: 'esm',
})

await build({
  ...shared,
  entryPoints: ['src/client.tsx'],
  outfile: 'lib/client.js',
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
})

console.log('built lib/index.js and lib/client.js')
