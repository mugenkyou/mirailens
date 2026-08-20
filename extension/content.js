// Listen for trusted user mouse clicks or key presses on the tab
window.addEventListener('mousedown', (event) => {
  if (event.isTrusted) {
    chrome.runtime.sendMessage({ type: 'user_interaction', eventType: 'mousedown' });
  }
}, { capture: true });

window.addEventListener('keydown', (event) => {
  if (event.isTrusted) {
    chrome.runtime.sendMessage({ type: 'user_interaction', eventType: 'keydown' });
  }
}, { capture: true });
