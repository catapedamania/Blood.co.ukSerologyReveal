// content.js
console.log('[content] loaded (scripting injection)');

function cLog(...args) { try { console.log('[content]', ...args); } catch (e) {} }

function safeSendMessage(msg, cb) {
  try {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        cLog('sendMessage failed', chrome.runtime.lastError.message);
      } else {
        cLog('sendMessage resp', resp);
      }
      if (typeof cb === 'function') cb(resp);
    });
  } catch (e) {
    cLog('sendMessage exception', e && e.message);
  }
}

// Forward page messages to background
window.addEventListener('message', (ev) => {
  try {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'BS_TEST_FROM_PAGE') {
      cLog('BS_TEST_FROM_PAGE', data.payload);
      safeSendMessage({ type: 'BS_PING', payload: data.payload });
      return;
    }

    if (data.type === 'BloodSerologyExtToken') {
      cLog('token received preview', data.token && data.token.slice(0,40));
      safeSendMessage({ type: 'BS_TOKEN', token: data.token, sourceUrl: data.sourceUrl || null });
      return;
    }

    if (data.type === 'BS_PAGE_HELLO') {
      cLog('page hello', data);
      safeSendMessage({ type: 'BS_PAGE_HELLO' });
      return;
    }

    if (data.type === 'BloodSerologyExtDetails') {
      cLog('account details received keys', data.json && Object.keys(data.json || {}).slice(0,10));
      return;
    }
  } catch (e) {
    cLog('window.message handler error', e && e.message);
  }
}, false);

// Ask background to inject page_inject.js into the page main world
(function requestInjection() {
  try {
    cLog('requesting background to inject page_inject.js');
    chrome.runtime.sendMessage({ type: 'INJECT_PAGE_SCRIPT' }, (resp) => {
      if (chrome.runtime.lastError) {
        cLog('INJECT_PAGE_SCRIPT request failed', chrome.runtime.lastError.message);
      } else {
        cLog('INJECT_PAGE_SCRIPT response', resp);
      }
    });
  } catch (e) {
    cLog('requestInjection exception', e && e.message);
  }
})();
