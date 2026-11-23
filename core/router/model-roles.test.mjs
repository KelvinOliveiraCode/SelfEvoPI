import test from "node:test";
import assert from "node:assert/strict";
import {
  ROLES, normalizeRole, rolePolicy, roleChain,
  resolveRole, pathScopedRoles, Cooldown,
} from "./model-roles.mjs";

const modelos = [
  { provider: "kilo1", id: "modelo-grande:free", family: "kilo", contextWindow: 1_000_000, input: ["text", "image"], variants: ["low", "high"], reasoning: true, cost: [{ input: 2, output: 8 }] },
  { provider: "kilo2", id: "modelo-barato:free", family: "kilo", contextWindow: 16_000, input: ["text"], variants: ["low"], reasoning: false, cost: [{ input: 0, output: 0 }] },
  { provider: "or1", id: "modelo-meio:free", family: "or", contextWindow: 64_000, input: ["text"], variants: ["medium"], reasoning: true, cost: [{ input: 0.5, output: 1 }] },
];

test("ROLES cobre os papéis essenciais e normalize cai em default", () => {
  assert.ok(ROLES.includes("default") && ROLES.includes("smol") && ROLES.includes("plan"));
  assert.equal(normalizeRole("  SLOW "), "slow");
  assert.equal(normalizeRole("inexistente"), "default");
});

test("rolePolicy cópia não altera a tabela original", () => {
  const p = rolePolicy("smol");
  p.effort = "mudado";
  assert.equal(rolePolicy("smol").effort, "low");
});

test("roleChain termina sempre em default e deduplica", () => {
  assert.deepEqual(roleChain("plan", { plan: ["slow", "plan"] }), ["plan", "slow", "default"]);
});

test("slow prefere contexto grande; smol prefere barato", () => {
  const slow = resolveRole("slow", { models: modelos });
  const smol = resolveRole("smol", { models: modelos });
  assert.equal(slow.ref, "kilo1/modelo-grande:free");
  assert.equal(slow.effort, "high");
  assert.equal(smol.ref, "kilo2/modelo-barato:free");
  assert.equal(smol.effort, "low");
});

test("vision exige imagem e plan prefere raciocínio", () => {
  assert.equal(resolveRole("vision", { models: modelos }).ref, "kilo1/modelo-grande:free");
  assert.equal(resolveRole("plan", { models: modelos }).ref, "kilo1/modelo-grande:free");
});

test("avoidRef e avoidFamily removem candidatos", () => {
  assert.notEqual(resolveRole("slow", { models: modelos, avoidRef: "kilo1/modelo-grande:free" }).ref, "kilo1/modelo-grande:free");
  assert.equal(resolveRole("slow", { models: modelos, avoidFamily: "kilo" }).ref, "or1/modelo-meio:free");
});

test("sem candidato devolve null em vez de inventar modelo", () => {
  assert.equal(resolveRole("vision", { models: [], cooldown: null }), null);
});

test("pathScopedRoles aplica apenas prefixos correspondentes", () => {
  const regras = [
    { path: "apps/", roles: { default: "smol" } },
    { path: "core/router/", roles: { plan: "slow" } },
  ];
  assert.equal(pathScopedRoles(regras, "apps/cli.mjs").default, "smol");
  assert.equal(pathScopedRoles(regras, "core/router/router.mjs").plan, "slow");
  assert.deepEqual(pathScopedRoles(regras, "docs/estado.md"), {});
});

test("Cooldown bloqueia, expira e restaura", () => {
  let agora = 1000;
  const cd = new Cooldown({ durationMs: 500, now: () => agora });
  cd.failure("kilo1/x");
  assert.equal(cd.allow("kilo1/x"), false);
  agora = 1400;
  assert.equal(cd.allow("kilo1/x"), false);
  agora = 1501;
  assert.equal(cd.allow("kilo1/x"), true);
  cd.failure("kilo1/y");
  assert.equal(cd.allow("kilo1/y"), false);
  cd.restore("kilo1/y");
  assert.equal(cd.allow("kilo1/y"), true);
  assert.equal(cd.size, 1); // só o registro expirado de x permanece
  cd.clear();
  assert.equal(cd.size, 0);
});
