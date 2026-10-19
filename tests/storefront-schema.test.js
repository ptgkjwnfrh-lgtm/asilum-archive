// tests/storefront-schema.test.js — Schema v62 (native storefront): catalog
// authority, integer money and inventory, reservation uniqueness, indexed
// foreign keys and explicit server policies.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/schema-v62-native-storefront.sql", import.meta.url), "utf8");

function tableSql(name) {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
  assert.notEqual(start, -1, `${name} exists`);
  const next = sql.indexOf("CREATE TABLE IF NOT EXISTS ", start + 1);
  return sql.slice(start, next === -1 ? sql.length : next);
}

test("v62 stores native catalog authority, integer money/inventory and checkout-off projection", () => {
  assert.match(sql, /owner_account_id\s+UUID NOT NULL UNIQUE/);
  assert.match(sql, /target_cents\s+INTEGER NOT NULL DEFAULT 3000 CHECK \(target_cents = 3000\)/);
  for (const column of [
    "commerce_rail", "storefront_slug", "native_listing_id", "default_variant_id",
    "price_cents", "inventory_available", "listing_version", "native_checkout_ready",
  ]) assert.match(sql, new RegExp(`ALTER TABLE items ADD COLUMN IF NOT EXISTS ${column}\\b`));
  assert.match(sql, /native_checkout_ready BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /request_fingerprint TEXT NOT NULL/);
  assert.match(sql, /CHECK \(application_fee_cents = passenger_fee_cents \+ storefront_fee_reserved_cents\)/);
  assert.match(sql, /CHECK \(application_fee_cents <= expected_buyer_total_cents\)/);
  assert.match(sql, /FOREIGN KEY \(storefront_id, listing_id\)\s+REFERENCES native_listings\(storefront_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(listing_id, variant_id\)\s+REFERENCES native_listing_variants\(listing_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(order_id, storefront_id\)\s+REFERENCES orders\(id, storefront_id\)/);
});

test("v62 has reservation uniqueness, refund/inbox seams, indexed FKs and explicit server policies", () => {
  assert.match(sql, /storefront_fee_reservations_order_attempt_key/);
  assert.match(sql, /inventory_reservations_order_attempt_key/);
  assert.match(sql, /ON inventory_reservations \(order_id, payment_attempt_id, variant_id\)/);
  assert.match(sql, /FOREIGN KEY \(payment_attempt_id, order_id, storefront_id\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS refund_operations[\s\S]*FOREIGN KEY \(payment_attempt_id, order_id, storefront_id\)\s+REFERENCES payment_attempts\(id, order_id, storefront_id\)/);
  assert.match(sql, /FOREIGN KEY \(payment_attempt_id, order_id, storefront_id\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS refund_operations/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS stripe_event_inbox/);
  const policyTables = [
    "storefronts", "storefront_payment_accounts", "storefront_fee_accounts",
    "native_listings", "native_listing_variants", "order_lines", "payment_attempts",
    "storefront_fee_reservations", "storefront_fee_events", "inventory_reservations",
    "refund_operations", "stripe_event_inbox",
  ];
  for (const table of policyTables) {
    assert.match(sql, new RegExp(`CREATE POLICY asilum_app_server_access ON ${table}\\b`));
  }
  assert.match(sql, /INSERT INTO app_schema_migrations \(version, name\)\s+VALUES \(62, 'native-storefront'\)/);
});

test("v62 pins every reservation and fee event to one order/store graph with provider proof", () => {
  const feeReservations = tableSql("storefront_fee_reservations");
  assert.match(feeReservations, /UNIQUE \(id, order_id, storefront_id\)/);
  assert.match(feeReservations,
    /FOREIGN KEY \(order_id, storefront_id\)\s+REFERENCES orders\(id, storefront_id\)/);

  const inventory = tableSql("inventory_reservations");
  assert.match(inventory,
    /FOREIGN KEY \(order_id, storefront_id\)\s+REFERENCES orders\(id, storefront_id\)/);

  const events = tableSql("storefront_fee_events");
  assert.match(events, /reservation_id\s+UUID NOT NULL/);
  assert.match(events,
    /FOREIGN KEY \(reservation_id, order_id, storefront_id\)\s+REFERENCES storefront_fee_reservations\(id, order_id, storefront_id\)/);
  assert.match(events,
    /FOREIGN KEY \(payment_attempt_id, order_id, storefront_id\)\s+REFERENCES payment_attempts\(id, order_id, storefront_id\)/);
  assert.match(events,
    /FOREIGN KEY \(reverses_event_id, storefront_id, order_id, reservation_id\)\s+REFERENCES storefront_fee_events\(id, storefront_id, order_id, reservation_id\)/);
  assert.match(events, /kind <> 'collected'[\s\S]*stripe_account_id IS NOT NULL[\s\S]*stripe_application_fee_id IS NOT NULL[\s\S]*stripe_event_id IS NOT NULL[\s\S]*livemode IS NOT NULL/);
  assert.match(events, /kind <> 'reversed'[\s\S]*stripe_fee_refund_id IS NOT NULL[\s\S]*stripe_event_id IS NOT NULL[\s\S]*livemode IS NOT NULL/);
});

test("v62 rollback drops dependent native tables before order graph columns", () => {
  const childDrop = sql.indexOf("DROP TABLE IF EXISTS stripe_event_inbox, refund_operations, inventory_reservations");
  const orderColumnDrop = sql.indexOf("ALTER TABLE orders DROP COLUMN IF EXISTS storefront_fee_reserved_cents");
  const authorityDrop = sql.indexOf("DROP TABLE IF EXISTS native_listing_variants, native_listings");
  assert.ok(childDrop >= 0 && orderColumnDrop >= 0 && authorityDrop >= 0);
  assert.ok(childDrop < orderColumnDrop, "child FKs are removed before the parent order columns");
  assert.ok(orderColumnDrop < authorityDrop, "order/store constraints and columns are removed before storefront authority");
});
