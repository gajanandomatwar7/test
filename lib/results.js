const fs = require("node:fs/promises");
const config = require("./config");
const { formatBytes, formatDuration } = require("./sizes");

const FILE_HEADER = [
  "# S3 upload benchmark results",
  "",
  "Every run appends a new section below; nothing already written is ever rewritten.",
  `Bucket: \`${config.bucket}\` · Endpoint: \`${config.endpoint}\` · Region: \`${config.region}\``,
  "",
  "",
].join("\n");

function cell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function seconds(durationMs) {
  return (durationMs / 1000).toFixed(3);
}

function throughput(mbps) {
  return Number.isFinite(mbps) ? mbps.toFixed(2) : "-";
}

async function ensureFile() {
  try {
    await fs.access(config.resultsFile);
  } catch {
    await fs.writeFile(config.resultsFile, FILE_HEADER, "utf8");
  }
}

async function beginRun(meta) {
  await ensureFile();

  const sizeList = meta.sizes.map((size) => size.label).join(", ");
  const lines = [
    `## Run ${meta.startedAt} (${formatBytes(meta.bytesTotal)} over ${meta.plan} uploads)`,
    "",
    `- **Endpoint:** \`${config.endpoint}\``,
    `- **Bucket:** \`${config.bucket}\``,
    `- **Region:** \`${config.region}\``,
    `- **Sizes:** ${sizeList}`,
    `- **Attempts per size:** ${meta.attempts}`,
    `- **Upload concurrency:** ${meta.partConcurrency} parts in flight (multipart)`,
    `- **Delete objects after upload:** ${meta.deleteAfter ? "yes" : "no"}`,
    "",
    "| # | Size | Attempt | Duration (s) | Throughput (MB/s) | Status | Object key |",
    "|--:|------|--------:|-------------:|------------------:|--------|------------|",
  ];

  await fs.appendFile(config.resultsFile, `${lines.join("\n")}\n`, "utf8");
}

async function appendRow(row) {
  const status = row.status === "ok" ? "OK" : `${row.status.toUpperCase()}: ${row.error || ""}`;
  const line =
    `| ${row.index} | ${cell(row.sizeLabel)} | ${row.attempt}/${row.attempts} | ` +
    `${seconds(row.durationMs)} | ${throughput(row.throughputMBps)} | ${cell(status)} | ` +
    `${cell(`\`${row.key}\``)} |\n`;

  await fs.appendFile(config.resultsFile, line, "utf8");
}

async function endRun(summary) {
  const lines = [
    "",
    `**Summary:** ${summary.total} uploads · ${summary.ok} ok · ${summary.failed} failed` +
      `${summary.cancelled ? ` · ${summary.cancelled} cancelled` : ""} · ` +
      `${formatDuration(summary.durationMs)} total · ` +
      `average ${throughput(summary.avgThroughputMBps)} MB/s` +
      `${summary.deleted ? ` · objects deleted after upload (${summary.deleted})` : ""}` +
      ` · finished ${summary.finishedAt}`,
    "",
    "",
  ];

  await fs.appendFile(config.resultsFile, lines.join("\n"), "utf8");
}

async function readResults() {
  try {
    return await fs.readFile(config.resultsFile, "utf8");
  } catch {
    return "";
  }
}

module.exports = { ensureFile, beginRun, appendRow, endRun, readResults };
