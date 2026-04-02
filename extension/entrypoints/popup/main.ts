const statusEl = document.getElementById('status')!;
const serverInfoEl = document.getElementById('server-info')!;
const captureBtn = document.getElementById('capture-btn')! as HTMLButtonElement;
const captureStats = document.getElementById('capture-stats')!;
const mcpConfig = document.getElementById('mcp-config')!;
const mcpJson = document.getElementById('mcp-json')!;

let capturing = false;

// Read connection state
async function updateState() {
  const state = await chrome.storage.local.get([
    'connected',
    'serverPort',
    'captureActive',
    'activeSessionId',
  ]);

  if (state.connected && state.serverPort) {
    statusEl.textContent = 'Connected';
    statusEl.className = 'status connected';
    serverInfoEl.textContent = `Bridge on port ${state.serverPort}`;
    captureBtn.disabled = false;

    // Show MCP config
    mcpConfig.classList.remove('hidden');
    mcpJson.textContent = JSON.stringify(
      {
        mcpServers: {
          underpixel: {
            type: 'streamableHttp',
            url: `http://127.0.0.1:${state.serverPort}/mcp`,
          },
        },
      },
      null,
      2,
    );
  } else {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'status disconnected';
    serverInfoEl.textContent = 'Bridge not connected. Install: npm i -g underpixel-bridge';
    captureBtn.disabled = true;
    mcpConfig.classList.add('hidden');
  }

  if (state.captureActive) {
    capturing = true;
    captureBtn.textContent = 'Stop Capture';
    captureBtn.classList.add('capturing');
    captureStats.classList.remove('hidden');
  } else {
    capturing = false;
    captureBtn.textContent = 'Start Capture';
    captureBtn.classList.remove('capturing');
    captureStats.classList.add('hidden');
  }
}

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;

  try {
    if (capturing) {
      // Send stop to background
      await chrome.runtime.sendMessage({
        type: 'underpixel-popup-action',
        action: 'stop-capture',
      });
    } else {
      await chrome.runtime.sendMessage({
        type: 'underpixel-popup-action',
        action: 'start-capture',
      });
    }
  } catch (err) {
    console.error('Popup action failed:', err);
  }

  // Refresh state after a brief delay
  setTimeout(updateState, 500);
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.connected || changes.serverPort || changes.captureActive) {
    updateState();
  }
});

// Initial state
updateState();
