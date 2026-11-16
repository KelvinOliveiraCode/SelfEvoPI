import test from "node:test";
import assert from "node:assert/strict";

import { reviewApproval, TRIGGERS } from "./approval.mjs";
import { evaluate } from "../sandbox/static-gate.mjs";

/** Scan de código limpo — nenhum gatilho. */
const scanLimpo = () => evaluate('const total = 1 + 1;\nexport default total;\n', { file: "limpo.mjs" });

/** Scan de código que pede rede. */
const scanRede = () =>
  evaluate('const r = await fetch("https://api.example.com/v1");\nexport default r;\n', { file: "rede.mjs" });

/** Scan de código que lê chave SSH. */
const scanSsh = () =>
  evaluate('import fs from "node:fs";\nexport const k = fs.readFileSync(process.env.HOME + "/.ssh/id_rsa", "utf8");\n', {
    file: "ssh.mjs",
  });

/** Scan de código que mexe no registro. */
const scanReg = () =>
  evaluate('import { execFileSync } from "node:child_process";\nexecFileSync("reg.exe", ["add", "HKCU\\\\x"]);\n', {
    file: "reg.mjs",
  });

/** Scan de código que apaga uma árvore fora do workspace. */
const scanDelete = () =>
  evaluate('Remove-Item -Recurse -Force C:\\\\Users\\\\Alguem\\\\Documentos;\n', { file: "limpeza.ps1" });

/* ------------------------------------------------------------------ */
/* Caso seguro                                                         */
/* ------------------------------------------------------------------ */

test("pedido seguro e scan limpo não precisa de humano", () => {
  const r = reviewApproval({ request: { mode: "cli", network: false }, scan: scanLimpo() });

  assert.equal(r.needsHuman, false);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.questions, []);
  assert.deepEqual(r.triggers, []);
});

test("sem request e sem scan não inventa pausa", () => {
  const r = reviewApproval({});
  assert.equal(r.needsHuman, false);
  assert.deepEqual(r.questions, []);
});

test("scan ausente não bloqueia um pedido seguro", () => {
  const r = reviewApproval({ request: { mode: "cli" } });
  assert.equal(r.needsHuman, false);
});

/* ------------------------------------------------------------------ */
/* Gatilhos declarados no pedido                                       */
/* ------------------------------------------------------------------ */

test("pedido que declara rede pausa com pergunta objetiva", () => {
  const r = reviewApproval({ request: { mode: "cli", network: true }, scan: scanLimpo() });

  assert.equal(r.needsHuman, true);
  assert.deepEqual(r.triggers, [TRIGGERS.NETWORK]);
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0], /^network: /);
  assert.ok(r.questions.some((q) => /domínio/.test(q)), `perguntas=${r.questions}`);
  assert.ok(!r.questions.some((q) => /certeza/i.test(q)), "nada de 'você tem certeza?'");
});

test("pedido que declara credenciais pausa", () => {
  const r = reviewApproval({ request: { mode: "cli", credentials: ["GITHUB_TOKEN"] }, scan: scanLimpo() });
  assert.equal(r.needsHuman, true);
  assert.ok(r.triggers.includes(TRIGGERS.CREDENTIALS));
  assert.ok(r.questions.some((q) => /credenciais/.test(q)));
});

test("permissions do contrato disparam rede", () => {
  // `permissions` e o campo proprio do contrato (createArtifactRequest). Se o
  // artefato declara que pode acessar rede, e pedido explicito.
  const r = reviewApproval({ request: { mode: "cli", permissions: ["acessar rede"] }, scan: scanLimpo() });
  assert.equal(r.needsHuman, true, "permissao de rede tem que pausar");
  assert.deepEqual(r.triggers, [TRIGGERS.NETWORK]);
});

test("permissions do contrato disparam credenciais e escrita externa", () => {
  const cred = reviewApproval({
    request: { mode: "cli", permissions: ["ler GITHUB_TOKEN"] },
    scan: scanLimpo(),
  });
  assert.ok(cred.triggers.includes(TRIGGERS.CREDENTIALS), JSON.stringify(cred));

  const fora = reviewApproval({
    request: { mode: "cli", permissions: ["escrever fora do workspace"] },
    scan: scanLimpo(),
  });
  assert.ok(fora.triggers.includes(TRIGGERS.WRITE_OUTSIDE), JSON.stringify(fora));
});

test("permissions seguras nao pausam", () => {
  const r = reviewApproval({
    request: { mode: "cli", permissions: ["ler arquivo local", "escrever no workspace"] },
    scan: scanLimpo(),
  });
  assert.equal(r.needsHuman, false, JSON.stringify(r));
});

test("pedido que declara escrita fora do workspace pausa", () => {
  const r = reviewApproval({ request: { mode: "cli", writesOutside: true }, scan: scanLimpo() });
  assert.equal(r.needsHuman, true);
  assert.ok(r.triggers.includes(TRIGGERS.WRITE_OUTSIDE));
  assert.ok(r.questions.some((q) => /fora do workspace/.test(q)));
});

test("declaração por access.write = 'outside' também pausa", () => {
  const r = reviewApproval({ request: { access: { write: "outside" } }, scan: scanLimpo() });
  assert.equal(r.needsHuman, true);
  assert.ok(r.triggers.includes(TRIGGERS.WRITE_OUTSIDE));
});

/* ------------------------------------------------------------------ */
/* Gatilhos revelados pelo scan                                        */
/* ------------------------------------------------------------------ */

test("scan com fetch pausa mesmo sem o pedido declarar rede", () => {
  const r = reviewApproval({ request: { mode: "cli" }, scan: scanRede() });

  assert.equal(r.needsHuman, true);
  assert.ok(r.triggers.includes(TRIGGERS.NETWORK));
  assert.match(r.reasons[0], /^network: o scan aponta/);
  assert.match(r.reasons[0], /network-access@1/, `reason=${r.reasons[0]}`);
});

test("scan com leitura de .ssh pausa por credenciais", () => {
  const r = reviewApproval({ request: { mode: "cli" }, scan: scanSsh() });

  assert.equal(r.needsHuman, true);
  assert.ok(r.triggers.includes(TRIGGERS.CREDENTIALS), `triggers=${r.triggers}`);
});

test("scan com reg.exe pausa por bloqueio do gate", () => {
  const r = reviewApproval({ request: { mode: "cli" }, scan: scanReg() });

  assert.equal(r.needsHuman, true);
  assert.ok(r.triggers.includes(TRIGGERS.GATE_BLOCK), `triggers=${r.triggers}`);
  assert.ok(r.reasons.some((x) => /registro|registry-exe|child-process/.test(x)), `reasons=${r.reasons}`);
});

test("scan com deleção de árvore fora do workspace pausa", () => {
  const r = reviewApproval({ request: { mode: "cli" }, scan: scanDelete() });

  assert.equal(r.needsHuman, true);
  assert.ok(r.triggers.includes(TRIGGERS.WRITE_OUTSIDE), `triggers=${r.triggers}`);
});

test("pedido e scan apontam o mesmo gatilho sem duplicar pergunta", () => {
  const r = reviewApproval({ request: { mode: "cli", network: true }, scan: scanRede() });

  assert.equal(r.needsHuman, true);
  assert.deepEqual(r.triggers, [TRIGGERS.NETWORK]);
  assert.equal(new Set(r.questions).size, r.questions.length, "perguntas não repetidas");
  assert.equal(r.reasons.length, 1, "uma linha de motivo por gatilho");
});

/* ------------------------------------------------------------------ */
/* Formato                                                             */
/* ------------------------------------------------------------------ */

test("a resposta tem exatamente o contrato pedido", () => {
  const r = reviewApproval({ request: { network: true }, scan: scanLimpo() });
  assert.deepEqual(Object.keys(r).sort(), ["needsHuman", "questions", "reasons", "triggers"]);
  assert.equal(typeof r.needsHuman, "boolean");
  assert.ok(Array.isArray(r.reasons));
  assert.ok(Array.isArray(r.questions));
  assert.ok(r.questions.every((q) => q.length > 10 && q.endsWith("?")), "pergunta objetiva e curta");
});

test("perguntas não são genéricas", () => {
  const r = reviewApproval({ request: { network: true, credentials: true, writesOutside: true }, scan: scanLimpo() });
  const juntas = r.questions.join(" ").toLowerCase();
  assert.ok(!/você tem certeza|tem certeza que|confirmar\?/.test(juntas));
  assert.ok(/domínio/.test(juntas) && /credenciais/.test(juntas) && /workspace/.test(juntas));
});