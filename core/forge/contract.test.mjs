import test from "node:test";
import assert from "node:assert/strict";

import {
  ARTIFACT_KINDS,
  createArtifactRequest,
  validateArtifactResult,
  chooseKind,
} from "./contract.mjs";

const BASE = {
  goal: "detectar mudanças de arquivos",
  kind: "cli",
  forbidden: ["acessar rede"],
  tests: [{ name: "smoke", command: "node detector.mjs --check" }],
};

test("ARTIFACT_KINDS vai do mais leve ao mais pesado", () => {
  assert.deepEqual(ARTIFACT_KINDS, ["mcp-config", "skill", "cli", "extension", "mcp-server"]);
});

test("createArtifactRequest normaliza e devolve campos", () => {
  const req = createArtifactRequest({ ...BASE, inputs: { path: "arquivo" }, outputs: { changed: "booleano" } });
  assert.equal(req.goal, BASE.goal);
  assert.equal(req.kind, "cli");
  assert.deepEqual(req.inputs, { path: "arquivo" });
  assert.deepEqual(req.outputs, { changed: "booleano" });
  assert.deepEqual(req.forbidden, ["acessar rede"]);
  assert.equal(req.tests.length, 1);
});

test("rejeita kind inválido", () => {
  assert.throws(
    () => createArtifactRequest({ ...BASE, kind: "plugin" }),
    /forge-contract: "kind" inválido "plugin"/,
  );
});

test("exige forbidden não-vazio", () => {
  assert.throws(
    () => createArtifactRequest({ ...BASE, forbidden: [] }),
    /forge-contract: "forbidden" é obrigatório e não pode ser vazio/,
  );
  assert.throws(
    () => createArtifactRequest({ ...BASE, forbidden: undefined }),
    /forge-contract: "forbidden" é obrigatório e não pode ser vazio/,
  );
});

test("exige goal e ao menos um teste", () => {
  assert.throws(() => createArtifactRequest({ kind: "cli", forbidden: ["x"], tests: BASE.tests }), /goal/);
  assert.throws(() => createArtifactRequest({ ...BASE, tests: [] }), /tests/);
});

test("escolhe o kind mais leve que atende", () => {
  // capacidades de config/mcp → mcp-config (o mais leve)
  const r1 = chooseKind(["config", "mcp"]);
  assert.equal(r1.kind, "mcp-config");
  assert.deepEqual(r1.missing, []);

  // precisa de cli → cli é o mais leve que cobre (skill não cobre "cli")
  const r2 = chooseKind(["cli"]);
  assert.equal(r2.kind, "cli");

  // precisa de server → mcp-server
  const r3 = chooseKind(["server"]);
  assert.equal(r3.kind, "mcp-server");
});

test("chooseKind prefere config/MCP existente antes de criar servidor novo", () => {
  // "mcp" sozinho é atendido por mcp-config (leve) e não por mcp-server (pesado).
  const r = chooseKind(["mcp"]);
  assert.equal(r.kind, "mcp-config", "deve preferir config/MCP existente a criar servidor novo");
  assert.ok(r.ranked.findIndex((x) => x.kind === "mcp-config") === 0);
});

test("chooseKind aceita string única e reporta faltas quando nada cobre tudo", () => {
  const r = chooseKind("ui");
  // nenhum kind cobre "ui" isolada? extension cobre; então extension.
  assert.equal(r.kind, "extension");
  assert.deepEqual(r.missing, []);

  const r2 = chooseKind(["inexistente"]);
  assert.ok(r2.missing.includes("inexistente"));
});

test("validateArtifactResult reprova resultado sem evidência", () => {
  const req = createArtifactRequest(BASE);
  const r = validateArtifactResult({ kind: "cli", tests: [] }, req);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((m) => m.includes("sem evidência")));
});

test("validateArtifactResult reprova teste que não passou", () => {
  const req = createArtifactRequest(BASE);
  const r = validateArtifactResult(
    { kind: "cli", tests: [{ name: "smoke", passed: false }] },
    req,
  );
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((m) => m.includes("não passou")));
});

test("validateArtifactResult reprova proibições infringidas e kind divergente", () => {
  const req = createArtifactRequest(BASE);
  const r = validateArtifactResult(
    {
      kind: "skill",
      tests: [{ name: "smoke", passed: true }],
      violations: ["acessar rede"],
      permissionsUsed: ["acessar rede"],
    },
    req,
  );
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((m) => m.includes("infringidas")));
  assert.ok(r.reasons.some((m) => m.includes("kind divergente")));
});

test("validateArtifactResult aprova quando há evidência e sem violações", () => {
  const req = createArtifactRequest(BASE);
  const r = validateArtifactResult(
    { kind: "cli", tests: [{ name: "smoke", passed: true }], permissionsUsed: [] },
    req,
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.reasons, []);
});