import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'stdio-bridge': 'src/stdio-bridge.ts',
    'scripts/postinstall': 'src/scripts/postinstall.ts',
    'scripts/register': 'src/scripts/register.ts',
  },
  format: 'esm',
  target: 'node20',
  platform: 'node',
  dts: false,
  sourcemap: true,
  clean: true,
  banner: {
    // Shim for __dirname/__filename in ESM
    js: `
import { fileURLToPath as __UP_fileURLToPath } from 'url';
import { dirname as __UP_dirname } from 'path';
const __filename = __UP_fileURLToPath(import.meta.url);
const __dirname = __UP_dirname(__filename);
    `.trim(),
  },
});
