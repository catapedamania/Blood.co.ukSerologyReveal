// background.js — cleaned, stable, MV3‑safe
console.log('[background] starting');

// Safe script injection wrapper
async function safeExecuteScript(target, files, world = 'MAIN') {
  try {
    const results = await chrome.scripting.executeScript({ target, files, world });
    console.log('[background] executeScript OK', target);
    return { ok: true, results };
  } catch (err) {
    console.warn('[background] executeScript FAIL', err?.message);
    return { ok: false, error: String(err) };
  }
}

// Register page_inject.js at document_start (MAIN world)
async function registerPageInject() {
  try {
    // Remove old registration if present
    if (chrome.scripting.unregisterContentScripts) {
      await chrome.scripting.unregisterContentScripts({ ids: ['bs-page-inject'] });
    }

    await chrome.scripting.registerContentScripts([{
      id: 'bs-page-inject',
      js: ['page_inject.js'],
      matches: ['https://my.blood.co.uk/*'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: true
    }]);

    console.log('[background] registered page_inject');
  } catch (e) {
    console.warn('[background] registerContentScripts error', e?.message);
  }
}

chrome.runtime.onInstalled.addListener(registerPageInject);
registerPageInject();

// Early MAIN‑world injection via navigation events
function earlyInject(details) {
  try {
    if (details.frameId !== 0) return;
    if (!details.url.startsWith('https://my.blood.co.uk/')) return;
    if (!details.tabId) return;

    console.log('[background] early inject', details.url, 'tab', details.tabId);
    safeExecuteScript({ tabId: details.tabId, frameIds: [0] }, ['page_inject.js'], 'MAIN');
  } catch (e) {
    console.error('[background] earlyInject error', e?.message);
  }
}

chrome.webNavigation.onCommitted.addListener(earlyInject);
chrome.webNavigation.onHistoryStateUpdated.addListener(earlyInject);

// Message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (!msg || !msg.type) {
      sendResponse({ ok: false, reason: 'no-type' });
      return;
    }

    // Fallback injection request
    if (msg.type === 'INJECT_PAGE_SCRIPT') {
      const tabId = sender.tab?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: 'no-tab' });
        return;
      }

      safeExecuteScript({ tabId, allFrames: true }, ['page_inject.js'], 'MAIN')
        .then(res => sendResponse(res))
        .catch(err => sendResponse({ ok: false, error: String(err) }));

      return true;
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
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('[background] stored token preview', String(msg.token).slice(0, 40));
          sendResponse({ ok: true });
        }
      });
      return true;
    }

    sendResponse({ ok: false, reason: 'unknown-type' });
  } catch (e) {
    sendResponse({ ok: false, error: String(e) });
  }
});
