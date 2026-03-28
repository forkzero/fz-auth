import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { 'kms/index': 'src/kms/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['fz-auth-core', '@aws-sdk/client-kms'],
})
