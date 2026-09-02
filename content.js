// content.js
console.log('[content] loaded (scripting injection + UI insert, idempotent)');

function cLog(...args) { try { console.log('[content]', ...args); } catch (e) {} }

// Robust sendMessage wrapper that tolerates service worker suspension
function safeSendMessage(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          console.warn('[content] sendMessage warning:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(resp);
      });
    } catch (e) {
      console.warn('[content] sendMessage exception', e && e.message);
      resolve(null);
    }
  });
}

// Inject CSS to match nhsuk summary list and ensure Serology value is not bold
(function injectBsStyles() {
  try {
    const css = `
/* BS Serology row styling to match nhsuk-summary-list */
#bs-serology-shortHand { display:block; margin:0; padding:0; font-family:inherit; font-size:1rem; line-height:1.4; color:inherit; }
#bs-serology-shortHand dt.nhsuk-summary-list__key { font-weight:700; margin-right:0.5rem; display:inline-block; }
#bs-serology-shortHand dd.nhsuk-summary-list__value { display:inline-block; margin:0; font-weight:400; }
#bs-serology-shortHand .bs-value[aria-hidden="true"] { font-weight:400 !important; margin-right:6px; }
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

// Insert or update serology row by cloning and copying computed styles (idempotent)
function insertOrUpdateSerologyRow(shortHand) {
  try {
    if (!shortHand) return;
    const dl = document.querySelector('dl.nhsuk-summary-list');
    if (!dl) {
      cLog('BS: summary list not found, aborting insertOrUpdate');
      return;
    }

    // If already present, update and return
    const existing = document.getElementById('bs-serology-shortHand');
    if (existing) {
      const vis = existing.querySelector('.bs-value[aria-hidden="true"]') || existing.querySelector('span[aria-hidden="true"]');
      const hid = existing.querySelector('.nhsuk-u-visually-hidden');
      if (vis) vis.textContent = shortHand;
      if (hid) hid.textContent = shortHand;
      cLog('BS: updated existing serology row');
      return;
    }

    // Find the Blood group row to clone
    const rows = Array.from(dl.querySelectorAll('.nhsuk-summary-list__row'));
    const bloodRow = rows.find(r => {
      const dt = r.querySelector('dt.nhsuk-summary-list__key');
      return dt && dt.textContent && dt.textContent.trim().toLowerCase().startsWith('blood group');
    });

    // Helper to copy computed styles from source element to target element
    function copyComputedStyles(sourceEl, targetEl, properties) {
      try {
        const cs = window.getComputedStyle(sourceEl);
        if (!properties || !properties.length) {
          properties = [
            'display','font','font-size','font-weight','line-height','color',
            'margin','padding','vertical-align','letter-spacing','text-transform',
            'white-space','word-break','box-sizing'
          ];
        }
        properties.forEach(prop => {
          try {
            const val = cs.getPropertyValue(prop);
            if (val) targetEl.style.setProperty(prop, val, 'important');
          } catch (e) {}
        });
      } catch (e) {
        console.warn('BS: copyComputedStyles failed', e && e.message);
      }
    }

    if (bloodRow) {
      // Clone the whole row to preserve markup and classes
      const clone = bloodRow.cloneNode(true);
      clone.id = 'bs-serology-shortHand';

      // Update dt text
      const dtClone = clone.querySelector('dt.nhsuk-summary-list__key') || clone.querySelector('dt');
      if (dtClone) dtClone.textContent = 'Serology:';

      // Update visible and hidden spans inside dd
      const visibleClone = clone.querySelector('span[aria-hidden="true"]');
      const hiddenClone = clone.querySelector('.nhsuk-u-visually-hidden') || clone.querySelector('span[aria-hidden="true"] + span');
      if (visibleClone) {
        visibleClone.classList.add('bs-value');
        visibleClone.textContent = shortHand;
        visibleClone.style.setProperty('font-weight', '400', 'important');
      }
      if (hiddenClone) hiddenClone.textContent = shortHand;

      // Copy computed styles from original dt and dd to cloned dt and dd
      try {
        const origDt = bloodRow.querySelector('dt.nhsuk-summary-list__key') || bloodRow.querySelector('dt');
        const origDd = bloodRow.querySelector('dd.nhsuk-summary-list__value') || bloodRow.querySelector('dd');
        const cloneDt = dtClone;
        const cloneDd = clone.querySelector('dd.nhsuk-summary-list__value') || clone.querySelector('dd');

        if (origDt && cloneDt) copyComputedStyles(origDt, cloneDt);
        if (origDd && cloneDd) copyComputedStyles(origDd, cloneDd);
        // ensure visible value not bold even if copied
        const vis = clone.querySelector('.bs-value[aria-hidden="true"]') || clone.querySelector('span[aria-hidden="true"]');
        if (vis) vis.style.setProperty('font-weight', '400', 'important');
      } catch (e) {
        console.warn('BS: style copy attempt failed', e && e.message);
      }

      // Insert clone after the original bloodRow
      const parent = bloodRow.parentNode;
      const afterNode = bloodRow.nextSibling;
      if (afterNode) parent.insertBefore(clone, afterNode);
      else parent.appendChild(clone);

      cLog('BS: inserted serology row by cloning bloodRow and copying styles');
      return;
    }

    // Final fallback: create a new row and copy styles from the first row if available
    const fallbackRow = rows[0];
    const newRow = document.createElement('div');
    newRow.id = 'bs-serology-shortHand';
    newRow.className = 'nhsuk-summary-list__row sc-dkmUuy kGzGkF';

    const dt2 = document.createElement('dt');
    dt2.className = 'nhsuk-summary-list__key sc-ejfMaa ljDfCo nhsuk-u-padding-right-1';
    dt2.textContent = 'Serology:';

    const dd2 = document.createElement('dd');
    dd2.className = 'nhsuk-summary-list__value sc-iEXKAz hYbzdA';

    const vis2 = document.createElement('span');
    vis2.setAttribute('aria-hidden', 'true');
    vis2.className = 'bs-value';
    vis2.textContent = shortHand;
    vis2.style.setProperty('font-weight', '400', 'important');

    const hid2 = document.createElement('span');
    hid2.className = 'nhsuk-u-visually-hidden';
    hid2.textContent = shortHand;

    dd2.appendChild(vis2);
    dd2.appendChild(hid2);
    newRow.appendChild(dt2);
    newRow.appendChild(dd2);

    if (fallbackRow) {
      try {
        const origDt = fallbackRow.querySelector('dt.nhsuk-summary-list__key') || fallbackRow.querySelector('dt');
        const origDd = fallbackRow.querySelector('dd.nhsuk-summary-list__value') || fallbackRow.querySelector('dd');
        if (origDt) copyComputedStyles(origDt, dt2);
        if (origDd) copyComputedStyles(origDd, dd2);
        vis2.style.setProperty('font-weight', '400', 'important');
      } catch (e) {}
    }

    dl.appendChild(newRow);
    cLog('BS: appended serology row fallback with copied styles');
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
      cLog('token received preview', data.token && String(data.token).slice(0,40));
      // Extract raw JWT-like token if present before storing
      function extractAccessTokenFromString(s) {
        if (!s) return null;
        try {
          const m = s.match(/accessToken=([^;]+)/) || s.match(/access_token=([^;]+)/);
          if (m) return m[1];
          const b = s.match(/Bearer\s+([A-Za-z0-9\-\._~\+\/]+=*)/);
          if (b) return b[1];
          if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s)) return s;
        } catch (e) {}
        return null;
      }
      const raw = data.token;
      const token = extractAccessTokenFromString(raw) || raw;
      safeSendMessage({ type: 'BS_TOKEN', token, sourceUrl: data.sourceUrl || null });
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

// Request the background to inject page_inject.js into the page main world (fallback)
(function requestInjectionOnce() {
  try {
    if (window.__bs_injection_requested) {
      cLog('injection already requested in this frame, skipping');
      return;
    }
    window.__bs_injection_requested = true;
    cLog('requesting background to inject page_inject.js');
    safeSendMessage({ type: 'INJECT_PAGE_SCRIPT' }).then(resp => {
      cLog('INJECT_PAGE_SCRIPT response', resp);
    });
  } catch (e) {
    cLog('requestInjection exception', e && e.message);
  }
})();
