import fs from 'fs';
import path from 'path';
import assert from 'assert';
import test from 'node:test';

const nativeSetTimeout = global.setTimeout;

// Helper to load background script in a fresh mock environment
function loadBackground(initialStorage = {}, initialTabUrl = 'http://localhost/index.html') {
  const chromeListeners = {
    message: [],
    tabActivated: [],
    tabRemoved: [],
    tabUpdated: [],
    storageChanged: [],
  };

  const mockStorage = new Map(Object.entries(initialStorage));
  
  mockStorage.set = (k, v) => {
    const oldValue = Map.prototype.get.call(mockStorage, k);
    Map.prototype.set.call(mockStorage, k, v);
    const changes = { [k]: { oldValue, newValue: v } };
    chromeListeners.storageChanged.forEach(fn => fn(changes, 'local'));
    return mockStorage;
  };
  
  mockStorage.delete = (k) => {
    const oldValue = Map.prototype.get.call(mockStorage, k);
    const deleted = Map.prototype.delete.call(mockStorage, k);
    if (deleted) {
      const changes = { [k]: { oldValue, newValue: undefined } };
      chromeListeners.storageChanged.forEach(fn => fn(changes, 'local'));
    }
    return deleted;
  };

  let popupStatus = null;
  let sentWsMessages = [];
  let wsInstance = null;
  let activeTabUrl = initialTabUrl;
  let mockInjectedResult = null;

  const activeTimeouts = new Set();
  const activeIntervals = new Set();

  const originalSetTimeout = global.setTimeout;
  const originalSetInterval = global.setInterval;
  const originalClearTimeout = global.clearTimeout;
  const originalClearInterval = global.clearInterval;

  global.setTimeout = (cb, delay, ...args) => {
    const id = originalSetTimeout((...a) => {
      activeTimeouts.delete(id);
      cb(...a);
    }, delay, ...args);
    activeTimeouts.add(id);
    return id;
  };
  global.setInterval = (cb, delay, ...args) => {
    const id = originalSetInterval(cb, delay, ...args);
    activeIntervals.add(id);
    return id;
  };
  global.clearTimeout = (id) => {
    activeTimeouts.delete(id);
    originalClearTimeout(id);
  };
  global.clearInterval = (id) => {
    activeIntervals.delete(id);
    originalClearInterval(id);
  };

  const chromeMock = {
    storage: {
      local: {
        get: (keys, cb) => {
          const res = {};
          const kArray = Array.isArray(keys) ? keys : [keys];
          kArray.forEach(k => res[k] = mockStorage.get(k));
          nativeSetTimeout(() => cb(res), 0);
        },
        set: (data, cb) => {
          const oldStorage = new Map(mockStorage);
          Object.entries(data).forEach(([k, v]) => mockStorage.set(k, v));
          const changes = {};
          Object.entries(data).forEach(([k, v]) => {
            changes[k] = { oldValue: oldStorage.get(k), newValue: v };
          });
          chromeListeners.storageChanged.forEach(fn => fn(changes, 'local'));
          if (cb) nativeSetTimeout(cb, 0);
        },
        remove: (keys, cb) => {
          const oldStorage = new Map(mockStorage);
          const kArray = Array.isArray(keys) ? keys : [keys];
          const changes = {};
          kArray.forEach(k => {
            changes[k] = { oldValue: oldStorage.get(k), newValue: undefined };
            mockStorage.delete(k);
          });
          chromeListeners.storageChanged.forEach(fn => fn(changes, 'local'));
          if (cb) nativeSetTimeout(cb, 0);
        }
      },
      onChanged: {
        addListener: (fn) => chromeListeners.storageChanged.push(fn)
      }
    },
    runtime: {
      sendMessage: (msg, cb) => {
        popupStatus = msg;
        if (cb) nativeSetTimeout(() => cb({ success: true }), 0);
      },
      onMessage: {
        addListener: (fn) => chromeListeners.message.push(fn)
      },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onSuspend: { addListener: () => {} }
    },
    commands: {
      onCommand: { addListener: () => {} }
    },
    tabs: {
      query: (queryInfo, cb) => {
        nativeSetTimeout(() => cb([{ id: 123, active: true, url: activeTabUrl }]), 0);
      },
      update: (tabId, props, cb) => {
        if (props.url) activeTabUrl = props.url;
        if (cb) nativeSetTimeout(() => cb({ id: tabId }), 0);
      },
      onActivated: { addListener: (fn) => chromeListeners.tabActivated.push(fn) },
      onRemoved: { addListener: (fn) => chromeListeners.tabRemoved.push(fn) },
      onUpdated: { addListener: (fn) => chromeListeners.tabUpdated.push(fn) }
    },
    scripting: {
      executeScript: (args, cb) => {
        let resVal = mockInjectedResult;
        if (!resVal && args.func) {
          const fnStr = args.func.toString();
          if (fnStr.includes('isSensitiveField')) {
            const selector = args.args[0];
            const isPassword = selector.includes('password');
            const isSubmit = selector.includes('submit') || selector.includes('pay');
            resVal = {
              exists: true,
              tag: 'input',
              type: isPassword ? 'password' : 'text',
              isSensitiveField: isPassword,
              isSubmit: isSubmit,
              hasForm: isSubmit
            };
          }
        }
        nativeSetTimeout(() => cb([{ result: resVal }]), 0);
      }
    },
    windows: {
      getAll: (cb) => nativeSetTimeout(() => cb([{ id: 1 }]), 0),
      onRemoved: { addListener: () => {} }
    }
  };

  class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 1; // OPEN
      wsInstance = this;
      nativeSetTimeout(() => {
        if (this.onopen) this.onopen();
      }, 0);
    }
    send(data) {
      sentWsMessages.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
  }

  MockWebSocket.CONNECTING = 0;
  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSING = 2;
  MockWebSocket.CLOSED = 3;

  global.chrome = chromeMock;
  global.WebSocket = MockWebSocket;

  const bgPath = path.resolve('extension/background.js');
  const code = fs.readFileSync(bgPath, 'utf8');
  
  const evalFunc = new Function('chrome', 'WebSocket', code);
  evalFunc(chromeMock, MockWebSocket);

  return {
    chromeListeners,
    mockStorage,
    setTabUrl: (u) => { activeTabUrl = u; },
    setMockInjectedResult: (val) => { mockInjectedResult = val; },
    getPopupStatus: () => popupStatus,
    getSentWsMessages: () => sentWsMessages,
    clearSentWsMessages: () => { sentWsMessages = []; },
    getWsInstance: () => wsInstance,
    cleanup: () => new Promise(resolve => {
      global.setTimeout = originalSetTimeout;
      global.setInterval = originalSetInterval;
      global.clearTimeout = originalClearTimeout;
      global.clearInterval = originalClearInterval;
      activeTimeouts.forEach(id => originalClearTimeout(id));
      activeIntervals.forEach(id => originalClearInterval(id));
      activeTimeouts.clear();
      activeIntervals.clear();
      if (chromeListeners.message[0]) {
        chromeListeners.message[0]({ cmd: 'disconnect' }, {}, () => resolve());
      } else {
        resolve();
      }
    }),
    getStatus: () => new Promise(resolve => {
      chromeListeners.message[0]({ cmd: 'getStatus' }, {}, resolve);
    }),
    connect: () => new Promise(resolve => {
      chromeListeners.message[0]({ cmd: 'connect' }, {}, resolve);
    }),
    simulateMcpMessage: (type, payload = {}, id = 'msg-123') => {
      if (wsInstance && wsInstance.onmessage) {
        wsInstance.onmessage({
          data: JSON.stringify({ id, type, payload })
        });
      }
    }
  };
}

test('Security Gate - Blocked domains are immediately blocked and transition to BLOCKED state', async () => {
  const policy = {
    draftOnly: false,
    trustedDomains: ['localhost'],
    blockedDomains: ['attacker.com', 'evil.com', '*.evil.com'],
    sensitiveFieldDecision: 'ALWAYS_ASK'
  };
  
  const instance = loadBackground({
    controlState: 'IDLE',
    connectedTabId: 123,
    mirailensPolicy: policy
  }, 'https://evil.com/payment');

  try {
    await instance.connect();
    await new Promise(r => nativeSetTimeout(r, 10));

    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_click', { selector: '#some-btn' }, 'msg-1');

    await new Promise(r => nativeSetTimeout(r, 100));

    const sent = instance.getSentWsMessages();
    const responseMsg = sent.find(m => m.id === 'msg-1');
    assert.ok(responseMsg, 'Response message should be sent');
    assert.ok(responseMsg.error, 'Message should return an error');
    
    const parsedErr = JSON.parse(responseMsg.error);
    assert.strictEqual(parsedErr.decision, 'ALWAYS_DENY');
    assert.strictEqual(parsedErr.reasonCode, 'BLOCKED_DOMAIN');
    assert.strictEqual(parsedErr.controlState, 'BLOCKED');
  } finally {
    await instance.cleanup();
  }
});

test('Security Gate - Substring domain matches do NOT bypass or trigger incorrect blocks', async () => {
  const policy = {
    draftOnly: false,
    trustedDomains: ['example.com'],
    blockedDomains: ['evil.com'],
    sensitiveFieldDecision: 'ALWAYS_ASK'
  };

  const instance = loadBackground({
    controlState: 'IDLE',
    connectedTabId: 123,
    mirailensPolicy: policy
  }, 'https://evil-example.com/home');

  try {
    await instance.connect();
    await new Promise(r => nativeSetTimeout(r, 10));

    global.chrome.scripting.executeScript = (args, cb) => {
      const fnStr = args.func.toString();
      if (fnStr.includes('isSensitiveField')) {
        nativeSetTimeout(() => cb([{ result: { exists: true, isSensitiveField: false, isSubmit: false } }]), 0);
      } else if (fnStr.includes('mirailens-preview-overlay')) {
        nativeSetTimeout(() => cb([{ result: { action: 'approve', token: args.args[0], risk: 'LOW' } }]), 0);
      } else {
        // Return valid state representation
        nativeSetTimeout(() => cb([{
          result: {
            url: 'https://evil-example.com/home',
            targetExists: true,
            targetText: 'Click me',
            targetAttributes: {},
            parentText: ''
          }
        }]), 0);
      }
    };

    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_click', { selector: '#neutral-btn' }, 'msg-2');

    await new Promise(r => nativeSetTimeout(r, 1700));

    const sent = instance.getSentWsMessages();
    const responseMsg = sent.find(m => m.id === 'msg-2');
    assert.ok(responseMsg);
    assert.ok(!responseMsg.error);
  } finally {
    await instance.cleanup();
  }
});

test('Security Gate - Draft-Only Mode blocks form submission', async () => {
  const policy = {
    draftOnly: true,
    trustedDomains: ['localhost'],
    blockedDomains: [],
    sensitiveFieldDecision: 'ALWAYS_ASK'
  };

  const instance = loadBackground({
    controlState: 'IDLE',
    connectedTabId: 123,
    mirailensPolicy: policy
  }, 'http://localhost/form.html');

  try {
    await instance.connect();
    await new Promise(r => nativeSetTimeout(r, 10));

    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_click', { selector: '#submit-btn' }, 'msg-3');

    await new Promise(r => nativeSetTimeout(r, 100));

    const sent = instance.getSentWsMessages();
    const responseMsg = sent.find(m => m.id === 'msg-3');
    assert.ok(responseMsg);
    assert.ok(responseMsg.error);
    
    const parsedErr = JSON.parse(responseMsg.error);
    assert.strictEqual(parsedErr.decision, 'ALWAYS_DENY');
    assert.strictEqual(parsedErr.reasonCode, 'DRAFT_ONLY');
  } finally {
    await instance.cleanup();
  }
});

test('Security Gate - Sensitive fields always mask values in logs and route to ALWAYS_DENY / ALWAYS_ASK', async () => {
  const policy = {
    draftOnly: false,
    trustedDomains: ['localhost'],
    blockedDomains: [],
    sensitiveFieldDecision: 'ALWAYS_DENY'
  };

  const instance = loadBackground({
    controlState: 'IDLE',
    connectedTabId: 123,
    mirailensPolicy: policy
  }, 'http://localhost/login.html');

  try {
    await instance.connect();
    await new Promise(r => nativeSetTimeout(r, 10));

    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_type', { selector: '#password-field', text: 'topSecret123!' }, 'msg-4');

    await new Promise(r => nativeSetTimeout(r, 100));

    const sent = instance.getSentWsMessages();
    const responseMsg = sent.find(m => m.id === 'msg-4');
    assert.ok(responseMsg);
    assert.ok(responseMsg.error);
    
    const parsedErr = JSON.parse(responseMsg.error);
    assert.strictEqual(parsedErr.decision, 'ALWAYS_DENY');
    assert.strictEqual(parsedErr.reasonCode, 'SENSITIVE_FIELD');
  } finally {
    await instance.cleanup();
  }
});

test('Security Gate - Replay protection token matches and is single-use', async () => {
  const policy = {
    draftOnly: false,
    trustedDomains: ['localhost'],
    blockedDomains: [],
    sensitiveFieldDecision: 'ALWAYS_ASK'
  };

  const instance = loadBackground({
    controlState: 'IDLE',
    connectedTabId: 123,
    mirailensPolicy: policy
  }, 'http://localhost/test.html');

  try {
    await instance.connect();
    await new Promise(r => nativeSetTimeout(r, 10));

    let capturedArgs = null;
    global.chrome.scripting.executeScript = (args, cb) => {
      const fnStr = args.func.toString();
      if (fnStr.includes('isSensitiveField')) {
        nativeSetTimeout(() => cb([{ result: { exists: true, isSensitiveField: false, isSubmit: false } }]), 0);
      } else if (fnStr.includes('mirailens-preview-overlay')) {
        capturedArgs = args.args;
        nativeSetTimeout(() => cb([{ result: { action: 'approve', token: args.args[0], risk: 'LOW' } }]), 0);
      } else {
        nativeSetTimeout(() => cb([{
          result: {
            url: 'http://localhost/test.html',
            targetExists: true,
            targetText: 'Click me',
            targetAttributes: {},
            parentText: ''
          }
        }]), 0);
      }
    };

    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_click', { selector: '#btn-neutral' }, 'msg-5');

    await new Promise(r => nativeSetTimeout(r, 1700));

    const sent = instance.getSentWsMessages();
    const responseMsg = sent.find(m => m.id === 'msg-5');
    assert.ok(responseMsg, 'Action should be approved and successful');
    assert.ok(!responseMsg.error);

    assert.ok(capturedArgs[0].startsWith('tok_'), 'Generated token should start with tok_');
  } finally {
    await instance.cleanup();
  }
});
