const POLICY_KEY = 'mirailensPolicy';
const DEFAULT_POLICY = {
  draftOnly: false,
  trustedDomains: ['localhost', '127.0.0.1'],
  blockedDomains: ['attacker.com', 'evil.com'],
  sensitiveFieldDecision: 'ALWAYS_ASK'
};

document.addEventListener('DOMContentLoaded', () => {
  // Policy controls
  const policyDraftOnly = document.getElementById('policy-draft-only');
  const policySensitiveFields = document.getElementById('policy-sensitive-fields');
  const policyExplanation = document.getElementById('policy-explanation');

  // Domain controls
  const blockedDomainsList = document.getElementById('blocked-domains-list');
  const inputAddBlocked = document.getElementById('input-add-blocked');
  const btnAddBlocked = document.getElementById('btn-add-blocked');

  const trustedDomainsList = document.getElementById('trusted-domains-list');
  const inputAddTrusted = document.getElementById('input-add-trusted');
  const btnAddTrusted = document.getElementById('btn-add-trusted');

  // Connection controls
  const connectionServerUrl = document.getElementById('connection-server-url');
  const btnSaveConnection = document.getElementById('btn-save-connection');
  const connectionStatusPill = document.getElementById('connection-status-pill');

  // Toast
  const toast = document.getElementById('toast');
  let toastTimeoutId = null;

  let currentPolicy = { ...DEFAULT_POLICY };

  function showToast(message = 'Policy updated') {
    if (toastTimeoutId) {
      clearTimeout(toastTimeoutId);
    }
    toast.innerHTML = `<span>✓</span> ${message}`;
    toast.classList.add('show');
    toastTimeoutId = setTimeout(() => {
      toast.classList.remove('show');
    }, 1500);
  }

  // Update dynamic explanation text
  function updateSensitiveFieldsExplanation(value) {
    if (value === 'ALWAYS_DENY') {
      policyExplanation.textContent = 'Sensitive-field actions are blocked automatically.';
    } else {
      policyExplanation.textContent = 'Ask for approval before interacting with sensitive fields.';
    }
  }

  // Query and render Connection Status
  function refreshConnectionStatus() {
    chrome.runtime.sendMessage({ cmd: 'getStatus' }, (response) => {
      const isConnected = Boolean(response && response.status === 'connected');
      if (isConnected) {
        connectionStatusPill.className = 'status-pill active';
        connectionStatusPill.innerHTML = '<span>●</span> CONNECTED';
      } else {
        connectionStatusPill.className = 'status-pill inactive';
        connectionStatusPill.innerHTML = '<span>●</span> DISCONNECTED';
      }
    });
  }

  // Render domain lists as custom chips
  function renderDomainChips(container, domainsArray, type) {
    container.innerHTML = '';
    if (!domainsArray || domainsArray.length === 0) {
      container.innerHTML = '<div style="color: #666; font-size: 11px; padding: 4px 0;">No domains configured</div>';
      return;
    }

    domainsArray.forEach((domain, idx) => {
      const chip = document.createElement('div');
      chip.className = `domain-chip ${type}`;

      const dot = document.createElement('span');
      dot.className = 'status-dot';

      const text = document.createTextNode(domain);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'domain-chip-remove';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', `Remove ${domain}`);
      removeBtn.addEventListener('click', () => {
        domainsArray.splice(idx, 1);
        savePolicy(() => {
          renderDomainChips(container, domainsArray, type);
        });
      });

      chip.appendChild(dot);
      chip.appendChild(text);
      chip.appendChild(removeBtn);
      container.appendChild(chip);
    });
  }

  // Load settings from storage
  chrome.storage.local.get([POLICY_KEY, 'serverUrl'], (data) => {
    // 1. Policy Loading
    if (data[POLICY_KEY]) {
      try {
        const parsed = typeof data[POLICY_KEY] === 'string' ? JSON.parse(data[POLICY_KEY]) : data[POLICY_KEY];
        if (parsed && typeof parsed === 'object') {
          currentPolicy = {
            draftOnly: !!parsed.draftOnly,
            trustedDomains: Array.isArray(parsed.trustedDomains) ? parsed.trustedDomains.map(String) : DEFAULT_POLICY.trustedDomains,
            blockedDomains: Array.isArray(parsed.blockedDomains) ? parsed.blockedDomains.map(String) : DEFAULT_POLICY.blockedDomains,
            sensitiveFieldDecision: ['ALWAYS_ASK', 'ALWAYS_DENY'].includes(parsed.sensitiveFieldDecision) ? parsed.sensitiveFieldDecision : 'ALWAYS_ASK'
          };
        }
      } catch (e) {
        console.warn('Failed to parse policy:', e);
      }
    }

    // Assign UI values
    policyDraftOnly.checked = currentPolicy.draftOnly;
    policySensitiveFields.value = currentPolicy.sensitiveFieldDecision;
    updateSensitiveFieldsExplanation(currentPolicy.sensitiveFieldDecision);

    renderDomainChips(blockedDomainsList, currentPolicy.blockedDomains, 'blocked');
    renderDomainChips(trustedDomainsList, currentPolicy.trustedDomains, 'trusted');

    // 2. Server URL Loading
    connectionServerUrl.value = data.serverUrl || 'ws://127.0.0.1:29100';

    // 3. Connection Status
    refreshConnectionStatus();
  });

  // Save policy helper
  function savePolicy(callback) {
    chrome.storage.local.set({ [POLICY_KEY]: currentPolicy }, () => {
      showToast('Policy updated');
      if (callback) callback();
    });
  }

  // Event Listeners for Policy
  policyDraftOnly.addEventListener('change', () => {
    currentPolicy.draftOnly = policyDraftOnly.checked;
    savePolicy();
  });

  policySensitiveFields.addEventListener('change', () => {
    currentPolicy.sensitiveFieldDecision = policySensitiveFields.value;
    updateSensitiveFieldsExplanation(policySensitiveFields.value);
    savePolicy();
  });

  // Event Listeners for Domain Addition
  function handleAddDomain(inputEl, domainsArray, container, type) {
    const val = inputEl.value.trim();
    if (!val) return;

    // Simple deduplication
    if (!domainsArray.includes(val)) {
      domainsArray.push(val);
      savePolicy(() => {
        renderDomainChips(container, domainsArray, type);
      });
    }
    inputEl.value = '';
  }

  btnAddBlocked.addEventListener('click', () => {
    handleAddDomain(inputAddBlocked, currentPolicy.blockedDomains, blockedDomainsList, 'blocked');
  });

  inputAddBlocked.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAddDomain(inputAddBlocked, currentPolicy.blockedDomains, blockedDomainsList, 'blocked');
    }
  });

  btnAddTrusted.addEventListener('click', () => {
    handleAddDomain(inputAddTrusted, currentPolicy.trustedDomains, trustedDomainsList, 'trusted');
  });

  inputAddTrusted.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAddDomain(inputAddTrusted, currentPolicy.trustedDomains, trustedDomainsList, 'trusted');
    }
  });

  // Save connection config
  if (btnSaveConnection) {
    btnSaveConnection.addEventListener('click', () => {
      const val = connectionServerUrl.value.trim() || 'ws://127.0.0.1:29100';
      chrome.storage.local.set({ serverUrl: val }, () => {
        showToast('Settings saved');
        // Refresh connection status immediately after saving new endpoint
        setTimeout(refreshConnectionStatus, 150);
      });
    });
  }

  // Listen for background connection status updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.status) {
      refreshConnectionStatus();
    }
  });
});
