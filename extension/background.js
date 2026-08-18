// Initialize persistent control state on startup
const CONTROL_STATE_KEY = 'controlState';
let controlState = 'RUNNING'; // default, will be overridden by init

function logControlTransition(prev, next, source) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${prev} → ${next} source=${source}`);
}

function persistControlState(state, source) {
  chrome.storage.local.set({ [CONTROL_STATE_KEY]: state }, () => {
    // optional callback
  });
  logControlTransition(controlState, state, source);
  controlState = state;
}

function initControlState() {
  chrome.storage.local.get([CONTROL_STATE_KEY], (data) => {
    const stored = data[CONTROL_STATE_KEY];
    if (!stored) {
      // No persisted state, start safe STOPPED
      persistControlState('STOPPED', 'init_no_state');
    } else if (stored === 'RUNNING') {
      // Safer default: do not auto‑resume autonomous AI after restart
      persistControlState('STOPPED', 'init_running_to_stopped');
    } else {
      // Restore PAUSED, HUMAN_CONTROL, STOPPED as stored
      persistControlState(stored, 'init_restore');
    }
    // Notify any UI listeners of the restored state
    sendPopupStatus('Connected');
  });
}

// Call init on load
initControlState();
let activeTabId = null;
let reconnectAttempt = 0;
let lastErrorMessage = '';
let serverUrl = 'ws://127.0.0.1:29100';
// controlState is managed via persistence; default set in initControlState

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
  if (controlState === 'RUNNING') return { allowed: true };
  if (controlState === 'PAUSED') return { allowed: false, reason: "AI execution is currently paused", controlState: "PAUSED" };
  if (controlState === 'HUMAN_CONTROL') return { allowed: false, reason: "Browser is currently under human control", controlState: "HUMAN_CONTROL" };
  if (controlState === 'STOPPED') return { allowed: false, reason: "AI execution has been emergency stopped", controlState: "STOPPED" };
  return { allowed: false, reason: "Unknown control state", controlState };
}

async function handleMCPMessage(message) {
  try {
    const { type, payload, id } = message;
    console.log('Received MCP message:', type, payload);
    
    if (type === 'browser_control') {
      const { action, source = 'ai' } = payload;
      if (action === 'RESET_STOP' && source !== 'human') {
        sendError(id, type, { allowed: false, reason: 'RESET_STOP not permitted from AI', controlState });
        return;
      }
      const prevState = controlState;
      if (action === 'PAUSE' && controlState !== 'STOPPED') persistControlState('PAUSED', source);
      else if (action === 'RESUME' && controlState !== 'STOPPED') persistControlState('RUNNING', source);
      else if (action === 'TAKE_CONTROL' && controlState !== 'STOPPED') persistControlState('HUMAN_CONTROL', source);
      else if (action === 'RETURN_CONTROL' && controlState !== 'STOPPED') persistControlState('RUNNING', source);
      else if (action === 'EMERGENCY_STOP') persistControlState('STOPPED', source);
      else if (action === 'RESET_STOP') persistControlState('RUNNING', source);
      
      // If state changed, log already done in persistControlState
      sendPopupStatus('Connected');
      sendResponse(id, type, { state: controlState });
      return;
    }
    
    if (type === 'get_control_state') {
      sendResponse(id, type, { state: controlState });
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
      getUrl: handleGetUrl,
      getTitle: handleGetTitle,
      // future actions can be added here
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

    try {
      const result = await handler(payload);
      sendResponse(id, type, result);
    } catch (e) {
      console.error('Error handling action', type, e);
      sendError(id, type, String(e?.message || e));
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
  if (tabId && payload.selector) {
    await exec(tabId, (selector) => {
      const element = document.querySelector(selector);
      if (element) {
        element.click();
        return true;
      }
      return false;
    }, [payload.selector]);
    return true;
  }
  return false;
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

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return true;
  }
  
  try {
    ws = new WebSocket(serverUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected to MCP server');
      sendPopupStatus('Connected');
      reconnectAttempt = 0;
      ws.send(JSON.stringify({ 
        type: 'extension_connected',
        data: { version: '1.0.0', capabilities: ['navigate', 'click', 'type', 'hover', 'snapshot'] }
      }));
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected from MCP server');
      sendPopupStatus('Disconnected');
      const attempt = ++reconnectAttempt;
      ws = null;
      const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
      setTimeout(() => {
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
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
    sendResponse({ success: true });
    return false;
  }
  
  if (msg?.cmd === 'control_action') {
    // Messages from popup are human-initiated
    handleMCPMessage({ type: 'browser_control', payload: { action: msg.action, source: 'human' } });
    sendResponse({ success: true });
    return false;
  }
});

chrome.commands?.onCommand.addListener((command) => {
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

chrome.runtime.onInstalled.addListener(() => {
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
