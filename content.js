// content.js (idempotent insert + single-injection guard)
console.log('[content] loaded (scripting injection + UI insert, idempotent)');

function cLog(...args) { try { console.log('[content]', ...args); } catch (e) {} }

// Safe wrapper for sending messages to background
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

// Inject CSS to match nhsuk summary list
(function injectBsStyles() {
  try {
    const css = `
/* BS Serology row styling to match nhsuk-summary-list */
#bs-serology-shortHand { display:block; margin:0; padding:0; font-family:inherit; font-size:1rem; line-height:1.4; color:inherit; }
#bs-serology-shortHand dt.nhsuk-summary-list__key { font-weight:700; margin-right:0.5rem; display:inline-block; }
#bs-serology-shortHand dd.nhsuk-summary-list__value { display:inline-block; margin:0; font-weight:400; }
#bs-serology-shortHand .bs-value[aria-hidden="true"] { font-weight:600; margin-right:6px; }
#bs-serology-shortHand .nhsuk-u-visually-hidden { position:absolute!important; width:1px!important; height:1px!important; padding:0!important; margin:-1px!important; overflow:hidden!important; clip:rect(0,0,0,0)!important; white-space:nowrap!important; border:0!important; }
#bs-inject-error { position: fixed; right: 8px; bottom: 8px; z-index:2147483647; background: rgba(255,60,60,0.95); color:#fff; padding:8px 12px; border-radius:6px; font-family: system-ui, Arial, sans-serif; font-size:12px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
`;
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
    cLog('BS styles injected');
  } catch (e) {
    cLog('injectBsStyles failed', e && e.message);
  }
})();

// Idempotent insert: update existing row or insert once
function insertOrUpdateSerologyRow(shortHand) {
  try {
    if (!shortHand) return;
    const dl = document.querySelector('dl.nhsuk-summary-list');
    if (!dl) {
      cLog('BS: summary list not found, aborting insertOrUpdate');
      return;
    }

    // If the row already exists, update its visible and hidden text
    const existing = document.getElementById('bs-serology-shortHand');
    if (existing) {
      const vis = existing.querySelector('.bs-value[aria-hidden="true"]');
      const hid = existing.querySelector('.nhsuk-u-visually-hidden');
      if (vis) vis.textContent = shortHand;
      if (hid) hid.textContent = shortHand;
      cLog('BS: updated existing serology row');
      return;
    }

    // Build new row (matching page classes)
    const rows = Array.from(dl.querySelectorAll('.nhsuk-summary-list__row'));
    let bloodRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const dt = rows[i].querySelector('dt.nhsuk-summary-list__key');
      if (dt && dt.textContent && dt.textContent.trim().toLowerCase().startsWith('blood group')) {
        bloodRowIndex = i;
        break;
      }
    }

    const newRow = document.createElement('div');
    newRow.id = 'bs-serology-shortHand';
    newRow.className = 'nhsuk-summary-list__row sc-dkmUuy kGzGkF';

    const dt = document.createElement('dt');
    dt.className = 'nhsuk-summary-list__key sc-ejfMaa ljDfCo nhsuk-u-padding-right-1';
    dt.textContent = 'Serology:';

    const dd = document.createElement('dd');
    dd.className = 'nhsuk-summary-list__value sc-iEXKAz hYbzdA';

    const visible = document.createElement('span');
    visible.setAttribute('aria-hidden', 'true');
    visible.className = 'bs-value';
    visible.textContent = shortHand;

    const hidden = document.createElement('span');
    hidden.className = 'nhsuk-u-visually-hidden';
    hidden.textContent = shortHand;

    dd.appendChild(visible);
    dd.appendChild(hidden);
    newRow.appendChild(dt);
    newRow.appendChild(dd);

    if (bloodRowIndex >= 0 && rows[bloodRowIndex].parentNode) {
      const afterNode = rows[bloodRowIndex].nextSibling;
      if (afterNode) rows[bloodRowIndex].parentNode.insertBefore(newRow, afterNode);
      else rows[bloodRowIndex].parentNode.appendChild(newRow);
      cLog('BS: inserted serology row after Blood group');
      return;
    }

    // fallback: insert before Donation type
    for (let i = 0; i < rows.length; i++) {
      const dt2 = rows[i].querySelector('dt.nhsuk-summary-list__key');
      if (dt2 && dt2.textContent && dt2.textContent.trim().toLowerCase().startsWith('donation type')) {
        rows[i].parentNode.insertBefore(newRow, rows[i]);
        cLog('BS: inserted serology row before Donation type');
        return;
      }
    }

    // final fallback: append
    dl.appendChild(newRow);
    cLog('BS: appended serology row as fallback');
  } catch (e) {
    console.error('BS: insertOrUpdateSerologyRow error', e && e.message);
  }
}

// Listen for messages from page context and forward to background; also handle details insertion
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
      const shortHand = data.json && data.json.serology && data.json.serology.shortHand;
      if (shortHand) {
        // If DOM ready, insert/update immediately; otherwise observe
        if (document.querySelector('dl.nhsuk-summary-list')) {
          insertOrUpdateSerologyRow(shortHand);
        } else {
          const obs = new MutationObserver((mutations, o) => {
            if (document.querySelector('dl.nhsuk-summary-list')) {
              o.disconnect();
              insertOrUpdateSerologyRow(shortHand);
            }
          });
          obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
          setTimeout(() => { try { obs.disconnect(); insertOrUpdateSerologyRow(shortHand); } catch(e){} }, 7000);
        }
      } else {
        cLog('serology.shortHand missing in details');
      }
      return;
    }
  } catch (e) {
    cLog('window.message handler error', e && e.message);
  }
}, false);

// Defensive onMessage listener so background->content sends don't throw "No Listener"
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    cLog('onMessage', msg);
    if (!msg || !msg.type) {
      sendResponse({ ok: false, reason: 'no-type' });
      return;
    }

    if (msg.type === 'outgoing.message.ready') {
      cLog('outgoing.message.ready received');
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, reason: 'unknown-type' });
  } catch (e) {
    console.error('[content] onMessage handler error', e && e.message);
    sendResponse({ ok: false, error: String(e) });
  }
});

// Request the background to inject page_inject.js into the page main world
(function requestInjectionOnce() {
  try {
    // guard so we only request injection once per frame
    if (window.__bs_injection_requested) {
      cLog('injection already requested in this frame, skipping');
      return;
    }
    window.__bs_injection_requested = true;
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
