const MAX_SIZE_BYTES = 10 * 1024 ** 3; // 10 GB (binary, 10 GiB)
const MAX_ENTRIES = 32;
const DEFAULT_SIZE_TEXT = "1MB, 10MB, 100MB, 500MB, 1GB, 5GB, 10GB";

const UNIT_FACTORS = {
  "": 1,
  b: 1,
  bytes: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  tb: 1024 ** 4,
  tib: 1024 ** 4,
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || Number.isInteger(value) ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unit]}`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ${seconds}s`;
}

/**
 * Parses a comma/space separated list such as "1MB, 500MB, 2.5GB" into
 * [{ label, bytes }]. Binary units are used (1 MB = 1024 * 1024 bytes).
 */
function parseSizes(input) {
  const text = String(input ?? "").trim();
  if (!text) {
    return { ok: false, error: "Enter at least one file size, for example 1MB, 100MB, 1GB." };
  }

  const tokens = text
    .split(/[,;\n]+|\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length > MAX_ENTRIES) {
    return { ok: false, error: `Please use at most ${MAX_ENTRIES} sizes per run.` };
  }

  const sizes = [];
  const seen = new Set();

  for (const token of tokens) {
    const match = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/.exec(token);
    if (!match) {
      return { ok: false, error: `"${token}" is not a valid size. Use values like 1MB or 2.5GB.` };
    }

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const factor = UNIT_FACTORS[unit];

    if (!factor) {
      return { ok: false, error: `Unknown unit in "${token}". Use B, KB, MB, GB or TB.` };
    }

    const bytes = Math.round(amount * factor);
    if (!Number.isFinite(bytes) || bytes < 1) {
      return { ok: false, error: `"${token}" is too small. The minimum size is 1 byte.` };
    }
    if (bytes > MAX_SIZE_BYTES) {
      return { ok: false, error: `"${token}" is larger than the 10 GB limit.` };
    }

    if (seen.has(bytes)) continue;
    seen.add(bytes);
    sizes.push({ label: formatBytes(bytes), bytes });
  }

  if (!sizes.length) {
    return { ok: false, error: "Enter at least one file size." };
  }

  sizes.sort((a, b) => a.bytes - b.bytes);
  return { ok: true, sizes };
}

module.exports = {
  DEFAULT_SIZE_TEXT,
  MAX_SIZE_BYTES,
  formatBytes,
  formatDuration,
  parseSizes,
};
