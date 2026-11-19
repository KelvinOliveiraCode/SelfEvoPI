#!/usr/bin/env node
// Bake-off estático de pacotes npm — mede o tarball sem instalar nada.
//
// Uso:
//   node scripts/bakeoff.mjs pkg1 pkg2 pkg3
//   node scripts/bakeoff.mjs --timeout=60000 pkg1 pkg2
//   node scripts/bakeoff.mjs --json pkg1 pkg2      (mesma saída, default)
//
// Para cada pacote: `npm view` (metadados) + `npm pack` (tarball) + extração
// real com tar (contagem de arquivos e bytes descomprimidos medidos, não
// estimados). O diretório temporário é removido ao final, sempre.
// Falha em um pacote não derruba os outros: o resultado carrega `error`.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileP = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;
const IS_WIN = process.platform === "win32";

// No Windows o `npm` é `npm.cmd`. O Node 24 se recusa a fazer spawn de .cmd
// (EINVAL, correção do CVE-2024-27980) a menos que `shell: true` seja usado —
// e `shell: true` com argumentos é justamente o vetor que a correção fechou.
//
// A saída é a mesma que docs/fase0/evals.md já usa para o `pi`: descobrir o
// `npm-cli.js` e rodá-lo com o próprio Node. Sem shell, sem aviso, argumentos
// passam como array e não como linha de comando.
const PKG_NAME_RE = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function assertPackageName(name) {
  if (typeof name !== "string" || !PKG_NAME_RE.test(name) || name.length > 214) {
    throw new Error(`nome de pacote inválido: ${JSON.stringify(name)}`);
  }
  return name;
}

/** Procura o npm-cli.js a partir de um executável npm (npm.cmd, npm, …). */
function cliFromNpmBin(binPath) {
  const dir = path.dirname(binPath);
  const candidates = [
    path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates;
}

/**
 * Resolve como chamar o npm sem passar por shell. Devolve
 * { cmd, prefixArgs } — prefixo vazio quando `npm` já é executável direto.
 */
async function resolveNpm() {
  if (process.env.npm_execpath) {
    return { cmd: process.execPath, prefixArgs: [process.env.npm_execpath] };
  }

  const locator = IS_WIN ? "where" : "which";
  const found = await run(locator, ["npm"], { timeout: 15_000 });
  const bins = (found.stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const bin of bins) {
    for (const candidate of cliFromNpmBin(bin)) {
      try {
        await fs.access(candidate, fs.constants.R_OK);
        return { cmd: process.execPath, prefixArgs: [candidate] };
      } catch {
        // próximo candidato
      }
    }
  }

  // Último recurso: o executável que o `where`/`which` achou.
  if (bins.length > 0) return { cmd: bins[0], prefixArgs: [] };
  return { cmd: IS_WIN ? "npm.cmd" : "npm", prefixArgs: [] };
}

function parseArgs(argv) {
  const opts = { timeout: DEFAULT_TIMEOUT_MS, packages: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--timeout=")) {
      const n = Number(arg.slice("--timeout=".length));
      if (Number.isFinite(n) && n > 0) opts.timeout = n;
    } else if (arg === "--timeout") {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) opts.timeout = n;
      i += 1;
    } else if (arg.startsWith("-")) {
      // flags desconhecidas são ignoradas (não travam)
    } else {
      opts.packages.push(arg);
    }
  }
  return opts;
}

// ---------------------------------------------------------------- execução

/**
 * Roda um comando com timeout real. Nunca rejeita por timeout de forma
 * ambígua: devolve { ok, stdout, stderr, timedOut }.
 */
async function run(cmd, args, { timeout = DEFAULT_TIMEOUT_MS, cwd, env } = {}) {
  try {
    const { stdout } = await execFileP(cmd, args, {
      timeout,
      maxBuffer: 32 * 1024 * 1024,
      cwd,
      windowsHide: true,
      env: { ...process.env, npm_config_yes: "true", npm_config_progress: "false", ...env },
    });
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    const code = typeof err?.code === "number" ? err.code : null;
    const killed = err?.killed === true || err?.signal != null;
    const stdout = typeof err?.stdout === "string" ? err.stdout : "";
    const stderr = typeof err?.stderr === "string" ? err.stderr : "";
    return { ok: false, code, stdout, stderr, timedOut: killed || err?.code === "ETIMEDOUT" };
  }
}

// Preenchido por resolveNpm() no main: { cmd, prefixArgs }.
let npmCli = null;

/** npm(args) — executa o npm resolvido, com timeout. */
async function npm(args, opts) {
  if (!npmCli) throw new Error("npm não resolvido: chame resolveNpm() antes");
  return run(npmCli.cmd, [...npmCli.prefixArgs, ...args], opts);
}

/** A linha de erro mais útil de uma falha do npm (stderr antes de stdout). */
function errorLine(result) {
  for (const block of [result.stderr, result.stdout]) {
    if (!block) continue;
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const hit = lines.reverse().find((l) => /^(npm ERR!|npm error)/i.test(l));
    if (hit) return hit.replace(/^npm (ERR!|error)\s*/i, "").trim();
    const plain = lines.filter((l) => !/^npm (warn|notice)/i.test(l));
    if (plain.length > 0) return plain[plain.length - 1];
  }
  return "";
}

// ------------------------------------------------------------- medições

/** Conta arquivos e soma bytes de um diretório, recursivamente. */
async function measureDir(dir) {
  let files = 0;
  let bytes = 0;

  async function walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files += 1;
        try {
          const st = await fs.stat(full);
          bytes += st.size;
        } catch {
          // arquivo sumido/ilegível: conta o arquivo, não os bytes
        }
      }
    }
  }

  await walk(dir);
  return { files, bytes };
}

/** Remove o diretório temporário sem estourar erro. */
async function rmrf(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* melhor esforço */
  }
}

// ------------------------------------------------------------- por pacote

async function bakeoff(name, { timeout, tmpRoot }) {
  const result = {
    name,
    ok: false,
    version: null,
    license: null,
    unpackedBytes: null,
    tarballBytes: null,
    files: null,
    deps: {},
    engines: {},
    peerDependencies: {},
    tarball: null,
  };

  // validar antes de qualquer interpolação em shell
  try {
    assertPackageName(name);
  } catch (err) {
    result.error = err.message;
    return result;
  }

  // 1) metadados — `npm view` é autoritativo para existência e versão
  const view = await npm(["view", name, "--json"], { timeout });
  if (!view.ok) {
    const detail = errorLine(view);
    if (view.timedOut) {
      result.error = `timeout após ${timeout}ms`;
    } else if (/E404|404 Not Found|is not in this registry|No match found/i.test(
        `${view.stderr}\n${view.stdout}`,
      )) {
      result.error = "pacote inexistente no npm (404)";
    } else {
      result.error = detail || "npm view falhou";
    }
    return result;
  }

  let meta;
  try {
    meta = JSON.parse(view.stdout);
  } catch {
    result.error = "npm view não devolveu JSON válido";
    return result;
  }
  if (Array.isArray(meta)) meta = meta[0];
  if (!meta || typeof meta !== "object") {
    result.error = "npm view devolveu metadados vazios";
    return result;
  }

  result.version = meta.version ?? null;
  result.license = meta.license ?? null;
  result.deps = meta.dependencies ?? {};
  result.engines = meta.engines ?? {};
  result.peerDependencies = meta.peerDependencies ?? {};
  result.tarball = meta.dist?.tarball ?? null;
  if (typeof meta.dist?.unpackedSize === "number") {
    result.unpackedBytes = meta.dist.unpackedSize;
  }

  // 2) tarball — `npm pack` baixa sem instalar nada no sistema
  const packDir = path.join(tmpRoot, `pack-${result.name.replace(/[^a-z0-9._-]/gi, "_")}`);
  await fs.mkdir(packDir, { recursive: true });

  const pack = await npm(
    ["pack", name, "--pack-destination", packDir, "--json", "--silent"],
    { timeout },
  );
  if (!pack.ok) {
    result.error = pack.timedOut
      ? `timeout após ${timeout}ms`
      : errorLine(pack) || "npm pack falhou";
    await rmrf(packDir);
    return result;
  }

  let packInfo = null;
  try {
    const parsed = JSON.parse(pack.stdout);
    packInfo = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    packInfo = null;
  }

  // 3) medição real do arquivo baixado + extração com tar
  let tgzPath = null;
  try {
    const entries = await fs.readdir(packDir);
    tgzPath = entries.map((e) => path.join(packDir, e)).find((p) => p.endsWith(".tgz")) ?? null;
  } catch {
    tgzPath = null;
  }

  if (!tgzPath) {
    result.error = "npm pack não produziu .tgz";
    await rmrf(packDir);
    return result;
  }

  try {
    const st = await fs.stat(tgzPath);
    result.tarballBytes = st.size;
  } catch {
    result.tarballBytes = null;
  }

  // `tar -xzf` (bsdtar no Windows 10+, tar POSIX nos outros). Se falhar,
  // cai nos números que o próprio npm pack reportou.
  const extractDir = path.join(packDir, "extract");
  await fs.mkdir(extractDir, { recursive: true });
  const ex = await run(IS_WIN ? "tar.exe" : "tar", ["-xzf", tgzPath, "-C", extractDir], {
    timeout,
  });

  if (ex.ok) {
    const measured = await measureDir(extractDir);
    result.files = measured.files;
    result.unpackedBytes = measured.bytes;
    result.measured = "extração real (tar)";
  } else if (packInfo && Array.isArray(packInfo.files)) {
    result.files = packInfo.files.length;
    if (typeof packInfo.unpackedSize === "number") result.unpackedBytes = packInfo.unpackedSize;
    result.measured = "npm pack --json (tar indisponível)";
  } else {
    result.files = packInfo?.entryCount ?? null;
    result.measured = "npm pack --json";
  }

  // 4) proporção — quanto o tarball pesa contra o conteúdo descomprimido
  if (result.tarballBytes && result.unpackedBytes) {
    result.compressionRatio = Number(
      (result.tarballBytes / result.unpackedBytes).toFixed(4),
    );
  }

  result.ok = true;
  await rmrf(packDir);
  return result;
}

// ------------------------------------------------------------------ main

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.packages.length === 0) {
    console.error(
      "uso: node scripts/bakeoff.mjs [--timeout=ms] <pacote> [pacote...]\n" +
        "ex.: node scripts/bakeoff.mjs pi-subagents pi-agent-orchestrator @arhen/pi-core-subagent",
    );
    process.exit(2);
  }

  // resolve o npm uma única vez, sem shell
  npmCli = await resolveNpm();

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "selfevopi-bakeoff-"));
  const started = Date.now();

  const results = [];
  for (const name of opts.packages) {
    // um pacote nunca derruba a rodada: erro vira campo, não exceção
    try {
      results.push(await bakeoff(name, { timeout: opts.timeout, tmpRoot }));
    } catch (err) {
      results.push({
        name,
        ok: false,
        version: null,
        license: null,
        unpackedBytes: null,
        tarballBytes: null,
        files: null,
        deps: {},
        engines: {},
        peerDependencies: {},
        tarball: null,
        error: `exceção inesperada: ${err?.message ?? String(err)}`,
      });
    }
  }

  await rmrf(tmpRoot);

  const output = results.map((r) => ({
    name: r.name,
    ok: r.ok,
    version: r.version,
    license: r.license,
    unpackedBytes: r.unpackedBytes,
    tarballBytes: r.tarballBytes,
    compressionRatio: r.compressionRatio ?? null,
    files: r.files,
    deps: r.deps,
    engines: r.engines,
    peerDependencies: r.peerDependencies,
    ...(r.error ? { error: r.error } : {}),
    ...(r.measured ? { measured: r.measured } : {}),
  }));

  console.log(JSON.stringify(output, null, 2));

  // exit 0 se a rodada terminou (mesmo com pacote inexistente: isso é dado,
  // não falha do script). Só falha se TODOS falharam por motivo não-404.
  const hardFailures = output.filter((r) => !r.ok && !/inexistente|404/i.test(r.error ?? ""));
  if (output.length > 0 && hardFailures.length === output.length) process.exit(1);

  const ms = Date.now() - started;
  console.error(`# ${output.length} pacote(s) em ${ms} ms`);
}

main().catch((err) => {
  console.error(`bakeoff: falha fatal: ${err?.stack ?? err}`);
  process.exit(1);
});