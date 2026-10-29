# S3 upload benchmark

A small Node.js + EJS dashboard that uploads **arbitrary byte streams** of several
file sizes (up to 10 GB) to an S3-compatible bucket, one size after another, twice
per size, and shows how long each upload took. Every run is **appended** to
[results.md](results.md) — earlier runs are never rewritten.

## What it does

- Only starts when you press **Start** — nothing uploads on page load.
- Uploads each configured size **2 times, sequentially** (size 1 attempt 1, size 1
  attempt 2, size 2 attempt 1, …).
- Payloads are generated on the fly from an in-memory random pool: nothing is
  written to disk, and only a few part buffers are kept in memory even for 10 GB.
- Files larger than 8 MiB are uploaded with **S3 multipart upload**
  (5–64 MiB parts, 4 parts in flight); smaller files use a single `PutObject`.
- Shows live per-upload progress and the **duration + throughput** of every
  completed upload, and writes a row into `results.md` as soon as it finishes.
- "Delete each object after upload" (on by default) removes the object right after
  it is measured, so repeated 10 GB runs do not fill the bucket. Uncheck it if you
  want to keep the uploaded objects.

## Configuration

Credentials live in `.env` (already filled in for this machine):

```
S3_ENDPOINT=http://10.13.5.27:9000
S3_BUCKET=246109051-workspace
S3_REGION=us-east-1
S3_ACCESS_KEY=...
S3_SECRET_KEY=...

PORT=3000
```

## Run it

```bash
npm install
npm start
# open http://localhost:3000
```

Default sizes are `1MB, 10MB, 100MB, 500MB, 1GB, 5GB, 10GB` → 7 sizes × 2 attempts
= 14 uploads, ≈33 GB of data per full run. Edit the size list in the UI for a
shorter run (e.g. `1MB, 50MB, 1GB`).

Sizes are binary: `1 MB = 1024² bytes`, `1 GB = 1024³ bytes`. Throughput is
reported in decimal MB/s (`bytes / 10⁶ / seconds`). Timing starts right before the
first request of an upload (create-multipart for large files, `PutObject` for
small ones) and stops when S3 confirms the upload, so multipart finalisation is
included.

Uploaded objects are keyed as
`bench/<run-timestamp>/<size>-attempt<1|2>.bin`.

## Results file

`results.md` gets a new section per run:

```markdown
## Run 2026-10-29T16:20:00.123Z (33.1 GB over 14 uploads)

- **Endpoint:** `http://10.13.5.27:9000`
...

| # | Size | Attempt | Duration (s) | Throughput (MB/s) | Status | Object key |
|--:|------|--------:|-------------:|------------------:|--------|------------|
| 1 | 1 MB | 1/2 | 0.183 | 5.47 | OK | `bench/.../1mb-attempt1.bin` |
...

**Summary:** 14 uploads · 14 ok · 0 failed · 5m 12s total · average 780.20 MB/s · ...
```

View it in the UI at `/results` (or open the file directly).

## Project layout

| File | Purpose |
|------|---------|
| `server.js` | Express server, EJS rendering, JSON + SSE endpoints |
| `lib/uploader.js` | Multipart / single-put uploader with progress and cancellation |
| `lib/runner.js` | Sequential run orchestration, timing, live state publishing |
| `lib/results.js` | Appends run sections and rows to `results.md` |
| `lib/payload.js` | Arbitrary byte stream generator |
| `lib/sizes.js` | Size parsing, validation (≤ 10 GB) and formatting |
| `lib/s3.js` | S3 client (path-style, MinIO friendly) |
| `views/` | EJS templates |
| `public/` | Browser script and styles |

## Notes

- A run is aborted after 3 consecutive failed uploads (endpoint down, bad
  credentials, …) so a broken configuration does not spin for hours.
- **Stop** aborts the upload in flight, aborts the multipart upload on the server
  and records the cancelled row in `results.md`.
