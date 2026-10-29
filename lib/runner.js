const { EventEmitter } = require("node:events");
const { performance } = require("node:perf_hooks");
const { DeleteObjectCommand } = require("@aws-sdk/client-s3");

const config = require("./config");
const results = require("./results");
const { getClient } = require("./s3");
const { formatBytes, formatDuration } = require("./sizes");
const { uploadObject, PART_CONCURRENCY } = require("./uploader");

/** Every size is uploaded this many times, back to back. */
const ATTEMPTS = 2;
/** Abort a run after this many consecutive failures (endpoint down, bad auth, ...). */
const MAX_CONSECUTIVE_FAILURES = 3;

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

let activeAbort = null;
let lastPublishAt = 0;

function emptyState() {
  return {
    running: false,
    cancelled: false,
    runId: null,
    startedAt: null,
    finishedAt: null,
    sizes: [],
    attempts: ATTEMPTS,
    totalUploads: 0,
    deleteAfter: true,
    bytesTotal: 0,
    bytesDone: 0,
    results: [],
    current: null,
    deleted: 0,
    error: null,
  };
}

let state = emptyState();

function snapshot() {
  return { ...state, at: Date.now() };
}

function publish() {
  lastPublishAt = Date.now();
  emitter.emit("state", snapshot());
}

function publishThrottled() {
  if (Date.now() - lastPublishAt < 100) return;
  publish();
}

const LOG_BUFFER_MAX = 300;
const logBuffer = [];

function log(message, level = "info") {
  const entry = { at: new Date().toISOString(), level, message };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
  emitter.emit("log", entry);
}

function slug(label) {
  return label.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9.-]/g, "");
}

function onProgress(index, progress) {
  const current = state.current;
  if (!current || current.index !== index) return;

  current.uploadedBytes = progress.uploadedBytes;
  current.elapsedMs = progress.elapsedMs;
  current.throughputMBps =
    progress.elapsedMs > 0 ? progress.uploadedBytes / 1e6 / (progress.elapsedMs / 1000) : 0;
  current.partNumber = progress.partNumber || 1;
  current.totalParts = progress.totalParts || 1;
  publishThrottled();
}

function start({ sizes, deleteAfter = true }) {
  if (state.running) {
    const error = new Error("A run is already in progress.");
    error.code = "ALREADY_RUNNING";
    throw error;
  }

  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");

  state = {
    ...emptyState(),
    running: true,
    runId: startedAt,
    startedAt,
    stamp,
    sizes,
    deleteAfter,
    totalUploads: sizes.length * ATTEMPTS,
    bytesTotal: sizes.reduce((sum, size) => sum + size.bytes, 0) * ATTEMPTS,
  };

  publish();
  run().catch((error) => {
    log(`Run crashed: ${error.message}`, "error");
    state.running = false;
    state.error = error.message;
    state.finishedAt = new Date().toISOString();
    publish();
  });

  return snapshot();
}

async function run() {
  activeAbort = new AbortController();
  const lifecycleStart = performance.now();

  await results.beginRun({
    startedAt: state.startedAt,
    sizes: state.sizes,
    attempts: ATTEMPTS,
    plan: state.totalUploads,
    bytesTotal: state.bytesTotal,
    deleteAfter: state.deleteAfter,
    partConcurrency: PART_CONCURRENCY,
  });

  log(
    `Run ${state.runId} started: ${state.totalUploads} uploads, ${formatBytes(state.bytesTotal)} total, ` +
      `bucket "${config.bucket}"`
  );

  let index = 0;
  let consecutiveFailures = 0;
  let stoppedEarly = false;

  try {
    for (const size of state.sizes) {
      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        if (state.cancelled) {
          stoppedEarly = true;
          break;
        }

        index += 1;
        const key = `bench/${state.stamp}/${slug(size.label)}-attempt${attempt}.bin`;

        state.current = {
          index,
          sizeLabel: size.label,
          bytes: size.bytes,
          attempt,
          attempts: ATTEMPTS,
          key,
          uploadedBytes: 0,
          totalBytes: size.bytes,
          elapsedMs: 0,
          throughputMBps: 0,
          partNumber: 1,
          totalParts: 1,
        };
        publish();
        log(`#${index}/${state.totalUploads} · ${size.label} attempt ${attempt}/${ATTEMPTS} → ${key}`);

        const attemptStart = performance.now();
        let row;

        try {
          const outcome = await uploadObject({
            size: size.bytes,
            key,
            signal: activeAbort.signal,
            onProgress: (progress) => onProgress(index, progress),
            onWarning: (message) => log(message, "warn"),
          });

          const durationMs = outcome.durationMs;
          row = {
            index,
            sizeLabel: size.label,
            bytes: size.bytes,
            attempt,
            attempts: ATTEMPTS,
            durationMs,
            throughputMBps: size.bytes / 1e6 / (durationMs / 1000),
            status: "ok",
            key,
            mode: outcome.mode,
            parts: outcome.parts,
          };
        } catch (error) {
          const wasCancelled = state.cancelled || error.name === "AbortError";
          row = {
            index,
            sizeLabel: size.label,
            bytes: size.bytes,
            attempt,
            attempts: ATTEMPTS,
            durationMs: performance.now() - attemptStart,
            throughputMBps: Number.NaN,
            status: wasCancelled ? "cancelled" : "failed",
            key,
            error: error.message,
          };
        }

        state.results.push(row);
        if (row.status === "ok") state.bytesDone += row.bytes;
        state.current = null;
        publish();

        try {
          await results.appendRow(row);
        } catch (error) {
          log(`Could not write results.md: ${error.message}`, "error");
        }

        if (row.status === "ok") {
          consecutiveFailures = 0;
          log(
            `#${index} done in ${formatDuration(row.durationMs)} · ${row.throughputMBps.toFixed(2)} MB/s ` +
              `· ${row.mode}, ${row.parts} part${row.parts === 1 ? "" : "s"}`
          );
        } else {
          consecutiveFailures += 1;
          log(`#${index} ${row.status}: ${row.error}`, "error");
        }

        if (row.status === "ok" && state.deleteAfter) {
          try {
            await getClient().send(
              new DeleteObjectCommand({ Bucket: config.bucket, Key: key })
            );
            state.deleted += 1;
          } catch (error) {
            log(`Could not delete ${key}: ${error.message}`, "warn");
          }
        }

        if (row.status !== "ok" && row.status !== "cancelled" && !state.cancelled) {
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            log(`Stopping after ${consecutiveFailures} consecutive failures.`, "error");
            state.error = row.error;
            stoppedEarly = true;
            break;
          }
        }

        if (state.cancelled) {
          stoppedEarly = true;
          break;
        }
      }

      if (stoppedEarly) break;
    }
  } finally {
    activeAbort = null;
    state.running = false;
    state.current = null;
    state.finishedAt = new Date().toISOString();

    const okRows = state.results.filter((row) => row.status === "ok");
    const failedRows = state.results.filter((row) => row.status === "failed");
    const cancelledRows = state.results.filter((row) => row.status === "cancelled");
    const wallClockMs = performance.now() - lifecycleStart;

    const summary = {
      total: state.results.length,
      ok: okRows.length,
      failed: failedRows.length,
      cancelled: cancelledRows.length,
      durationMs: wallClockMs,
      avgThroughputMBps: okRows.length
        ? okRows.reduce((sum, row) => sum + row.throughputMBps, 0) / okRows.length
        : Number.NaN,
      finishedAt: state.finishedAt,
      deleted: state.deleted,
    };

    try {
      await results.endRun(summary);
    } catch (error) {
      log(`Could not write results.md summary: ${error.message}`, "error");
    }

    if (state.cancelled) {
      log("Run cancelled.", "warn");
    } else if (okRows.length === state.results.length && state.results.length > 0) {
      log(
        `Run finished: ${okRows.length}/${state.totalUploads} uploads in ${formatDuration(wallClockMs)} ` +
          `(${summary.avgThroughputMBps.toFixed(2)} MB/s average)`
      );
    } else {
      log(
        `Run finished with problems: ${okRows.length} ok, ${failedRows.length} failed, ` +
          `${cancelledRows.length} cancelled.`,
        "warn"
      );
    }

    publish();
    emitter.emit("done", snapshot());
  }
}

function stop() {
  if (!state.running) return snapshot();
  state.cancelled = true;
  log("Stop requested — aborting the current upload…", "warn");
  activeAbort?.abort();
  publish();
  return snapshot();
}

module.exports = {
  ATTEMPTS,
  getState: () => snapshot(),
  getLogBuffer: () => [...logBuffer],
  isRunning: () => state.running,
  start,
  stop,
  onState: (handler) => {
    emitter.on("state", handler);
    return () => emitter.off("state", handler);
  },
  onLog: (handler) => {
    emitter.on("log", handler);
    return () => emitter.off("log", handler);
  },
};
