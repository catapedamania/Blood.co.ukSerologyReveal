// page_inject.js - runs in page main world
(function () {
  try {
    window.__bs_page_inject_installed = true;
    console.log('[page_inject] installed and marker set __bs_page_inject_installed = true');
  } catch (e) {
    console.warn('[page_inject] could not set marker', e && e.message);
  }

  const LOG = (...args) => { try { console.log('[page_inject]', ...args); } catch (e) {} };
  const MAX_SNIPPET = 2000;

  function extractTokenFromObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    return obj.accessToken || obj.access_token || obj.token || (obj.data && (obj.data.accessToken || obj.data.access_token || obj.data.token)) || null;
  }

  function postToken(token, sourceUrl) {
    try {
      window.postMessage({ type: 'BloodSerologyExtToken', token, sourceUrl }, '*');
      LOG('posted token preview', token && token.slice(0,40), 'from', sourceUrl);
    } catch (e) {
      LOG('postToken error', e && e.message);
    }
  }

  function postDetails(json, sourceUrl) {
    try {
      window.postMessage({ type: 'BloodSerologyExtDetails', json, sourceUrl }, '*');
      LOG('posted account details keys', json && Object.keys(json).slice(0,10));
    } catch (e) {
      LOG('postDetails error', e && e.message);
    }
  }

  function inspectText(text, url) {
    if (!text) return null;
    try {
      const json = JSON.parse(text);
      const token = extractTokenFromObject(json);
      if (token) postToken(token, url);
      // heuristics: if JSON contains account-like keys, forward details
      if (json && (json.accountDetails || json.serology || /donorID|donorId/i.test(JSON.stringify(Object.keys(json))))) {
        postDetails(json, url);
      }
      return token;
    } catch (e) {
      const snippet = text && text.slice ? text.slice(0, MAX_SNIPPET) : String(text).slice(0, MAX_SNIPPET);
      if (/accessToken|access_token|token|refreshToken/i.test(snippet)) {
        LOG('Response contains token-like text (not JSON) snippet:', snippet);
      }
    }
    return null;
  }

  // Wrap fetch
  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = async function (...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0] && args[0].url;
      const res = await originalFetch.apply(this, args);
      try {
        const text = await res.clone().text().catch(() => null);
        if (text) inspectText(text, url);
      } catch (e) {
        LOG('fetch wrapper error', e && e.message);
      }
      return res;
    };
    LOG('fetch wrapped');
  } else {
    LOG('fetch not available to wrap');
  }

  // Wrap XHR
  try {
    const OriginalXHR = window.XMLHttpRequest;
    function PatchedXHR() {
      const xhr = new OriginalXHR();
      const originalOpen = xhr.open;
      xhr.open = function (method, url, async, user, password) {
        this.__bs_url = url;
        return originalOpen.apply(this, arguments);
      };
      xhr.addEventListener('load', function () {
        try {
          const url = this.__bs_url;
          if (!this.responseText) return;
          if (/accessToken|access_token|token|auth|donorID|accountDetails/i.test(this.responseText) || /\/login|\/auth|\/api\/auth|\/api\/account/i.test(url)) {
            inspectText(this.responseText, url);
          }
        } catch (e) {
          LOG('XHR wrapper error', e && e.message);
        }
      });
      return xhr;
    }
    window.XMLHttpRequest = PatchedXHR;
    LOG('XMLHttpRequest wrapped');
  } catch (e) {
    LOG('Failed to patch XHR', e && e.message);
  }

  // Announce readiness to content script
  try {
    window.postMessage({ type: 'BS_PAGE_HELLO', ready: true }, '*');
    LOG('announced BS_PAGE_HELLO');
  } catch (e) {
    LOG('BS_PAGE_HELLO post failed', e && e.message);
  }

  try { window.__bs_page_inject_timestamp = Date.now(); } catch (e) {}
})();
