// content.js — final cleaned version with Blood Group clone-only insertion
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

// Minimal CSS for injected rows
(function injectBsStyles() {
  try {
    const css = `
.bs-value[aria-hidden="true"] { font-weight:400 !important; margin-right:6px; }
.nhsuk-u-visually-hidden {
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

// Format registration date
function formatRegistrationDate(raw) {
  if (!raw || raw.length !== 8) return null;
  const yyyy = raw.slice(0,4);
  const mm = raw.slice(4,6);
  const dd = raw.slice(6,8);

  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  if (isNaN(date.getTime())) return null;

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

// Clone-only Serology insertion
function insertOrUpdateSerologyRow(shortHand) {
  try {
    if (!shortHand) return;

    const dl = document.querySelector('dl.nhsuk-summary-list');
    if (!dl) return;

    const existing = document.getElementById('bs-serology-shortHand');
    if (existing) {
      existing.querySelector('.bs-value').textContent = shortHand;
      existing.querySelector('.nhsuk-u-visually-hidden').textContent = shortHand;
      return;
    }

    const rows = [...dl.querySelectorAll('.nhsuk-summary-list__row')];
    const bloodRow = rows.find(r => {
      const dt = r.querySelector('dt.nhsuk-summary-list__key');
      return dt && dt.textContent.trim().toLowerCase().startsWith('blood group');
    });

    if (!bloodRow) return;

    const clone = bloodRow.cloneNode(true);
    clone.id = 'bs-serology-shortHand';

    const dtClone = clone.querySelector('dt.nhsuk-summary-list__key');
    const ddClone = clone.querySelector('dd.nhsuk-summary-list__value');
    const visClone = clone.querySelector('span[aria-hidden="true"]');
    const hidClone = clone.querySelector('.nhsuk-u-visually-hidden');

    dtClone.textContent = 'Serology:';
    visClone.textContent = shortHand;
    visClone.classList.add('bs-value');
    hidClone.textContent = shortHand;

    bloodRow.after(clone);
  } catch (e) {
    console.error('[content] insertOrUpdateSerologyRow error', e);
  }
}

// Clone-only Registration Date insertion
function insertRegistrationDateRow(regDateFormatted) {
  try {
    if (!regDateFormatted) return;

    const dl = document.querySelector('dl.nhsuk-summary-list');
    if (!dl) return;

    const existing = document.getElementById('bs-registration-date');
    if (existing) {
      existing.querySelector('.bs-value').textContent = regDateFormatted;
      existing.querySelector('.nhsuk-u-visually-hidden').textContent = regDateFormatted;
      return;
    }

    const rows = [...dl.querySelectorAll('.nhsuk-summary-list__row')];
    const bloodRow = rows.find(r => {
      const dt = r.querySelector('dt.nhsuk-summary-list__key');
      return dt && dt.textContent.trim().toLowerCase().startsWith('blood group');
    });

    if (!bloodRow) return;

    const clone = bloodRow.cloneNode(true);
    clone.id = 'bs-registration-date';

    const dtClone = clone.querySelector('dt.nhsuk-summary-list__key');
    const ddClone = clone.querySelector('dd.nhsuk-summary-list__value');
    const visClone = ddClone.querySelector('span[aria-hidden="true"]');
    const hidClone = ddClone.querySelector('.nhsuk-u-visually-hidden');

    dtClone.textContent = 'Registration date:';
    visClone.textContent = regDateFormatted;
    visClone.classList.add('bs-value');
    hidClone.textContent = regDateFormatted;

    // Insert under Donation Credits
    const donationCreditsRow = rows.find(r => {
      const dt = r.querySelector('dt.nhsuk-summary-list__key');
      return dt && dt.textContent.trim().toLowerCase().startsWith('donation credits');
    });

    if (donationCreditsRow) {
      donationCreditsRow.after(clone);
    } else {
      dl.appendChild(clone);
    }

  } catch (e) {
    console.error('[content] insertRegistrationDateRow error', e);
  }
}

// Handle messages from page_inject.js
window.addEventListener('message', (ev) => {
  try {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'BloodSerologyExtDetails') {
      const shortHand =
        data.json?.serology?.shortHand ||
        data.json?.accountDetails?.serology?.shortHand;

      const regRaw =
        data.json?.registrationDate ||
        data.json?.accountDetails?.registrationDate ||
        null;

      const regFormatted = regRaw ? formatRegistrationDate(regRaw) : null;

      const dl = document.querySelector('dl.nhsuk-summary-list');
      if (dl) {
        if (shortHand) insertOrUpdateSerologyRow(shortHand);
        if (regFormatted) insertRegistrationDateRow(regFormatted);
      } else {
        const obs = new MutationObserver((_, o) => {
          if (document.querySelector('dl.nhsuk-summary-list')) {
            o.disconnect();
            if (shortHand) insertOrUpdateSerologyRow(shortHand);
            if (regFormatted) insertRegistrationDateRow(regFormatted);
          }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => {
          try { obs.disconnect(); } catch {}
        }, 7000);
      }
      return;
    }

    if (data.type === 'BloodSerologyExtToken') {
      safeSendMessage({ type: 'BS_TOKEN', token: data.token });
      return;
    }

  } catch (e) {
    console.error('[content] message handler error', e);
  }
}, false);
