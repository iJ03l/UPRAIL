const dns = require('node:dns');
const net = require('node:net');

dns.setDefaultResultOrder('ipv4first');
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}

const origLookup = dns.lookup;
dns.lookup = function patchedLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    return origLookup.call(this, hostname, { family: 4 }, options);
  }
  if (typeof options === 'number') {
    return origLookup.call(this, hostname, 4, callback);
  }
  if (options && typeof options === 'object') {
    return origLookup.call(this, hostname, { ...options, family: 4 }, callback);
  }
  return origLookup.call(this, hostname, { family: 4 }, callback);
};

const origSetTimeout = global.setTimeout;
global.setTimeout = function patchedSetTimeout(fn, delay, ...args) {
  // Undici's default connectTimeout is 10_000ms; extend to 60_000ms so slow handshakes succeed
  const nextDelay = typeof delay === 'number' && delay === 10000 ? 60000 : delay;
  return origSetTimeout.call(this, fn, nextDelay, ...args);
};

const Module = require('node:module');

function wrapFetchWith429Retry(origFetch) {
  if (!origFetch || origFetch.__patched429) return origFetch;
  const wrapped = async function patchedFetch(input, init) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await origFetch(input, init);
      if (res.status !== 429 || attempt === 5) {
        return res;
      }
      const retryAfterSec = parseInt(res.headers?.get?.('retry-after') || '', 10);
      const waitMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 45000)
          : (attempt + 1) * 5000;
      await new Promise((resolve) => origSetTimeout(resolve, waitMs));
    }
  };
  wrapped.__patched429 = true;
  return wrapped;
}

if (typeof global.fetch === 'function') {
  global.fetch = wrapFetchWith429Retry(global.fetch);
}

const origLoad = Module._load;
Module._load = function patchedModuleLoad(request, parent, isMain) {
  const loaded = origLoad.apply(this, arguments);
  if (
    loaded &&
    (request === 'undici' || String(request).endsWith('/undici') || String(request).includes('undici')) &&
    typeof loaded.fetch === 'function' &&
    !loaded.fetch.__patched429
  ) {
    try {
      loaded.fetch = wrapFetchWith429Retry(loaded.fetch.bind(loaded));
    } catch {
      // ignore if read-only export
    }
  }
  return loaded;
};


