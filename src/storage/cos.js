const COS = require("cos-nodejs-sdk-v5");
const { findMissingEnv, getStorageConfig } = require("../config/env");

function createClient(config) {
  return new COS({
    SecretId: config.COS_SECRET_ID,
    SecretKey: config.COS_SECRET_KEY,
  });
}

function headBucket(client, config) {
  return new Promise((resolve, reject) => {
    client.headBucket(
      {
        Bucket: config.COS_BUCKET,
        Region: config.COS_REGION,
      },
      (error, data) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(data);
      }
    );
  });
}

async function checkStorage() {
  const config = getStorageConfig();
  const missingEnv = findMissingEnv(config, [
    "COS_SECRET_ID",
    "COS_SECRET_KEY",
    "COS_BUCKET",
    "COS_REGION",
  ]);

  if (missingEnv.length > 0) {
    return {
      ok: false,
      status: "missing_config",
      missingEnv,
    };
  }

  try {
    const client = createClient(config);
    await headBucket(client, config);

    return {
      ok: true,
      status: "ok",
      bucket: config.COS_BUCKET,
      region: config.COS_REGION,
      prefix: config.COS_PREFIX,
    };
  } catch (error) {
    console.error("Storage check failed:", error.message);
    return {
      ok: false,
      status: "connection_failed",
      bucket: config.COS_BUCKET,
      region: config.COS_REGION,
    };
  }
}

module.exports = {
  checkStorage,
};
