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
