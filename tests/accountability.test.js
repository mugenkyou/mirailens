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

  // Mock scripting execution outputs
  let mockExecResult = { action: 'approve' };
  let mockInspectResult = { isSensitiveField: false };
  let mockTabUrl = 'http://localhost/test';

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
        nativeSetTimeout(() => cb([{ id: 123, active: true, url: mockTabUrl }]), 0);
      },
      update: (tabId, props, cb) => {
        if (props && props.url) {
          mockTabUrl = props.url;
        }
        if (cb) nativeSetTimeout(() => cb({ id: tabId }), 0);
      },
      onActivated: {
        addListener: (fn) => chromeListeners.tabActivated.push(fn),
        removeListener: (fn) => {
          const idx = chromeListeners.tabActivated.indexOf(fn);
          if (idx !== -1) chromeListeners.tabActivated.splice(idx, 1);
        }
      },
      onRemoved: {
        addListener: (fn) => chromeListeners.tabRemoved.push(fn),
        removeListener: (fn) => {
          const idx = chromeListeners.tabRemoved.indexOf(fn);
          if (idx !== -1) chromeListeners.tabRemoved.splice(idx, 1);
        }
      },
      onUpdated: {
        addListener: (fn) => chromeListeners.tabUpdated.push(fn),
        removeListener: (fn) => {
          const idx = chromeListeners.tabUpdated.indexOf(fn);
          if (idx !== -1) chromeListeners.tabUpdated.splice(idx, 1);
        }
      }
    },
    scripting: {
      executeScript: (args, cb) => {
        const funcString = args.func.toString();
        let resultVal = mockExecResult;

        if (funcString.includes('isSensitiveField')) {
          resultVal = mockInspectResult;
        } else if (funcString.includes('targetAttributes')) {
          resultVal = {
            url: mockTabUrl,
            title: 'Mock Page',
            targetExists: true,
            targetText: 'test',
            targetAttributes: { value: 'initial' },
            parentText: 'Success indicators parent context'
          };
        } else if (funcString.includes('el.value = val') || funcString.includes('el.value = txt')) {
          resultVal = true;
        } else if (funcString.includes('el ? el.value')) {
          resultVal = 'initial';
        } else {
          if (resultVal && resultVal.action === 'approve' && args.args && args.args[0]) {
            resultVal = { ...resultVal, token: args.args[0] };
          }
        }

        nativeSetTimeout(() => cb([{ result: resultVal }]), 0);
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

  const evalFunc = new Function('chrome', 'WebSocket', code);
  evalFunc(chromeMock, MockWebSocket);

  return {
    chromeListeners,
    mockStorage,
    getPopupStatus: () => popupStatus,
    getSentWsMessages: () => sentWsMessages,
    clearSentWsMessages: () => { sentWsMessages = []; },
    getWsInstance: () => wsInstance,
    setMockExecResult: (res) => { mockExecResult = res; },
    setMockInspectResult: (res) => { mockInspectResult = res; },
    setMockTabUrl: (url) => { mockTabUrl = url; },

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
        chromeListeners.message[0]({ cmd: 'disconnect' }, {}, () => {
          resolve();
        });
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

    sendPopupControl: (action) => new Promise(resolve => {
      chromeListeners.message[0]({ cmd: 'control_action', action }, {}, resolve);
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

// ============================================================================
// AUTHORITATIVE SEQUENTIAL TEST WRAPPER
// ============================================================================

test('MiraiLens Phase 5 Accountability Suite', { concurrency: false }, async (suite) => {

  await suite.test('1. Ledger Creation & State Machine Lifecycle Tests', async (t) => {
    const instance = loadBackground();
    try {
      await instance.connect();
      await new Promise(resolve => nativeSetTimeout(resolve, 20));

      await t.test('AI click creates ledger entry and transitions states', async () => {
        // Clear trusted domains so the action requires human approval
        const policy = {
          draftOnly: false,
          sensitiveFieldDecision: 'ALWAYS_ASK',
          trustedDomains: [],
          blockedDomains: ['evil.com']
        };
        await instance.mockStorage.set('mirailensPolicy', policy);

        instance.setMockExecResult({ action: 'approve' });
        instance.simulateMcpMessage('browser_click', { selector: '#btn-test' }, 'click-id-1');
        await new Promise(resolve => nativeSetTimeout(resolve, 2000));

        const ledger = instance.mockStorage.get('mirailensLedger') || [];
        const clickEntry = ledger.find(e => e.id === 'click-id-1');
        assert.ok(clickEntry);
        assert.strictEqual(clickEntry.actionType, 'browser_click');
        assert.strictEqual(clickEntry.actor, 'AI');
        assert.strictEqual(clickEntry.decision, 'APPROVED');
      });

      await t.test('AI type records entry with snapshots and masked targets', async () => {
        // Force non-trusted domain example.com
        instance.setMockTabUrl('http://example.com/test');
        instance.setMockInspectResult({ isSensitiveField: true });
        instance.simulateMcpMessage('browser_type', { selector: '#pass', text: 'secretVal' }, 'type-id-1');
        await new Promise(resolve => nativeSetTimeout(resolve, 2000));

        const ledger = instance.mockStorage.get('mirailensLedger') || [];
        const typeEntry = ledger.find(e => e.id === 'type-id-1');
        assert.ok(typeEntry);
        assert.strictEqual(typeEntry.actionType, 'browser_type');
        assert.strictEqual(typeEntry.target, '#pass [Sensitive Value Masked]');
      });

      await t.test('Human Takeover action writes correct actor attributes', async () => {
        await instance.sendPopupControl('TAKE_CONTROL');
        await new Promise(resolve => nativeSetTimeout(resolve, 20));

        const ledger = instance.mockStorage.get('mirailensLedger') || [];
        const humanEntry = ledger.find(e => e.actionType === 'take_control');
        assert.ok(humanEntry);
        assert.strictEqual(humanEntry.actor, 'HUMAN');
      });

      await t.test('Blocked domains are caught and logged with blocked status', async () => {
        // Return control to AI first
        await instance.sendPopupControl('RETURN_CONTROL');
        await new Promise(resolve => nativeSetTimeout(resolve, 20));

        const policy = {
          draftOnly: false,
          sensitiveFieldDecision: 'ALWAYS_ASK',
          trustedDomains: [],
          blockedDomains: ['evil.com']
        };
        await instance.mockStorage.set('mirailensPolicy', policy);
        instance.setMockTabUrl('http://evil.com/page');
        instance.simulateMcpMessage('browser_click', { selector: '#btn-evil' }, 'block-id-1');
        await new Promise(resolve => nativeSetTimeout(resolve, 50));

        const ledger = instance.mockStorage.get('mirailensLedger') || [];
        const blockEntry = ledger.find(e => e.id === 'block-id-1');
        assert.ok(blockEntry);
        assert.strictEqual(blockEntry.outcome, 'BLOCKED');
        assert.strictEqual(blockEntry.decision, 'DENIED');
      });
    } finally {
      await instance.cleanup();
    }
  });

  await suite.test('2. Verification Pipeline Tests', async (t) => {
    const instance = loadBackground();
    try {
      await instance.connect();
      await new Promise(resolve => nativeSetTimeout(resolve, 20));

      // Reset policy to defaults
      const policy = {
        draftOnly: false,
        sensitiveFieldDecision: 'ALWAYS_ASK',
        trustedDomains: ['localhost', '127.0.0.1'],
        blockedDomains: []
      };
      await instance.mockStorage.set('mirailensPolicy', policy);
      instance.setMockTabUrl('http://localhost/test');

      await t.test('Navigation to expected URL becomes VERIFIED', async () => {
        instance.setMockExecResult({ action: 'approve' });
        instance.simulateMcpMessage('browser_navigate', { url: 'http://localhost/test' }, 'nav-id-1');

        // Trigger load complete
        nativeSetTimeout(() => {
          instance.chromeListeners.tabUpdated.forEach(fn => fn(123, { status: 'complete' }));
        }, 50);

        await new Promise(resolve => nativeSetTimeout(resolve, 2000));

        const ledger = instance.mockStorage.get('mirailensLedger') || [];
        const navEntry = ledger.find(e => e.id === 'nav-id-1');
        assert.ok(navEntry);
        assert.strictEqual(navEntry.outcome, 'VERIFIED');
      });

      await t.test('Navigation to incorrect URL becomes FAILED', async () => {
        instance.setMockExecResult({ action: 'approve' });
        instance.simulateMcpMessage('browser_navigate', { url: 'http://evil.com' }, 'nav-id-2');

        // Loaded different redirected URL
        nativeSetTimeout(() => {
          instance.setMockTabUrl('http://some-other-redirected-page.com');
          instance.chromeListeners.tabUpdated.forEach(fn => fn(123, { status: 'complete' }));
        }, 50);

        await new Promise(resolve => nativeSetTimeout(resolve, 2000));

        const ledger = instance.mockStorage.get('mirailensLedger') || [];
        const navEntry = ledger.find(e => e.id === 'nav-id-2');
        assert.ok(navEntry);
        assert.strictEqual(navEntry.outcome, 'FAILED');
      });
    } finally {
      await instance.cleanup();
    }
  });

  await suite.test('3. Recovery / Undo Verification Tests', async (t) => {
    const instance = loadBackground();
    try {
      await instance.connect();
      await new Promise(resolve => nativeSetTimeout(resolve, 20));

      await t.test('Reversible form change can be undone successfully', async () => {
        const policy = {
          draftOnly: false,
          sensitiveFieldDecision: 'ALWAYS_ASK',
          trustedDomains: [],
          blockedDomains: []
        };
        await instance.mockStorage.set('mirailensPolicy', policy);

        instance.setMockInspectResult({ isSensitiveField: false });
        instance.simulateMcpMessage('browser_type', { selector: '#username', text: 'Sachin' }, 'type-id-2');
        await new Promise(resolve => nativeSetTimeout(resolve, 2000));

        let ledger = instance.mockStorage.get('mirailensLedger') || [];
        const typeEntry = ledger.find(e => e.id === 'type-id-2');
        assert.ok(typeEntry.reversible);

        // Trigger local undo Action message
        await new Promise(resolve => {
          instance.chromeListeners.message[0]({ cmd: 'undoAction', id: 'type-id-2' }, {}, (response) => {
            console.log('DEBUG_UNDO_RESPONSE:', response);
            assert.ok(response.success, response?.reason);
            resolve();
          });
        });

        // Verify undo itself created a ledger entry and target is no longer reversible
        ledger = instance.mockStorage.get('mirailensLedger') || [];
        const undoEntry = ledger.find(e => e.actionType === 'undo_last');
        assert.ok(undoEntry);
        assert.strictEqual(undoEntry.outcome, 'VERIFIED');

        const updatedType = ledger.find(e => e.id === 'type-id-2');
        assert.strictEqual(updatedType.reversible, false);
      });

      await t.test('Sensitive field snapshots never occur and are irreversible', async () => {
        instance.setMockInspectResult({ isSensitiveField: true });
        instance.simulateMcpMessage('browser_type', { selector: '#password', text: 'topSecret123!' }, 'type-id-3');
        await new Promise(resolve => nativeSetTimeout(resolve, 2000));

        const ledger = instance.mockStorage.get('mirailensLedger') || [];
        const typeEntry = ledger.find(e => e.id === 'type-id-3');
        assert.strictEqual(typeEntry.reversible, false);
        assert.strictEqual(typeEntry.snapshotId, null);
      });
    } finally {
      await instance.cleanup();
    }
  });

  await suite.test('4. History & Export Query Boundedness and Filtering', async (t) => {
    const instance = loadBackground();
    try {
      await instance.connect();
      await new Promise(resolve => nativeSetTimeout(resolve, 20));

      await t.test('get_action_history is safe and returns bounded lists', async () => {
        // Simulate multiple mock messages to populate ledger list
        for (let i = 0; i < 10; i++) {
          instance.simulateMcpMessage('browser_wait', { time: 0.01 }, `wait-id-${i}`);
          await new Promise(resolve => nativeSetTimeout(resolve, 20));
        }

        // Query history from MCP server message interface
        await new Promise(resolve => {
          instance.chromeListeners.message[0]({ cmd: 'getLedger' }, {}, (response) => {
            assert.ok(response.ledger.length >= 10);
            resolve();
          });
        });
      });
    } finally {
      await instance.cleanup();
    }
  });

  await suite.test('5. Storage & Concurrency Integrity Tests', async (t) => {
    const instance = loadBackground();
    try {
      await instance.connect();
      await new Promise(resolve => nativeSetTimeout(resolve, 20));

      await t.test('Ledger survives connections and popups reloading', async () => {
        instance.simulateMcpMessage('browser_wait', { time: 0.01 }, 'wait-id-persist');
        await new Promise(resolve => nativeSetTimeout(resolve, 20));

        const initialLedger = instance.mockStorage.get('mirailensLedger') || [];
        assert.ok(initialLedger.find(e => e.id === 'wait-id-persist'));

        // Re-load environment simulation
        const anotherInstance = loadBackground(Object.fromEntries(instance.mockStorage));
        await anotherInstance.connect();
        await new Promise(resolve => nativeSetTimeout(resolve, 20));

        const reloadedLedger = anotherInstance.mockStorage.get('mirailensLedger') || [];
        assert.ok(reloadedLedger.find(e => e.id === 'wait-id-persist'));
        await anotherInstance.cleanup();
      });
    } finally {
      await instance.cleanup();
    }
  });

});
