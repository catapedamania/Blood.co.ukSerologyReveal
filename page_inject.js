// page_inject.js — final cleaned version, always forwards FULL JSON
(function () {
  if (window.__bs_page_inject_installed) return;
  window.__bs_page_inject_installed = true;

  const LOGIN_URL = 'https://my.blood.co.uk/api/auth/v2/login';
  const DETAILS_URL = 'https://my.blood.co.uk/api/account/v2/details';

  const postToContent = (msg) => {
    try { window.postMessage(msg, '*'); } catch {}
  };

  const extractTokenFromJson = (obj) =>
    obj?.accessToken || obj?.access_token || obj?.token || null;

  const extractTokenFromCookieString = (cookieStr) => {
    if (!cookieStr) return null;
    const m = cookieStr.match(/accessToken=([^;]+)/) ||
              cookieStr.match(/access_token=([^;]+)/);
    return m ? m[1] : null;
  };

  const looksLikeJwt = (s) =>
    /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s || '');

  async function fetchDetailsWithBearer(token, sourceHint) {
    try {
      const res = await fetch(DETAILS_URL, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token },
        credentials: 'include'
      });

      if (!res.ok) return;

      const json = await res.json().catch(() => null);
      if (!json) return;

      const hasSerology =
        json.serology?.shortHand ||
        json.accountDetails?.serology?.shortHand;

      if (hasSerology) {
        postToContent({ type: 'BloodSerologyExtDetails', json, source: sourceHint });
      }
    } catch {}
  }

  async function handleDetectedToken(rawToken, hint) {
    try {
      const token = extractTokenFromCookieString(rawToken) || rawToken;
      if (!token) return;

      postToContent({ type: 'BloodSerologyExtToken', token, source: hint });

      const trusted = new Set(['login-response', 'xhr-login-response', 'storage.setItem', 'globalState']);
      if (!trusted.has(hint)) return;
      if (!looksLikeJwt(token)) return;

      const last = window.__bs_last_details || {};
      if (last.token === token && Date.now() - last.ts < 5000) return;
      window.__bs_last_details = { token, ts: Date.now() };

      await fetchDetailsWithBearer(token, hint + '-bearer');
    } catch {}
  }

  // Wrap fetch
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = async function (...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      const res = await origFetch.apply(this, args);

      try {
        if (url === DETAILS_URL) {
          const json = await res.clone().json().catch(() => null);
          if (!json) return;

          const hasSerology =
            json.serology?.shortHand ||
            json.accountDetails?.serology?.shortHand;

          if (hasSerology) {
            postToContent({ type: 'BloodSerologyExtDetails', json, source: 'observed-fetch' });
          }
        }

        if (url === LOGIN_URL) {
          const text = await res.clone().text().catch(() => null);
          if (text) {
            const json = JSON.parse(text);
            const token = extractTokenFromJson(json);
            if (token) handleDetectedToken(token, 'login-response');
          }
        }
      } catch {}

      return res;
    };
  }

  // Wrap XHR
  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const xhr = new OriginalXHR();
    const origOpen = xhr.open;

    xhr.open = function (method, url, async, user, password) {
      this.__bs_url = url;
      return origOpen.apply(this, arguments);
    };

    xhr.addEventListener('load', function () {
      const url = this.__bs_url;
      if (!url) return;

      try {
        const text = this.responseText;
        if (!text) return;

        const json = JSON.parse(text);

        const hasSerology =
          json.serology?.shortHand ||
          json.accountDetails?.serology?.shortHand;

        if (hasSerology) {
          postToContent({ type: 'BloodSerologyExtDetails', json, source: 'observed-xhr' });
        }

        if (url === LOGIN_URL) {
          const token = extractTokenFromJson(json);
          if (token) handleDetectedToken(token, 'xhr-login-response');
        }
      } catch {}
    });

    return xhr;
  };

  // Observe cookie writes
  const cookieDesc =
    Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
    Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');

  if (cookieDesc?.configurable) {
    const origSetter = cookieDesc.set;
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      enumerable: true,
      get: cookieDesc.get,
      set: function (val) {
        try {
          const s = String(val || '');
          if (/accessToken=|access_token=/.test(s)) {
            postToContent({ type: 'BloodSerologyExtToken', token: s, source: 'cookie-write' });
          }
        } catch {}
        return origSetter.call(document, val);
      }
    });
  }

  // Observe localStorage
  try {
    const v = localStorage.getItem('accessToken') || localStorage.getItem('bs_token');
    if (v && looksLikeJwt(v)) handleDetectedToken(v, 'storage.setItem');
    else if (v) postToContent({ type: 'BloodSerologyExtToken', token: v, source: 'localStorage' });
  } catch {}

})();
