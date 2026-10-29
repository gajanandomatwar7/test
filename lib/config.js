const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} in .env`);
  }
  return value;
}

const rootDir = path.join(__dirname, "..");

module.exports = {
  rootDir,
  resultsFile: path.join(rootDir, "results.md"),
  endpoint: required("S3_ENDPOINT"),
  bucket: required("S3_BUCKET"),
  region: process.env.S3_REGION || "us-east-1",
  accessKeyId: required("S3_ACCESS_KEY"),
  secretAccessKey: required("S3_SECRET_KEY"),
  port: Number(process.env.PORT || 3000),
};
