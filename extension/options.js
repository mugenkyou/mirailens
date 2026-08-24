const POLICY_KEY = 'mirailensPolicy';
const DEFAULT_POLICY = {
  draftOnly: false,
  trustedDomains: ['localhost', '127.0.0.1'],
  blockedDomains: ['attacker.com', 'evil.com'],
  sensitiveFieldDecision: 'ALWAYS_ASK'
};

document.addEventListener('DOMContentLoaded', () => {
  const policyDraftOnly = document.getElementById('policy-draft-only');
  const policySensitiveFields = document.getElementById('policy-sensitive-fields');
  const policyBlockedDomains = document.getElementById('policy-blocked-domains');
  const policyTrustedDomains = document.getElementById('policy-trusted-domains');
  const connectionServerUrl = document.getElementById('connection-server-url');
  const btnSaveConnection = document.getElementById('btn-save-connection');
  const toast = document.getElementById('toast');

  let currentPolicy = { ...DEFAULT_POLICY };

  function showToast() {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 1500);
  }

  // Load settings
  chrome.storage.local.get([POLICY_KEY, 'serverUrl'], (data) => {
    // 1. Policy
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
    
    policyDraftOnly.checked = currentPolicy.draftOnly;
    policySensitiveFields.value = currentPolicy.sensitiveFieldDecision;
    policyBlockedDomains.value = currentPolicy.blockedDomains.join(', ');
    policyTrustedDomains.value = currentPolicy.trustedDomains.join(', ');

    // 2. Server URL
    connectionServerUrl.value = data.serverUrl || 'ws://127.0.0.1:29100';
  });

  // Save policy helper
  function savePolicy() {
    chrome.storage.local.set({ [POLICY_KEY]: currentPolicy }, () => {
      showToast();
    });
  }

  // Event Listeners
  policyDraftOnly.addEventListener('change', () => {
    currentPolicy.draftOnly = policyDraftOnly.checked;
    savePolicy();
  });

  policySensitiveFields.addEventListener('change', () => {
    currentPolicy.sensitiveFieldDecision = policySensitiveFields.value;
    savePolicy();
  });

  policyBlockedDomains.addEventListener('change', () => {
    currentPolicy.blockedDomains = policyBlockedDomains.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    savePolicy();
  });

  policyTrustedDomains.addEventListener('change', () => {
    currentPolicy.trustedDomains = policyTrustedDomains.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    savePolicy();
  });

  if (btnSaveConnection) {
    btnSaveConnection.addEventListener('click', () => {
      const val = connectionServerUrl.value.trim() || 'ws://127.0.0.1:29100';
      chrome.storage.local.set({ serverUrl: val }, () => {
        showToast();
      });
    });
  }
});
