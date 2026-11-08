const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const origLookup = dns.lookup;
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = { family: 4 };
  } else if (typeof options === 'number') {
    options = { family: 4 };
  } else if (typeof options === 'object' && options !== null) {
    options = { ...options, family: 4 };
  } else {
    options = { family: 4 };
  }
  return origLookup.call(this, hostname, options, (err, address, family) => {
    if (Array.isArray(address)) {
      const filtered = address.filter(a => a.family === 4);
      return callback(err, filtered.length ? filtered : address);
    }
    callback(err, address, family);
  });
};

try {
  const undici = require('/home/x-5194/UP/worker/node_modules/undici');
  if (undici && undici.setGlobalDispatcher && undici.Agent) {
    undici.setGlobalDispatcher(
      new undici.Agent({
        headersTimeout: 600000,
        bodyTimeout: 600000,
        connectTimeout: 120000,
      })
    );
  }
} catch {}
