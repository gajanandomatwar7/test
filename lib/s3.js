const { S3Client } = require("@aws-sdk/client-s3");
const config = require("./config");

let client = null;

/**
 * Single shared S3 client configured for an S3-compatible endpoint (MinIO).
 * forcePathStyle is required for MinIO, and checksum calculation is limited to
 * operations that require it so older S3-compatible servers accept the
 * multipart requests.
 */
function getClient() {
  if (client) return client;

  client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
  });

  return client;
}

module.exports = { getClient };
