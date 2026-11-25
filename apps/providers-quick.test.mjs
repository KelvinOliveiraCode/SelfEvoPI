#!/usr/bin/env node
/**
 * providers-quick.test.mjs - configuração de provider em uma entrada só.
 *
 * Sobe um gateway OpenAI-compatible local, roda o caminho rápido do script e
 * o comando /providers quick da CLI, e confere que todos os modelos foram
 * gravados sem imprimir a chave. Nenhuma rede externa, nenhuma chave real.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import { runSlash } from "./cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "chave-de-teste-local";

const MODELOS = [
  { id: "mock/alfa", name: "Alfa", reasoning: { supported_efforts: ["low", "high"] } },
  { id: "mock/beta", name: "Beta" },
  { id: "mock/gama", name: "Gama", architecture: { input_modalities: ["text", "image"] } },
];

async function comGateway(fn) {
  const server = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: MODELOS }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try { return await fn(`http://127.0.0.1:${port}/v1`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("providers-setup --quick puxa todos os modelos e grava a chave sem imprimir", async () => {
  await comGateway(async (baseUrl) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "selfevopi-quick-"));
    const arquivo = path.join(dir, "models.json");
    try {
      const { stdout: saida } = await execFileAsync(process.execPath, [
        path.join(root, "scripts", "providers-setup.mjs"),
        "--quick", "--base-url", baseUrl, "--api-key", KEY, "--file", arquivo,
      ], { encoding: "utf8", env: { ...process.env, PI_MODELS_FILE: arquivo } });
      assert.ok(!saida.includes(KEY), "a chave não pode aparecer na saída");
      const doc = JSON.parse(await readFile(arquivo, "utf8"));
      const providers = Object.values(doc.providers);
      assert.equal(providers.length, 1);
      assert.equal(providers[0].baseUrl, baseUrl);
      assert.equal(providers[0].models.length, MODELOS.length);
      assert.deepEqual(providers[0].models.map((m) => m.id).sort(), MODELOS.map((m) => m.id).sort());
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

test("/providers quick grava todos os modelos pela CLI", async () => {
  await comGateway(async (baseUrl) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "selfevopi-cli-quick-"));
    const arquivo = path.join(dir, "models.json");
    const anterior = process.env.PI_MODELS_FILE;
    process.env.PI_MODELS_FILE = arquivo;
    try {
      let out = "";
      const code = await runSlash("/providers", `quick ${baseUrl}`, (s) => { out += s + "\n"; }, { pi: null });
      assert.equal(code, 0, out);
      const doc = JSON.parse(await readFile(arquivo, "utf8"));
      const providers = Object.values(doc.providers);
      assert.equal(providers.length, 1);
      assert.equal(providers[0].models.length, MODELOS.length);
    } finally {
      if (anterior === undefined) delete process.env.PI_MODELS_FILE;
      else process.env.PI_MODELS_FILE = anterior;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
