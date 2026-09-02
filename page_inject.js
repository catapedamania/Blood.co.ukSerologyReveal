// page_inject.js - trimmed, conservative, observes only LOGIN_URL and DETAILS_URL
(function () {
  try {
    if (window.__bs_page_inject_installed) return;
    window.__bs_page_inject_installed = true;

    const LOGIN_URL = 'https://my.blood.co.uk/api/auth/v2/login';
    const DETAILS_URL = 'https://my.blood.co.uk/api/account/v2/details';

    const LOG = (...args) => { try { console.log('[page_inject]', ...args); } catch (e) {} };

    function postToContent(msg) {
      try { window.postMessage(msg, '*'); } catch (e) {}
    }

    function extractTokenFromJson(obj) {
      if (!obj || typeof obj !== 'object') return null;
      return obj.accessToken || obj.access_token || obj.token || null;
    }

    function extractTokenFromCookieString(cookieStr) {
      if (!cookieStr) return null;
      const m = cookieStr.match(/accessToken=([^;]+)/) || cookieStr.match(/access_token=([^;]+)/);
      return m ? m[1] : null;
    }

    function looksLikeJwt(s) {
      if (!s || typeof s !== 'string') return false;
      return /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s.trim());
    }

    // Only request details when we have a JWT and the source is trusted
    async function fetchDetailsWithBearer(token, sourceHint) {
      if (!token) return null;
      try {
        const res = await fetch(DETAILS_URL, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
          credentials: 'include'
        }).catch(() => null);

        if (!res || res.status === 401 || !res.ok) return null;

        const json = await res.json().catch(() => null);
        if (json && json.serology && json.serology.shortHand) {
          postToContent({ type: 'BloodSerologyExtDetails', json, source: sourceHint });
          return json;
        }
        if (json && json.accountDetails && json.accountDetails.serology && json.accountDetails.serology.shortHand) {
          postToContent({ type: 'BloodSerologyExtDetails', json: json.accountDetails, source: sourceHint });
          return json.accountDetails;
        }
        return null;
      } catch (e) {
        return null;
      }
    }

    // Only attempt details when token is JWT and source is trusted for bearer usage
    async function handleDetectedToken(rawToken, hint) {
      try {
        const tokenFromCookie = (typeof rawToken === 'string') ? (extractTokenFromCookieString(rawToken) || rawToken) : rawToken;
        const token = (typeof tokenFromCookie === 'string') ? tokenFromCookie.trim() : tokenFromCookie;

        // forward raw token for storage/logging
        postToContent({ type: 'BloodSerologyExtToken', token: token, source: hint });

        const bearerTrustedSources = new Set(['login-response', 'xhr-login-response', 'storage.setItem', 'globalState']);
        if (!bearerTrustedSources.has(hint)) return;
        if (!looksLikeJwt(token)) return;

        // debounce per token
        try {
          const last = window.__bs_last_details || {};
          if (last.token === token && (Date.now() - last.ts) < 5000) return;
          window.__bs_last_details = { token, ts: Date.now() };
        } catch (e) {}

        await fetchDetailsWithBearer(token, hint + '-bearer');
      } catch (e) {}
    }

    // Forward details if response contains serology (deduped)
    const forwardedDetailsCache = new Map();
    function forwardDetailsIfContainsSerology(json, sourceHint) {
      try {
        if (!json) return false;
        const candidate = json.serology ? json : (json.accountDetails ? json.accountDetails : null);
        if (!candidate) return false;
        const shortHand = candidate.serology && candidate.serology.shortHand;
        if (!shortHand) return false;

        const key = String(shortHand) + '|' + (sourceHint || 'observed');
        const lastTs = forwardedDetailsCache.get(key) || 0;
        if ((Date.now() - lastTs) < 3000) return true;
        forwardedDetailsCache.set(key, Date.now());

        postToContent({ type: 'BloodSerologyExtDetails', json: candidate, source: sourceHint });
        return true;
      } catch (e) {
        return false;
      }
    }

    // Inspect fetch responses for DETAILS_URL and LOGIN_URL
    try {
      const origFetch = window.fetch;
      if (origFetch) {
        window.fetch = async function (...args) {
          const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
          const res = await origFetch.apply(this, args);
          try {
            if (requestUrl && requestUrl === DETAILS_URL) {
              const json = await res.clone().json().catch(() => null);
              if (json) forwardDetailsIfContainsSerology(json, 'observed-fetch');
            }
            if (requestUrl && requestUrl === LOGIN_URL) {
              const text = await res.clone().text().catch(() => null);
              if (text) {
                try {
                  const json = JSON.parse(text);
                  const token = extractTokenFromJson(json);
                  if (token) handleDetectedToken(token, 'login-response').catch(()=>{});
                } catch (e) {}
              }
            }
          } catch (e) {}
          return res;
        };
      }
    } catch (e) {}

    // Inspect XHR responses for DETAILS_URL and LOGIN_URL
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
            if (!url) return;
            if (url === DETAILS_URL) {
              const text = this.responseText;
              if (!text) return;
              try {
                const json = JSON.parse(text);
                if (json) forwardDetailsIfContainsSerology(json, 'observed-xhr');
              } catch (e) {}
            }
            if (url === LOGIN_URL) {
              const text = this.responseText;
              if (!text) return;
              try {
                const json = JSON.parse(text);
                const token = extractTokenFromJson(json);
                if (token) handleDetectedToken(token, 'xhr-login-response').catch(()=>{});
              } catch (e) {}
            }
          } catch (e) {}
        });
        return xhr;
      }
      window.XMLHttpRequest = PatchedXHR;
    } catch (e) {}

    // Patch document.cookie setter: post token only, do not attempt bearer details
    try {
      const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                               Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
      if (cookieDescriptor && cookieDescriptor.configurable) {
        const origCookieSetter = cookieDescriptor.set;
        Object.defineProperty(document, 'cookie', {
          configurable: true,
          enumerable: true,
          get: cookieDescriptor.get,
          set: function (val) {
            try {
              const s = String(val || '');
              if (/accessToken=|access_token=|refreshToken=/.test(s)) {
                postToContent({ type: 'BloodSerologyExtToken', token: s, source: 'cookie-write' });
              }
            } catch (e) {}
            return origCookieSetter.call(document, val);
          }
        });
      }
    } catch (e) {}

    // Quick storage check for explicit JWT keys (optional, minimal)
    try {
      const v = localStorage.getItem('accessToken') || localStorage.getItem('bs_token');
      if (v && looksLikeJwt(v)) handleDetectedToken(v, 'storage.setItem').catch(()=>{});
      else if (v) postToContent({ type: 'BloodSerologyExtToken', token: v, source: 'localStorage' });
    } catch (e) {}

    LOG('page_inject installed');
  } catch (e) {}
})();
