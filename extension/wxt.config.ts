import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  outDir: '.output',
  modules: [],
  manifest: {
    name: 'UnderPixel',
    description: 'Record, replay, and understand what\'s behind the pixels',
    version: '0.1.0',
    permissions: [
      'nativeMessaging',
      'tabs',
      'activeTab',
      'scripting',
      'debugger',
      'offscreen',
      'storage',
      'webNavigation',
    ],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: ['content-recorder.js'],
        matches: ['<all_urls>'],
      },
    ],
  },
  runner: {
    binaries: {
      chrome: 'google-chrome',
    },
  },
});
