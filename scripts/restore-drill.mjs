// scripts/restore-drill.mjs
// Rehearse the restore (owner directive, 14 Aug 2026, backlog 6).
//
//   node scripts/restore-drill.mjs [path/to/asilum-*.dump]
//
// A backup nobody has restored is a hope, not a backup. This proves the
// dump is restorable by actually restoring it into a THROWAWAY database
// and comparing every table's row count against the manifest written when
// the dump was taken. Then it drops the throwaway.
//
// SAFETY, because this script drops a database:
//   * The target name is built here and must match DRILL_DB_RE. The drop
//     refuses any name that does not — there is no way to point this at
//     the production database, even by editing the argument.
//   * It refuses to run if the target name equals the source database.
//   * It NEVER writes to the source. The only statements it issues there
//     are CREATE DATABASE / DROP DATABASE for its own scratch target.
// Nothing in the production database is read-modified or deleted.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PG_BIN = process.env.PG_BIN || path.join(process.env.HOME || "", ".local/libpq/18.4/bin");
const pgEnv = {
  ...process.env,
  DYLD_LIBRARY_PATH: process.env.DYLD_LIBRARY_PATH ||
    path.join(process.env.HOME || "", ".local/libpq/18.4/lib"),
};
const tool = (name) => (fs.existsSync(path.join(PG_BIN, name)) ? path.join(PG_BIN, name) : name);

// The only database names this script is allowed to create or drop.
const DRILL_DB_RE = /^asilum_restore_drill_[0-9a-z]{6,}$/;

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const psql = async (url, sql) =>
  (await run(tool("psql"), [url, "-Atc", sql], { env: pgEnv, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();

// Swap the database name in a connection string, keeping everything else
// (credentials, host, sslmode, pooler options) exactly as configured.
function withDatabase(url, dbName) {
  const u = new URL(url);
  u.pathname = "/" + dbName;
  return u.toString();
}

function latestDump(dir) {
  if (!fs.existsSync(dir)) return null;
  const dumps = fs.readdirSync(dir).filter((f) => f.endsWith(".dump")).sort();
  return dumps.length ? path.join(dir, dumps[dumps.length - 1]) : null;
}

/**
 * Restore the latest dump into a scratch database, verify it, and drop it.
 *
 * THE HALF OF BACKUP THAT ACTUALLY PROVES ANYTHING: a dump nobody has ever
 * restored is a hope. Runs against a throwaway database, never a live one, and
 * needs owner credentials to create and drop it.
 */
export async function drill({ dumpPath } = {}) {
  loadEnv();
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required (creating and dropping a scratch database needs the owner)");

  const dir = process.env.BACKUP_DIR || path.join(root, "backups");
  const dump = dumpPath || latestDump(dir);
  if (!dump || !fs.existsSync(dump)) throw new Error(`no dump found (looked in ${dir})`);
  const manifestPath = dump.replace(/\.dump$/, ".manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("the dump has no manifest — row counts cannot be checked, so this would prove nothing");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const sourceDb = new URL(adminUrl).pathname.replace(/^\//, "");
  const target = "asilum_restore_drill_" + Math.random().toString(36).slice(2, 10).replace(/[^0-9a-z]/g, "x");
  if (!DRILL_DB_RE.test(target)) throw new Error("generated an unsafe drill database name — refusing");
  if (target === sourceDb) throw new Error("drill target equals the source database — refusing");

  const targetUrl = withDatabase(adminUrl, target);
  const started = Date.now();
  const report = { dump: path.basename(dump), target, sourceDb, manifest, checks: [], ok: false };

  await psql(adminUrl, `CREATE DATABASE ${target}`);
  try {
    // pg_restore reports non-fatal noise (extensions, comments the role may
    // not own) on exit 1; the row-count comparison below is the real verdict,
    // so warnings are recorded rather than treated as failure.
    let restoreWarnings = "";
    try {
      await run(tool("pg_restore"), ["-d", targetUrl, "--no-owner", "--no-privileges", "-j", "4", dump],
        { env: pgEnv, maxBuffer: 256 * 1024 * 1024 });
    } catch (error) {
      restoreWarnings = String(error.stderr || error.message).split("\n").slice(0, 12).join("\n");
    }
    report.restoreWarnings = restoreWarnings;

    // THE VERDICT: every table in the manifest must exist in the restored
    // database with the same row count.
    const restoredRows = await psql(targetUrl,
      `select string_agg(t || '=' || n, E'\\n') from (
         select table_name as t,
                (xpath('/row/c/text()',
                  query_to_xml(format('select count(*) as c from public.%I', table_name),
                               false, true, '')))[1]::text::bigint as n
           from information_schema.tables
          where table_schema='public' and table_type='BASE TABLE'
       ) s`);
    const restored = Object.fromEntries(
      (restoredRows || "").split("\n").filter(Boolean).map((line) => {
        const i = line.lastIndexOf("=");
        return [line.slice(0, i), Number(line.slice(i + 1))];
      })
    );

    for (const [table, expected] of Object.entries(manifest.rows)) {
      const got = restored[table];
      report.checks.push({
        table,
        expected,
        got: got === undefined ? null : got,
        ok: got === expected,
      });
    }
    const extra = Object.keys(restored).filter((t) => !(t in manifest.rows));
    report.extraTables = extra;
    report.restoredSchemaVersion = Number(
      await psql(targetUrl, "select coalesce(max(version), 0) from app_schema_migrations").catch(() => "0")
    );
    report.failures = report.checks.filter((c) => !c.ok);
    report.ok = report.failures.length === 0 &&
      report.restoredSchemaVersion === manifest.schemaVersion;
  } finally {
    // Always clean up — a drill that leaves a database behind is a leak.
    // The guard is re-checked here because this is the destructive call.
    if (DRILL_DB_RE.test(target) && target !== sourceDb) {
      await psql(adminUrl, `DROP DATABASE IF EXISTS ${target} WITH (FORCE)`).catch(async () => {
        await psql(adminUrl, `DROP DATABASE IF EXISTS ${target}`).catch(() => {});
      });
      report.droppedScratch = true;
    }
  }
  report.seconds = +((Date.now() - started) / 1000).toFixed(1);
  return report;
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  drill({ dumpPath: arg })
    .then((r) => {
      console.log(`restore drill · ${r.dump} → scratch db ${r.target} (dropped: ${!!r.droppedScratch})`);
      console.log(`  schema v${r.restoredSchemaVersion} (dump says v${r.manifest.schemaVersion})`);
      console.log(`  ${r.checks.length} tables checked · ${r.checks.filter((c) => c.ok).length} match · ${r.failures.length} differ`);
      if (r.extraTables?.length) console.log(`  extra tables in restore: ${r.extraTables.join(", ")}`);
      if (r.restoreWarnings) console.log(`  pg_restore notes:\n${r.restoreWarnings.split("\n").map((l) => "    " + l).join("\n")}`);
      for (const f of r.failures.slice(0, 20)) {
        console.log(`  MISMATCH ${f.table}: expected ${f.expected}, restored ${f.got}`);
      }
      console.log(r.ok
        ? `  RESTORABLE — every table matched the manifest (${r.seconds}s)`
        : `  DRILL FAILED — this dump did not restore faithfully (${r.seconds}s)`);
      process.exit(r.ok ? 0 : 1);
    })
    .catch((error) => {
      console.error("DRILL ERROR: " + error.message);
      process.exit(1);
    });
}
