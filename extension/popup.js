document.addEventListener('DOMContentLoaded', () => {
  const connectBtn = document.getElementById('connect');
  const connectTabBtn = document.getElementById('connect-tab');
  const focusTabBtn = document.getElementById('focus-tab');
  const disconnectBtn = document.getElementById('disconnect');
  const statusDiv = document.getElementById('status');
  const lastErrorDiv = document.getElementById('last-error');
  
  // Control Panel Elements
  const controlPanel = document.getElementById('control-panel');
  const aiStatusDiv = document.getElementById('ai-status');
  const btnPause = document.getElementById('btn-pause');
  const btnResume = document.getElementById('btn-resume');
  const btnTakeControl = document.getElementById('btn-take-control');
  const btnReturnControl = document.getElementById('btn-return-control');
  const btnStop = document.getElementById('btn-stop');
  const btnReset = document.getElementById('btn-reset');

  function updateControlPanel(state) {
    if (!state) return;
    
    btnPause.classList.add('hidden');
    btnResume.classList.add('hidden');
    btnTakeControl.classList.add('hidden');
    btnReturnControl.classList.add('hidden');
    btnStop.classList.add('hidden');
    btnReset.classList.add('hidden');

    if (state === 'RUNNING') {
      aiStatusDiv.textContent = 'Status: 🟢 AI ACTIVE';
      btnPause.classList.remove('hidden');
      btnTakeControl.classList.remove('hidden');
      btnStop.classList.remove('hidden');
    } else if (state === 'PAUSED') {
      aiStatusDiv.textContent = 'Status: 🟡 AI PAUSED';
      btnResume.classList.remove('hidden');
      btnTakeControl.classList.remove('hidden');
      btnStop.classList.remove('hidden');
    } else if (state === 'HUMAN_CONTROL') {
      aiStatusDiv.textContent = 'Status: 🔵 HUMAN CONTROL';
      btnReturnControl.classList.remove('hidden');
      btnStop.classList.remove('hidden');
    } else if (state === 'STOPPED') {
      aiStatusDiv.textContent = 'Status: 🔴 AI STOPPED';
      btnReset.classList.remove('hidden');
    }
  }

  function setLastError(text) {
    if (!text) {
      lastErrorDiv.textContent = '';
      lastErrorDiv.classList.add('hidden');
      return;
    }
    lastErrorDiv.textContent = text;
    lastErrorDiv.classList.remove('hidden');
  }

  function refreshUIForActiveTab() {
    chrome.runtime.sendMessage({ cmd: 'getStatus' }, (statusResponse) => {
      const isServerConnected = Boolean(statusResponse && statusResponse.status === 'connected');
      
      if (isServerConnected && statusResponse.controlState) {
        controlPanel.classList.remove('hidden');
        updateControlPanel(statusResponse.controlState);
      } else {
        controlPanel.classList.add('hidden');
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        if (!currentTab) return;

        chrome.storage.local.get('connectedTabId', (data) => {
          const connectedTabId = Number.isInteger(data.connectedTabId) ? data.connectedTabId : null;
          const hasConnectedTab = Boolean(connectedTabId);

          if (connectedTabId && connectedTabId !== currentTab.id) {
            connectBtn.classList.add('hidden');
            connectTabBtn.classList.remove('hidden');
            focusTabBtn.classList.remove('hidden');
            disconnectBtn.classList.toggle('hidden', !hasConnectedTab);
            statusDiv.textContent = 'Connected on another tab';
            statusDiv.className = 'status-connected';
          } else if (connectedTabId === currentTab.id) {
            connectBtn.classList.add('hidden');
            connectTabBtn.classList.add('hidden');
            focusTabBtn.classList.add('hidden');
            disconnectBtn.classList.toggle('hidden', !hasConnectedTab);
            
            if (isServerConnected) {
              statusDiv.textContent = 'Connected on this tab';
              statusDiv.className = 'status-connected';
            } else {
              statusDiv.textContent = 'Disconnected';
              statusDiv.className = 'status-disconnected';
            }
          } else {
            connectBtn.classList.remove('hidden');
            connectTabBtn.classList.add('hidden');
            focusTabBtn.classList.add('hidden');
            disconnectBtn.classList.add('hidden');
            statusDiv.textContent = 'Disconnected';
            statusDiv.className = 'status-disconnected';
          }
        });
      });
    });
  }

  refreshUIForActiveTab();

  connectBtn.addEventListener('click', () => {
    statusDiv.textContent = 'Connecting...';
    statusDiv.className = 'status-disconnected';
    setLastError('');
    chrome.runtime.sendMessage({ cmd: 'connect' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        statusDiv.textContent = 'Connection failed';
        statusDiv.className = 'status-disconnected';
        setLastError(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Failed to connect');
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.storage.local.set({ connectedTabId: tabs[0].id }, () => {
          statusDiv.textContent = 'Connected on this tab';
          statusDiv.className = 'status-connected';
          connectBtn.classList.add('hidden');
          connectTabBtn.classList.add('hidden');
          focusTabBtn.classList.add('hidden');
          refreshUIForActiveTab();
        });
      });
    });
  });

  connectTabBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.storage.local.set({ connectedTabId: tabs[0].id }, () => {
        statusDiv.textContent = 'Switched connection to this tab';
        statusDiv.className = 'status-connected';
        connectBtn.classList.add('hidden');
        connectTabBtn.classList.add('hidden');
        focusTabBtn.classList.add('hidden');
        disconnectBtn.classList.remove('hidden');
      });
    });
  });

  focusTabBtn.addEventListener('click', () => {
    chrome.storage.local.get('connectedTabId', (data) => {
      if (data.connectedTabId) {
        chrome.tabs.update(data.connectedTabId, { active: true });
        chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { focused: true });
      }
    });
  });

  disconnectBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ cmd: 'disconnect' }, (_response) => {
      chrome.storage.local.remove('connectedTabId', () => {
        statusDiv.textContent = 'Disconnected';
        statusDiv.className = 'status-disconnected';
        refreshUIForActiveTab();
      });
    });
  });

  function sendControlAction(action) {
    chrome.runtime.sendMessage({ cmd: 'control_action', action }, () => {
      refreshUIForActiveTab();
    });
  }

  btnPause.addEventListener('click', () => sendControlAction('PAUSE'));
  btnResume.addEventListener('click', () => sendControlAction('RESUME'));
  btnTakeControl.addEventListener('click', () => sendControlAction('TAKE_CONTROL'));
  btnReturnControl.addEventListener('click', () => sendControlAction('RETURN_CONTROL'));
  btnStop.addEventListener('click', () => sendControlAction('EMERGENCY_STOP'));
  btnReset.addEventListener('click', () => sendControlAction('RESET_STOP'));

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.status) {
      if (message.controlState) {
        updateControlPanel(message.controlState);
      }
      
      if (['Connected', 'Disconnected', 'WebSocket error', 'Failed to open WebSocket'].includes(message.status)) {
        refreshUIForActiveTab();
      }
    }
  });

  chrome.tabs.onActivated.addListener(() => {
    refreshUIForActiveTab();
  });

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (tab.active && changeInfo.status === 'complete') {
      refreshUIForActiveTab();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.connectedTabId) {
      refreshUIForActiveTab();
    }
  });
});
