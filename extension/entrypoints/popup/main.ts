const statusEl = document.getElementById('status')!;
const serverInfoEl = document.getElementById('server-info')!;
const captureSection = document.getElementById('capture-section')!;
const captureBtn = document.getElementById('capture-btn')! as HTMLButtonElement;
const captureStats = document.getElementById('capture-stats')!;
const replayBtn = document.getElementById('replay-btn')! as HTMLButtonElement;
const setupSection = document.getElementById('setup-section')!;
const dataSection = document.getElementById('data-section')!;
const mcpCmd = document.getElementById('mcp-cmd')!;
const mcpJson = document.getElementById('mcp-json')!;

let capturing = false;

async function updateState() {
  const state = await chrome.storage.local.get(['connected', 'serverPort', 'captureActive']);

  if (state.connected && state.serverPort) {
    statusEl.textContent = 'Connected';
    statusEl.className = 'status connected';
    serverInfoEl.textContent = `Bridge running on port ${state.serverPort}`;

    // Show connected sections
    captureSection.classList.remove('hidden');
    setupSection.classList.remove('hidden');
    dataSection.classList.remove('hidden');

    const url = `http://127.0.0.1:${state.serverPort}/mcp`;
    mcpCmd.textContent = `claude mcp add underpixel --scope user --transport http ${url}`;
    mcpJson.textContent = JSON.stringify(
      {
        mcpServers: {
          underpixel: { type: 'streamableHttp', url },
        },
      },
      null,
      2,
    );
  } else {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'status disconnected';
    serverInfoEl.innerHTML =
      'Bridge not connected.<br>' +
      '<span style="color:#a0aec0">Run: <b>npm install -g underpixel-bridge</b></span>';

    captureSection.classList.add('hidden');
    setupSection.classList.add('hidden');
    dataSection.classList.add('hidden');
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

  // Show replay button if there are sessions
  chrome.runtime.sendMessage(
    { type: 'underpixel-popup-action', action: 'has-sessions' },
    (response) => {
      if (response?.hasSessions) {
        replayBtn.classList.remove('hidden');
      } else {
        replayBtn.classList.add('hidden');
      }
    },
  );
}

// Capture toggle
captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({
      type: 'underpixel-popup-action',
      action: capturing ? 'stop-capture' : 'start-capture',
    });
  } catch (err) {
    console.error('Popup action failed:', err);
  }
  setTimeout(() => {
    captureBtn.disabled = false;
    updateState();
  }, 500);
});

// Copy buttons
function copyToClipboard(text: string, btn: HTMLButtonElement) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = original;
    }, 1500);
  });
}

document.getElementById('copy-cmd-btn')!.addEventListener('click', (e) => {
  copyToClipboard(mcpCmd.textContent || '', e.target as HTMLButtonElement);
});

document.getElementById('copy-json-btn')!.addEventListener('click', (e) => {
  copyToClipboard(mcpJson.textContent || '', e.target as HTMLButtonElement);
});

// View Replay
replayBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({
    type: 'underpixel-popup-action',
    action: 'open-replay',
  });
  window.close();
});

// Clear all data
const clearBtn = document.getElementById('clear-btn')! as HTMLButtonElement;
clearBtn.addEventListener('click', async () => {
  if (!confirm('Delete all captured sessions and data? This cannot be undone.')) return;
  clearBtn.disabled = true;
  clearBtn.textContent = 'Clearing...';
  try {
    await chrome.runtime.sendMessage({
      type: 'underpixel-popup-action',
      action: 'clear-all-data',
    });
    clearBtn.textContent = 'Cleared!';
    replayBtn.classList.add('hidden');
    setTimeout(() => {
      clearBtn.textContent = 'Clear All Data';
      clearBtn.disabled = false;
    }, 1500);
  } catch {
    clearBtn.textContent = 'Clear All Data';
    clearBtn.disabled = false;
  }
});

// Watch for changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.connected || changes.serverPort || changes.captureActive) {
    updateState();
  }
});

updateState();
