document.addEventListener('DOMContentLoaded', () => {
  const connectBtn = document.getElementById('connect');
  const connectTabBtn = document.getElementById('connect-tab');
  const focusTabBtn = document.getElementById('focus-tab');
  const disconnectBtn = document.getElementById('disconnect');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const lastErrorDiv = document.getElementById('last-error');

  // Control Panel Elements
  const controlPanel = document.getElementById('control-panel');
  const aiStatusBadge = document.getElementById('ai-status-badge');
  const aiStatusText = document.getElementById('ai-status-text');
  const controlStateDesc = document.getElementById('control-state-desc');
  const btnPause = document.getElementById('btn-pause');
  const btnResume = document.getElementById('btn-resume');
  const btnTakeControl = document.getElementById('btn-take-control');
  const btnReturnControl = document.getElementById('btn-return-control');
  const btnStop = document.getElementById('btn-stop');
  const btnReset = document.getElementById('btn-reset');

  function updateControlPanel(state) {
    if (!state) return;

    // Reset buttons visibility
    btnPause.classList.add('hidden');
    btnResume.classList.add('hidden');
    btnTakeControl.classList.add('hidden');
    btnReturnControl.classList.add('hidden');
    btnStop.classList.add('hidden');
    btnReset.classList.add('hidden');

    // Reset status badge classes
    aiStatusBadge.className = 'status-indicator';

    if (state === 'IDLE') {
      aiStatusText.textContent = 'CONNECTED';
      aiStatusBadge.classList.add('badge-idle');
      controlStateDesc.textContent = 'AI is idle, waiting for commands.';
      btnPause.classList.remove('hidden');
      btnTakeControl.classList.remove('hidden');
      btnStop.classList.remove('hidden');
    } else if (state === 'AGENT_RUNNING') {
      aiStatusText.textContent = 'AI WORKING';
      aiStatusBadge.classList.add('badge-working');
      controlStateDesc.textContent = 'AI controls this tab.';
      btnPause.classList.remove('hidden');
      btnTakeControl.classList.remove('hidden');
      btnStop.classList.remove('hidden');
    } else if (state === 'HUMAN_TAKEOVER') {
      aiStatusText.textContent = 'WAITING FOR YOU';
      aiStatusBadge.classList.add('badge-waiting');
      controlStateDesc.textContent = 'Human takeover requested.';
      btnStop.classList.remove('hidden');
    } else if (state === 'HUMAN_CONTROLLED') {
      aiStatusText.textContent = 'HUMAN CONTROL';
      aiStatusBadge.classList.add('badge-controlling');
      controlStateDesc.textContent = 'Human control active.';
      btnReturnControl.classList.remove('hidden');
      btnStop.classList.remove('hidden');
    } else if (state === 'AGENT_RESUMING') {
      aiStatusText.textContent = 'AI RESUMING';
      aiStatusBadge.classList.add('badge-working');
      controlStateDesc.textContent = 'AI is resuming control.';
      btnStop.classList.remove('hidden');
    } else if (state === 'BLOCKED') {
      aiStatusText.textContent = 'BLOCKED';
      aiStatusBadge.classList.add('badge-blocked');
      controlStateDesc.textContent = 'AI execution is blocked.';
      btnResume.classList.remove('hidden');
      btnReset.classList.remove('hidden');
    } else if (state === 'COMPLETED') {
      aiStatusText.textContent = 'COMPLETED';
      aiStatusBadge.classList.add('badge-completed');
      controlStateDesc.textContent = 'AI execution completed successfully.';
      btnReset.classList.remove('hidden');
    } else if (state === 'FAILED') {
      aiStatusText.textContent = 'FAILED';
      aiStatusBadge.classList.add('badge-failed');
      controlStateDesc.textContent = 'AI execution failed.';
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

      // Update top-level connection badge
      if (isServerConnected) {
        statusBadge.className = 'connection-status badge-connected';
        statusText.textContent = 'CONNECTED';
      } else {
        statusBadge.className = 'connection-status badge-disconnected';
        statusText.textContent = 'DISCONNECTED';
      }

      if (isServerConnected && statusResponse.controlState) {
        controlPanel.classList.remove('hidden');
        updateControlPanel(statusResponse.controlState);
      } else {
        controlPanel.classList.add('hidden');
      }

      // Update telemetry server URL
      const serverUrlElement = document.getElementById('telemetry-server-url');
      if (serverUrlElement) {
        serverUrlElement.textContent = (statusResponse && statusResponse.url) ? statusResponse.url : 'ws://127.0.0.1:29100';
      }

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        if (!currentTab) return;

        // Update controlled domain text
        const urlElement = document.getElementById('controlled-url');
        if (urlElement) {
          try {
            const urlObj = new URL(currentTab.url);
            urlElement.textContent = urlObj.hostname + urlObj.pathname;
          } catch (_) {
            urlElement.textContent = currentTab.url || 'No active tab';
          }
        }

        chrome.storage.local.get('connectedTabId', (data) => {
          const connectedTabId = Number.isInteger(data.connectedTabId) ? data.connectedTabId : null;
          const hasConnectedTab = Boolean(connectedTabId);

          // Update telemetry Tab ID
          const tabIdElement = document.getElementById('telemetry-tab-id');
          if (tabIdElement) {
            tabIdElement.textContent = connectedTabId ? `TAB ${connectedTabId}` : 'NONE';
          }

          if (connectedTabId && connectedTabId !== currentTab.id) {
            connectBtn.classList.add('hidden');
            connectTabBtn.classList.remove('hidden');
            focusTabBtn.classList.remove('hidden');
            disconnectBtn.classList.toggle('hidden', !hasConnectedTab);
            statusText.textContent = 'ACTIVE ON ANOTHER TAB';
            statusBadge.className = 'connection-status badge-connected';
          } else if (connectedTabId === currentTab.id) {
            connectBtn.classList.add('hidden');
            connectTabBtn.classList.add('hidden');
            focusTabBtn.classList.add('hidden');
            disconnectBtn.classList.toggle('hidden', !hasConnectedTab);

            if (isServerConnected) {
              statusText.textContent = 'ACTIVE ON THIS TAB';
              statusBadge.className = 'connection-status badge-connected';
            } else {
              statusText.textContent = 'DISCONNECTED';
              statusBadge.className = 'connection-status badge-disconnected';
            }
          } else {
            connectBtn.classList.remove('hidden');
            connectTabBtn.classList.add('hidden');
            focusTabBtn.classList.add('hidden');
            disconnectBtn.classList.add('hidden');
            statusText.textContent = 'DISCONNECTED';
            statusBadge.className = 'connection-status badge-disconnected';
          }
        });
      });
    });
  }

  function refreshAuditLog() {
    chrome.runtime.sendMessage({ cmd: 'getAuditLog' }, (response) => {
      const container = document.getElementById('audit-log-container');
      if (!container) return;
      if (!response || !response.auditLog || response.auditLog.length === 0) {
        container.innerHTML = '<div class="audit-empty">No audit records</div>';
        return;
      }

      container.innerHTML = '';
      response.auditLog.forEach(record => {
        const time = new Date(record.timestamp).toLocaleTimeString([], { hour12: false });
        let div = document.createElement('div');
        div.className = 'audit-record';

        let html = `<div style="color: #555;">${time}</div>`;
        html += `<div style="color: #ccc;"><strong>${record.action}</strong> &rarr; <span style="color: #eee;">"${record.target || 'N/A'}"</span></div>`;

        let riskColor = '#888';
        if (record.risk === 'LOW') riskColor = '#B6FF00';
        if (record.risk === 'MEDIUM') riskColor = '#FFA500';
        if (record.risk === 'HIGH') riskColor = '#FF5555';

        html += `<div style="color: #666;">Risk: <span style="color: ${riskColor};">${record.risk}</span></div>`;
        html += `<div style="color: #666;">Decision: <span style="color: #aaa;">${record.decision}</span></div>`;
        html += `<div style="color: #666;">Execution: <span style="color: #aaa;">${record.execution}</span></div>`;
        html += `<div style="color: #666;">Outcome: <span style="color: #aaa;">${record.outcome || 'N/A'}</span></div>`;

        div.innerHTML = html;
        container.appendChild(div);
      });
    });
  }

  function initPolicyUI() {
    const policyDraftOnly = document.getElementById('policy-draft-only');
    const policySensitiveFields = document.getElementById('policy-sensitive-fields');
    const policyBlockedDomains = document.getElementById('policy-blocked-domains');
    const policyTrustedDomains = document.getElementById('policy-trusted-domains');

    if (!policyDraftOnly || !policySensitiveFields || !policyBlockedDomains || !policyTrustedDomains) return;

    function loadPolicySettings() {
      chrome.storage.local.get('mirailensPolicy', (data) => {
        const policy = data.mirailensPolicy || {
          draftOnly: false,
          trustedDomains: ['localhost', '127.0.0.1'],
          blockedDomains: ['attacker.com', 'evil.com'],
          sensitiveFieldDecision: 'ALWAYS_ASK'
        };

        policyDraftOnly.checked = !!policy.draftOnly;
        policySensitiveFields.value = policy.sensitiveFieldDecision || 'ALWAYS_ASK';
        policyBlockedDomains.value = (policy.blockedDomains || []).join(', ');
        policyTrustedDomains.value = (policy.trustedDomains || []).join(', ');
      });
    }

    function savePolicySettings() {
      const policy = {
        draftOnly: policyDraftOnly.checked,
        sensitiveFieldDecision: policySensitiveFields.value,
        blockedDomains: policyBlockedDomains.value.split(',').map(s => s.trim()).filter(Boolean),
        trustedDomains: policyTrustedDomains.value.split(',').map(s => s.trim()).filter(Boolean)
      };
      chrome.storage.local.set({ mirailensPolicy: policy });
    }

    policyDraftOnly.addEventListener('change', savePolicySettings);
    policySensitiveFields.addEventListener('change', savePolicySettings);
    policyBlockedDomains.addEventListener('input', savePolicySettings);
    policyTrustedDomains.addEventListener('input', savePolicySettings);

    loadPolicySettings();
    window.refreshPolicyUIInputs = loadPolicySettings;
  }

  refreshUIForActiveTab();
  refreshAuditLog();
  initPolicyUI();

  const btnClearAudit = document.getElementById('btn-clear-audit');
  if (btnClearAudit) {
    btnClearAudit.addEventListener('click', () => {
      chrome.runtime.sendMessage({ cmd: 'clearAuditLog' }, () => {
        refreshAuditLog();
      });
    });
  }

  connectBtn.addEventListener('click', () => {
    statusText.textContent = 'CONNECTING...';
    statusBadge.className = 'connection-status badge-disconnected';
    setLastError('');
    chrome.runtime.sendMessage({ cmd: 'connect' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        statusText.textContent = 'CONNECTION FAILED';
        statusBadge.className = 'connection-status badge-disconnected';
        setLastError(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Failed to connect');
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.storage.local.set({ connectedTabId: tabs[0].id }, () => {
          statusText.textContent = 'ACTIVE ON THIS TAB';
          statusBadge.className = 'connection-status badge-connected';
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
        statusText.textContent = 'SWITCHED TO THIS TAB';
        statusBadge.className = 'connection-status badge-connected';
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
    chrome.runtime.sendMessage({ cmd: 'disconnect' });
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

  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) {
    btnSettings.addEventListener('click', () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('options.html'));
      }
    });
  const btnHistory = document.getElementById('btn-history');
  if (btnHistory) {
    btnHistory.addEventListener('click', () => {
      chrome.tabs.create({ url: 'history.html' });
    });
  }}

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
    if (area === 'local') {
      if (changes.connectedTabId) {
        refreshUIForActiveTab();
      }
      if (changes.mirailensPolicy && window.refreshPolicyUIInputs) {
        window.refreshPolicyUIInputs();
      }
    }
  });
});
