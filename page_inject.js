// page_inject.js - conservative, bearer-only details requests, runs in page main world at document_start
(function () {
  try {
    if (window.__bs_page_inject_installed) return;
    window.__bs_page_inject_installed = true;
    const LOG = (...args) => { try { console.log('[page_inject]', ...args); } catch (e) {} };

    const LOGIN_URL = 'https://my.blood.co.uk/api/auth/v2/login';
    const DETAILS_URL = 'https://my.blood.co.uk/api/account/v2/details';

    function postToContent(msg) {
      try { window.postMessage(msg, '*'); } catch (e) { LOG('postToContent failed', e && e.message); }
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

    // Strict JWT check
    function looksLikeJwt(s) {
      if (!s || typeof s !== 'string') return false;
      return /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s.trim());
    }

    // Only request details when we have a JWT and the source is trusted
    async function fetchDetailsWithBearer(token, sourceHint) {
      if (!token) return null;
      try {
        LOG('fetchDetailsWithBearer start', sourceHint, 'tokenPreview:', token && String(token).slice(0,40));
        try { console.trace('[page_inject] fetchDetailsWithBearer stack'); } catch (e) {}

        const res = await fetch(DETAILS_URL, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
          credentials: 'include'
        }).catch(err => { LOG('fetch details network error', err && err.message); return null; });

        if (!res) { LOG('fetchDetailsWithBearer: no response'); return null; }
        if (res.status === 401) { LOG('fetchDetailsWithBearer: 401 Unauthorized — will not retry', sourceHint); return null; }
        if (!res.ok) { LOG('fetchDetailsWithBearer: non-ok response', res.status, sourceHint); return null; }

        const json = await res.json().catch(() => null);
        if (json && json.serology && json.serology.shortHand) {
          postToContent({ type: 'BloodSerologyExtDetails', json, source: sourceHint });
          return json;
        }
        if (json && json.accountDetails && json.accountDetails.serology && json.accountDetails.serology.shortHand) {
          postToContent({ type: 'BloodSerologyExtDetails', json: json.accountDetails, source: sourceHint });
          return json.accountDetails;
        }

        LOG('fetchDetailsWithBearer: no serology in response', sourceHint);
        return null;
      } catch (e) {
        LOG('fetchDetailsWithBearer error', e && e.message);
        return null;
      }
    }

    // Only attempt details when token is JWT and source is trusted for bearer usage
    async function handleDetectedToken(rawToken, hint) {
      try {
        const tokenFromCookie = (typeof rawToken === 'string') ? (extractTokenFromCookieString(rawToken) || rawToken) : rawToken;
        const token = (typeof tokenFromCookie === 'string') ? tokenFromCookie.trim() : tokenFromCookie;

        // Always forward the raw token for storage/logging
        postToContent({ type: 'BloodSerologyExtToken', token: token, source: hint });

        // Trusted sources for bearer requests
        const bearerTrustedSources = new Set(['login-response', 'xhr-login-response', 'storage.setItem', 'globalState']);
        const isTrustedSource = bearerTrustedSources.has(hint);

        if (!isTrustedSource) {
          LOG('handleDetectedToken: source not trusted for bearer request, skipping details', hint);
          return;
        }

        if (!looksLikeJwt(token)) {
          LOG('handleDetectedToken: token not JWT-like, skipping details', hint, token && String(token).slice(0,40));
          return;
        }

        // Debounce repeated requests for same token
        try {
          const last = window.__bs_last_details || {};
          if (last.token === token && (Date.now() - last.ts) < 5000) {
            LOG('handleDetectedToken: recent details request already made for this token, skipping');
            return;
          }
          window.__bs_last_details = { token, ts: Date.now() };
        } catch (e) {}

        await fetchDetailsWithBearer(token, hint + '-bearer');
      } catch (e) {
        LOG('handleDetectedToken error', e && e.message);
      }
    }

    // Inspect only the exact login URL responses
    try {
      const origFetch = window.fetch;
      if (origFetch) {
        window.fetch = async function (...args) {
          const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
          const res = await origFetch.apply(this, args);
          try {
            if (requestUrl && requestUrl === LOGIN_URL) {
              const text = await res.clone().text().catch(() => null);
              if (text) {
                try {
                  const json = JSON.parse(text);
                  const token = extractTokenFromJson(json);
                  if (token) {
                    handleDetectedToken(token, 'login-response').catch(()=>{});
                  }
                } catch (e) {
                  // ignore non-JSON
                }
              }
            }
          } catch (e) {
            LOG('fetch wrapper inspect error', e && e.message);
          }
          return res;
        };
        LOG('fetch wrapped (restricted to login URL)');
      }
    } catch (e) { LOG('fetch wrap failed', e && e.message); }

    // Wrap XHR but only inspect requests to the exact login URL
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
            if (url === LOGIN_URL) {
              const text = this.responseText;
              if (!text) return;
              try {
                const json = JSON.parse(text);
                const token = extractTokenFromJson(json);
                if (token) {
                  handleDetectedToken(token, 'xhr-login-response').catch(()=>{});
                }
              } catch (e) {
                // ignore non-JSON
              }
            }
          } catch (e) {
            LOG('XHR wrapper error', e && e.message);
          }
        });
        return xhr;
      }
      window.XMLHttpRequest = PatchedXHR;
      LOG('XMLHttpRequest wrapped (restricted to login URL)');
    } catch (e) { LOG('XHR wrap failed', e && e.message); }

    // Patch document.cookie setter but do NOT trigger bearer details from cookie writes.
    // Only post the cookie token for storage; do not call handleDetectedToken here.
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
                LOG('cookie write detected token-like value (restricted)', s.slice(0, 200));
                // Only post token; do not attempt bearer details from cookie writes
                postToContent({ type: 'BloodSerologyExtToken', token: s, source: 'cookie-write' });
              }
            } catch (e) {}
            return origCookieSetter.call(document, val);
          }
        });
        LOG('document.cookie setter patched (restricted, no bearer from cookie)');
      } else {
        LOG('document.cookie descriptor not configurable; skipping cookie setter patch');
      }
    } catch (e) { LOG('cookie patch failed', e && e.message); }

    // Initial scan for trusted sources only (storage keys or global state)
    try {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          const v = localStorage.getItem(k);
          if (!v) continue;
          // Only treat explicit accessToken keys as trusted storage sources
          if (/accessToken|access_token|bs_token/i.test(k) && looksLikeJwt(v)) {
            LOG('found JWT-like token in localStorage key', k);
            handleDetectedToken(v, 'storage.setItem').catch(()=>{});
          } else if (/accessToken|access_token|bs_token/i.test(k)) {
            // forward non-JWT token for storage but do not call details
            postToContent({ type: 'BloodSerologyExtToken', token: v, source: 'localStorage' });
          }
        }
      } catch (e) {}

      // Check common global state objects but only trigger details if a JWT is found
      try {
        const candidates = [
          window.__INITIAL_STATE__,
          window.__PRELOADED_STATE__,
          window.__APP_STATE__,
          window.__STATE__,
          window.__SSR_DATA__
        ];
        candidates.forEach((c, idx) => {
          try {
            if (!c) return;
            const json = (typeof c === 'string') ? (() => { try { return JSON.parse(c); } catch (e) { return null; } })() : c;
            if (json) {
              const token = extractTokenFromJson(json);
              if (token && looksLikeJwt(token)) {
                LOG('found JWT in global state candidate', idx);
                handleDetectedToken(token, 'globalState').catch(()=>{});
              } else if (token) {
                postToContent({ type: 'BloodSerologyExtToken', token, source: 'globalState' });
              }
              if (json && (json.accountDetails || json.serology)) {
                postToContent({ type: 'BloodSerologyExtDetails', json, source: 'globalState' });
              }
            }
          } catch (e) {}
        });
      } catch (e) {}
    } catch (e) { LOG('initial scan failed', e && e.message); }

    // Announce readiness
    postToContent({ type: 'BS_PAGE_HELLO', ready: true });
    LOG('installed (restricted, bearer-only details requests)');

  } catch (e) {
    try { console.warn('[page_inject] top-level error', e && e.message); } catch (e2) {}
  }
})();
