#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { register } from './scripts/register.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    force: { type: 'boolean', short: 'f' },
    browser: { type: 'string', short: 'b' },
  },
});

const command = positionals[0];

if (values.help || !command) {
  console.log(`
underpixel-bridge — MCP server bridge for UnderPixel Chrome extension

Commands:
  register    Register as Chrome Native Messaging host
  start       Start the bridge (used by Native Messaging, not usually called directly)

Options:
  -f, --force          Force re-registration
  -b, --browser <b>    Register for specific browser (chrome, chromium)
  -h, --help           Show this help
  `);
  process.exit(0);
}

switch (command) {
  case 'register':
    await register({
      force: values.force ?? false,
      browser: values.browser as 'chrome' | 'chromium' | undefined,
    });
    break;

  case 'start':
    // Dynamic import to start the bridge
    await import('./index.js');
    break;

  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
