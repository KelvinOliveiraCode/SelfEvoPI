#!/usr/bin/env node
/** Wrapper de steer, followUp e clearQueue sobre o RpcClient do motor. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPiClient } from "./pi-rpc.mjs";

function fakeRpc() {
  const calls = [];
  return {
    calls,
    onEvent: () => () => {},
    steer: async (m) => (calls.push(["steer", m]), "queued"),
    followUp: async (m) => (calls.push(["followUp", m]), "queued"),
    clearQueue: async () => (calls.push(["clearQueue"]), { steering: ["a"], followUp: [] }),
  };
}

test("PiClient.steer encaminha texto para o motor", async () => {
  const rpc = fakeRpc();
  const pi = await createPiClient({ client: rpc });
  assert.equal(await pi.steer("mude para azul"), "queued");
  assert.deepEqual(rpc.calls, [["steer", "mude para azul"]]);
});

test("PiClient.followUp encaminha texto para o motor", async () => {
  const rpc = fakeRpc();
  const pi = await createPiClient({ client: rpc });
  assert.equal(await pi.followUp("depois disso"), "queued");
  assert.deepEqual(rpc.calls, [["followUp", "depois disso"]]);
});

test("PiClient.clearQueue devolve as filas do motor", async () => {
  const rpc = fakeRpc();
  const pi = await createPiClient({ client: rpc });
  assert.deepEqual(await pi.clearQueue(), { steering: ["a"], followUp: [] });
  assert.deepEqual(rpc.calls, [["clearQueue"]]);
});
