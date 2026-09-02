// content.js — cleaned, no dead listeners, no fallback injection spam
console.log('[content] loaded');

// Safe message sender
function safeSendMessage(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(resp);
      });
    } catch {
      resolve(null);
    }
  });
}

// Inject minimal CSS for serology row
(function injectBsStyles() {
  try {
    const css = `
#bs-serology-shortHand { display:block; margin:0; padding:0; font-family:inherit; font-size:1rem; line-height:1.4; color:inherit; }
#bs-serology-shortHand dt.nhsuk-summary-list__key { font-weight:700; margin-right:0.5rem; display:inline-block; }
#bs-serology-shortHand dd.nhsuk-summary-list__value { display:inline-block; margin:0; font-weight:400; }
#bs-serology-shortHand .bs-value[aria-hidden="true"] { font-weight:400 !important; margin-right:6px; }
#bs-serology-shortHand .nhsuk-u-visually-hidden {
  position:absolute!important; width:1px!important; height:1px!important;
  padding:0!important; margin:-1px!important; overflow:hidden!important;
  clip:rect(0,0,0,0)!important; white-space:nowrap!important; border:0!important;
}
`;
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  } catch {
    console.error('[content] injectBsStyles failed');
  }
})();

// Insert or update serology row
function insertOrUpdateSerologyRow(shortHand) {
  try {
    if (!shortHand) return;

    const dl = document.querySelector('dl.nhsuk-summary-list');
    if (!dl) return;

    // Update existing row
    const existing = document.getElementById('bs-serology-shortHand');
    if (existing) {
      const vis = existing.querySelector('.bs-value[aria-hidden="true"]');
      const hid = existing.querySelector('.nhsuk-u-visually-hidden');
      if (vis) vis.textContent = shortHand;
      if (hid) hid.textContent = shortHand;
      return;
    }

    // Find Blood group row to clone
    const rows = [...dl.querySelectorAll('.nhsuk-summary-list__row')];
    const bloodRow = rows.find(r => {
      const dt = r.querySelector('dt.nhsuk-summary-list__key');
      return dt && dt.textContent.trim().toLowerCase().startsWith('blood group');
    });

    // Copy computed styles helper
    function copyComputedStyles(sourceEl, targetEl) {
      try {
        const cs = window.getComputedStyle(sourceEl);
        ['display','font','font-size','font-weight','line-height','color','margin','padding']
          .forEach(prop => {
            const val = cs.getPropertyValue(prop);
            if (val) targetEl.style.setProperty(prop, val, 'important');
          });
      } catch {}
    }

    // Clone Blood group row
    if (bloodRow) {
      const clone = bloodRow.cloneNode(true);
      clone.id = 'bs-serology-shortHand';

      const dtClone = clone.querySelector('dt.nhsuk-summary-list__key') || clone.querySelector('dt');
      const ddClone = clone.querySelector('dd.nhsuk-summary-list__value') || clone.querySelector('dd');
      const visClone = clone.querySelector('span[aria-hidden="true"]');
      const hidClone = clone.querySelector('.nhsuk-u-visually-hidden');

      dtClone.textContent = 'Serology:';
      visClone.textContent = shortHand;
      visClone.classList.add('bs-value');
      visClone.style.setProperty('font-weight', '400', 'important');
      hidClone.textContent = shortHand;

      // Copy styles
      const origDt = bloodRow.querySelector('dt.nhsuk-summary-list__key') || bloodRow.querySelector('dt');
      const origDd = bloodRow.querySelector('dd.nhsuk-summary-list__value') || bloodRow.querySelector('dd');
      if (origDt) copyComputedStyles(origDt, dtClone);
      if (origDd) copyComputedStyles(origDd, ddClone);

      bloodRow.after(clone);
      return;
    }

    // Fallback: create new row
    const fallbackRow = rows[0];
    const newRow = document.createElement('div');
    newRow.id = 'bs-serology-shortHand';
    newRow.className = 'nhsuk-summary-list__row';

    const dt2 = document.createElement('dt');
    dt2.className = 'nhsuk-summary-list__key';
    dt2.textContent = 'Serology:';

    const dd2 = document.createElement('dd');
    dd2.className = 'nhsuk-summary-list__value';

    const vis2 = document.createElement('span');
    vis2.setAttribute('aria-hidden', 'true');
    vis2.className = 'bs-value';
    vis2.style.setProperty('font-weight', '400', 'important');
    vis2.textContent = shortHand;

    const hid2 = document.createElement('span');
    hid2.className = 'nhsuk-u-visually-hidden';
    hid2.textContent = shortHand;

    dd2.append(vis2, hid2);
    newRow.append(dt2, dd2);

    // Copy fallback styles
    if (fallbackRow) {
      const origDt = fallbackRow.querySelector('dt.nhsuk-summary-list__key') || fallbackRow.querySelector('dt');
      const origDd = fallbackRow.querySelector('dd.nhsuk-summary-list__value') || fallbackRow.querySelector('dd');
      if (origDt) copyComputedStyles(origDt, dt2);
      if (origDd) copyComputedStyles(origDd, dd2);
    }

    dl.appendChild(newRow);
  } catch {
    console.error('[content] insertOrUpdateSerologyRow error');
  }
}

// Handle messages from page_inject.js
window.addEventListener('message', (ev) => {
  try {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || typeof data !== 'object') return;

    // Manual DevTools ping hook
    if (data.type === 'BS_TEST_FROM_PAGE') {
      safeSendMessage({ type: 'BS_PING', payload: data.payload });
      return;
    }

    // Token forwarding
    if (data.type === 'BloodSerologyExtToken') {
      const raw = data.token;

      function extractAccessTokenFromString(s) {
        if (!s) return null;
        try {
          const m = s.match(/accessToken=([^;]+)/) || s.match(/access_token=([^;]+)/);
          if (m) return m[1];
          const b = s.match(/Bearer\s+([A-Za-z0-9\-\._~\+\/]+=*)/);
          if (b) return b[1];
          if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s)) return s;
        } catch {}
        return null;
      }

      const token = extractAccessTokenFromString(raw) || raw;
      safeSendMessage({ type: 'BS_TOKEN', token, sourceUrl: data.sourceUrl || null });
      return;
    }

    // Serology details forwarding
    if (data.type === 'BloodSerologyExtDetails') {
      const shortHand =
        data.json?.serology?.shortHand ||
        data.json?.accountDetails?.serology?.shortHand;

      if (!shortHand) return;

      const dl = document.querySelector('dl.nhsuk-summary-list');
      if (dl) {
        insertOrUpdateSerologyRow(shortHand);
      } else {
        const obs = new MutationObserver((_, o) => {
          if (document.querySelector('dl.nhsuk-summary-list')) {
            o.disconnect();
            insertOrUpdateSerologyRow(shortHand);
          }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => {
          try { obs.disconnect(); insertOrUpdateSerologyRow(shortHand); } catch {}
        }, 7000);
      }
      return;
    }
  } catch {
    console.error('[content] message handler error');
  }
}, false);
