import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { NATIVE_HOST_NAME, EXTENSION_ID } from 'underpixel-shared';

interface RegisterOptions {
  force?: boolean;
  browser?: 'chrome' | 'chromium';
}

/**
 * Get the path to the run_host wrapper script for this platform.
 * In production (npm installed), this is alongside the built JS files.
 */
function getHostPath(): string {
  const ext = platform() === 'win32' ? 'bat' : 'sh';
  // Look for wrapper script next to the built dist
  const scriptDir = resolve(__dirname, '..', 'scripts');
  const wrapper = join(scriptDir, `run_host.${ext}`);
  if (existsSync(wrapper)) return wrapper;

  // Fallback: use node directly with the index.js entry
  const indexPath = resolve(__dirname, 'index.js');
  return indexPath;
}

function createManifest(hostPath: string): object {
  const manifest: Record<string, unknown> = {
    name: NATIVE_HOST_NAME,
    description: 'UnderPixel Bridge — MCP server for visual-API correlation',
    path: hostPath,
    type: 'stdio',
  };

  manifest.allowed_origins = [`chrome-extension://${EXTENSION_ID}/`];

  return manifest;
}

function getUserManifestPaths(browser?: 'chrome' | 'chromium'): string[] {
  const home = homedir();
  const fileName = `${NATIVE_HOST_NAME}.json`;
  const paths: string[] = [];
  const os = platform();

  const browsers = browser ? [browser] : ['chrome', 'chromium'];

  for (const b of browsers) {
    if (os === 'win32') {
      const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
      const base = b === 'chrome' ? 'Google\\Chrome' : 'Chromium';
      paths.push(join(appData, base, 'NativeMessagingHosts', fileName));
    } else if (os === 'darwin') {
      const base = b === 'chrome' ? 'Google/Chrome' : 'Chromium';
      paths.push(
        join(home, 'Library', 'Application Support', base, 'NativeMessagingHosts', fileName),
      );
    } else {
      // Linux
      const base = b === 'chrome' ? 'google-chrome' : 'chromium';
      paths.push(join(home, '.config', base, 'NativeMessagingHosts', fileName));
    }
  }

  return paths;
}

function writeWindowsRegistry(manifestPath: string, browser: string): void {
  if (platform() !== 'win32') return;

  const base = browser === 'chrome' ? 'Google\\Chrome' : 'Chromium';
  const regPath = `HKCU\\Software\\${base}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;

  try {
    execSync(`reg add "${regPath}" /ve /t REG_SZ /d "${manifestPath}" /f`, {
      stdio: 'pipe',
    });
    console.log(`  Registry entry created: ${regPath}`);
  } catch {
    console.warn(`  Warning: Failed to create registry entry at ${regPath}`);
  }
}

export async function register(options: RegisterOptions = {}): Promise<void> {
  console.log('UnderPixel Bridge — Native Messaging Host Registration\n');

  // Save the current Node.js path so the wrapper script can find it
  const nodePathFile = resolve(__dirname, '..', 'node_path.txt');
  writeFileSync(nodePathFile, process.execPath, 'utf-8');
  console.log(`Node path saved: ${process.execPath}`);

  const hostPath = getHostPath();
  const manifest = createManifest(hostPath);
  const manifestJson = JSON.stringify(manifest, null, 2);
  const paths = getUserManifestPaths(options.browser);

  console.log(`Host path: ${hostPath}`);
  console.log(`Registering for: ${options.browser || 'chrome + chromium'}\n`);

  for (const manifestPath of paths) {
    if (existsSync(manifestPath) && !options.force) {
      console.log(`  Already registered: ${manifestPath} (use --force to overwrite)`);
      continue;
    }

    const dir = dirname(manifestPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(manifestPath, manifestJson, 'utf-8');
    console.log(`  Written: ${manifestPath}`);

    // Windows needs registry entry too
    const browser = manifestPath.includes('Chromium') ? 'chromium' : 'chrome';
    writeWindowsRegistry(manifestPath, browser);
  }

  // On Unix, make wrapper executable
  if (platform() !== 'win32' && hostPath.endsWith('.sh') && existsSync(hostPath)) {
    try {
      execSync(`chmod +x "${hostPath}"`, { stdio: 'pipe' });
    } catch {
      // Ignore
    }
  }

  console.log('\nRegistration complete!');
  console.log('Next: Load the UnderPixel extension in Chrome and click Connect.');
}
