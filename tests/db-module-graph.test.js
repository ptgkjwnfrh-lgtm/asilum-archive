// tests/db-module-graph.test.js — The lib/db module graph: every relative
// import resolves to a real file, and the privacy export reaches the mail desk
// by a path that resolves.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

// THE SPLIT BROKE A DYNAMIC IMPORT AND NOTHING WENT RED.
//
// lib/db/production.js was 4,502 lines and came apart into lib/db/production/*.
// One line inside the §6 export did `await import("./dm.js")` — correct while
// the code lived in lib/db/, wrong the moment it moved one directory down. The
// build reported it as a WARNING that scrolls past, the unit suite was green,
// and the failure mode in production would have been an access-right export
// telling a person their mail desk was "unreadable".
//
// A static import would have thrown at load. A dynamic one inside a try/catch
// is invisible to every check the repo had. So the check is now here: every
// relative specifier in lib/db, static or dynamic, must name a file that
// exists. It costs nothing and it does not depend on a database.

const DB_DIR = path.join(process.cwd(), "lib", "db");

function jsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

// Comments FIRST: an apostrophe in prose ("the reader's record") opens a string
// literal that closes pages later and swallows everything between.
const stripComments = (s) =>
  s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const SPECIFIERS = [
  /\bfrom\s*["'](\.[^"']*)["']/g,        // static:  from "./x.js"
  /\bimport\s*\(\s*["'](\.[^"']*)["']/g, // dynamic: import("./x.js")
  /\brequire\s*\(\s*["'](\.[^"']*)["']/g,
];

test("every relative import under lib/db resolves to a file that exists", () => {
  const files = jsFilesUnder(DB_DIR);
  assert.ok(files.length > 5, `expected the db layer to have many modules, saw ${files.length}`);

  const broken = [];
  let checked = 0;
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const re of SPECIFIERS) {
      for (const m of src.matchAll(re)) {
        checked++;
        const target = path.resolve(path.dirname(file), m[1]);
        if (!existsSync(target)) {
          broken.push(`${path.relative(process.cwd(), file)} -> ${m[1]}`);
        }
      }
    }
  }

  // Positive assertion: a regex that matched nothing would pass vacuously, and
  // that is the exact shape of the bug this file exists to catch.
  assert.ok(checked > 20, `expected to check many specifiers, checked ${checked}`);
  assert.deepEqual(broken, [], "these relative imports name files that do not exist");
});

test("the §6 export reaches the mail desk by a path that resolves", () => {
  // The specific line that broke, asserted specifically — the general test
  // above would still pass if somebody replaced this import with a literal
  // empty result, which is what the catch block renders anyway.
  const privacy = path.join(DB_DIR, "production", "privacy.js");
  const src = readFileSync(privacy, "utf8");
  const m = /await import\(["'](\.[^"']*dm\.js)["']\)/.exec(src);
  assert.ok(m, "the §6 export must still load the mail desk to include it");
  assert.ok(existsSync(path.resolve(path.dirname(privacy), m[1])),
    `the export imports ${m[1]}, which does not exist — a person exercising ` +
    `their access right would be told their messages are unreadable`);
});
