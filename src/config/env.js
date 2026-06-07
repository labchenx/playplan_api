function splitAddress(address) {
  if (!address) {
    return { host: undefined, port: undefined };
  }

  const [host, port] = address.split(":");
  return {
    host,
    port: port ? Number(port) : undefined,
  };
}

function findMissingEnv(config, requiredKeys) {
  return requiredKeys.filter((key) => !config[key]);
}

function getDatabaseConfig() {
  const { host, port } = splitAddress(process.env.MYSQL_ADDRESS);

  return {
    MYSQL_ADDRESS: process.env.MYSQL_ADDRESS,
    MYSQL_USERNAME: process.env.MYSQL_USERNAME,
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD,
    MYSQL_DATABASE: process.env.MYSQL_DATABASE,
    host,
    port,
  };
}

function getStorageConfig() {
  return {
    COS_SECRET_ID: process.env.COS_SECRET_ID,
    COS_SECRET_KEY: process.env.COS_SECRET_KEY,
    COS_BUCKET: process.env.COS_BUCKET,
    COS_REGION: process.env.COS_REGION,
    COS_PREFIX: process.env.COS_PREFIX || "covers/",
  };
}

module.exports = {
  findMissingEnv,
  getDatabaseConfig,
  getStorageConfig,
};
