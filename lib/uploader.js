const {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  UploadPartCommand,
} = require("@aws-sdk/client-s3");
const { performance } = require("node:perf_hooks");

const config = require("./config");
const payload = require("./payload");
const { getClient } = require("./s3");

const MIB = 1024 * 1024;
const MIN_PART_SIZE = 5 * MIB; // S3 minimum for every part but the last
const MAX_PART_SIZE = 64 * MIB;
const MULTIPART_THRESHOLD = 8 * MIB;
const PART_CONCURRENCY = 4;
const MAX_PARTS = 10_000;

/**
 * Picks a part size that keeps the part count low enough for very large files
 * while staying in the 5 MiB - 64 MiB window.
 */
function choosePartSize(size) {
  const target = Math.ceil(size / 2000);
  const rounded = Math.ceil(Math.max(MIN_PART_SIZE, target) / MIB) * MIB;
  return Math.min(Math.max(rounded, MIN_PART_SIZE), MAX_PART_SIZE);
}

/**
 * Uploads `size` arbitrary bytes to `key`, streaming multipart parts with
 * bounded concurrency. Timing starts immediately before the first request
 * reaches S3 and stops once the upload is committed.
 *
 * @returns {Promise<{bytes:number,durationMs:number,parts:number,partSize:number,mode:string}>}
 */
async function uploadObject({ size, key, signal, onProgress = () => {}, onWarning = () => {} }) {
  const client = getClient();
  const bucket = config.bucket;
  const startedAt = performance.now();
  const elapsedMs = () => performance.now() - startedAt;

  if (size <= MULTIPART_THRESHOLD) {
    const body = payload.chunk(size);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: size,
        ContentType: "application/octet-stream",
      }),
      { abortSignal: signal }
    );

    const durationMs = elapsedMs();
    onProgress({ uploadedBytes: size, totalBytes: size, elapsedMs: durationMs });
    return { bytes: size, durationMs, parts: 1, partSize: size, mode: "single put" };
  }

  const partSize = choosePartSize(size);
  const totalParts = Math.ceil(size / partSize);
  if (totalParts > MAX_PARTS) {
    throw new Error(`Upload would need ${totalParts} parts (limit ${MAX_PARTS}).`);
  }

  const created = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: "application/octet-stream",
    }),
    { abortSignal: signal }
  );

  const uploadId = created.UploadId;
  const parts = new Array(totalParts);
  let nextIndex = 0;
  let uploadedBytes = 0;

  const abortMultipart = async () => {
    try {
      await client.send(
        new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId })
      );
    } catch (error) {
      // Nothing else we can do if cleanup fails; bucket lifecycle rules win.
      onWarning(`Could not abort multipart upload ${uploadId} for ${key}: ${error.message}`);
    }
  };

  async function worker() {
    // One buffer per worker, reused for every part it sends.
    const buffer = payload.chunk(partSize);

    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= totalParts) return;
      if (signal?.aborted) return;

      const offset = index * partSize;
      const length = Math.min(partSize, size - offset);
      const body = length === partSize ? buffer : buffer.subarray(0, length);

      const result = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: index + 1,
          Body: body,
          ContentLength: length,
        }),
        { abortSignal: signal }
      );

      parts[index] = { ETag: result.ETag, PartNumber: index + 1 };
      uploadedBytes += length;
      onProgress({
        uploadedBytes,
        totalBytes: size,
        elapsedMs: elapsedMs(),
        partNumber: index + 1,
        totalParts,
      });
    }
  }

  try {
    const workerCount = Math.min(PART_CONCURRENCY, totalParts);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } catch (error) {
    await abortMultipart();
    throw error;
  }

  if (signal?.aborted) {
    await abortMultipart();
    throw Object.assign(new Error("Upload cancelled"), { name: "AbortError" });
  }

  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }),
    { abortSignal: signal }
  );

  const durationMs = elapsedMs();
  onProgress({ uploadedBytes: size, totalBytes: size, elapsedMs: durationMs });
  return { bytes: size, durationMs, parts: totalParts, partSize, mode: "multipart" };
}

module.exports = { uploadObject, choosePartSize, PART_CONCURRENCY };
