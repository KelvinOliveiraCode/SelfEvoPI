/** provider-discovery.test.mjs — descoberta genérica sem rede. */

import test from "node:test";
import assert from "node:assert/strict";
import {
  EFFORT_LEVELS, normalizeModelsResponse, detectVariants, inferEfforts,
  inferImage, inferCapabilities, modelEndpoints, discoverModels,
} from "./provider-discovery.mjs";

const ENTRY = {
  id: "baidu/ernie-5.5-flash-preview:free",
  name: "ERNIE Free",
  reasoning: { mandatory: true, supported_efforts: ["high"] },
  architecture: { input_modalities: ["text"] },
  context_length: 1024000,
  top_provider: { max_completion_tokens: 32768 },
};

test("normaliza os três formatos de catálogo", () => {
  assert.equal(normalizeModelsResponse([ENTRY]).length, 1);
  assert.equal(normalizeModelsResponse({ data: [ENTRY] }).length, 1);
  assert.equal(normalizeModelsResponse({ models: [ENTRY] }).length, 1);
  assert.deepEqual(normalizeModelsResponse({ outro: 1 }), []);
});

test("detecta variantes free/fast e imagem", () => {
  assert.ok(detectVariants(ENTRY).includes("free"));
  assert.ok(detectVariants({ id: "x/y:fast", name: "Rápido" }).includes("fast"));
  assert.equal(inferImage(ENTRY), false);
  assert.equal(inferImage({ id: "v", architecture: { input_modalities: ["text", "image"] } }), true);
});

test("infere efforts e thinkingLevelMap de raciocínio obrigatório", () => {
  assert.deepEqual(inferEfforts(ENTRY), ["high"]);
  const cap = inferCapabilities(ENTRY);
  assert.equal(cap.reasoning, true);
  assert.deepEqual(cap.efforts, ["high"]);
  assert.equal(cap.thinkingLevelMap.high, "high");
  assert.equal(cap.thinkingLevelMap.off, null);
  assert.equal(cap.compat.supportsReasoningEffort, true);
  assert.equal(cap.contextWindow, 1024000);
  assert.equal(cap.maxTokens, 32768);
  assert.ok(EFFORT_LEVELS.includes("xhigh"));
});

test("modelo de visão sem raciocínio", () => {
  const cap = inferCapabilities({ id: "vision/a", name: "Visão", input_modalities: ["text", "image"] });
  assert.equal(cap.image, true);
  assert.equal(cap.reasoning, false);
  assert.deepEqual(cap.efforts, []);
});

test("candidatos de endpoint cobrem base, /v1 e /api/v1", () => {
  assert.deepEqual(modelEndpoints("https://api.x/v1"), ["https://api.x/v1/models"]);
  assert.deepEqual(modelEndpoints("https://api.x"), [
    "https://api.x/models", "https://api.x/v1/models", "https://api.x/api/v1/models",
  ]);
});

test("discoverModels tenta Bearer e depois X-API-Key, sem vazar a chave", async () => {
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url, headers: init.headers });
    if (init.headers["X-API-Key"]) return { ok: true, json: async () => ({ data: [ENTRY] }) };
    return { ok: false, status: 401 };
  };
  const res = await discoverModels({ baseUrl: "https://gateway.local/v1", apiKey: "CHAVE_SECRETA_XYZ", fetchImpl: stub });
  assert.equal(res.headerMode, "x-api-key");
  assert.equal(res.models.length, 1);
  assert.equal(res.models[0].id, ENTRY.id);
  const dump = JSON.stringify(res);
  assert.equal(dump.includes("CHAVE_SECRETA_XYZ"), false, "a chave não pode aparecer no resultado");
  assert.equal(calls[0].url, "https://gateway.local/v1/models");
});
