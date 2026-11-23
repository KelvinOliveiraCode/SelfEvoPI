import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readAgentDefs,
  resolveAgent,
  checkPermission,
  parseFrontmatter,
  parseList,
  parseBool,
  parseModel,
  parseRule,
  agentDefDirs,
  AGENT_MODES,
} from "./agent-defs.mjs";

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "sev-agent-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function def(id, fields = {}, path = `src/${id}.md`) {
  return { id, ...fields, path, defined: Object.keys(fields) };
}

const FM = `---
description: rever evidência antes de promover
mode: subagent
model: p1/m1#v1
steps: |
  coletar evidência
  refutar hipótese
hidden: true
permissions: |
  read/*/allow
  write/dist/deny
---

Corpo ignorado.
`;

test("parseFrontmatter: campos simples e listas linha a linha", () => {
  const meta = parseFrontmatter(FM);
  assert.equal(meta.description, "rever evidência antes de promover");
  assert.equal(meta.mode, "subagent");
  assert.equal(meta.model, "p1/m1#v1");
  assert.deepEqual(parseList(meta.steps), ["coletar evidência", "refutar hipótese"]);
  assert.deepEqual(parseList(meta.permissions), ["read/*/allow", "write/dist/deny"]);
  assert.equal(parseBool(meta.hidden), true);
  assert.deepEqual(parseFrontmatter("sem frontmatter"), {});
  assert.deepEqual(parseFrontmatter("---\nsem fecho: x"), {});
});

test("parseBool e parseList: tolerantes e determinísticos", () => {
  assert.equal(parseBool("false"), false);
  assert.equal(parseBool("0"), false);
  assert.equal(parseBool("sim"), true);
  assert.equal(parseBool("talvez", true), true);
  assert.deepEqual(parseList("a, b,\nc"), ["a", "b", "c"]);
  assert.deepEqual(parseList(undefined), []);
});

test("readAgentDefs: diretórios ausentes devolvem lista vazia e nunca lançam", () => {
  const { dir, cleanup } = tmp();
  try {
    assert.deepEqual(readAgentDefs(join(dir, "sem-projeto"), { home: join(dir, "sem-home") }), []);
  } finally {
    cleanup();
  }
});

test("readAgentDefs: lê projeto antes do usuário e ignora extensão estranha", () => {
  const { dir, cleanup } = tmp();
  try {
    const root = join(dir, "root");
    const home = join(dir, "home");
    mkdirSync(join(root, ".pi", "agents"), { recursive: true });
    mkdirSync(join(home, ".pi", "agent", "agents"), { recursive: true });
    writeFileSync(join(root, ".pi", "agents", "reviewer.md"), FM, "utf8");
    writeFileSync(join(root, ".pi", "agents", "ignore.txt"), FM, "utf8");
    writeFileSync(join(home, ".pi", "agent", "agents", "reviewer.md"), "---\nmode: primary\n---\n", "utf8");
    writeFileSync(join(home, ".pi", "agent", "agents", "zebra.md"), "---\ndescription: último\n---\n", "utf8");

    const defs = readAgentDefs(root, { home });
    assert.deepEqual(defs.map((d) => d.id), ["reviewer", "reviewer", "zebra"]);
    assert.deepEqual(defs.map((d) => d.source), ["project", "user", "user"]);
    assert.equal(defs[0].description, "rever evidência antes de promover");
    assert.deepEqual(defs[0].steps, ["coletar evidência", "refutar hipótese"]);
    assert.deepEqual(defs[1].defined, ["mode"]);
    assert.deepEqual(agentDefDirs(root, home).map((x) => x.source), ["project", "user"]);
  } finally {
    cleanup();
  }
});

test("readAgentDefs: arquivo sem frontmatter vira definição vazia, sem erro", () => {
  const { dir, cleanup } = tmp();
  try {
    mkdirSync(join(dir, ".pi", "agents"), { recursive: true });
    writeFileSync(join(dir, ".pi", "agents", "vazio.md"), "só corpo\n", "utf8");
    const [d] = readAgentDefs(dir, { home: join(dir, "nada") });
    assert.equal(d.id, "vazio");
    assert.deepEqual(d.defined, []);
    assert.equal(resolveAgent([d], "vazio").mode, "all");
  } finally {
    cleanup();
  }
});

test("resolveAgent: última declaração vence por campo, arrays substituem e campos ausentes sobrevivem", () => {
  const defs = [
    def("a", {
      description: "primeira",
      mode: "primary",
      model: "p1/m1",
      steps: ["um", "dois"],
      hidden: true,
      permissions: ["read/*/allow", "write/*/deny"],
    }, "a1.md"),
    def("a", { description: "segunda", steps: ["novo"], permissions: ["read/*/deny"] }, "a2.md"),
  ];
  const agent = resolveAgent(defs, "a");
  assert.equal(agent.description, "segunda");
  assert.equal(agent.mode, "primary", "campo não declarado na última def deve sobreviver");
  assert.equal(agent.model, "p1/m1", "campo não declarado na última def deve sobreviver");
  assert.equal(agent.hidden, true, "campo não declarado na última def deve sobreviver");
  assert.deepEqual(agent.steps, ["novo"], "arrays não concatenam");
  assert.deepEqual(agent.permissions, ["read/*/deny"], "arrays não concatenam");
  assert.deepEqual(agent.sources, ["a1.md", "a2.md"]);
  assert.deepEqual(agent.warnings, []);
});

test("resolveAgent: aceita os três modos; modo inválido cai para all com aviso", () => {
  for (const mode of AGENT_MODES) {
    assert.equal(resolveAgent([def("a", { mode })], "a").mode, mode);
  }
  const agent = resolveAgent([def("a", { mode: "desconhecido" })], "a");
  assert.equal(agent.mode, "all");
  assert.match(agent.warnings[0], /modo/);
});

test("resolveAgent: modelo com variante é decomposto; modelo inválido vira null com aviso", () => {
  const ok = resolveAgent([def("a", { model: "p1/m1#v1" })], "a");
  assert.deepEqual(ok.modelRef, { provider: "p1", name: "m1", variant: "v1", raw: "p1/m1#v1" });
  assert.deepEqual(ok.warnings, []);

  const semVariante = resolveAgent([def("a", { model: "p2/m2" })], "a");
  assert.equal(semVariante.modelRef.variant, null);
  assert.equal(semVariante.modelRef.provider, "p2");

  for (const ruim of ["sem-barra", "p1/m1#", "/m1", "p1/"]) {
    const r = resolveAgent([def("a", { model: ruim })], "a");
    assert.equal(r.modelRef, null, `modelo ${ruim} deveria ser rejeitado`);
    assert.match(r.warnings.join(" "), /modelo inválido/);
  }
});

test("resolveAgent: id inexistente devolve null", () => {
  assert.equal(resolveAgent([def("a", {})], "b"), null);
  assert.equal(resolveAgent(null, "b"), null);
});

test("checkPermission: sem regra correspondente devolve ask", () => {
  assert.equal(checkPermission(def("a", {}), "read", "src/x.mjs"), "ask");
  assert.equal(checkPermission(null, "read", "x"), "ask");
});

test("checkPermission: allow e deny; última regra que casa vence", () => {
  const agente = def("a", { permissions: ["read/*/allow", "read/src/secret/deny"] });
  assert.equal(checkPermission(agente, "read", "src/publico"), "allow");
  assert.equal(checkPermission(agente, "read", "src/secret"), "deny");
  const invertido = def("a", { permissions: ["read/*/deny", "read/src/liberal/allow"] });
  assert.equal(checkPermission(invertido, "read", "src/liberal"), "allow", "última regra vence também no sentido inverso");
  assert.equal(checkPermission(invertido, "read", "src/outro"), "deny");
});

test("checkPermission: curinga simples em ação, recurso e ambos", () => {
  const agente = def("a", { permissions: ["*/*/ask", "read/*/allow", "*/dist/deny"] });
  assert.equal(checkPermission(agente, "write", "src/x"), "ask");
  assert.equal(checkPermission(agente, "read", "src/x"), "allow");
  assert.equal(checkPermission(agente, "write", "dist"), "deny");
  const tudo = def("a", { permissions: ["*/*/allow"] });
  assert.equal(checkPermission(tudo, "qualquer", "recurso/com/barra"), "allow");
});

test("checkPermission: regras inválidas são ignoradas, não derrubam", () => {
  const agente = def("a", { permissions: ["lixo", "read/x/maybe", "", parseRule({ action: "write", resource: "dist", effect: "deny" })] });
  assert.equal(checkPermission(agente, "write", "dist"), "deny");
  assert.equal(checkPermission(agente, "read", "x"), "ask");
});

test("parseRule: recurso com barra e efeitos aceitos", () => {
  assert.deepEqual(parseRule("read/pasta/arquivo/allow"), {
    action: "read", resource: "pasta/arquivo", effect: "allow", raw: "read/pasta/arquivo/allow",
  });
  assert.equal(parseRule("read/x/ALLOW").effect, "allow");
  assert.equal(parseRule("read/x/deny").effect, "deny");
  assert.equal(parseRule("read/x/ask").effect, "ask");
  assert.equal(parseRule("read/x/nope"), null);
  assert.equal(parseRule("read"), null);
});
