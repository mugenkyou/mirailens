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
let controlState = STATES.IDLE; // default, overridden by init
let activeAction = null; // { id, type, auditRecord, reject }

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

function initControlState() {
  chrome.storage.local.get([CONTROL_STATE_KEY, 'isEmergencyStop', 'pausedBy', 'connectedTabId'], (data) => {
    isEmergencyStop = !!data.isEmergencyStop;
    pausedBy = data.pausedBy || null;
    connectedTabId = data.connectedTabId || null;
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

    const shouldVerify = type === 'browser_click' || type === 'browser_type';
    const rawSelector = payload ? (payload.element || payload.selector) : null;
    const selector = typeof rawSelector === 'string' && rawSelector.trim() ? rawSelector : null;

    let beforeState = null;
    let auditRecord = null;
    
    if (shouldVerify) {
      auditRecord = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        action: type,
        target: selector,
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
        const tabId = await getActiveTabId();
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
}

async function handleNavigate(payload) {
  const tabId = await getActiveTabId();
  if (tabId && payload.url) {
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
  
  return new Promise((resolve, reject) => {
    const actionId = Math.random().toString(36).substr(2, 9);
    
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
    
    pendingPreviews.set(tabId, { actionId, status: 'PENDING', resolve, reject, timeoutId });
    
    exec(tabId, (sel) => {
      return new Promise((res, rej) => {
        const elements = document.querySelectorAll(sel);
        if (elements.length === 0) {
           return res({ error: "Target selector matched zero elements." });
        }
        if (elements.length > 1) {
           return res({ error: "Target selector matched multiple elements." });
        }
        
        const target = elements[0];
        
        function analyzeRisk(el) {
          try {
            const text = (el.innerText || el.textContent || '').toLowerCase().trim();
            const tag = el.tagName.toLowerCase();
            const type = (el.getAttribute('type') || '').toLowerCase();
            const href = (el.getAttribute('href') || '').toLowerCase();
            const form = el.closest('form');
            
            const highKeywords = ['delete', 'remove', 'erase', 'destroy', 'terminate', 'close account', 'delete account', 'cancel subscription', 'pay', 'purchase', 'buy', 'transfer', 'withdraw', 'send money', 'confirm payment'];
            const mediumKeywords = ['submit', 'save', 'update', 'change', 'edit', 'confirm', 'send', 'apply', 'publish', 'upload', 'create'];
            
            let level = 'LOW';
            const reasons = [];
            
            if (highKeywords.some(kw => text.includes(kw) || href.includes(kw))) {
              level = 'HIGH';
              reasons.push(`Contains high-risk keyword.`);
            } else if (mediumKeywords.some(kw => text.includes(kw) || href.includes(kw))) {
              level = 'MEDIUM';
              reasons.push(`Contains medium-risk keyword.`);
            }
            
            if (form) {
               if (level === 'LOW') {
                 level = 'MEDIUM';
               }
               reasons.push(`Form submission detected.`);
            }
            
            if (level === 'LOW' && reasons.length === 0) {
               reasons.push(`Standard navigation or informational action.`);
            }
            
            return { level, reasons: [...new Set(reasons)] };
          } catch (e) {
            return { level: 'UNKNOWN', reasons: ['Risk analysis failed'] };
          }
        }
        
        const riskData = analyzeRisk(target);
        
        target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        
        const rect = target.getBoundingClientRect();
        
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
        title.innerHTML = '<strong>MiraiLens</strong><br/>AI wants to click this element.';
        title.style.fontSize = '14px';
        title.style.marginBottom = '4px';
        panel.appendChild(title);
        
        const riskDisplay = document.createElement('div');
        riskDisplay.style.fontSize = '13px';
        riskDisplay.style.marginBottom = '12px';
        
        let riskColor = '#28a745'; // LOW
        if (riskData.level === 'MEDIUM') riskColor = '#d39e00'; // dark yellow
        if (riskData.level === 'HIGH' || riskData.level === 'UNKNOWN') riskColor = '#dc3545';
        
        const riskLabel = document.createElement('strong');
        riskLabel.style.color = riskColor;
        riskLabel.textContent = 'Risk: ' + riskData.level;
        riskDisplay.appendChild(riskLabel);
        
        const whyBlock = document.createElement('div');
        whyBlock.style.marginTop = '4px';
        whyBlock.style.color = '#555';
        whyBlock.textContent = 'Why:';
        
        const ul = document.createElement('ul');
        ul.style.margin = '4px 0 0 0';
        ul.style.paddingLeft = '20px';
        
        riskData.reasons.forEach(r => {
          const li = document.createElement('li');
          li.textContent = r;
          ul.appendChild(li);
        });
        
        whyBlock.appendChild(ul);
        riskDisplay.appendChild(whyBlock);
        
        panel.appendChild(riskDisplay);
        
        let autoApproveInterval = null;
        let isDeniedOrApproved = false;

        let warningText = null;
        if (riskData.level === 'LOW') {
          const autoText = document.createElement('div');
          autoText.style.fontSize = '13px';
          autoText.style.fontWeight = 'bold';
          autoText.style.color = '#17a2b8';
          autoText.style.marginBottom = '8px';
          
          let countdown = 4;
          autoText.textContent = `Auto-approving in ${countdown}...`;
          panel.appendChild(autoText);
          
          console.log('[MiraiLens] LOW risk: countdown started at', countdown);
          autoApproveInterval = setInterval(() => {
            if (isDeniedOrApproved) {
              console.log('[MiraiLens] Interval tick skipped: already denied/approved.');
              clearInterval(autoApproveInterval);
              return;
            }
            countdown--;
            console.log('[MiraiLens] Countdown value:', countdown);
            if (countdown > 0) {
              autoText.textContent = `Auto-approving in ${countdown}...`;
            } else {
              console.log('[MiraiLens] Countdown reached zero.');
              clearInterval(autoApproveInterval);
              if (!isDeniedOrApproved) {
                isDeniedOrApproved = true;
                console.log('[MiraiLens] Auto approval triggered.');
                overlayHost.remove();
                
                // Resolve first to avoid navigation race conditions blocking the response
                res({ action: 'approve', risk: riskData.level, decision: 'AUTO_APPROVED' });
                console.log('[MiraiLens] Promise resolved.');
                
                // Execute click slightly after to guarantee message is sent
                setTimeout(() => {
                  try {
                    target.click();
                    console.log('[MiraiLens] target.click() executed.');
                  } catch (e) {
                    console.error('[MiraiLens] target.click() failed:', e);
                  }
                }, 10);
              }
            }
          }, 1000);
        } else if (riskData.level === 'HIGH' || riskData.level === 'UNKNOWN') {
          warningText = document.createElement('div');
          warningText.style.fontSize = '13px';
          warningText.style.fontWeight = 'bold';
          warningText.style.color = '#dc3545';
          warningText.style.marginBottom = '8px';
          warningText.textContent = riskData.level === 'HIGH' ? '⚠ HIGH RISK' : '⚠ UNKNOWN RISK';
          panel.appendChild(warningText);
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
        
        const btnApprove = document.createElement('button');
        if (riskData.level === 'HIGH' || riskData.level === 'UNKNOWN') {
          btnApprove.textContent = 'CONFIRM DANGER';
          btnApprove.style.background = '#dc3545';
          btnApprove.style.color = '#fff';
          btnApprove.style.border = 'none';
          btnApprove.style.padding = '6px 12px';
          btnApprove.style.borderRadius = '4px';
          btnApprove.style.cursor = 'pointer';
        } else {
          btnApprove.textContent = 'APPROVE';
          btnApprove.style.background = '#28a745';
          btnApprove.style.color = '#fff';
          btnApprove.style.border = 'none';
          btnApprove.style.padding = '6px 12px';
          btnApprove.style.borderRadius = '4px';
          btnApprove.style.cursor = 'pointer';
        }
        
        btnRow.appendChild(btnDeny);
        if (riskData.level !== 'LOW') {
          btnRow.appendChild(btnApprove);
        }
        panel.appendChild(btnRow);
        
        shadow.appendChild(highlight);
        shadow.appendChild(panel);
        document.body.appendChild(overlayHost);
        
        btnDeny.addEventListener('click', () => {
          if (isDeniedOrApproved) return;
          isDeniedOrApproved = true;
          if (autoApproveInterval) clearInterval(autoApproveInterval);
          overlayHost.remove();
          res({ action: 'deny', risk: riskData.level, decision: 'HUMAN_DENIED' });
        });
        
        let highRiskConfirmStep = false;
        
        if (riskData.level !== 'LOW') {
          btnApprove.addEventListener('click', () => {
            if (isDeniedOrApproved) return;
            
            if ((riskData.level === 'HIGH' || riskData.level === 'UNKNOWN') && !highRiskConfirmStep) {
              highRiskConfirmStep = true;
              if (warningText) {
                warningText.textContent = '⚠ CONFIRM THIS DANGEROUS ACTION';
              }
              return;
            }
            
            isDeniedOrApproved = true;
            if (autoApproveInterval) clearInterval(autoApproveInterval);
            overlayHost.remove();
            target.click();
            res({ action: 'approve', risk: riskData.level, decision: 'HUMAN_APPROVED' });
          });
        }
      });
    }, [selector]).then((injectionResult) => {
      if (!pendingPreviews.has(tabId)) return;
      const pending = pendingPreviews.get(tabId);
      clearTimeout(pending.timeoutId);
      pendingPreviews.delete(tabId);
      
      if (!injectionResult) {
         return reject(new Error("Failed to inject preview UI or tab closed."));
      }
      if (injectionResult.error) {
         return reject(new Error(injectionResult.error));
      }
      if (injectionResult.action === 'deny') {
         if (activeAction && activeAction.auditRecord) {
           activeAction.auditRecord.risk = injectionResult.risk || 'UNKNOWN';
           activeAction.auditRecord.decision = injectionResult.decision || 'HUMAN_DENIED';
         }
         return resolve({ approved: false, reason: "Human denied the action" });
      }
      if (injectionResult.action === 'approve') {
         if (activeAction && activeAction.auditRecord) {
           activeAction.auditRecord.risk = injectionResult.risk || 'UNKNOWN';
           activeAction.auditRecord.decision = injectionResult.decision || 'HUMAN_APPROVED';
         }
         return resolve(true);
      }
      return reject(new Error("Unknown preview result"));
    }).catch((err) => {
      if (pendingPreviews.has(tabId)) {
        clearTimeout(pendingPreviews.get(tabId).timeoutId);
        pendingPreviews.delete(tabId);
      }
      reject(err);
    });
  });
}

async function handleType(payload) {
  const tabId = await getActiveTabId();
  if (tabId && payload.selector && payload.text) {
    await exec(tabId, (selector, text, mode) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const applyValue = (node) => {
        if (mode === 'append') node.value = (node.value || '') + text;
        else node.value = text;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        applyValue(el);
        return true;
      }
      if (el.isContentEditable) {
        if (mode === 'append') el.textContent = (el.textContent || '') + text;
        else el.textContent = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, [payload.selector, payload.text, payload.mode || 'replace']);
    return true;
  }
  return false;
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
