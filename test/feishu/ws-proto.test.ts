import assert from "node:assert/strict";
import test from "node:test";
import { decodeFrame, encodeFrame } from "../../src/feishu/ws-proto.js";

test("ws proto encode/decode roundtrip", () => {
  const payload = new TextEncoder().encode(JSON.stringify({ hello: "world" }));
  const frame = {
    SeqID: 123n,
    LogID: 456n,
    service: 7,
    method: 1,
    headers: [
      { key: "type", value: "event" },
      { key: "message_id", value: "mid" },
    ],
    payload,
  };
  const encoded = encodeFrame(frame);
  const decoded = decodeFrame(encoded);
  assert.equal(decoded.SeqID, frame.SeqID);
  assert.equal(decoded.LogID, frame.LogID);
  assert.equal(decoded.service, frame.service);
  assert.equal(decoded.method, frame.method);
  assert.deepEqual(decoded.headers, frame.headers);
  assert.deepEqual(decoded.payload, frame.payload);
});
