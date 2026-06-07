const { Sequelize } = require("sequelize");
const { findMissingEnv, getDatabaseConfig } = require("../config/env");

let sequelize;

function getSequelize() {
  const config = getDatabaseConfig();

  if (!sequelize) {
    sequelize = new Sequelize(
      config.MYSQL_DATABASE,
      config.MYSQL_USERNAME,
      config.MYSQL_PASSWORD,
      {
        host: config.host,
        port: config.port,
        dialect: "mysql",
        logging: false,
      }
    );
  }

  return sequelize;
}

async function checkDatabase() {
  const config = getDatabaseConfig();
  const missingEnv = findMissingEnv(config, [
    "MYSQL_ADDRESS",
    "MYSQL_USERNAME",
    "MYSQL_PASSWORD",
    "MYSQL_DATABASE",
  ]);

  if (missingEnv.length > 0) {
    return {
      ok: false,
      status: "missing_config",
      missingEnv,
    };
  }

  try {
    const connection = getSequelize();
    await connection.query("SELECT 1 AS ok");

    return {
      ok: true,
      status: "ok",
      database: config.MYSQL_DATABASE,
      hostConfigured: Boolean(config.host),
    };
  } catch (error) {
    console.error("MySQL check failed:", error.message);
    return {
      ok: false,
      status: "connection_failed",
    };
  }
}

module.exports = {
  checkDatabase,
  getSequelize,
};
