// user_records (v53): the device-only V.2 records become real (19 Sep 2026).
//
// Law 1: a record is private to its identity; another device sees nothing.
// Law 2: validation is typed — kind, id, payload shape, size, per-kind cap —
//        and a refusal names its code; nothing is trimmed in silence.
// Law 3: the table is registered everywhere a per-person table must be:
//        adoption moves rows into the account (no-clobber), erasure removes
//        them, export lists them (docs/engineering/architecture.md § Identity).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { callRoute, loadRoute, newDevice } from "./helpers/route.js";
import {
  putUserRecord, listUserRecords, deleteUserRecord, validateRecordInput, RECORD_CAPS,
  adoptAccountData, purgePersonalizationData, exportPersonalizationData, EXPORT_MANIFEST,
} from "../lib/db/production.js";

const route = await loadRoute("app/api/records/route.js");

test("law 2: typed validation", () => {
  assert.equal(validateRecordInput({ kind: "nope", recordId: "x", payload: {} }).code, "record_kind");
  assert.equal(validateRecordInput({ kind: "save", recordId: "", payload: {} }).code, "record_id");
  assert.equal(validateRecordInput({ kind: "location", recordId: "home", payload: {} }).code, "record_id");
  assert.equal(validateRecordInput({ kind: "save", recordId: "a", payload: [] }).code, "record_payload");
  assert.equal(validateRecordInput({ kind: "save", recordId: "a", payload: { big: "x".repeat(9000) } }).code, "record_too_large");
  assert.equal(validateRecordInput({ kind: "draft", recordId: "draft-1", payload: { name: "Fair" } }).ok, true);
});

test("law 1 + 2: the route round-trips a save, refuses a stranger's read, and names its refusals", async () => {
  const me = newDevice();
  const other = newDevice();
  const put = await callRoute(route.PUT, {
    path: "/api/records", method: "PUT", cookies: me.cookies,
    json: { user: me.uid, kind: "save", recordId: "person:olivier-rousteing", payload: { kind: "person", id: "olivier-rousteing", title: "Olivier Rousteing", at: "2026-09-19T00:00:00Z" } },
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.outcome, "ok");
  assert.equal(put.body.created, true);
  assert.equal(put.body.record.recordId, "person:olivier-rousteing");

  const again = await callRoute(route.PUT, {
    path: "/api/records", method: "PUT", cookies: me.cookies,
    json: { user: me.uid, kind: "save", recordId: "person:olivier-rousteing", payload: { kind: "person", id: "olivier-rousteing", title: "Olivier Rousteing", note: "edited" } },
  });
  assert.equal(again.body.created, false, "an upsert, not a duplicate");

  const mine = await callRoute(route.GET, { path: "/api/records", cookies: me.cookies, query: { user: me.uid, kind: "save" } });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.outcome, "ok");
  assert.equal(mine.body.records.length, 1);
  assert.equal(mine.body.records[0].payload.note, "edited");
  assert.match(mine.headers.get("Cache-Control") || "", /no-store/);

  const theirs = await callRoute(route.GET, { path: "/api/records", cookies: other.cookies, query: { user: other.uid, kind: "save" } });
  assert.equal(theirs.body.outcome, "empty");
  assert.deepEqual(theirs.body.records, []);

  const anon = await callRoute(route.GET, { path: "/api/records", query: { kind: "save" } });
  assert.equal(anon.status, 401);
  assert.equal(anon.body.outcome, "unauthorized");

  const badKind = await callRoute(route.GET, { path: "/api/records", cookies: me.cookies, query: { user: me.uid, kind: "wishes" } });
  assert.equal(badKind.status, 400);
  assert.equal(badKind.body.error.code, "record_kind");

  const tooBig = await callRoute(route.PUT, {
    path: "/api/records", method: "PUT", cookies: me.cookies,
    json: { user: me.uid, kind: "draft", recordId: "d1", payload: { blob: "y".repeat(8500) } },
  });
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.body.error.code, "record_too_large");

  const del = await callRoute(route.DELETE, {
    path: "/api/records", method: "DELETE", cookies: me.cookies,
    json: { user: me.uid, kind: "save", recordId: "person:olivier-rousteing" },
  });
  assert.equal(del.body.deleted, true);
  const gone = await callRoute(route.DELETE, {
    path: "/api/records", method: "DELETE", cookies: me.cookies,
    json: { user: me.uid, kind: "save", recordId: "person:olivier-rousteing" },
  });
  assert.equal(gone.body.deleted, false, "deleting what is not there is not an error");
});

test("law 2: location is one private row, and the cap refuses a 51st draft by name", async () => {
  const me = newDevice();
  const loc = await putUserRecord(me.uid, { kind: "location", recordId: "base", payload: { baseCity: { name: "Bowie", lat: 38.94, lng: -76.73 }, publicDetail: "none", audience: "me" } });
  assert.equal(loc.created, true);
  const loc2 = await putUserRecord(me.uid, { kind: "location", recordId: "base", payload: { baseCity: null, publicDetail: "city", audience: "everyone" } });
  assert.equal(loc2.created, false);
  assert.equal((await listUserRecords(me.uid, { kind: "location" })).length, 1);
  await assert.rejects(putUserRecord(me.uid, { kind: "location", recordId: "second", payload: {} }), /base/);

  for (let i = 0; i < RECORD_CAPS.draft; i++) {
    const r = await putUserRecord(me.uid, { kind: "draft", recordId: `draft-${i}`, payload: { i } });
    assert.equal(r.created, true);
  }
  const over = await putUserRecord(me.uid, { kind: "draft", recordId: "draft-over", payload: {} });
  assert.deepEqual(over, { capped: true, cap: RECORD_CAPS.draft });
  const update = await putUserRecord(me.uid, { kind: "draft", recordId: "draft-0", payload: { i: "edited" } });
  assert.equal(update.created, false, "the cap never refuses an update of an existing record");
  const viaRoute = await callRoute(route.PUT, {
    path: "/api/records", method: "PUT", cookies: me.cookies,
    json: { user: me.uid, kind: "draft", recordId: "draft-over", payload: {} },
  });
  assert.equal(viaRoute.status, 409);
  assert.equal(viaRoute.body.error.code, "record_cap");
  assert.equal(viaRoute.body.cap, RECORD_CAPS.draft);
});

test("law 3: adoption moves records into the account without clobbering, erasure removes them, export lists them", async () => {
  const device = newDevice().uid;
  const account = "sb-" + "0".repeat(8) + "-0000-4000-8000-" + Date.now().toString().padStart(12, "0").slice(-12);
  await putUserRecord(device, { kind: "save", recordId: "place:pg-fashion-week", payload: { from: "device" } });
  await putUserRecord(device, { kind: "save", recordId: "person:x", payload: { from: "device" } });
  await putUserRecord(device, { kind: "location", recordId: "base", payload: { from: "device" } });
  await putUserRecord(account, { kind: "save", recordId: "person:x", payload: { from: "account" } });

  const adopted = await adoptAccountData(device, account);
  assert.ok(adopted, "adoption ran");
  const accountSaves = await listUserRecords(account, { kind: "save" });
  assert.equal(accountSaves.length, 2);
  assert.equal(accountSaves.find((r) => r.recordId === "person:x").payload.from, "account", "the account's own record wins a collision");
  assert.equal(accountSaves.find((r) => r.recordId === "place:pg-fashion-week").payload.from, "device");
  assert.equal((await listUserRecords(account, { kind: "location" }))[0].payload.from, "device");
  assert.equal((await listUserRecords(device)).length, 0, "nothing is left under the device");

  const exported = await exportPersonalizationData(account);
  assert.ok(Array.isArray(exported.data.records.rows), "the export carries the records domain");
  assert.equal(exported.data.records.rows.length, 3);
  assert.equal(exported.data.records.truncated, false);
  assert.equal(EXPORT_MANIFEST.user_records.domain, "records");

  await purgePersonalizationData(account);
  assert.equal((await listUserRecords(account)).length, 0, "erasure reaches user_records");
  assert.equal((await deleteUserRecord(account, "save", "person:x")).deleted, false);
});

test("law 3: the migration and the registration points name the table", () => {
  const sql = fs.readFileSync(new URL("../supabase/schema-v53-user-records.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_records/);
  assert.match(sql, /UNIQUE \(user_id, kind, record_id\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /CREATE POLICY asilum_app_server_access ON user_records/);
  assert.match(sql, /VALUES \(53, 'user-records'\)/);
  const corrections = fs.readFileSync(new URL("../lib/db/production/corrections.js", import.meta.url), "utf8");
  assert.match(corrections, /INSERT INTO user_records \(user_id, kind, record_id, payload, created_at, updated_at\)/, "PG adoption");
  assert.match(corrections, /SELECT count\(\*\) FROM user_records WHERE user_id=\$1/, "adoption's signal count sees the table");
  const privacy = fs.readFileSync(new URL("../lib/db/production/privacy.js", import.meta.url), "utf8");
  assert.match(privacy, /DELETE FROM user_records WHERE user_id=\$1/, "PG erasure");
});
