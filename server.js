const path = require("node:path");
const express = require("express");

const config = require("./lib/config");
const { HeadBucketCommand } = require("@aws-sdk/client-s3");
const { getClient } = require("./lib/s3");
const { DEFAULT_SIZE_TEXT, formatBytes, parseSizes } = require("./lib/sizes");
const results = require("./lib/results");
const runner = require("./lib/runner");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (request, response) => {
  response.render("index", {
    bucket: config.bucket,
    endpoint: config.endpoint,
    region: config.region,
    defaultSizes: DEFAULT_SIZE_TEXT,
    attempts: runner.ATTEMPTS,
    maxSize: formatBytes(10 * 1024 ** 3),
  });
});

app.get("/api/state", (request, response) => {
  response.json(runner.getState());
});

app.get("/api/plan", (request, response) => {
  const parsed = parseSizes(request.query.sizes ?? DEFAULT_SIZE_TEXT);
  if (!parsed.ok) {
    response.status(400).json({ ok: false, error: parsed.error });
    return;
  }

  const bytesTotal = parsed.sizes.reduce((sum, size) => sum + size.bytes, 0) * runner.ATTEMPTS;
  response.json({
    ok: true,
    sizes: parsed.sizes,
    attempts: runner.ATTEMPTS,
    totalUploads: parsed.sizes.length * runner.ATTEMPTS,
    bytesTotal,
    bytesTotalLabel: formatBytes(bytesTotal),
  });
});

app.post("/api/start", (request, response) => {
  if (runner.isRunning()) {
    response.status(409).json({ ok: false, error: "A run is already in progress." });
    return;
  }

  const parsed = parseSizes(request.body?.sizes ?? DEFAULT_SIZE_TEXT);
  if (!parsed.ok) {
    response.status(400).json({ ok: false, error: parsed.error });
    return;
  }

  try {
    const state = runner.start({
      sizes: parsed.sizes,
      deleteAfter: request.body?.deleteAfter !== false,
    });
    response.status(202).json({ ok: true, runId: state.runId });
  } catch (error) {
    response.status(error.code === "ALREADY_RUNNING" ? 409 : 500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/api/stop", (request, response) => {
  response.json({ ok: true, state: runner.stop() });
});

app.get("/api/stream", (request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event, payload) => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  send("state", runner.getState());
  for (const entry of runner.getLogBuffer()) send("log", entry);

  const unsubscribeState = runner.onState((state) => send("state", state));
  const unsubscribeLog = runner.onLog((entry) => send("log", entry));

  const heartbeat = setInterval(() => response.write(": ping\n\n"), 15_000);

  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribeState();
    unsubscribeLog();
  });
});

app.get("/api/health", async (request, response) => {
  const startedAt = Date.now();
  try {
    await getClient().send(new HeadBucketCommand({ Bucket: config.bucket }), {
      requestTimeout: 8_000,
    });
    response.json({
      ok: true,
      bucket: config.bucket,
      endpoint: config.endpoint,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    response.status(502).json({
      ok: false,
      bucket: config.bucket,
      endpoint: config.endpoint,
      error: error.message,
    });
  }
});

app.get("/results", async (request, response) => {
  const markdown = await results.readResults();
  response.render("results", { markdown, bucket: config.bucket });
});

app.get("/results.md", (request, response) => {
  response.sendFile(config.resultsFile, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});

results
  .ensureFile()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`S3 upload benchmark running at http://localhost:${config.port}`);
      console.log(`Endpoint: ${config.endpoint} · Bucket: ${config.bucket}`);
      console.log(`Results append to: ${config.resultsFile}`);
    });
  })
  .catch((error) => {
    console.error(`Could not prepare results.md: ${error.message}`);
    process.exit(1);
  });
