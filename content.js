// content.js - minimal logging, no automatic hello/ping, manual DevTools ping hook
console.log('[content] loaded');

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
    } catch (e) {
      resolve(null);
    }
  });
}

// Minimal CSS injection for serology row
(function injectBsStyles() {
  try {
    const css = `
#bs-serology-shortHand { display:block; margin:0; padding:0; font-family:inherit; font-size:1rem; line-height:1.4; color:inherit; }
#bs-serology-shortHand dt.nhsuk-summary-list__key { font-weight:700; margin-right:0.5rem; display:inline-block; }
#bs-serology-shortHand dd.nhsuk-summary-list__value { display:inline-block; margin:0; font-weight:400; }
#bs-serology-shortHand .bs-value[aria-hidden="true"] { font-weight:400 !important; margin-right:6px; }
#bs-serology-shortHand .nhsuk-u-visually-hidden { position:absolute!important; width:1px!important; height:1px!important; padding:0!important; margin:-1px!important; overflow:hidden!important; clip:rect(0,0,0,0)!important; white-space:nowrap!important; border:0!important; }
`;
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    console.error('[content] injectBsStyles failed');
  }
})();

function insertOrUpdateSerologyRow(shortHand) {
  try {
    if (!shortHand) return;
    const dl = document.querySelector('dl.nhsuk-summary-list');
    if (!dl) return;

    const existing = document.getElementById('bs-serology-shortHand');
    if (existing) {
      const vis = existing.querySelector('.bs-value[aria-hidden="true"]') || existing.querySelector('span[aria-hidden="true"]');
      const hid = existing.querySelector('.nhsuk-u-visually-hidden');
      if (vis) vis.textContent = shortHand;
      if (hid) hid.textContent = shortHand;
      return;
    }

    const rows = Array.from(dl.querySelectorAll('.nhsuk-summary-list__row'));
    const bloodRow = rows.find(r => {
      const dt = r.querySelector('dt.nhsuk-summary-list__key');
      return dt && dt.textContent && dt.textContent.trim().toLowerCase().startsWith('blood group');
    });

    function copyComputedStyles(sourceEl, targetEl, properties) {
      try {
        const cs = window.getComputedStyle(sourceEl);
        if (!properties || !properties.length) {
          properties = ['display','font','font-size','font-weight','line-height','color','margin','padding'];
        }
        properties.forEach(prop => {
          try {
            const val = cs.getPropertyValue(prop);
            if (val) targetEl.style.setProperty(prop, val, 'important');
          } catch (e) {}
        });
      } catch (e) {}
    }

    if (bloodRow) {
      const clone = bloodRow.cloneNode(true);
      clone.id = 'bs-serology-shortHand';
      const dtClone = clone.querySelector('dt.nhsuk-summary-list__key') || clone.querySelector('dt');
      if (dtClone) dtClone.textContent = 'Serology:';
      const visibleClone = clone.querySelector('span[aria-hidden="true"]');
      const hiddenClone = clone.querySelector('.nhsuk-u-visually-hidden') || clone.querySelector('span[aria-hidden="true"] + span');
      if (visibleClone) {
        visibleClone.classList.add('bs-value');
        visibleClone.textContent = shortHand;
        visibleClone.style.setProperty('font-weight', '400', 'important');
      }
      if (hiddenClone) hiddenClone.textContent = shortHand;
      try {
        const origDt = bloodRow.querySelector('dt.nhsuk-summary-list__key') || bloodRow.querySelector('dt');
        const origDd = bloodRow.querySelector('dd.nhsuk-summary-list__value') || bloodRow.querySelector('dd');
        const cloneDt = dtClone;
        const cloneDd = clone.querySelector('dd.nhsuk-summary-list__value') || clone.querySelector('dd');
        if (origDt && cloneDt) copyComputedStyles(origDt, cloneDt);
        if (origDd && cloneDd) copyComputedStyles(origDd, cloneDd);
      } catch (e) {}
      const parent = bloodRow.parentNode;
      const afterNode = bloodRow.nextSibling;
      if (afterNode) parent.insertBefore(clone, afterNode);
      else parent.appendChild(clone);
      return;
    }

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
      } catch (e) {}
    }
    dl.appendChild(newRow);
  } catch (e) {
    console.error('[content] insertOrUpdateSerologyRow error');
  }
}

window.addEventListener('message', (ev) => {
  try {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || typeof data !== 'object') return;

    // Manual DevTools ping hook (invoke from console):
    // window.postMessage({ type: 'BS_TEST_FROM_PAGE', payload: 'ping' }, '*');
    if (data.type === 'BS_TEST_FROM_PAGE') {
      safeSendMessage({ type: 'BS_PING', payload: data.payload });
      return;
    }

    if (data.type === 'BloodSerologyExtToken') {
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

    if (data.type === 'BloodSerologyExtDetails') {
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
      }
      return;
    }
  } catch (e) {
    console.error('[content] message handler error');
  }
}, false);

// Request background to inject page_inject.js as a fallback (fire-and-forget)
(function requestInjectionOnce() {
  try {
    if (window.__bs_injection_requested) return;
    window.__bs_injection_requested = true;
    safeSendMessage({ type: 'INJECT_PAGE_SCRIPT' }).then(()=>{});
  } catch (e) {}
})();
