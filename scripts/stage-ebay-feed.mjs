#!/usr/bin/env node
// scripts/stage-ebay-feed.mjs — Stages the eBay feed: downloads and verifies
// the entitled feed file into a manifest (lib/ingest/ebayFeed.js) without
// publishing it. Run with `npm run ebay:feed`.
import { parseArgs } from "node:util";
import { feedReadiness, stageEbayFeed } from "../lib/ingest/ebayFeed.js";

try {
  const { values } = parseArgs({ options: {
    status: { type: "boolean" }, category: { type: "string" },
    marketplace: { type: "string", default: "EBAY_US" },
    scope: { type: "string", default: "ALL_ACTIVE" }, date: { type: "string" },
    output: { type: "string" },
  }});
  if (values.status) {
    const status = feedReadiness();
    console.log(JSON.stringify({ ...status, checks: "local configuration only; entitlement unverified" }, null, 2));
    process.exitCode = status.ready ? 0 : 1;
  } else {
    const result = await stageEbayFeed({ categoryId: values.category, marketplace: values.marketplace,
      feedScope: values.scope, date: values.date, outputDir: values.output });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
