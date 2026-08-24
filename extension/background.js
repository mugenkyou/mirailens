const STATES = {
  IDLE: 'IDLE',
  AGENT_RUNNING: 'AGENT_RUNNING',
  HUMAN_TAKEOVER: 'HUMAN_TAKEOVER',
  HUMAN_CONTROLLED: 'HUMAN_CONTROLLED',
  AGENT_RESUMING: 'AGENT_RESUMING',
  BLOCKED: 'BLOCKED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
};

const TRANSITION_MATRIX = {
  [STATES.IDLE]: [STATES.AGENT_RUNNING, STATES.HUMAN_TAKEOVER, STATES.HUMAN_CONTROLLED, STATES.BLOCKED, STATES.COMPLETED, STATES.FAILED],
  [STATES.AGENT_RUNNING]: [STATES.IDLE, STATES.HUMAN_TAKEOVER, STATES.HUMAN_CONTROLLED, STATES.BLOCKED, STATES.FAILED],
  [STATES.HUMAN_TAKEOVER]: [STATES.HUMAN_CONTROLLED, STATES.BLOCKED],
  [STATES.HUMAN_CONTROLLED]: [STATES.AGENT_RESUMING, STATES.BLOCKED],
  [STATES.AGENT_RESUMING]: [STATES.AGENT_RUNNING, STATES.IDLE, STATES.HUMAN_TAKEOVER, STATES.BLOCKED],
  [STATES.BLOCKED]: [STATES.AGENT_RESUMING, STATES.IDLE],
  [STATES.COMPLETED]: [STATES.IDLE],
  [STATES.FAILED]: [STATES.IDLE]
};

const CONTROL_STATE_KEY = 'controlState';
const POLICY_KEY = 'mirailensPolicy';

// Default policy settings
const DEFAULT_POLICY = {
  draftOnly: false,
  trustedDomains: ['localhost', '127.0.0.1'],
  blockedDomains: ['attacker.com', 'evil.com'],
  sensitiveFieldDecision: 'ALWAYS_ASK' // 'ALWAYS_ASK' | 'ALWAYS_DENY'
};

let controlState = STATES.IDLE; // default, overridden by init
let activeAction = null; // { id, type, auditRecord, reject }
let currentPolicy = { ...DEFAULT_POLICY };

const auditLog = [];

function recordAudit(record) {
  try {
    record.id = record.id || crypto.randomUUID();
    record.timestamp = record.timestamp || Date.now();
    auditLog.unshift(record);
    if (auditLog.length > 100) {
      auditLog.length = 100;
    }
  } catch (e) {
    console.warn("[Phase6] Audit logging failed:", e);
  }
}

function clearAuditLog() {
  auditLog.length = 0;
}

let isEmergencyStop = false;
let pausedBy = null;
let connectedTabId = null;

function setEmergencyStop(value) {
  isEmergencyStop = value;
  chrome.storage.local.set({ isEmergencyStop: value }, () => {});
}

function setPausedBy(value) {
  pausedBy = value;
  chrome.storage.local.set({ pausedBy: value }, () => {});
}

function logControlTransition(prev, next, source) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${prev} → ${next} source=${source}`);
}

function persistControlState(state, source) {
  chrome.storage.local.set({ [CONTROL_STATE_KEY]: state }, () => {});
  logControlTransition(controlState, state, source);
  controlState = state;
}

function matchDomain(pattern, hostname) {
  if (!pattern || !hostname) return false;
  const lowerPattern = pattern.toLowerCase().trim();
  const lowerHostname = hostname.toLowerCase().trim();

  if (lowerPattern === '*') return true;

  if (lowerPattern.startsWith('*.')) {
    const base = lowerPattern.substring(2);
    return lowerHostname === base || lowerHostname.endsWith('.' + base);
  }

  return lowerHostname === lowerPattern;
}

function isDomainBlocked(hostname) {
  if (!hostname) return false;
  return currentPolicy.blockedDomains.some(pattern => matchDomain(pattern, hostname));
}

function isDomainTrusted(hostname) {
  if (!hostname) return false;
  return currentPolicy.trustedDomains.some(pattern => matchDomain(pattern, hostname));
}

function evaluatePolicy(hostname, actionType, props) {
  // 1. Blocked domains
  if (isDomainBlocked(hostname)) {
    return { decision: 'ALWAYS_DENY', reasonCode: 'BLOCKED_DOMAIN', message: 'Action blocked because this domain is blocked by extension policy.' };
  }

  // 2. Draft-only mode
  if (currentPolicy.draftOnly && props && props.isSubmit) {
    return { decision: 'ALWAYS_DENY', reasonCode: 'DRAFT_ONLY', message: 'Form submission is blocked because Draft-Only Mode is active.' };
  }

  // 3. Sensitive fields
  if (props && props.isSensitiveField) {
    const decision = currentPolicy.sensitiveFieldDecision || 'ALWAYS_ASK';
    return { decision, reasonCode: 'SENSITIVE_FIELD', message: `Action on sensitive field is ${decision} by policy.` };
  }

  // 4. Default rules based on domain trust
  if (isDomainTrusted(hostname)) {
    return { decision: 'AUTO_EXECUTE', reasonCode: 'TRUSTED_DOMAIN', message: 'Action auto-executed on trusted domain.' };
  }

  // 5. Unknown domains
  return { decision: 'ALWAYS_ASK', reasonCode: 'UNKNOWN_POLICY', message: 'Approval required for unknown domain.' };
}

async function inspectElementProperties(tabId, selector) {
  if (!tabId || !selector) return null;
  try {
    return await exec(tabId, (sel) => {
      try {
        const el = document.querySelector(sel);
        if (!el) return { exists: false };

        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
        const name = (el.getAttribute('name') || '').toLowerCase();
        const id = (el.getAttribute('id') || '').toLowerCase();
        const className = el.className ? String(el.className).toLowerCase() : '';
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();

        // Sensitive field keywords
        const sensitiveKeywords = ['password', 'passwd', 'pin', 'cvv', 'cvc', 'creditcard', 'cardnumber', 'ccnum', 'ssn', 'socialsecurity'];
        const isSensitiveField =
          type === 'password' ||
          ['cc-number', 'cc-csc', 'cc-exp', 'current-password', 'new-password', 'one-time-code'].includes(autocomplete) ||
          sensitiveKeywords.some(kw => name.includes(kw) || id.includes(kw) || className.includes(kw) || ariaLabel.includes(kw) || placeholder.includes(kw));

        // Form submission detection
        const form = el.closest('form');
        const isSubmit =
          type === 'submit' ||
          tag === 'button' && (type === '' || type === 'submit') ||
          (form && (name.includes('submit') || id.includes('submit') || className.includes('submit')));

        return {
          exists: true,
          tag,
          type,
          isSensitiveField,
          isSubmit,
          hasForm: !!form
        };
      } catch (_) {
        return { exists: false, error: true };
      }
    }, [selector]);
  } catch (_) {
    return null;
  }
}

function initControlState() {
  chrome.storage.local.get([CONTROL_STATE_KEY, 'isEmergencyStop', 'pausedBy', 'connectedTabId', POLICY_KEY, 'serverUrl'], (data) => {
    isEmergencyStop = !!data.isEmergencyStop;
    pausedBy = data.pausedBy || null;
    connectedTabId = data.connectedTabId || null;
    if (data.serverUrl) {
      serverUrl = data.serverUrl;
    }

    // Load policy
    if (data[POLICY_KEY]) {
      try {
        const parsed = typeof data[POLICY_KEY] === 'string' ? JSON.parse(data[POLICY_KEY]) : data[POLICY_KEY];
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.trustedDomains) && Array.isArray(parsed.blockedDomains)) {
          currentPolicy = {
            draftOnly: !!parsed.draftOnly,
            trustedDomains: parsed.trustedDomains.map(String),
            blockedDomains: parsed.blockedDomains.map(String),
            sensitiveFieldDecision: ['ALWAYS_ASK', 'ALWAYS_DENY'].includes(parsed.sensitiveFieldDecision) ? parsed.sensitiveFieldDecision : 'ALWAYS_ASK'
          };
        } else {
          currentPolicy = { ...DEFAULT_POLICY };
        }
      } catch (e) {
        currentPolicy = { ...DEFAULT_POLICY };
      }
    } else {
      currentPolicy = { ...DEFAULT_POLICY };
      chrome.storage.local.set({ [POLICY_KEY]: currentPolicy }, () => {});
    }

    const stored = data[CONTROL_STATE_KEY];

    if (isEmergencyStop) {
      persistControlState(STATES.BLOCKED, 'init_emergency_stop');
    } else if (pausedBy) {
      persistControlState(STATES.BLOCKED, 'init_paused');
    } else if (!stored) {
      persistControlState(STATES.IDLE, 'init_no_state');
    } else if (stored === 'RUNNING' || stored === STATES.AGENT_RUNNING || stored === STATES.IDLE) {
      persistControlState(STATES.IDLE, 'init_to_idle');
    } else if (stored === 'STOPPED' || stored === 'PAUSED' || stored === STATES.BLOCKED) {
      persistControlState(STATES.BLOCKED, 'init_to_blocked');
    } else if (stored === 'HUMAN_CONTROL' || stored === STATES.HUMAN_CONTROLLED) {
      persistControlState(STATES.HUMAN_CONTROLLED, 'init_to_human_controlled');
    } else {
      persistControlState(stored, 'init_restore');
    }
    sendPopupStatus('Connected');
  });
}

initControlState();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.connectedTabId) {
      connectedTabId = changes.connectedTabId.newValue || null;
    }
    if (changes.isEmergencyStop) {
      isEmergencyStop = !!changes.isEmergencyStop.newValue;
    }
    if (changes.pausedBy) {
      pausedBy = changes.pausedBy.newValue || null;
    }
    if (changes.serverUrl) {
      serverUrl = changes.serverUrl.newValue || 'ws://127.0.0.1:29100';
    }
    if (changes[POLICY_KEY]) {
      const val = changes[POLICY_KEY].newValue;
      if (val) {
        try {
          const parsed = typeof val === 'string' ? JSON.parse(val) : val;
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.trustedDomains) && Array.isArray(parsed.blockedDomains)) {
            currentPolicy = {
              draftOnly: !!parsed.draftOnly,
              trustedDomains: parsed.trustedDomains.map(String),
              blockedDomains: parsed.blockedDomains.map(String),
              sensitiveFieldDecision: ['ALWAYS_ASK', 'ALWAYS_DENY'].includes(parsed.sensitiveFieldDecision) ? parsed.sensitiveFieldDecision : 'ALWAYS_ASK'
            };
          }
        } catch (_) {}
      }
    }
  }
});

function transitionTo(nextState, source) {
  const prevState = controlState;
  const allowedNext = TRANSITION_MATRIX[prevState];
  if (!allowedNext || !allowedNext.includes(nextState)) {
    console.error(`Invalid state transition: ${prevState} → ${nextState} (requested by ${source})`);
    return { success: false, reason: `Invalid transition from ${prevState} to ${nextState}` };
  }

  persistControlState(nextState, source);

  if (nextState === STATES.HUMAN_TAKEOVER || nextState === STATES.HUMAN_CONTROLLED || nextState === STATES.BLOCKED) {
    abortActiveAction(`Execution halted: transitioned to ${nextState}`);
  }

  sendPopupStatus('Connected');
  notifyServerStateChange(nextState);
  return { success: true };
}

function abortActiveAction(reason) {
  if (activeAction) {
    console.log(`Aborting active action ${activeAction.type} (${activeAction.id}) due to: ${reason}`);
    try {
      activeAction.reject(new Error(reason));
    } catch (e) {
      console.error('Error rejecting active action:', e);
    }
    activeAction = null;
  }
  for (const [tabId, pending] of pendingPreviews.entries()) {
    clearTimeout(pending.timeoutId);
    pending.reject(new Error(reason));
    exec(tabId, () => {
      const ui = document.getElementById('mirailens-preview-overlay');
      if (ui) ui.remove();
    }).catch(() => {});
  }
  pendingPreviews.clear();
}

function handleControlAction(action, source = 'ai') {
  if (action === 'EMERGENCY_STOP') {
    setEmergencyStop(true);
    if (controlState === STATES.BLOCKED) {
      return { success: true };
    }
    return transitionTo(STATES.BLOCKED, source);
  }

  if (action === 'PAUSE') {
    setPausedBy(source);
    if (controlState === STATES.BLOCKED) {
      return { success: true };
    }
    return transitionTo(STATES.BLOCKED, source);
  }

  if (action === 'TAKE_CONTROL') {
    if (controlState === STATES.HUMAN_CONTROLLED) {
      return { success: true };
    }
    const res = transitionTo(STATES.HUMAN_TAKEOVER, source);
    if (res.success) {
      return transitionTo(STATES.HUMAN_CONTROLLED, source);
    }
    return res;
  }

  if (action === 'RETURN_CONTROL') {
    if (source !== 'human' && source !== 'human_implicit') {
      return { success: false, reason: "Return control must be authorized by human." };
    }
    if (controlState === STATES.IDLE || controlState === STATES.AGENT_RUNNING) {
      return { success: true };
    }
    const res = transitionTo(STATES.AGENT_RESUMING, source);
    if (res.success) {
      return transitionTo(STATES.IDLE, source);
    }
    return res;
  }

  if (action === 'RESUME') {
    if (controlState === STATES.HUMAN_CONTROLLED || controlState === STATES.HUMAN_TAKEOVER) {
      if (source !== 'human' && source !== 'human_implicit') {
        return { success: false, reason: "Cannot resume: human holds control of the browser." };
      }
    }
    if (isEmergencyStop) {
      return { success: false, reason: "Cannot resume: Emergency Stop is active. Requires human reset." };
    }
    if (pausedBy === 'human' && source !== 'human' && source !== 'human_implicit') {
      return { success: false, reason: "Cannot resume: paused by human." };
    }

    if (controlState === STATES.IDLE || controlState === STATES.AGENT_RUNNING) {
      return { success: true };
    }
    const res = transitionTo(STATES.AGENT_RESUMING, source);
    if (res.success) {
      setPausedBy(null);
      return transitionTo(STATES.IDLE, source);
    }
    return res;
  }

  if (action === 'RESET_STOP') {
    if (source !== 'human' && source !== 'human_implicit') {
      return { success: false, reason: "Reset emergency stop must be authorized by human." };
    }
    if (controlState !== STATES.BLOCKED) {
      return { success: false, reason: `Cannot reset from state ${controlState}.` };
    }
    setEmergencyStop(false);
    setPausedBy(null);
    return transitionTo(STATES.IDLE, source);
  }

  return { success: false, reason: `Unknown control action: ${action}` };
}

let activeTabId = null;
let reconnectAttempt = 0;
let lastErrorMessage = '';
let serverUrl = 'ws://127.0.0.1:29100';
let ws = null;
const pendingPreviews = new Map();

// ---------- Chrome API helpers (callback-based, safe in MV3) ----------
function tabsQuery(queryInfo) {
  return new Promise((resolve) => chrome.tabs.query(queryInfo, (tabs) => resolve(tabs || [])));
}
function tabsUpdate(tabId, updateProps) {
  return new Promise((resolve) => chrome.tabs.update(tabId, updateProps, (tab) => resolve(tab)));
}
function scriptingExecuteScript(args) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(args, (results) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(results || []);
    });
  });
}
function windowsGetAll() {
  return new Promise((resolve) => chrome.windows.getAll({}, (wins) => resolve(wins || [])));
}

function sendPopupStatus(status) {
  try {
    chrome.runtime.sendMessage({ status, controlState }, () => {
      void chrome.runtime.lastError;
    });
  } catch (_err) {}
}

function notifyServerStateChange(state) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'control_state_changed',
      payload: { state }
    }));
  }
}

async function getActiveTabId() {
  if (!activeTabId) {
    const tabs = await tabsQuery({ active: true, currentWindow: true });
    const tab = tabs[0];
    activeTabId = tab && tab.id;
  }
  return activeTabId;
}

async function updateActiveTab() {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const tab = tabs[0];
  activeTabId = tab && tab.id;
  return activeTabId;
}

async function exec(tabId, func, args = []) {
  try {
    const results = await scriptingExecuteScript({ target: { tabId }, func, args });
    const first = results && results[0];
    return first ? first.result : null;
  } catch (error) {
    console.error('Script execution error:', error);
    return null;
  }
}

function canExecuteAIAction() {
  if (activeAction !== null) {
    return {
      allowed: false,
      reason: "Another AI action is currently in progress.",
      controlState
    };
  }
  if (controlState === STATES.IDLE || controlState === STATES.AGENT_RESUMING || controlState === STATES.AGENT_RUNNING) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `AI execution is blocked. Current state: ${controlState}`,
    controlState
  };
}

async function handleGetConsoleLogs() {
  return []; // Fallback for console logs
}

async function captureActionState(tabId, selector) {
  if (!tabId || typeof selector !== 'string' || !selector.trim()) {
    return null;
  }
  try {
    return await exec(tabId, (sel) => {
      const state = {
        url: window.location.href,
        title: document.title,
        targetExists: false,
        targetText: null,
        targetAttributes: {},
        parentText: null
      };
      if (sel) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            state.targetExists = true;
            state.targetText = (el.innerText || el.textContent || '').trim().substring(0, 200);
            const attrs = ['value', 'checked', 'disabled', 'aria-expanded', 'aria-pressed', 'href'];
            for (const attr of attrs) {
              let val = el.getAttribute(attr);
              if (val === null && attr in el) {
                val = el[attr];
              }
              if (val !== null && val !== undefined && val !== '') {
                state.targetAttributes[attr] = String(val);
              }
            }
            const parent = el.closest('form, article, main, section, div');
            if (parent) {
              state.parentText = (parent.innerText || parent.textContent || '').trim().substring(0, 500);
            }
          }
        } catch(e) {}
      }
      return state;
    }, [selector]);
  } catch (e) {
    return null;
  }
}

function verifyActionOutcome(before, after) {
  if (!before || !after) {
    return { outcome: 'UNKNOWN', before, after, reasons: ['Unable to verify post-action state.'] };
  }

  const reasons = [];
  let outcome = 'UNKNOWN';

  if (before.url !== after.url) {
    reasons.push(`URL changed from ${before.url} to ${after.url}`);
    return { outcome: 'EXPECTED_CHANGE', before, after, reasons };
  }

  if (before.targetExists && !after.targetExists) {
    reasons.push('Target element disappeared.');
    return { outcome: 'EXPECTED_CHANGE', before, after, reasons };
  }

  if (before.targetExists && after.targetExists) {
    let changed = false;
    if (before.targetText !== after.targetText) {
      reasons.push('Target text changed.');
      changed = true;
    }

    for (const key of Object.keys(before.targetAttributes)) {
      if (before.targetAttributes[key] !== after.targetAttributes[key]) {
        reasons.push(`Attribute ${key} changed.`);
        changed = true;
      }
    }

    for (const key of Object.keys(after.targetAttributes)) {
      if (before.targetAttributes[key] === undefined) {
        reasons.push(`Attribute ${key} added.`);
        changed = true;
      }
    }

    if (changed) {
      return { outcome: 'VERIFIED', before, after, reasons };
    }
  }

  if (after.parentText && before.parentText !== after.parentText) {
    const lowerAfter = after.parentText.toLowerCase();
    if (lowerAfter.includes('success') || lowerAfter.includes('saved') || lowerAfter.includes('done') || lowerAfter.includes('thank')) {
       reasons.push('Success indicator found in parent context.');
       return { outcome: 'VERIFIED', before, after, reasons };
    }
  }

  reasons.push('No observable changes detected.');
  return { outcome, before, after, reasons };
}

async function handleMCPMessage(message) {
  try {
    const { type, payload, id } = message;
    console.log('Received MCP message:', type, payload);

    if (type === 'browser_control') {
      const { action } = payload;
      const res = handleControlAction(action, 'ai');
      if (res.success) {
        sendResponse(id, type, { state: controlState });
      } else {
        sendError(id, type, { allowed: false, reason: res.reason, controlState });
      }
      return;
    }

    if (type === 'get_control_state' || type === 'get_agent_status') {
      sendResponse(id, type, {
        state: controlState,
        connectionStatus: ws && ws.readyState === WebSocket.OPEN ? 'connected' : 'disconnected',
        allowedToExecute: canExecuteAIAction().allowed
      });
      return;
    }

    if (type === 'get_policy') {
      sendResponse(id, type, { policy: currentPolicy });
      return;
    }

    if (type === 'set_policy') {
      const tabId = await getActiveTabId();
      if (!tabId) {
        sendError(id, type, "No connected tab to authorize policy modification.");
        return;
      }
      try {
        const approval = await requestHumanApproval(tabId, 'set_policy', null, JSON.stringify(payload), 'ALWAYS_ASK');
        if (approval && approval.approved) {
          const updated = {
            draftOnly: payload.draftOnly !== undefined ? !!payload.draftOnly : currentPolicy.draftOnly,
            sensitiveFieldDecision: payload.sensitiveFieldDecision !== undefined ? payload.sensitiveFieldDecision : currentPolicy.sensitiveFieldDecision,
            trustedDomains: payload.trustedDomains !== undefined ? payload.trustedDomains : currentPolicy.trustedDomains,
            blockedDomains: payload.blockedDomains !== undefined ? payload.blockedDomains : currentPolicy.blockedDomains
          };
          if (payload.addTrustedDomain) {
            if (!updated.trustedDomains.includes(payload.addTrustedDomain)) updated.trustedDomains.push(payload.addTrustedDomain);
          }
          if (payload.removeTrustedDomain) {
            updated.trustedDomains = updated.trustedDomains.filter(d => d !== payload.removeTrustedDomain);
          }
          if (payload.addBlockedDomain) {
            if (!updated.blockedDomains.includes(payload.addBlockedDomain)) updated.blockedDomains.push(payload.addBlockedDomain);
          }
          if (payload.removeBlockedDomain) {
            updated.blockedDomains = updated.blockedDomains.filter(d => d !== payload.removeBlockedDomain);
          }
          chrome.storage.local.set({ [POLICY_KEY]: updated }, () => {});
          sendResponse(id, type, { success: true, policy: updated });
        } else {
          sendError(id, type, "Human denied policy modification request.");
        }
      } catch (e) {
        sendError(id, type, e.message || String(e));
      }
      return;
    }

    // Centralized browser action dispatch
    const browserHandlers = {
      browser_navigate: handleNavigate,
      browser_go_back: handleGoBack,
      browser_go_forward: handleGoForward,
      browser_wait: handleWait,
      browser_click: handleClick,
      browser_type: handleType,
      browser_hover: handleHover,
      browser_snapshot: handleSnapshot,
      browser_screenshot: handleScreenshot,
      browser_get_console_logs: handleGetConsoleLogs,
      getUrl: handleGetUrl,
      getTitle: handleGetTitle,
    };

    const handler = browserHandlers[type];
    if (!handler) {
      sendError(id, type, { allowed: false, reason: 'Unknown browser action', controlState });
      return;
    }

    // Enforce control gate before executing any browser action
    const gate = canExecuteAIAction();
    if (!gate.allowed) {
      sendError(id, type, gate);
      return;
    }

    const isConsequential = ['browser_click', 'browser_type', 'browser_navigate'].includes(type);
    const shouldVerify = type === 'browser_click' || type === 'browser_type';
    const rawSelector = payload ? (payload.element || payload.selector) : null;
    const selector = typeof rawSelector === 'string' && rawSelector.trim() ? rawSelector : null;

    let props = null;
    let targetHostname = '';
    let tabId = null;

    if (isConsequential) {
      tabId = await getActiveTabId();
      let activeHostname = '';
      if (tabId) {
        const tab = await tabsQuery({ active: true, currentWindow: true }).then(t => t[0]);
        if (tab && tab.url) {
          try {
            activeHostname = new URL(tab.url).hostname;
          } catch (_) {}
        }
      }

      targetHostname = activeHostname;
      if (type === 'browser_navigate' && payload && payload.url) {
        try {
          targetHostname = new URL(payload.url).hostname;
        } catch (_) {}
      }

      // Policy Gate Check
      if (shouldVerify && selector && tabId) {
        props = await inspectElementProperties(tabId, selector);
      }

      const evalResult = evaluatePolicy(targetHostname, type, props);
      if (evalResult.decision === 'ALWAYS_DENY') {
        console.warn(`[MiraiLens] Policy ALWAYS_DENY triggered: ${evalResult.reasonCode}`);
        sendError(id, type, {
          allowed: false,
          decision: evalResult.decision,
          reasonCode: evalResult.reasonCode,
          message: evalResult.message,
          controlState: STATES.BLOCKED
        });
        transitionTo(STATES.BLOCKED, 'policy_engine');
        return;
      }
    }

    let beforeState = null;
    let auditRecord = null;

    if (shouldVerify) {
      const isSensitive = props && props.isSensitiveField;
      const targetText = isSensitive ? `${selector} [Sensitive Value Masked]` : selector;

      auditRecord = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        action: type,
        target: targetText,
        risk: 'UNKNOWN',
        decision: 'UNKNOWN',
        execution: 'UNKNOWN',
        outcome: null,
        reasons: [],
        urlBefore: null,
        urlAfter: null
      };
      recordAudit(auditRecord);
      console.log('[Phase6] Audit started');

      if (selector) {
        console.log(`[Phase5] Verification enabled: ${type}`);
        console.log('[Phase5] Capturing before state');
        beforeState = await captureActionState(tabId, selector);
      } else {
        console.log('[Phase5] Verification skipped: invalid selector');
      }
    } else {
      console.log(`[Phase5] Verification skipped for: ${type}`);
    }

    // Transition to AGENT_RUNNING if we are IDLE or AGENT_RESUMING
    if (controlState === STATES.IDLE || controlState === STATES.AGENT_RESUMING) {
      const transitioned = transitionTo(STATES.AGENT_RUNNING, 'start_action');
      if (!transitioned.success) {
        sendError(id, type, { allowed: false, reason: transitioned.reason, controlState });
        return;
      }
    }

    let actionRejected = false;
    const actionPromise = new Promise(async (resolve, reject) => {
      activeAction = {
        id,
        type,
        auditRecord,
        reject: (err) => {
          actionRejected = true;
          reject(err);
        }
      };

      try {
        const result = await handler(payload);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    });

    try {
      const result = await actionPromise;
      activeAction = null;

      if (auditRecord) {
        console.log(`[Phase6] Risk recorded: ${auditRecord.risk}`);
        if (result && result.approved === false) {
           auditRecord.decision = auditRecord.decision !== 'UNKNOWN' ? auditRecord.decision : 'HUMAN_DENIED';
           auditRecord.execution = 'NOT_EXECUTED';
           auditRecord.outcome = 'DENIED';
        } else if (result !== false) {
           auditRecord.execution = 'EXECUTED';
        } else {
           auditRecord.execution = 'NOT_EXECUTED';
        }
        console.log(`[Phase6] Decision recorded: ${auditRecord.decision}`);
        console.log(`[Phase6] Execution recorded: ${auditRecord.execution}`);
      }

      let verification = null;
      if (shouldVerify && selector) {
        console.log('[Phase5] Action completed');
        if (beforeState && result !== false && !(result && result.approved === false)) {
          await new Promise(r => setTimeout(r, 1500));
          console.log('[Phase5] Capturing after state');
          const currentTabId = await getActiveTabId();
          const afterState = await captureActionState(currentTabId, selector);
          verification = verifyActionOutcome(beforeState, afterState);
          console.log('[Phase5] Verification outcome:', verification.outcome);
        } else if (result && result.approved === false) {
          // Human denied action, do not verify
        } else {
          verification = { outcome: 'UNKNOWN', reasons: ['Unable to verify post-action state.'] };
        }
      }

      if (verification && auditRecord) {
        auditRecord.outcome = verification.outcome;
        if (verification.reasons) auditRecord.reasons = [...verification.reasons];
        if (verification.before && verification.before.url) auditRecord.urlBefore = verification.before.url;
        if (verification.after && verification.after.url) auditRecord.urlAfter = verification.after.url;
        console.log(`[Phase6] Outcome recorded: ${auditRecord.outcome}`);
      }

      if (controlState === STATES.AGENT_RUNNING) {
        transitionTo(STATES.IDLE, 'finish_action');
      }

      let finalResult = result;
      if (verification) {
        if (typeof result === 'object' && result !== null) {
          finalResult = { ...result, verification };
        } else {
          finalResult = { original_result: result, verification };
        }
      }

      sendResponse(id, type, finalResult);
      if (auditRecord) {
        console.log('[Phase6] Audit completed');
      }
    } catch (e) {
      activeAction = null;
      if (auditRecord) {
        const msg = e.message || String(e);
        if (msg.includes('HUMAN_TAKEOVER')) {
           auditRecord.decision = 'HUMAN_TAKEOVER';
           auditRecord.execution = 'NOT_EXECUTED';
           auditRecord.outcome = 'UNKNOWN';
        } else {
           auditRecord.execution = 'FAILED';
           auditRecord.outcome = 'FAILED';
           auditRecord.reasons.push(msg);
        }
        console.log(`[Phase6] Decision recorded: ${auditRecord.decision}`);
        console.log(`[Phase6] Execution recorded: ${auditRecord.execution}`);
        console.log('[Phase6] Audit completed (catch)');
      }
      sendError(id, type, { allowed: false, reason: e.message || String(e), controlState });
      if (!actionRejected && controlState === STATES.AGENT_RUNNING) {
        transitionTo(STATES.IDLE, 'action_failed');
      }
    }
    return;
  } catch (error) {
    console.error('Error handling MCP message:', error);
    lastErrorMessage = String(error?.message || error);
    sendError(message.id, message.type, lastErrorMessage);
  }
}

function sendResponse(id, type, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (id) {
      ws.send(JSON.stringify({ id, result: data }));
    } else {
      ws.send(JSON.stringify({ type: `${type}_result`, data, timestamp: Date.now() }));
    }
  }
}

function sendError(id, type, error) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (id) {
      ws.send(JSON.stringify({ id, error: typeof error === 'string' ? error : JSON.stringify(error) }));
    } else {
      ws.send(JSON.stringify({ type: `${type}_result`, error: typeof error === 'string' ? error : JSON.stringify(error), timestamp: Date.now() }));
    }
  }
}async function requestHumanApproval(tabId, actionType, selector, details, policyDecision) {
  const actionId = 'tok_' + Math.random().toString(36).substr(2, 9);

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (pendingPreviews.has(tabId)) {
        pendingPreviews.delete(tabId);
        exec(tabId, () => {
          const ui = document.getElementById('mirailens-preview-overlay');
          if (ui) ui.remove();
        }).catch(() => {});
        reject(new Error("Human approval timed out."));
      }
    }, 30000); // 30s timeout

    tabsQuery({ active: true, currentWindow: true }).then(async (tabs) => {
      const currentTab = tabs[0];
      const currentUrl = currentTab ? currentTab.url : '';

      pendingPreviews.set(tabId, { actionId, status: 'PENDING', resolve, reject, timeoutId, targetSelector: selector, actionType, url: currentUrl });

      try {
        const result = await exec(tabId, (actId, actType, sel, dls, polDec) => {
          return new Promise((res) => {
            let target = null;
            let rect = { left: 100, top: 100, width: 200, height: 100 }; // default

            if (sel) {
              const elements = document.querySelectorAll(sel);
              if (elements.length === 0) {
                 return res({ error: "Target selector matched zero elements." });
              }
              if (elements.length > 1) {
                 return res({ error: "Target selector matched multiple elements." });
              }
              target = elements[0];
              target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
              rect = target.getBoundingClientRect();
            }

            let riskLevel = 'LOW';
            let reasons = [];

            if (actType === 'click' || actType === 'type') {
              if (target) {
                const text = (target.innerText || target.textContent || '').toLowerCase().trim();
                const tag = target.tagName.toLowerCase();
                const typeAttr = (target.getAttribute('type') || '').toLowerCase();
                const href = (target.getAttribute('href') || '').toLowerCase();
                const form = target.closest('form');

                const highKeywords = ['delete', 'remove', 'erase', 'destroy', 'terminate', 'close account', 'delete account', 'cancel subscription', 'pay', 'purchase', 'buy', 'transfer', 'withdraw', 'send money', 'confirm payment'];
                const mediumKeywords = ['submit', 'save', 'update', 'change', 'edit', 'confirm', 'send', 'apply', 'publish', 'upload', 'create'];

                if (highKeywords.some(kw => text.includes(kw) || href.includes(kw))) {
                  riskLevel = 'HIGH';
                  reasons.push('Contains high-risk keyword.');
                } else if (mediumKeywords.some(kw => text.includes(kw) || href.includes(kw))) {
                  riskLevel = 'MEDIUM';
                  reasons.push('Contains medium-risk keyword.');
                }
                if (form) {
                  if (riskLevel === 'LOW') riskLevel = 'MEDIUM';
                  reasons.push('Form interaction detected.');
                }
              }
            } else if (actType === 'navigate') {
              riskLevel = 'MEDIUM';
              reasons.push('Navigation to external URL.');
            } else if (actType === 'set_policy') {
              riskLevel = 'HIGH';
              reasons.push('Security-sensitive policy modification.');
            }

            const isSensitive = actType === 'type' && target && (
              target.type === 'password' ||
              (target.getAttribute('name') || '').includes('password') ||
              (target.getAttribute('id') || '').includes('password')
            );
            if (isSensitive) {
              riskLevel = 'HIGH';
              reasons.push('Input target is a password/sensitive field.');
            }

            if (reasons.length === 0) {
              reasons.push('Informational action.');
            }

            const overlayHost = document.createElement('div');
            overlayHost.id = 'mirailens-preview-overlay';
            overlayHost.style.position = 'fixed';
            overlayHost.style.top = '0';
            overlayHost.style.left = '0';
            overlayHost.style.width = '100vw';
            overlayHost.style.height = '100vh';
            overlayHost.style.zIndex = '2147483647';
            overlayHost.style.pointerEvents = 'none';

            const shadow = overlayHost.attachShadow({ mode: 'closed' });

            if (sel) {
              const highlight = document.createElement('div');
              highlight.style.position = 'absolute';
              highlight.style.left = rect.left + 'px';
              highlight.style.top = rect.top + 'px';
              highlight.style.width = rect.width + 'px';
              highlight.style.height = rect.height + 'px';
              highlight.style.border = '3px solid #ff00ff';
              highlight.style.boxSizing = 'border-box';
              highlight.style.backgroundColor = 'rgba(255, 0, 255, 0.2)';
              highlight.style.pointerEvents = 'none';
              shadow.appendChild(highlight);
            }

            const panel = document.createElement('div');
            panel.style.position = 'absolute';
            panel.style.left = Math.max(0, rect.left) + 'px';
            panel.style.top = Math.max(0, rect.bottom + 10) + 'px';
            panel.style.backgroundColor = '#ffffff';
            panel.style.border = '1px solid #ccc';
            panel.style.borderRadius = '6px';
            panel.style.padding = '12px';
            panel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            panel.style.fontFamily = 'system-ui, sans-serif';
            panel.style.pointerEvents = 'auto';
            panel.style.display = 'flex';
            panel.style.flexDirection = 'column';
            panel.style.gap = '8px';
            panel.style.color = '#000';

            const title = document.createElement('div');
            let desc = `AI wants to click this element.`;
            if (actType === 'type') {
              const displayVal = isSensitive ? '[Sensitive Value Masked]' : `"${dls}"`;
              desc = `AI wants to type ${displayVal} here.`;
            } else if (actType === 'navigate') {
              desc = `AI wants to navigate to "${dls}".`;
            } else if (actType === 'set_policy') {
              desc = `AI requests extension policy update: ${dls}`;
            }
            title.innerHTML = `<strong>MiraiLens Action Preview</strong><br/>${desc}`;
            title.style.fontSize = '14px';
            panel.appendChild(title);

            const riskDisplay = document.createElement('div');
            riskDisplay.style.fontSize = '13px';

            let riskColor = '#28a745';
            if (riskLevel === 'MEDIUM') riskColor = '#d39e00';
            if (riskLevel === 'HIGH') riskColor = '#dc3545';

            const riskLabel = document.createElement('strong');
            riskLabel.style.color = riskColor;
            riskLabel.textContent = `Risk: ${riskLevel}`;
            riskDisplay.appendChild(riskLabel);

            const why = document.createElement('div');
            why.style.marginTop = '4px';
            why.style.color = '#555';
            why.textContent = 'Why: ' + reasons.join(' / ');
            riskDisplay.appendChild(why);
            panel.appendChild(riskDisplay);

            let autoApproveInterval = null;
            let isDeniedOrApproved = false;

            // Check auto approve conditions
            if (polDec === 'AUTO_EXECUTE' || (riskLevel === 'LOW' && polDec !== 'ALWAYS_ASK')) {
              const autoText = document.createElement('div');
              autoText.style.fontSize = '13px';
              autoText.style.fontWeight = 'bold';
              autoText.style.color = '#17a2b8';
              let countdown = 4;
              autoText.textContent = `Auto-approving in ${countdown}...`;
              panel.appendChild(autoText);

              autoApproveInterval = setInterval(() => {
                if (isDeniedOrApproved) {
                  clearInterval(autoApproveInterval);
                  return;
                }
                countdown--;
                if (countdown > 0) {
                  autoText.textContent = `Auto-approving in ${countdown}...`;
                } else {
                  clearInterval(autoApproveInterval);
                  if (!isDeniedOrApproved) {
                    isDeniedOrApproved = true;
                    overlayHost.remove();
                    res({ action: 'approve', token: actId, risk: riskLevel });
                  }
                }
              }, 1000);
            }

            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.gap = '8px';

            const btnDeny = document.createElement('button');
            btnDeny.textContent = 'DENY';
            btnDeny.style.background = '#dc3545';
            btnDeny.style.color = '#fff';
            btnDeny.style.border = 'none';
            btnDeny.style.padding = '6px 12px';
            btnDeny.style.borderRadius = '4px';
            btnDeny.style.cursor = 'pointer';
            btnRow.appendChild(btnDeny);

            const btnApprove = document.createElement('button');
            if (riskLevel === 'HIGH') {
              btnApprove.textContent = 'CONFIRM DANGER';
              btnApprove.style.background = '#dc3545';
            } else {
              btnApprove.textContent = 'APPROVE';
              btnApprove.style.background = '#28a745';
            }
            btnApprove.style.color = '#fff';
            btnApprove.style.border = 'none';
            btnApprove.style.padding = '6px 12px';
            btnApprove.style.borderRadius = '4px';
            btnApprove.style.cursor = 'pointer';

            if (polDec === 'ALWAYS_ASK' || riskLevel !== 'LOW') {
              btnRow.appendChild(btnApprove);
            }
            panel.appendChild(btnRow);

            shadow.appendChild(panel);
            document.body.appendChild(overlayHost);

            btnDeny.addEventListener('click', () => {
              if (isDeniedOrApproved) return;
              isDeniedOrApproved = true;
              if (autoApproveInterval) clearInterval(autoApproveInterval);
              overlayHost.remove();
              res({ action: 'deny', token: actId, risk: riskLevel });
            });

            let confirmedDanger = false;
            btnApprove.addEventListener('click', () => {
              if (isDeniedOrApproved) return;
              if (riskLevel === 'HIGH' && !confirmedDanger) {
                confirmedDanger = true;
                btnApprove.textContent = 'CONFIRM DANGER (CLICK AGAIN)';
                btnApprove.style.background = '#ff0000';
                return;
              }
              isDeniedOrApproved = true;
              if (autoApproveInterval) clearInterval(autoApproveInterval);
              overlayHost.remove();
              res({ action: 'approve', token: actId, risk: riskLevel });
            });
          });
        }, [actionId, actionType, selector, details, policyDecision]);

        if (!pendingPreviews.has(tabId)) return;
        const pending = pendingPreviews.get(tabId);
        clearTimeout(pending.timeoutId);
        pendingPreviews.delete(tabId);

        if (!result) {
          return reject(new Error("Failed to inject preview UI or tab closed."));
        }
        if (result.error) {
          return reject(new Error(result.error));
        }
        if (result.action === 'deny') {
          if (activeAction && activeAction.auditRecord) {
            activeAction.auditRecord.risk = result.risk || 'UNKNOWN';
            activeAction.auditRecord.decision = 'HUMAN_DENIED';
          }
          return resolve({ approved: false, reason: "Human denied the action" });
        }
        if (result.action === 'approve') {
          if (result.token === actionId) {
            if (activeAction && activeAction.auditRecord) {
              activeAction.auditRecord.risk = result.risk || 'UNKNOWN';
              activeAction.auditRecord.decision = 'HUMAN_APPROVED';
            }
            return resolve({ approved: true });
          } else {
            return reject(new Error("Security violation: invalid approval token."));
          }
        }
        return reject(new Error("Unknown preview result"));
      } catch (err) {
        if (pendingPreviews.has(tabId)) {
          clearTimeout(pendingPreviews.get(tabId).timeoutId);
          pendingPreviews.delete(tabId);
        }
        reject(err);
      }
    });
  });
}

async function handleNavigate(payload) {
  const tabId = await getActiveTabId();
  if (tabId && payload.url) {
    let activeHostname = '';
    const tab = await tabsQuery({ active: true, currentWindow: true }).then(t => t[0]);
    if (tab && tab.url) {
      try { activeHostname = new URL(tab.url).hostname; } catch (_) {}
    }
    const evalResult = evaluatePolicy(activeHostname, 'browser_navigate', null);

    // Request approval if not auto-execute
    if (evalResult.decision !== 'AUTO_EXECUTE') {
      const approval = await requestHumanApproval(tabId, 'navigate', null, payload.url, evalResult.decision);
      if (!approval || !approval.approved) {
        throw new Error("Human denied navigation.");
      }
    }

    await tabsUpdate(tabId, { url: payload.url });
    try { await waitForTabComplete(tabId, 45000); } catch (_e) {}
    return true;
  }
  return false;
}

async function handleGoBack() {
  const tabId = await getActiveTabId();
  if (tabId) {
    await exec(tabId, () => { history.back(); });
    return true;
  }
  return false;
}

async function handleGoForward() {
  const tabId = await getActiveTabId();
  if (tabId) {
    await exec(tabId, () => { history.forward(); });
    return true;
  }
  return false;
}

async function handleWait(payload) {
  const time = payload?.time || 1;
  await new Promise(resolve => setTimeout(resolve, time * 1000));
  return true;
}

async function handleClick(payload) {
  const tabId = await getActiveTabId();
  const selector = payload.element || payload.selector;

  if (!tabId || !selector) return false;

  if (pendingPreviews.has(tabId)) {
    throw new Error("Another action is awaiting human approval.");
  }

  let activeHostname = '';
  const tab = await tabsQuery({ active: true, currentWindow: true }).then(t => t[0]);
  if (tab && tab.url) {
    try { activeHostname = new URL(tab.url).hostname; } catch (_) {}
  }

  const props = await inspectElementProperties(tabId, selector);
  const evalResult = evaluatePolicy(activeHostname, 'browser_click', props);

  if (evalResult.decision === 'ALWAYS_DENY') {
    throw new Error(`Policy blocked: ${evalResult.reasonCode}`);
  }

  const approval = await requestHumanApproval(tabId, 'click', selector, '', evalResult.decision);
  if (approval && approval.approved) {
    await exec(tabId, (sel) => {
      const el = document.querySelector(sel);
      if (el) {
        el.click();
      }
    }, [selector]);
    return true;
  }
  return { approved: false, reason: "Human denied the action" };
}

async function handleType(payload) {
  const tabId = await getActiveTabId();
  const selector = payload.selector || payload.element;

  if (!tabId || !selector || payload.text === undefined) return false;

  if (pendingPreviews.has(tabId)) {
    throw new Error("Another action is awaiting human approval.");
  }

  let activeHostname = '';
  const tab = await tabsQuery({ active: true, currentWindow: true }).then(t => t[0]);
  if (tab && tab.url) {
    try { activeHostname = new URL(tab.url).hostname; } catch (_) {}
  }

  const props = await inspectElementProperties(tabId, selector);
  const evalResult = evaluatePolicy(activeHostname, 'browser_type', props);

  if (evalResult.decision === 'ALWAYS_DENY') {
    throw new Error(`Policy blocked: ${evalResult.reasonCode}`);
  }

  const isSensitive = props && props.isSensitiveField;
  const loggedText = isSensitive ? '[Sensitive Value Masked]' : payload.text;

  // Override audit target / values to keep secrets out of logs
  if (activeAction && activeAction.auditRecord) {
    activeAction.auditRecord.target = isSensitive ? `${selector} [Sensitive Value Masked]` : selector;
  }

  const approval = await requestHumanApproval(tabId, 'type', selector, loggedText, evalResult.decision);
  if (approval && approval.approved) {
    await exec(tabId, (sel, txt, mode) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const applyValue = (node) => {
        if (mode === 'append') node.value = (node.value || '') + txt;
        else node.value = txt;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        applyValue(el);
        return true;
      }
      if (el.isContentEditable) {
        if (mode === 'append') el.textContent = (el.textContent || '') + txt;
        else el.textContent = txt;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, [selector, payload.text, payload.mode || 'replace']);
    return true;
  }
  return { approved: false, reason: "Human denied the action" };
}

async function handleHover(payload) {
  const tabId = await getActiveTabId();
  if (tabId && payload.selector) {
    await exec(tabId, (selector) => {
      const element = document.querySelector(selector);
      if (element) {
        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        return true;
      }
      return false;
    }, [payload.selector]);
    return true;
  }
  return false;
}

async function handleSnapshot() {
  const tabId = await getActiveTabId();
  if (tabId) {
    return await exec(tabId, () => {
      const dims = { width: window.innerWidth, height: window.innerHeight };
      const scroll = { x: window.scrollX, y: window.scrollY };
      return {
        url: window.location.href,
        title: document.title,
        viewport: dims,
        scroll,
        html: document.documentElement.outerHTML
      };
    });
  }
  return null;
}

async function handleScreenshot() {
  await new Promise(resolve => setTimeout(resolve, 300));
  return await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
}

async function handleGetUrl() {
  const tabId = await getActiveTabId();
  if (!tabId) return null;
  return await retry(async () => await exec(tabId, () => window.location.href), 3, 300);
}

async function handleGetTitle() {
  const tabId = await getActiveTabId();
  if (!tabId) return null;
  return await retry(async () => await exec(tabId, () => document.title), 3, 300);
}

function waitForTabComplete(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function retry(fn, times = 3, delayMs = 300) {
  let lastErr;
  for (let i = 0; i < times; i++) {
    try {
      const res = await fn();
      if (res !== undefined && res !== null) return res;
    } catch (e) {
      lastErr = e;
    }
    if (i < times - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  if (lastErr) throw lastErr;
  return null;
}

let heartbeatIntervalId = null;
let heartbeatTimeoutId = null;

function startHeartbeat() {
  stopHeartbeat();
  heartbeatIntervalId = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'heartbeat_ping' }));
      heartbeatTimeoutId = setTimeout(() => {
        console.warn('Heartbeat timeout. Closing stale connection...');
        if (ws) {
          ws.close();
        }
      }, 5000);
    }
  }, 10000);
}

function stopHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
  if (heartbeatTimeoutId) {
    clearTimeout(heartbeatTimeoutId);
    heartbeatTimeoutId = null;
  }
}

function handleHeartbeatPong() {
  if (heartbeatTimeoutId) {
    clearTimeout(heartbeatTimeoutId);
    heartbeatTimeoutId = null;
  }
}

let reconnectTimeoutId = null;

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return true;
  }

  try {
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
    ws = new WebSocket(serverUrl);

    ws.onopen = () => {
      console.log('WebSocket connected to MCP server');
      sendPopupStatus('Connected');
      reconnectAttempt = 0;
      startHeartbeat();
      ws.send(JSON.stringify({
        type: 'extension_connected',
        data: { version: '1.0.0', capabilities: ['navigate', 'click', 'type', 'hover', 'snapshot'] }
      }));
      notifyServerStateChange(controlState);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected from MCP server');
      sendPopupStatus('Disconnected');
      stopHeartbeat();
      const attempt = ++reconnectAttempt;
      ws = null;

      abortActiveAction("WebSocket disconnected.");

      if (controlState === STATES.AGENT_RUNNING || controlState === STATES.AGENT_RESUMING) {
        transitionTo(STATES.IDLE, 'disconnect');
      } else if (controlState === STATES.HUMAN_TAKEOVER) {
        transitionTo(STATES.HUMAN_CONTROLLED, 'disconnect');
      }

      for (const [tabId, pending] of pendingPreviews.entries()) {
        clearTimeout(pending.timeoutId);
        pending.reject(new Error("WebSocket disconnected."));
        exec(tabId, () => {
          const ui = document.getElementById('mirailens-preview-overlay');
          if (ui) ui.remove();
        }).catch(() => {});
      }
      pendingPreviews.clear();

      const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
      reconnectTimeoutId = setTimeout(() => {
        if (!ws) connect();
      }, delay);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      lastErrorMessage = String(error?.message || 'WebSocket error');
      sendPopupStatus('WebSocket error');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'heartbeat_pong' || message.result === 'pong') {
          handleHeartbeatPong();
          return;
        }
        handleMCPMessage(message);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };

    return true;
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
    lastErrorMessage = String(error?.message || 'Failed to create WebSocket');
    sendPopupStatus('Failed to open WebSocket');
    return false;
  }
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  activeTabId = activeInfo.tabId;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabId === tabId) {
    activeTabId = null;
  }
  if (connectedTabId === tabId) {
    connectedTabId = null;
    chrome.storage.local.remove('connectedTabId');
  }
  if (pendingPreviews.has(tabId)) {
    clearTimeout(pendingPreviews.get(tabId).timeoutId);
    pendingPreviews.get(tabId).reject(new Error("Tab closed."));
    pendingPreviews.delete(tabId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && pendingPreviews.has(tabId)) {
    clearTimeout(pendingPreviews.get(tabId).timeoutId);
    pendingPreviews.get(tabId).reject(new Error("Tab navigated."));
    pendingPreviews.delete(tabId);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'user_interaction') {
    if (_sender.tab && _sender.tab.id === connectedTabId) {
      if (controlState === STATES.AGENT_RUNNING || controlState === STATES.AGENT_RESUMING) {
        console.log(`Implicit takeover detected via ${msg.eventType} on connected tab.`);
        handleControlAction('TAKE_CONTROL', 'human_implicit');
      }
    }
    sendResponse({ success: true });
    return false;
  }

  if (msg?.cmd === 'connect') {
    reconnectAttempt = 0;
    const ok = connect();
    sendResponse({ success: ok, lastError: lastErrorMessage });
    return false;
  }

  if (msg?.cmd === 'getStatus') {
    const connected = ws && ws.readyState === WebSocket.OPEN;
    sendResponse({ status: connected ? 'connected' : 'disconnected', lastError: lastErrorMessage, url: serverUrl, controlState });
    return false;
  }

  if (msg?.cmd === 'disconnect') {
    if (ws) {
      ws.close();
      ws = null;
    }
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
    sendResponse({ success: true });
    return false;
  }

  if (msg?.cmd === 'control_action') {
    // Messages from popup are human-initiated
    handleControlAction(msg.action, 'human');
    sendResponse({ success: true });
    return false;
  }

  if (msg?.cmd === 'getAuditLog') {
    sendResponse({ auditLog });
    return false;
  }

  if (msg?.cmd === 'clearAuditLog') {
    clearAuditLog();
    sendResponse({ success: true });
    return false;
  }
});

chrome.commands?.onCommand?.addListener((command) => {
  if (command === 'connect') {
    connect();
  } else if (command === 'disconnect') {
    if (ws) {
      ws.close();
      ws = null;
      sendPopupStatus('Disconnected');
    }
  }
});

chrome.windows.onRemoved.addListener(async () => {
  const windows = await windowsGetAll();
  if (windows.length === 0 && ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
    sendPopupStatus('Disconnected');
    try { chrome.storage.local.remove('connectedTabId'); } catch (_) {}
  }
});

chrome.runtime.onStartup?.addListener(() => {
  try { chrome.storage.local.remove('connectedTabId'); } catch (_) {}
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }
  sendPopupStatus('Disconnected');
});

chrome.runtime.onInstalled?.addListener(() => {
  try { chrome.storage.local.remove('connectedTabId'); } catch (_) {}
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }
  sendPopupStatus('Disconnected');
});

chrome.runtime.onSuspend?.addListener(() => {
  try { chrome.storage.local.remove('connectedTabId'); } catch (_) {}
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }
});
