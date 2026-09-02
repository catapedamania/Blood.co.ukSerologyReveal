// background.js
console.log('[background] starting');

async function safeExecuteScript(target, files, world = 'MAIN') {
  try {
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      console.warn('[background] chrome.scripting.executeScript not available');
      return { ok: false, error: 'scripting API not available' };
    }
    const results = await chrome.scripting.executeScript({ target, files, world });
    console.log('[background] executeScript succeeded', target);
    return { ok: true, results };
  } catch (err) {
    console.warn('[background] executeScript failed', err && err.message);
    return { ok: false, error: String(err) };
  }
}

async function tryRegisterContentScript() {
  try {
    if (!chrome.scripting || !chrome.scripting.registerContentScripts) {
      console.warn('[background] chrome.scripting.registerContentScripts not available');
      return { ok: false, error: 'registerContentScripts not available' };
    }

    // Unregister previous registration to avoid duplicates
    try {
      if (chrome.scripting.unregisterContentScripts) {
        await chrome.scripting.unregisterContentScripts({ ids: ['bs-page-inject'] });
        console.log('[background] unregistered previous bs-page-inject if present');
      }
    } catch (e) {
      console.warn('[background] unregisterContentScripts failed or not supported', e && e.message);
    }

    await chrome.scripting.registerContentScripts([{
      id: 'bs-page-inject',
      js: ['page_inject.js'],
      matches: ['https://my.blood.co.uk/*'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: true
    }]);
    console.log('[background] registered page_inject via registerContentScripts (document_start, allFrames:true)');
    return { ok: true };
  } catch (e) {
    console.warn('[background] registerContentScripts failed (maybe already registered)', e && e.message);
    return { ok: false, error: String(e) };
  }
}

// Register on install/startup
chrome.runtime.onInstalled.addListener(() => {
  tryRegisterContentScript();
});
tryRegisterContentScript().catch(() => { /* ignore */ });

// Fallback: add webNavigation listeners if available
if (chrome.webNavigation && chrome.webNavigation.onCommitted && chrome.webNavigation.onHistoryStateUpdated) {
  try {
    chrome.webNavigation.onCommitted.addListener((details) => {
      try {
        const url = details.url || '';
        if (!url.startsWith('https://my.blood.co.uk/')) return;
        if (!details.tabId) return;
        console.log('[background] onCommitted for', url, 'tab', details.tabId, 'frameId', details.frameId);
        safeExecuteScript({ tabId: details.tabId, allFrames: true }, ['page_inject.js'], 'MAIN');
      } catch (e) {
        console.error('[background] onCommitted handler error', e && e.message);
      }
    });

    chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
      try {
        const url = details.url || '';
        if (!url.startsWith('https://my.blood.co.uk/')) return;
        if (!details.tabId) return;
        console.log('[background] onHistoryStateUpdated for', url, 'tab', details.tabId, 'frameId', details.frameId);
        safeExecuteScript({ tabId: details.tabId, allFrames: true }, ['page_inject.js'], 'MAIN');
      } catch (e) {
        console.error('[background] onHistoryStateUpdated handler error', e && e.message);
      }
    });

    console.log('[background] webNavigation listeners registered');
  } catch (e) {
    console.warn('[background] failed to register webNavigation listeners', e && e.message);
  }
} else {
  console.warn('[background] chrome.webNavigation API not available; skipping webNavigation listeners');
}

// Message handler for content script requests and token forwarding
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[background] onMessage', msg, 'from', sender && sender.tab && sender.tab.id);

  try {
    if (!msg || !msg.type) {
      sendResponse({ ok: false, reason: 'no-type' });
      return;
    }

    // Injection request from content script (fallback)
    if (msg.type === 'INJECT_PAGE_SCRIPT') {
      if (!sender.tab || !sender.tab.id) {
        sendResponse({ ok: false, error: 'no-tab' });
        return;
      }

      safeExecuteScript({ tabId: sender.tab.id, allFrames: true }, ['page_inject.js'], 'MAIN')
        .then(res => {
          if (res.ok) sendResponse({ ok: true });
          else sendResponse({ ok: false, error: res.error });
        }).catch(err => {
          sendResponse({ ok: false, error: String(err) });
        });

      return true; // keep channel open for async sendResponse
    }

    // Simple ping
    if (msg.type === 'BS_PING') {
      sendResponse({ ok: true, echo: msg.payload });
      return;
    }

    // Token forwarded from content script
    if (msg.type === 'BS_TOKEN') {
      chrome.storage.local.set({ bs_token: msg.token }, () => {
        if (chrome.runtime.lastError) {
          console.error('[background] storage error', chrome.runtime.lastError.message);
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('[background] token stored preview', msg.token && String(msg.token).slice(0,40));
          sendResponse({ ok: true, stored: true });
        }
      });
      return true; // async response
    }

    // Page hello forwarded
    if (msg.type === 'BS_PAGE_HELLO') {
      console.log('[background] page hello from tab', sender && sender.tab && sender.tab.id);
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, reason: 'unknown-type' });
  } catch (e) {
    console.error('[background] exception', e && e.message);
    try { sendResponse({ ok: false, error: String(e) }); } catch (e2) {}
  }
});
