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

async function listDatabaseTables() {
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
    const [rows] = await connection.query(
      `SELECT
        table_name AS name,
        table_rows AS rows_count,
        create_time,
        update_time
      FROM information_schema.tables
      WHERE table_schema = ?
      ORDER BY table_name`,
      {
        replacements: [config.MYSQL_DATABASE],
      }
    );

    return {
      ok: true,
      status: "ok",
      database: config.MYSQL_DATABASE,
      tables: rows,
    };
  } catch (error) {
    console.error("MySQL table list failed:", error.message);
    return {
      ok: false,
      status: "query_failed",
    };
  }
}

async function listCatalogGames(options = {}) {
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

  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const where = [];
  const replacements = [];

  if (options.platform) {
    where.push("platform = ?");
    replacements.push(options.platform);
  }

  if (options.keyword) {
    where.push("name LIKE ?");
    replacements.push(`%${options.keyword}%`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const connection = getSequelize();
    const [rows] = await connection.query(
      `SELECT
        id,
        name,
        platform,
        release_date,
        publisher,
        region,
        cover_url,
        cover_thumb_url,
        cover_file_id,
        cover_thumb_file_id,
        local_image_path,
        source_original_url,
        source,
        source_row,
        created_at,
        updated_at
      FROM game_catalog
      ${whereSql}
      ORDER BY release_date IS NULL, release_date, source_row
      LIMIT ? OFFSET ?`,
      {
        replacements: [...replacements, limit, offset],
      }
    );

    const [countRows] = await connection.query(
      `SELECT COUNT(*) AS total FROM game_catalog ${whereSql}`,
      {
        replacements,
      }
    );

    return {
      ok: true,
      status: "ok",
      database: config.MYSQL_DATABASE,
      total: countRows[0].total,
      limit,
      offset,
      items: rows,
    };
  } catch (error) {
    console.error("Catalog game list failed:", error.message);
    return {
      ok: false,
      status: "query_failed",
    };
  }
}

module.exports = {
  checkDatabase,
  getSequelize,
  listDatabaseTables,
  listCatalogGames,
};
