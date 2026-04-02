import { register } from './register.js';

// Only auto-register on global install
const isGlobal = process.env.npm_config_global === 'true' ||
  (process.env.PNPM_HOME && process.argv[1]?.includes('global'));

if (isGlobal) {
  console.log('Global install detected — auto-registering Native Messaging host...\n');
  register().catch((err) => {
    console.error('Auto-registration failed:', err.message);
    console.log('Run `underpixel-bridge register` manually to retry.');
  });
} else {
  console.log(
    'UnderPixel Bridge installed locally.\n' +
    'For Native Messaging, install globally: npm install -g underpixel-bridge\n' +
    'Or run: npx underpixel-bridge register',
  );
}
