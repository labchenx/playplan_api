const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const XLSX = require("xlsx");

loadEnvFile(path.resolve(__dirname, "../.env"));
loadEnvFile(path.resolve(__dirname, "../.env.local"));

const { findMissingEnv, getDatabaseConfig } = require("../src/config/env");

const DEFAULT_PLATFORM = "NS1";
const DEFAULT_SOURCE = "excel_import";
const REQUIRED_ENV = [
  "MYSQL_ADDRESS",
  "MYSQL_USERNAME",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
];

const NAME_COLUMNS = ["游戏名", "游戏名称"];
const DATE_COLUMNS = ["发售日期"];
const COVER_COLUMNS = ["封面原图URL"];
const LOCAL_IMAGE_COLUMNS = ["入库用本地图片"];

function parseArgs(argv) {
  const args = {
    input: path.resolve(__dirname, "../../files/games.xlsx"),
    platform: DEFAULT_PLATFORM,
    sheet: "",
    dryRun: false,
    outputSql: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--input") {
      args.input = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--platform") {
      args.platform = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--sheet") {
      args.sheet = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--output-sql") {
      args.outputSql = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }
  }

  return args;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function cleanText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function normalizeName(value) {
  return cleanText(value).replace(/\s+/g, " ");
}

function normalizeLocalPath(value) {
  return cleanText(value).replace(/\\/g, "/");
}

function readCell(row, columns) {
  for (const column of columns) {
    if (Object.prototype.hasOwnProperty.call(row, column)) {
      return row[column];
    }
  }
  return undefined;
}

function createCatalogId(platform, name) {
  const base = `${platform}:${name}`.toLowerCase();
  const digest = crypto.createHash("sha1").update(base, "utf8").digest("hex").slice(0, 12);
  return `catalog-${platform.toLowerCase()}-${digest}`;
}

function formatDateParts(year, month, day) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function isValidDateParts(year, month, day) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const date = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay));

  return (
    date.getUTCFullYear() === numericYear &&
    date.getUTCMonth() + 1 === numericMonth &&
    date.getUTCDate() === numericDay
  );
}

function parseReleaseDate(value) {
  if (value === null || value === undefined || value === "") {
    return { value: null, invalid: false, raw: "" };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      value: formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate()),
      invalid: false,
      raw: value.toISOString(),
    };
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return {
        value: formatDateParts(parsed.y, parsed.m, parsed.d),
        invalid: false,
        raw: String(value),
      };
    }
  }

  const raw = cleanText(value);
  if (!raw) {
    return { value: null, invalid: false, raw };
  }

  const normalized = raw.replace(/[.-]/g, "/");
  const fullDate = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (fullDate) {
    if (!isValidDateParts(fullDate[1], fullDate[2], fullDate[3])) {
      return { value: null, invalid: true, raw };
    }

    return {
      value: formatDateParts(fullDate[1], fullDate[2], fullDate[3]),
      invalid: false,
      raw,
    };
  }

  const yearMonth = normalized.match(/^(\d{4})\/(\d{1,2})$/);
  if (yearMonth) {
    if (!isValidDateParts(yearMonth[1], yearMonth[2], 1)) {
      return { value: null, invalid: true, raw };
    }

    return {
      value: formatDateParts(yearMonth[1], yearMonth[2], 1),
      invalid: false,
      raw,
    };
  }

  const yearOnly = normalized.match(/^(\d{4})$/);
  if (yearOnly) {
    return {
      value: formatDateParts(yearOnly[1], 1, 1),
      invalid: false,
      raw,
    };
  }

  return { value: null, invalid: true, raw };
}

function getSheetRows(workbook, sheetName) {
  const candidates = sheetName ? [sheetName] : workbook.SheetNames;

  for (const candidateName of candidates) {
    const sheet = workbook.Sheets[candidateName];
    if (!sheet) {
      continue;
    }

    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      const headers = [];
      for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
        const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        headers.push(cleanText(sheet[cellAddress] && sheet[cellAddress].v));
      }

      if (!headers.some((header) => NAME_COLUMNS.includes(header))) {
        continue;
      }

      const rows = [];
      for (let dataRowIndex = rowIndex + 1; dataRowIndex <= range.e.r; dataRowIndex += 1) {
        const row = {};
        headers.forEach((header, headerIndex) => {
          if (!header) {
            return;
          }
          const colIndex = range.s.c + headerIndex;
          const cellAddress = XLSX.utils.encode_cell({ r: dataRowIndex, c: colIndex });
          const cell = sheet[cellAddress];
          row[header] = cell ? cell.v : undefined;
        });
        rows.push({ sourceRow: dataRowIndex + 1, row });
      }

      return {
        sheetName: candidateName,
        headerRow: rowIndex + 1,
        rows,
      };
    }
  }

  throw new Error("No worksheet contains a supported game name header.");
}

function buildCatalogItems(inputPath, options) {
  const workbook = XLSX.readFile(inputPath, { cellDates: true });
  const sheetRows = getSheetRows(workbook, options.sheet);
  const seen = new Set();
  const items = [];
  const invalidDateRows = [];
  let skippedEmptyName = 0;
  let duplicateRows = 0;

  for (const entry of sheetRows.rows) {
    const name = normalizeName(readCell(entry.row, NAME_COLUMNS));
    if (!name) {
      skippedEmptyName += 1;
      continue;
    }

    const platform = options.platform || DEFAULT_PLATFORM;
    const dedupeKey = `${platform}:${name}`.toLowerCase();
    if (seen.has(dedupeKey)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(dedupeKey);

    const releaseDate = parseReleaseDate(readCell(entry.row, DATE_COLUMNS));
    if (releaseDate.invalid) {
      invalidDateRows.push({
        sourceRow: entry.sourceRow,
        name,
        raw: releaseDate.raw,
      });
    }

    const coverUrl = cleanText(readCell(entry.row, COVER_COLUMNS));
    const localImagePath = normalizeLocalPath(readCell(entry.row, LOCAL_IMAGE_COLUMNS));

    items.push({
      id: createCatalogId(platform, name),
      name,
      platform,
      release_date: releaseDate.value,
      publisher: null,
      region: null,
      cover_url: coverUrl || null,
      cover_thumb_url: null,
      cover_file_id: null,
      cover_thumb_file_id: null,
      local_image_path: localImagePath || null,
      source_original_url: coverUrl || null,
      source: DEFAULT_SOURCE,
      source_row: entry.sourceRow,
    });
  }

  return {
    sheetName: sheetRows.sheetName,
    headerRow: sheetRows.headerRow,
    totalRows: sheetRows.rows.length,
    items,
    skippedEmptyName,
    duplicateRows,
    invalidDateRows,
  };
}

function valuesForInsert(item) {
  return [
    item.id,
    item.name,
    item.platform,
    item.release_date,
    item.publisher,
    item.region,
    item.cover_url,
    item.cover_thumb_url,
    item.cover_file_id,
    item.cover_thumb_file_id,
    item.local_image_path,
    item.source_original_url,
    item.source,
    item.source_row,
  ];
}

function sqlValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return String(value);
  }

  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function buildCatalogImportSql(items) {
  const columns = [
    "id",
    "name",
    "platform",
    "release_date",
    "publisher",
    "region",
    "cover_url",
    "cover_thumb_url",
    "cover_file_id",
    "cover_thumb_file_id",
    "local_image_path",
    "source_original_url",
    "source",
    "source_row",
  ];

  const values = items.map((item) => {
    return `(${columns.map((column) => sqlValue(item[column])).join(", ")})`;
  });

  return [
    "-- Generated from files/games.xlsx by scripts/import-game-catalog.js",
    "-- Execute after 20260607_001_create_game_catalog_and_user_games.sql.",
    "SET NAMES utf8mb4;",
    "",
    `INSERT INTO game_catalog (${columns.join(", ")}) VALUES`,
    `${values.join(",\n")}`,
    `ON DUPLICATE KEY UPDATE
  release_date = VALUES(release_date),
  publisher = VALUES(publisher),
  region = VALUES(region),
  cover_url = VALUES(cover_url),
  cover_thumb_url = VALUES(cover_thumb_url),
  cover_file_id = VALUES(cover_file_id),
  cover_thumb_file_id = VALUES(cover_thumb_file_id),
  local_image_path = VALUES(local_image_path),
  source_original_url = VALUES(source_original_url),
  source = VALUES(source),
  source_row = VALUES(source_row);`,
    "",
  ].join("\n");
}

function hasCatalogDiff(existing, item) {
  const fields = [
    "release_date",
    "publisher",
    "region",
    "cover_url",
    "cover_thumb_url",
    "cover_file_id",
    "cover_thumb_file_id",
    "local_image_path",
    "source_original_url",
    "source",
    "source_row",
  ];

  return fields.some((field) => {
    const existingValue = existing[field] instanceof Date
      ? formatDateParts(
          existing[field].getFullYear(),
          existing[field].getMonth() + 1,
          existing[field].getDate()
        )
      : existing[field];
    return (existingValue === undefined ? null : existingValue) !== item[field];
  });
}

async function createConnection() {
  const config = getDatabaseConfig();
  const missingEnv = findMissingEnv(config, REQUIRED_ENV);
  if (missingEnv.length > 0) {
    throw new Error(`MySQL config incomplete: ${missingEnv.join(", ")}`);
  }

  return mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.MYSQL_USERNAME,
    password: config.MYSQL_PASSWORD,
    database: config.MYSQL_DATABASE,
    charset: "utf8mb4",
  });
}

async function importItems(items) {
  const connection = await createConnection();
  const stats = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
  };

  try {
    for (const item of items) {
      const [existingRows] = await connection.execute(
        "SELECT * FROM game_catalog WHERE platform = ? AND name = ? LIMIT 1",
        [item.platform, item.name]
      );

      if (existingRows.length === 0) {
        await connection.execute(
          `INSERT INTO game_catalog (
            id, name, platform, release_date, publisher, region,
            cover_url, cover_thumb_url, cover_file_id, cover_thumb_file_id,
            local_image_path, source_original_url, source, source_row
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          valuesForInsert(item)
        );
        stats.inserted += 1;
        continue;
      }

      const existing = existingRows[0];
      if (!hasCatalogDiff(existing, item)) {
        stats.unchanged += 1;
        continue;
      }

      await connection.execute(
        `UPDATE game_catalog SET
          release_date = ?,
          publisher = ?,
          region = ?,
          cover_url = ?,
          cover_thumb_url = ?,
          cover_file_id = ?,
          cover_thumb_file_id = ?,
          local_image_path = ?,
          source_original_url = ?,
          source = ?,
          source_row = ?
        WHERE id = ?`,
        [
          item.release_date,
          item.publisher,
          item.region,
          item.cover_url,
          item.cover_thumb_url,
          item.cover_file_id,
          item.cover_thumb_file_id,
          item.local_image_path,
          item.source_original_url,
          item.source,
          item.source_row,
          existing.id,
        ]
      );
      stats.updated += 1;
    }
  } finally {
    await connection.end();
  }

  return stats;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = buildCatalogItems(args.input, args);
  const summary = {
    input: args.input,
    sheet: catalog.sheetName,
    headerRow: catalog.headerRow,
    totalRows: catalog.totalRows,
    imported: catalog.items.length,
    skippedEmptyName: catalog.skippedEmptyName,
    duplicateRows: catalog.duplicateRows,
    invalidDates: catalog.invalidDateRows.length,
    invalidDateRows: catalog.invalidDateRows,
    dryRun: args.dryRun,
  };

  if (!args.dryRun) {
    summary.database = process.env.MYSQL_DATABASE || null;
    summary.write = await importItems(catalog.items);
  }

  if (args.outputSql) {
    fs.mkdirSync(path.dirname(args.outputSql), { recursive: true });
    fs.writeFileSync(args.outputSql, buildCatalogImportSql(catalog.items), "utf8");
    summary.outputSql = args.outputSql;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
