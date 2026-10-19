// scripts/backup-database.mjs
// Take a restorable backup of the ASILUM database (owner directive,
// 14 Aug 2026, backlog 6).
//
//   node scripts/backup-database.mjs [--out DIR]
//
// THE TRAP THIS SCRIPT EXISTS TO AVOID: pg_dump run as the least-privilege
// application role does NOT fail on tables it cannot read — it dumps what
// it can see and exits 0. That produces a backup that looks healthy and is
// silently missing tables, which is worse than having no backup, because
// you stop worrying. So this refuses to run as anyone but the owner, and
// then PROVES completeness by comparing the tables inside the dump against
// the tables in the live catalog. A mismatch is a hard failure.
//
// The dump is custom format (-Fc): compressed, and pg_restore can read it
// selectively, which is what you want at 3am.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// pg_dump/psql live wherever the operator put them. ~/.local is this
// project's convention for durable tooling (no system-wide installs).
const PG_BIN = process.env.PG_BIN || path.join(process.env.HOME || "", ".local/libpq/18.4/bin");
const pgEnv = {
  ...process.env,
  DYLD_LIBRARY_PATH: process.env.DYLD_LIBRARY_PATH ||
    path.join(process.env.HOME || "", ".local/libpq/18.4/lib"),
};
const tool = (name) => (fs.existsSync(path.join(PG_BIN, name)) ? path.join(PG_BIN, name) : name);

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

async function psql(url, sql) {
  const { stdout } = await run(tool("psql"), [url, "-Atc", sql], { env: pgEnv, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * Take a full logical dump of the database. OWNER CREDENTIALS ONLY.
 *
 * Requires DATABASE_ADMIN_URL and refuses without it. The runtime
 * DATABASE_URL connects as `asilum_app`, which deliberately cannot read every
 * table — a backup taken as the app role would be SILENTLY PARTIAL and would
 * look like a successful backup until the day it was restored. There is no
 * best-effort option here on purpose.
 */
export async function backup({ outDir, stamp } = {}) {
  loadEnv();
  // OWNER ONLY. DATABASE_URL connects as asilum_app, which cannot read
  // every table — see the note at the top. There is no "best effort"
  // option here on purpose.
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    throw new Error(
      "DATABASE_ADMIN_URL is required — a backup taken as the application role " +
      "silently omits tables it cannot read. Set the owner connection string."
    );
  }
  const who = await psql(url, "select current_user");
  if (who === "asilum_app") {
    throw new Error("refusing to back up as asilum_app — that dump would be silently incomplete");
  }

  const dir = outDir || process.env.BACKUP_DIR || path.join(root, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const when = stamp || new Date().toISOString().replace(/[:.]/g, "-");
  const dumpPath = path.join(dir, `asilum-${when}.dump`);

  // What the live database holds, BEFORE the dump — the yardstick.
  const schemaVersion = await psql(url, "select coalesce(max(version), 0) from app_schema_migrations");
  const tableRows = await psql(url,
    `select table_name from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE' order by table_name`);
  const liveTables = tableRows ? tableRows.split("\n").filter(Boolean) : [];

  await run(tool("pg_dump"), [url, "-Fc", "--no-owner", "--no-privileges", "-f", dumpPath],
    { env: pgEnv, maxBuffer: 256 * 1024 * 1024 });

  // PROVE it. pg_restore -l lists what is actually inside the archive.
  const { stdout: toc } = await run(tool("pg_restore"), ["-l", dumpPath],
    { env: pgEnv, maxBuffer: 64 * 1024 * 1024 });
  const dumped = new Set(
    [...toc.matchAll(/^\d+;\s+\d+\s+\d+\s+TABLE DATA\s+public\s+(\S+)/gm)].map((m) => m[1])
  );
  const missing = liveTables.filter((t) => !dumped.has(t));
  if (missing.length) {
    throw new Error(
      `INCOMPLETE BACKUP — ${missing.length} table(s) absent from the dump: ${missing.join(", ")}. ` +
      "The file has been kept for inspection, but do not treat it as a backup."
    );
  }

  // Row counts travel with the dump so a restore can be checked against
  // the source it came from, not against a guess.
  const countRows = await psql(url,
    `select string_agg(t || '=' || n, E'\\n') from (
       select table_name as t,
              (xpath('/row/c/text()',
                query_to_xml(format('select count(*) as c from public.%I', table_name),
                             false, true, '')))[1]::text::bigint as n
         from information_schema.tables
        where table_schema='public' and table_type='BASE TABLE'
     ) s`);
  const counts = Object.fromEntries(
    (countRows || "").split("\n").filter(Boolean).map((line) => {
      const i = line.lastIndexOf("=");
      return [line.slice(0, i), Number(line.slice(i + 1))];
    })
  );

  const manifest = {
    takenAt: new Date().toISOString(),
    schemaVersion: Number(schemaVersion),
    tables: liveTables.length,
    rows: counts,
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    dump: path.basename(dumpPath),
    bytes: fs.statSync(dumpPath).size,
    pgDump: (await run(tool("pg_dump"), ["--version"], { env: pgEnv })).stdout.trim(),
  };
  const manifestPath = dumpPath.replace(/\.dump$/, ".manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  return { dumpPath, manifestPath, manifest };
}

// Compare RESOLVED FILESYSTEM PATHS, not url strings: this project's
// directory contains spaces and a literal "*", so import.meta.url is
// percent-encoded and never equals `file://${process.argv[1]}` — the
// guard silently did nothing and the script exited 0 having run no
// backup, which is the worst possible failure mode for this file.
const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const outIdx = process.argv.indexOf("--out");
  backup({ outDir: outIdx > -1 ? process.argv[outIdx + 1] : undefined })
    .then(({ dumpPath, manifest }) => {
      console.log(`backup written: ${dumpPath}`);
      console.log(`  schema v${manifest.schemaVersion} · ${manifest.tables} tables · ` +
        `${manifest.totalRows.toLocaleString()} rows · ${(manifest.bytes / 1e6).toFixed(1)} MB`);
      console.log("  every live table is present in the dump (verified against pg_restore -l)");
    })
    .catch((error) => {
      console.error("BACKUP FAILED: " + error.message);
      process.exit(1);
    });
}
