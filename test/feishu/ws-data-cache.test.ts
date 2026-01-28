import assert from "node:assert/strict";
import test from "node:test";
import { WsDataCache } from "../../src/feishu/ws-data-cache.js";

test("ws data cache merges chunks", () => {
  const cache = new WsDataCache({ logger: {} });
  const full = new TextEncoder().encode(JSON.stringify({ ok: true }));
  const partA = full.slice(0, 4);
  const partB = full.slice(4);

  const first = cache.mergeData({
    messageId: "m1",
    sum: 2,
    seq: 0,
    traceId: "t1",
    data: partA,
  });
  assert.equal(first, null);

  const second = cache.mergeData({
    messageId: "m1",
    sum: 2,
    seq: 1,
    traceId: "t1",
    data: partB,
  });
  assert.deepEqual(second, { ok: true });
});
