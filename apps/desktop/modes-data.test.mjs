import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * modes-data.js e uma copia congelada de core/governance/modes.mjs, porque o
 * modulo do browser nao pode importar o core (que carrega uma arvore de
 * imports do lado do Node). Copia sem guarda vira mentira com o tempo — este
 * teste e a guarda: se o core mudar e ninguem regenerar, fica vermelho aqui.
 */
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ARQUIVO = path.join(ROOT, "apps", "desktop", "modes-data.js");

test("modes-data.js nao diverge de core/governance/modes.mjs", async () => {
  const core = await import(pathToFileURL(path.join(ROOT, "core", "governance", "modes.mjs")).href);
  const browser = await import(pathToFileURL(ARQUIVO).href);

  assert.deepEqual(
    [...browser.MODE_NAMES],
    [...core.MODE_NAMES],
    "MODE_NAMES difere do core — regenere com o script gerador",
  );

  // O arquivo congela MODES como JSON: o que importa e o conteudo, nao a ordem.
  assert.deepEqual(
    Object.keys(browser.MODES).sort(),
    Object.keys(core.MODES).sort(),
    "MODES difere do core",
  );

  for (const modo of core.MODE_NAMES) {
    assert.equal(
      browser.MODES[modo]?.nota,
      core.MODES[modo]?.nota,
      `nota de "${modo}" difere do core`,
    );
  }
});

test("describePermissions do browser responde pelos 5 modos", async () => {
  const browser = await import(pathToFileURL(ARQUIVO).href);
  const core = await import(pathToFileURL(path.join(ROOT, "core", "governance", "modes.mjs")).href);

  for (const modo of core.MODE_NAMES) {
    const esperado = core.describePermissions({ mode: modo });
    const obtido = browser.describePermissions({ mode: modo });
    assert.equal(obtido.label, esperado.label, `label de "${modo}"`);
    assert.equal(obtido.canRead, esperado.canRead, `canRead de "${modo}"`);
    assert.equal(obtido.canWrite, esperado.canWrite, `canWrite de "${modo}"`);
    assert.equal(obtido.canExec, esperado.canExec, `canExec de "${modo}"`);
  }
});

test("describePermissions cai no build quando o modo e desconhecido", async () => {
  const browser = await import(pathToFileURL(ARQUIVO).href);
  assert.equal(browser.describePermissions({ mode: "nao-existe" }).label, browser.PERMS.build.label);
  assert.equal(browser.describePermissions(null).label, browser.PERMS.build.label);
});