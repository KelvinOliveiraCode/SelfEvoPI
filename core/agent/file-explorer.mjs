#!/usr/bin/env node
/**
 * core/agent/file-explorer.mjs — abre o explorador de arquivos do Windows e
 * devolve a pasta/arquivo escolhido pelo usuário.
 *
 * Dois modos:
 *   pickFolder({ title? })            -> Promise<string|null>  (FolderBrowserDialog)
 *   pickFile({ title?, filter? })     -> Promise<string|null>  (OpenFileDialog)
 *
 * Implementação: PowerShell (`System.Windows.Forms`) via `powershell.exe -STA`.
 * Segurança:
 *  - `spawn` com **array de args** (sem shell, sem interpolação em string);
 *  - título/filtro vão por **variáveis de ambiente** (`SELFEOPI_DIALOG_*`), que
 *    o PowerShell lê como texto literal — assim um título começando com "-" não
 *    é interpretado como parâmetro, e nenhum valor vira código;
 *  - timeout (default 120s) mata o processo e devolve `null`-equivalente (erro
 *    tipado `timeout`);
 *  - cancelar (diálogo fechado sem OK) devolve `null`, nunca lança.
 *
 * Erros: `ExplorerError` com `code` ∈ { "no-powershell", "timeout", "failed" }.
 * Nunca imprime/loga segredos (o módulo não manuseia credenciais).
 *
 * Windows nativo, Node ESM puro, só `node:`.
 */

import { spawn } from "node:child_process";

const POWERSHELL = "powershell.exe";
const DEFAULT_TIMEOUT_MS = 120_000;

/* ------------------------------------------------------------------ */
/* Erro tipado                                                         */
/* ------------------------------------------------------------------ */

export class ExplorerError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "ExplorerError";
    this.code = code;
    Object.assign(this, extra);
  }
}

/* ------------------------------------------------------------------ */
/* Scripts PowerShell (sem interpolação: lê $env:SELFEOPI_DIALOG_*)     */
/* ------------------------------------------------------------------ */

const FOLDER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dlg = New-Object System.Windows.Forms.FolderBrowserDialog",
  "if ($env:SELFEOPI_DIALOG_TITLE) { $dlg.Description = $env:SELFEOPI_DIALOG_TITLE }",
  "$res = $dlg.ShowDialog()",
  "if ($res -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.SelectedPath) }",
  "$dlg.Dispose()",
].join("\n");

const FILE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dlg = New-Object System.Windows.Forms.OpenFileDialog",
  "if ($env:SELFEOPI_DIALOG_TITLE) { $dlg.Title = $env:SELFEOPI_DIALOG_TITLE }",
  "if ($env:SELFEOPI_DIALOG_FILTER) { $dlg.Filter = $env:SELFEOPI_DIALOG_FILTER }",
  "$res = $dlg.ShowDialog()",
  "if ($res -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.SelectedPath) }",
  "$dlg.Dispose()",
].join("\n");

/* ------------------------------------------------------------------ */
/* Diálogo genérico                                                    */
/* ------------------------------------------------------------------ */

/**
 * Roda um diálogo do Windows e devolve o caminho escolhido (string) ou `null`
 * quando o usuário cancela. Rejeita com `ExplorerError` em falha/timeout.
 *
 * @param {string} script  corpo PowerShell do diálogo
 * @param {object} [opts]
 * @param {string} [opts.title]      título do diálogo (vai por env)
 * @param {string} [opts.filter]     filtro do OpenFileDialog (vai por env)
 * @param {Function} [opts.spawnImpl]  injetável para teste (default: child_process.spawn)
 * @param {number} [opts.timeoutMs]  teto de espera (default 120s)
 * @returns {Promise<string|null>}
 */
function runDialog(script, { title, filter, spawnImpl, timeoutMs } = {}) {
  const spawnFn = typeof spawnImpl === "function" ? spawnImpl : spawn;
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    // Valores por ambiente: o PowerShell lê como texto, nunca como código/parâmetro.
    const env = { ...process.env };
    if (typeof title === "string" && title !== "") env.SELFEOPI_DIALOG_TITLE = title;
    if (typeof filter === "string" && filter !== "") env.SELFEOPI_DIALOG_FILTER = filter;

    let child;
    try {
      child = spawnFn(POWERSHELL, ["-NoProfile", "-STA", "-Command", script], {
        env,
        windowsHide: true,
      });
    } catch (err) {
      reject(new ExplorerError("no-powershell", `não foi possível iniciar o powershell: ${err?.message ?? err}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* kill best-effort */
      }
      reject(new ExplorerError("timeout", `diálogo excedeu ${ms}ms`));
    }, ms);

    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // ENOENT = powershell.exe ausente; qualquer outro = falha ao iniciar.
      const code = err && err.code === "ENOENT" ? "no-powershell" : "failed";
      const detail = String(err?.message ?? err).split("\n")[0].slice(0, 200);
      reject(new ExplorerError(code, `erro ao iniciar o diálogo: ${detail}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const detail = String(stderr || "").trim().split("\n")[0] || `exit ${code}`;
        reject(new ExplorerError("failed", `diálogo falhou: ${detail.slice(0, 200)}`));
        return;
      }
      const chosen = String(stdout || "").trim();
      resolve(chosen === "" ? null : chosen);
    });
  });
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

/**
 * Abre o seletor de PASTA do Windows.
 *
 * @param {object} [opts]
 * @param {string} [opts.title]       texto descritivo do diálogo
 * @param {Function} [opts.spawnImpl] injetável (teste); default child_process.spawn
 * @param {number} [opts.timeoutMs]   teto de espera (default 120s)
 * @returns {Promise<string|null>} caminho escolhido, ou `null` se cancelar
 */
export async function pickFolder({ title, spawnImpl, timeoutMs } = {}) {
  return runDialog(FOLDER_SCRIPT, { title, spawnImpl, timeoutMs });
}

/**
 * Abre o seletor de ARQUIVO do Windows.
 *
 * @param {object} [opts]
 * @param {string} [opts.title]       título do diálogo
 * @param {string} [opts.filter]      filtro (ex.: "Imagens|*.png;*.jpg")
 * @param {Function} [opts.spawnImpl] injetável (teste); default child_process.spawn
 * @param {number} [opts.timeoutMs]   teto de espera (default 120s)
 * @returns {Promise<string|null>} caminho escolhido, ou `null` se cancelar
 */
export async function pickFile({ title, filter, spawnImpl, timeoutMs } = {}) {
  return runDialog(FILE_SCRIPT, { title, filter, spawnImpl, timeoutMs });
}

export default { pickFolder, pickFile, ExplorerError };