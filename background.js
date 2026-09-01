// background.js
console.log('[background] starting');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[background] onMessage', msg, 'from', sender && sender.tab && sender.tab.id);

  try {
    if (!msg || !msg.type) {
      sendResponse({ ok: false, reason: 'no-type' });
      return;
    }

    // Request to inject page script into the page main world
    if (msg.type === 'INJECT_PAGE_SCRIPT') {
      if (!sender.tab || !sender.tab.id) {
        sendResponse({ ok: false, error: 'no-tab' });
        return;
      }

      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, allFrames: false },
        files: ['page_inject.js'],
        world: 'MAIN'
      }).then(() => {
        console.log('[background] executeScript succeeded for tab', sender.tab.id);
        sendResponse({ ok: true });
      }).catch(err => {
        console.error('[background] executeScript failed', err && err.message);
        sendResponse({ ok: false, error: String(err) });
      });

      return true; // async response
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
          console.log('[background] token stored preview', msg.token && msg.token.slice(0,40));
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
    sendResponse({ ok: false, error: String(e) });
  }
});
