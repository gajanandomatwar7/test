const crypto = require("node:crypto");

/**
 * Source of arbitrary bytes for the uploads. A random pool is generated once
 * and copied into freshly allocated chunks; a plain memcpy is far faster than
 * generating 10 GB of random data on the fly, so it never bottlenecks the
 * network measurement. The data is incompressible pseudo-random bytes.
 */
const POOL_SIZE = 8 * 1024 * 1024;
const pool = crypto.randomBytes(POOL_SIZE);
let cursor = crypto.randomInt(0, POOL_SIZE);

function chunk(bytes) {
  if (bytes <= 0) return Buffer.alloc(0);

  const buffer = Buffer.allocUnsafe(bytes);
  let written = 0;

  while (written < bytes) {
    const available = POOL_SIZE - cursor;
    const take = Math.min(bytes - written, available);
    pool.copy(buffer, written, cursor, cursor + take);
    written += take;
    cursor += take;
    if (cursor >= POOL_SIZE) cursor = 0;
  }

  return buffer;
}

module.exports = { chunk };
