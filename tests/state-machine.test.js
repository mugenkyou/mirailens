import fs from 'fs';
import path from 'path';
import assert from 'assert';
import test from 'node:test';

const nativeSetTimeout = global.setTimeout;

// Helper to load background script in a fresh mock environment
function loadBackground(initialStorage = {}) {
  const chromeListeners = {
    message: [],
    tabActivated: [],
    tabRemoved: [],
    tabUpdated: [],
    storageChanged: [],
  };

  const mockStorage = new Map(Object.entries(initialStorage));
  
  // Override set to trigger onChanged
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

  // Track all timers created during this instance's lifetime
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
      onInstalled: {
        addListener: () => {}
      },
      onStartup: {
        addListener: () => {}
      },
      onSuspend: {
        addListener: () => {}
      }
    },
    commands: {
      onCommand: {
        addListener: () => {}
      }
    },
    tabs: {
      query: (queryInfo, cb) => {
        nativeSetTimeout(() => cb([{ id: 123, active: true }]), 0);
      },
      update: (tabId, props, cb) => {
        if (cb) nativeSetTimeout(() => cb({ id: tabId }), 0);
      },
      onActivated: {
        addListener: (fn) => chromeListeners.tabActivated.push(fn)
      },
      onRemoved: {
        addListener: (fn) => chromeListeners.tabRemoved.push(fn)
      },
      onUpdated: {
        addListener: (fn) => chromeListeners.tabUpdated.push(fn)
      }
    },
    scripting: {
      executeScript: (args, cb) => {
        nativeSetTimeout(() => cb([{ result: { action: 'approve' } }]), 0);
      }
    },
    windows: {
      getAll: (cb) => nativeSetTimeout(() => cb([{ id: 1 }]), 0),
      onRemoved: {
        addListener: () => {}
      }
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
      this.readyState = 3; // CLOSED
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
  
  // Evaluate the code using Function, injecting Chrome mocks
  const evalFunc = new Function('chrome', 'WebSocket', code);
  evalFunc(chromeMock, MockWebSocket);

  // Return API to interact with the loaded instance
  return {
    chromeListeners,
    mockStorage,
    getPopupStatus: () => popupStatus,
    getSentWsMessages: () => sentWsMessages,
    clearSentWsMessages: () => { sentWsMessages = []; },
    getWsInstance: () => wsInstance,
    
    cleanup: () => new Promise(resolve => {
      // Restore globals
      global.setTimeout = originalSetTimeout;
      global.setInterval = originalSetInterval;
      global.clearTimeout = originalClearTimeout;
      global.clearInterval = originalClearInterval;

      // Clear all active timers for this instance
      activeTimeouts.forEach(id => originalClearTimeout(id));
      activeIntervals.forEach(id => originalClearInterval(id));
      activeTimeouts.clear();
      activeIntervals.clear();

      if (chromeListeners.message[0]) {
        chromeListeners.message[0]({ cmd: 'disconnect' }, {}, () => {
          resolve();
        });
      } else {
        resolve();
      }
    }),

    // Helper to query control state
    getStatus: () => new Promise(resolve => {
      chromeListeners.message[0]({ cmd: 'getStatus' }, {}, resolve);
    }),

    // Helper to trigger connection from popup
    connect: () => new Promise(resolve => {
      chromeListeners.message[0]({ cmd: 'connect' }, {}, resolve);
    }),
    
    // Helper to send message from popup
    sendPopupControl: (action) => new Promise(resolve => {
      chromeListeners.message[0]({ cmd: 'control_action', action }, {}, resolve);
    }),

    // Helper to send message from content script
    sendUserInteraction: (eventType, tabId = 123) => new Promise(resolve => {
      chromeListeners.message[0](
        { type: 'user_interaction', eventType },
        { tab: { id: tabId } },
        resolve
      );
    }),

    // Helper to simulate incoming MCP socket command
    simulateMcpMessage: (type, payload = {}, id = 'msg-123') => {
      if (wsInstance && wsInstance.onmessage) {
        wsInstance.onmessage({
          data: JSON.stringify({ id, type, payload })
        });
      }
    }
  };
}

test('Initial state is IDLE, then transitions to AGENT_RUNNING and back to IDLE upon tool completion', async () => {
  const instance = loadBackground();
  try {
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10)); // wait for open

    // Verify initial state
    let status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'IDLE');

    // Set connected tab
    await instance.mockStorage.set('connectedTabId', 123);

    // Simulate MCP tool call (e.g. browser_wait)
    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_wait', { time: 0.05 }, 'msg-1');

    // Wait for transition to AGENT_RUNNING
    await new Promise(resolve => nativeSetTimeout(resolve, 10));
    status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'AGENT_RUNNING');

    // Wait for wait to finish and verify it transitions back to IDLE
    await new Promise(resolve => nativeSetTimeout(resolve, 80));
    status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'IDLE');

    // Verify completion response sent back to server
    const wsMsgs = instance.getSentWsMessages();
    const responseMsg = wsMsgs.find(m => m.id === 'msg-1');
    assert.ok(responseMsg);
    assert.strictEqual(responseMsg.result, true);
  } finally {
    await instance.cleanup();
  }
});

test('Emergency stop aborts in-flight actions and blocks future execution', async () => {
  const instance = loadBackground();
  try {
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Set connected tab
    await instance.mockStorage.set('connectedTabId', 123);

    // Trigger browser_wait
    instance.simulateMcpMessage('browser_wait', { time: 5 }, 'msg-2');
    await new Promise(resolve => nativeSetTimeout(resolve, 5));

    let status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'AGENT_RUNNING');

    // Trigger Emergency Stop from popup
    instance.clearSentWsMessages();
    await instance.sendPopupControl('EMERGENCY_STOP');

    // Verify it transitioned to BLOCKED
    status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'BLOCKED');

    // Verify the in-flight wait was rejected and error sent to server
    await new Promise(resolve => nativeSetTimeout(resolve, 10));
    const wsMsgs = instance.getSentWsMessages();
    const errorMsg = wsMsgs.find(m => m.id === 'msg-2');
    assert.ok(errorMsg);
    assert.ok(errorMsg.error);
    assert.match(JSON.stringify(errorMsg.error), /Execution halted/);

    // Try to send another browser tool - should be gated and rejected
    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_wait', { time: 1 }, 'msg-3');
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    const wsMsgs2 = instance.getSentWsMessages();
    const rejectMsg = wsMsgs2.find(m => m.id === 'msg-3');
    assert.ok(rejectMsg);
    assert.ok(rejectMsg.error);
    assert.match(JSON.stringify(rejectMsg.error), /AI execution is blocked/);
  } finally {
    await instance.cleanup();
  }
});

test('Implicit user interaction on connected tab triggers takeover and halts AI execution', async () => {
  const instance = loadBackground();
  try {
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Set connected tab
    await instance.mockStorage.set('connectedTabId', 123);

    // Trigger long wait
    instance.simulateMcpMessage('browser_wait', { time: 10 }, 'msg-4');
    await new Promise(resolve => nativeSetTimeout(resolve, 5));

    let status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'AGENT_RUNNING');

    // Simulate user interaction on the connected tab
    instance.clearSentWsMessages();
    await instance.sendUserInteraction('mousedown', 123); // connected tab

    // Settle takeover transitions
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Verify state transitioned to HUMAN_CONTROLLED
    status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'HUMAN_CONTROLLED');

    // Verify in-flight action was aborted
    const wsMsgs = instance.getSentWsMessages();
    const abortMsg = wsMsgs.find(m => m.id === 'msg-4');
    assert.ok(abortMsg);
    assert.match(JSON.stringify(abortMsg.error), /Execution halted/);

    // Try to send browser action - should fail
    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_wait', { time: 1 }, 'msg-5');
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    const wsMsgs2 = instance.getSentWsMessages();
    const rejectMsg = wsMsgs2.find(m => m.id === 'msg-5');
    assert.ok(rejectMsg);
    assert.match(JSON.stringify(rejectMsg.error), /AI execution is blocked/);
  } finally {
    await instance.cleanup();
  }
});

test('Implicit user interaction on unrelated tab does NOT trigger takeover', async () => {
  const instance = loadBackground();
  try {
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Set connected tab to 123
    await instance.mockStorage.set('connectedTabId', 123);

    // Trigger wait
    instance.simulateMcpMessage('browser_wait', { time: 5 }, 'msg-6');
    await new Promise(resolve => nativeSetTimeout(resolve, 5));

    // Simulate user interaction on a different tab (456)
    await instance.sendUserInteraction('mousedown', 456);
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // State should remain AGENT_RUNNING
    let status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'AGENT_RUNNING');
  } finally {
    await instance.cleanup();
  }
});

test('AI/Server cannot bypass control checks or force resume when human holds control', async () => {
  const instance = loadBackground();
  try {
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Set connected tab
    await instance.mockStorage.set('connectedTabId', 123);

    // Explicit Take Control
    await instance.sendPopupControl('TAKE_CONTROL');
    let status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'HUMAN_CONTROLLED');

    // Try to force resume from AI (simulating socket payload without source: 'human')
    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_control', { action: 'RESUME', source: 'ai' }, 'msg-7');
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Resume must be rejected
    const wsMsgs = instance.getSentWsMessages();
    const rejectMsg = wsMsgs.find(m => m.id === 'msg-7');
    assert.ok(rejectMsg);
    assert.ok(rejectMsg.error);
    assert.match(JSON.stringify(rejectMsg.error), /Cannot resume: human holds control/);

    // State remains HUMAN_CONTROLLED
    status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'HUMAN_CONTROLLED');

    // Return control from human (source: 'human')
    await instance.sendPopupControl('RETURN_CONTROL');
    status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'IDLE');
  } finally {
    await instance.cleanup();
  }
});

test('Heartbeat sends periodic pings and handles pongs correctly', async () => {
  let timerCallbacks = [];
  const originalSetInterval = global.setInterval;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  
  // Custom timer mocks to trigger heartbeats instantly
  global.setInterval = (cb, delay) => {
    timerCallbacks.push({ cb, delay, type: 'interval' });
    return 1;
  };
  global.setTimeout = (cb, delay) => {
    timerCallbacks.push({ cb, delay, type: 'timeout' });
    return 2;
  };
  global.clearTimeout = (id) => {
    timerCallbacks = timerCallbacks.filter(t => t.type !== 'timeout');
  };

  const instance = loadBackground();
  try {
    await instance.connect();
    // Wait for connection to open and triggers heartbeat interval
    await new Promise(resolve => nativeSetTimeout(resolve, 15));

    const intervalTimer = timerCallbacks.find(t => t.type === 'interval' && t.delay === 10000);
    assert.ok(intervalTimer);

    // Trigger heartbeat ping
    instance.clearSentWsMessages();
    intervalTimer.cb();

    // Verify heartbeat ping was sent
    const wsMsgs = instance.getSentWsMessages();
    const pingMsg = wsMsgs.find(m => m.type === 'heartbeat_ping');
    assert.ok(pingMsg);

    // Verify heartbeat timeout was registered
    const timeoutTimer = timerCallbacks.find(t => t.type === 'timeout' && t.delay === 5000);
    assert.ok(timeoutTimer);

    // Send pong to background
    let closeCalled = false;
    instance.getWsInstance().close = () => { closeCalled = true; };

    instance.getWsInstance().onmessage({
      data: JSON.stringify({ type: 'heartbeat_pong', result: 'pong' })
    });

    // Verify timeout timer was cancelled (removed from callbacks)
    const activeTimeout = timerCallbacks.find(t => t.type === 'timeout');
    assert.strictEqual(activeTimeout, undefined);
    assert.strictEqual(closeCalled, false);
  } finally {
    global.setInterval = originalSetInterval;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    await instance.cleanup();
  }
});

test('AI/Server cannot bypass control checks by sending source: human in message payload', async () => {
  const instance = loadBackground();
  try {
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));
    await instance.mockStorage.set('connectedTabId', 123);

    // Human takeover
    await instance.sendPopupControl('TAKE_CONTROL');
    let status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'HUMAN_CONTROLLED');

    // Try to send RESUME command with source: 'human' via websocket
    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_control', { action: 'RESUME', source: 'human' }, 'msg-resume-spoof');
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Verify it was rejected because source is forced to 'ai'
    const wsMsgs = instance.getSentWsMessages();
    const rejectMsg = wsMsgs.find(m => m.id === 'msg-resume-spoof');
    assert.ok(rejectMsg);
    assert.ok(rejectMsg.error);
    assert.match(JSON.stringify(rejectMsg.error), /Cannot resume: human holds control/);

    // State remains HUMAN_CONTROLLED
    status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'HUMAN_CONTROLLED');
  } finally {
    await instance.cleanup();
  }
});

test('Emergency stop cannot be bypassed by AI resume, and is persistent across reloads', async () => {
  const instance = loadBackground();
  try {
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));
    await instance.mockStorage.set('connectedTabId', 123);

    // Activate emergency stop
    await instance.sendPopupControl('EMERGENCY_STOP');
    let status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'BLOCKED');
    
    // Verify emergency stop flag is set in storage
    const isStopStored = await new Promise(resolve => {
      chrome.storage.local.get('isEmergencyStop', (data) => resolve(data.isEmergencyStop));
    });
    assert.strictEqual(isStopStored, true);

    // AI tries to resume
    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_control', { action: 'RESUME' }, 'msg-resume-blocked');
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Verify resume rejected
    let wsMsgs = instance.getSentWsMessages();
    let rejectMsg = wsMsgs.find(m => m.id === 'msg-resume-blocked');
    assert.ok(rejectMsg);
    assert.match(JSON.stringify(rejectMsg.error), /Emergency Stop is active/);

    // Reload extension simulation: load background again, which should restore from storage
    await instance.cleanup();
    
    const instance2 = loadBackground({
      isEmergencyStop: true,
      controlState: 'BLOCKED'
    });
    await instance2.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 15));
    
    // Verify restored state is BLOCKED
    let status2 = await instance2.getStatus();
    assert.strictEqual(status2.controlState, 'BLOCKED');

    // AI tries to run browser action
    instance2.clearSentWsMessages();
    instance2.simulateMcpMessage('browser_wait', { time: 1 }, 'msg-action-during-stop');
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Verify action rejected
    wsMsgs = instance2.getSentWsMessages();
    const actionRejectMsg = wsMsgs.find(m => m.id === 'msg-action-during-stop');
    assert.ok(actionRejectMsg);
    assert.match(JSON.stringify(actionRejectMsg.error), /AI execution is blocked/);
    
    // Clean up instance2
    await instance2.cleanup();
  } finally {
    await instance.cleanup();
  }
});

test('AI-requested pause can be resumed by AI, but Human-requested pause cannot', async () => {
  const instance = loadBackground();
  try {
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));
    await instance.mockStorage.set('connectedTabId', 123);

    // 1. AI-requested pause
    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_control', { action: 'PAUSE' }, 'msg-ai-pause');
    await new Promise(resolve => nativeSetTimeout(resolve, 10));
    
    let status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'BLOCKED');

    // AI resumes
    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_control', { action: 'RESUME' }, 'msg-ai-resume-1');
    await new Promise(resolve => nativeSetTimeout(resolve, 10));
    
    // State transitions to IDLE
    status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'IDLE');

    // 2. Human-requested pause
    await instance.sendPopupControl('PAUSE');
    status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'BLOCKED');

    // AI tries to resume
    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_control', { action: 'RESUME' }, 'msg-ai-resume-2');
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Should fail because paused by human
    let wsMsgs = instance.getSentWsMessages();
    let rejectMsg = wsMsgs.find(m => m.id === 'msg-ai-resume-2');
    assert.ok(rejectMsg);
    assert.match(JSON.stringify(rejectMsg.error), /paused by human/);

    // Human resumes
    await instance.sendPopupControl('RESUME');
    status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'IDLE');
  } finally {
    await instance.cleanup();
  }
});

test('Concurrent AI actions are blocked at canExecuteAIAction gate', async () => {
  const instance = loadBackground();
  try {
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));
    await instance.mockStorage.set('connectedTabId', 123);

    // Start a long-running wait action
    instance.simulateMcpMessage('browser_wait', { time: 5 }, 'msg-wait-long');
    await new Promise(resolve => nativeSetTimeout(resolve, 5));
    
    let status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'AGENT_RUNNING');

    // Start a second action concurrently
    instance.clearSentWsMessages();
    instance.simulateMcpMessage('browser_wait', { time: 1 }, 'msg-wait-concurrent');
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Second action must be immediately rejected as another action is in progress
    const wsMsgs = instance.getSentWsMessages();
    const rejectMsg = wsMsgs.find(m => m.id === 'msg-wait-concurrent');
    assert.ok(rejectMsg);
    assert.match(JSON.stringify(rejectMsg.error), /Another AI action is currently in progress/);
  } finally {
    await instance.cleanup();
  }
});

test('WebSocket disconnection aborts active actions and transitions to a safe state', async () => {
  const instance = loadBackground();
  try {
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));
    await instance.mockStorage.set('connectedTabId', 123);

    // Start action
    instance.simulateMcpMessage('browser_wait', { time: 5 }, 'msg-active-disc');
    await new Promise(resolve => nativeSetTimeout(resolve, 5));

    let status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'AGENT_RUNNING');

    // Trigger ws disconnect
    instance.getWsInstance().close();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // State should transition back to IDLE
    status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'IDLE');
  } finally {
    await instance.cleanup();
  }
});

test('Closing connected tab clears connectedTabId and aborts pending actions', async () => {
  const instance = loadBackground();
  try {
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));
    await instance.mockStorage.set('connectedTabId', 123);

    // Verify connected tab is set in storage
    let storedTabId = await new Promise(resolve => {
      chrome.storage.local.get('connectedTabId', (data) => resolve(data.connectedTabId));
    });
    assert.strictEqual(storedTabId, 123);

    // Trigger tab removed listener
    const removeListener = instance.chromeListeners.tabRemoved[0];
    assert.ok(removeListener);
    removeListener(123); // tab 123 closed

    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Verify connectedTabId is cleared from storage
    storedTabId = await new Promise(resolve => {
      chrome.storage.local.get('connectedTabId', (data) => resolve(data.connectedTabId));
    });
    assert.strictEqual(storedTabId, undefined);
  } finally {
    await instance.cleanup();
  }
});

test('Explicit disconnect prevents reconnect and resets control state to IDLE', async () => {
  const instance = loadBackground();
  try {
    // 1. Connect
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Verify CONNECTED
    let status = await instance.getStatus();
    assert.strictEqual(status.status, 'connected');

    // 2. Put controlState to HUMAN_CONTROLLED
    await instance.sendPopupControl('TAKE_CONTROL');
    status = await instance.getStatus();
    assert.strictEqual(status.controlState, 'HUMAN_CONTROLLED');

    // 3. Disconnect
    await new Promise(resolve => {
      instance.chromeListeners.message[0]({ cmd: 'disconnect' }, {}, resolve);
    });
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // Verify DISCONNECTED and controlState reset to IDLE
    status = await instance.getStatus();
    assert.strictEqual(status.status, 'disconnected');
    assert.strictEqual(status.controlState, 'IDLE');

    // 4. Wait to ensure no auto-reconnect happens
    await new Promise(resolve => nativeSetTimeout(resolve, 100));
    status = await instance.getStatus();
    assert.strictEqual(status.status, 'disconnected');
  } finally {
    await instance.cleanup();
  }
});

test('Stale WebSocket callbacks are ignored via connection generation', async () => {
  const instance = loadBackground();
  try {
    // 1. Connect
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    const oldWs = instance.getWsInstance();
    assert.ok(oldWs);

    // 2. Disconnect
    await new Promise(resolve => {
      instance.chromeListeners.message[0]({ cmd: 'disconnect' }, {}, resolve);
    });
    await new Promise(resolve => nativeSetTimeout(resolve, 10));

    // 3. Simulate stale socket triggering onopen or onclose
    let status = await instance.getStatus();
    assert.strictEqual(status.status, 'disconnected');

    // If the old WS triggers open, it must NOT connect
    if (oldWs.onopen) {
      oldWs.onopen();
    }
    status = await instance.getStatus();
    assert.strictEqual(status.status, 'disconnected');

    // If the old WS triggers close, it must NOT start reconnect timer
    if (oldWs.onclose) {
      oldWs.onclose();
    }
    await new Promise(resolve => nativeSetTimeout(resolve, 100));
    status = await instance.getStatus();
    assert.strictEqual(status.status, 'disconnected');
  } finally {
    await instance.cleanup();
  }
});

test('Reopening popup / getStatus query does not automatically reconnect', async () => {
  const instance = loadBackground();
  try {
    let status = await instance.getStatus();
    assert.strictEqual(status.status, 'disconnected');

    // Query status multiple times simulating popup opening/closing
    status = await instance.getStatus();
    assert.strictEqual(status.status, 'disconnected');

    await new Promise(resolve => nativeSetTimeout(resolve, 50));
    status = await instance.getStatus();
    assert.strictEqual(status.status, 'disconnected');
  } finally {
    await instance.cleanup();
  }
});

test('Manual reconnect after explicit disconnect works successfully', async () => {
  const instance = loadBackground();
  try {
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));
    let status = await instance.getStatus();
    assert.strictEqual(status.status, 'connected');

    // Disconnect
    await new Promise(resolve => {
      instance.chromeListeners.message[0]({ cmd: 'disconnect' }, {}, resolve);
    });
    status = await instance.getStatus();
    assert.strictEqual(status.status, 'disconnected');

    // Connect manually again
    await instance.connect();
    await new Promise(resolve => nativeSetTimeout(resolve, 10));
    status = await instance.getStatus();
    assert.strictEqual(status.status, 'connected');
  } finally {
    await instance.cleanup();
  }
});
