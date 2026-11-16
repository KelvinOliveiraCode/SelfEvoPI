/**
 * selfevopi-static-gate — gate estático do SelfEvoPI (camada 1 do sandbox).
 *
 * Roda ANTES de qualquer execução: analisa o código gerado e devolve violações.
 * Não executa nada, não sobe processo, não acessa rede. Só lê texto.
 *
 * Contrato:
 *   scanSource(code, { file, workspace, allow }) -> Violation[]
 *   scanFile(path,  { workspace, allow })        -> Violation[]   (async)
 *   Violation = { rule, severity, line, excerpt }
 *   severity  = "block" (impede) | "warn" (permite com registro)
 *
 *   decide(violations)            -> { decision, blocked, warned }
 *   evaluate(code, opts)          -> { file, decision, blockingRules, warningRules, violations, ... }
 *   evaluateFile(path, opts)      -> idem, a partir de arquivo
 *   formatDecision(result)        -> string de uma linha para o ledger JSONL
 *
 * Duas passadas por linha, de propósito:
 *  - `bare` (comentários removidos, strings intactas) → regras de caminho e credencial,
 *    porque é dentro de string que mora `".ssh/id_rsa"`.
 *  - `all` (comentários e strings removidos) → regras de código, para que um comentário
 *    ("não rode reg.exe") ou um exemplo em string ("chame fetch( agora") não vire falso positivo.
 *
 * Severidade se resolve por regra, não por linha: `allow` pode baixar (block→warn) ou
 * desligar ("off") uma regra por tarefa, sem editar o módulo.
 */

import { readFile } from "node:fs/promises";

export const BLOCK = "block";
export const WARN = "warn";

const MAX_EXCERPT = 180;
const MAX_BYTES = 1_048_576; // 1 MiB: acima disso o gate não lê (arquivo gerado não é isso)
const BINARY_PROBE = 8192;

/* ------------------------------------------------------------------ */
/* Máscara: comentários e literais viram espaço, fim de linha fica     */
/* ------------------------------------------------------------------ */

/**
 * Duas máscaras em uma passada, preservando comprimento e numeração de linhas:
 *  - `bare`: comentários viram espaço, strings ficam intactas (regras de caminho vivem em string)
 *  - `all`: comentários e conteúdo de string viram espaço (regras de código, sem falso positivo)
 * Os delimitadores (`"`, `'`, `` ` ``) saem nas duas; o que sobra é código.
 */
function maskSource(code) {
  const all = code.split("");
  const bare = code.split("");
  const n = code.length;
  let i = 0;
  let state = "code"; // code | line | block | sq | dq | tpl

  while (i < n) {
    const c = code[i];
    const d = i + 1 < n ? code[i + 1] : "";

    if (state === "code") {
      if (c === "/" && d === "/") {
        all[i] = " ";
        bare[i] = " ";
        all[i + 1] = " ";
        bare[i + 1] = " ";
        i += 2;
        state = "line";
        continue;
      }
      if (c === "/" && d === "*") {
        all[i] = " ";
        bare[i] = " ";
        all[i + 1] = " ";
        bare[i + 1] = " ";
        i += 2;
        state = "block";
        continue;
      }
      // comentário de linha em PowerShell/Python: só quando o # abre a linha
      if (c === "#") {
        let j = i;
        while (j > 0 && code[j - 1] !== "\n") j -= 1;
        if (code.slice(j, i).trim() === "") {
          all[i] = " ";
          bare[i] = " ";
          i += 1;
          state = "line";
          continue;
        }
      }
      if (c === "'" || c === '"' || c === "`") {
        all[i] = " ";
        i += 1;
        state = c === "'" ? "sq" : c === '"' ? "dq" : "tpl";
        continue;
      }
      i += 1;
      continue;
    }

    if (state === "line") {
      if (c === "\n") {
        state = "code";
        i += 1;
        continue;
      }
      all[i] = " ";
      bare[i] = " ";
      i += 1;
      continue;
    }

    if (state === "block") {
      if (c === "*" && d === "/") {
        all[i] = " ";
        bare[i] = " ";
        all[i + 1] = " ";
        bare[i + 1] = " ";
        i += 2;
        state = "code";
        continue;
      }
      if (c !== "\n") {
        all[i] = " ";
        bare[i] = " ";
      }
      i += 1;
      continue;
    }

    // dentro de string: some na máscara `all`, sobrevive em `bare`
    if (c === "\\") {
      all[i] = " ";
      if (i + 1 < n && code[i + 1] !== "\n") all[i + 1] = " ";
      i += 2;
      continue;
    }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) {
      all[i] = " ";
      i += 1;
      state = "code";
      continue;
    }
    if (c === "\n") {
      // template literal multilinha: preserva a quebra para alinhar as linhas
      i += 1;
      continue;
    }
    all[i] = " ";
    i += 1;
  }

  return { all: all.join(""), bare: bare.join("") };
}

/* ------------------------------------------------------------------ */
/* Utilidades de caminho                                               */
/* ------------------------------------------------------------------ */

function normPath(p) {
  return String(p ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
}

/**
 * "inside" quando o alvo não sai do workspace, "outside" quando sai,
 * "unknown" quando não dá para decidir (variável de ambiente, vazio).
 * Comparação sem caixa: Windows é case-insensitive.
 */
export function classifyPath(target, workspace) {
  const t = normPath(target);
  if (!t || t === "." || t === "./") return "inside";
  if (t.includes("$") || t.includes("%")) return "unknown";

  const w = normPath(workspace);
  const abs = /^[A-Za-z]:\//.test(t) || /^\/\//.test(t);

  if (abs) {
    if (!w) return "outside";
    const base = w.endsWith("/") ? w : `${w}/`;
    return t.toLowerCase().startsWith(base.toLowerCase()) ? "inside" : "outside";
  }

  if (t.startsWith("/")) return "outside";
  if (t.split("/").includes("..")) return "outside";
  return "inside";
}

/** Último token que não é flag — alvo típico de um comando de deleção. */
function lastPathToken(raw) {
  const tokens = raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const flat = tokens
    .map((t) => t.replace(/[;,)\]}'"]+$/, "")) // pontuação que fecha o comando
    .filter((t) => t !== "" && !t.startsWith("-") && !/^\/[a-z]$/i.test(t));
  return flat.length > 0 ? flat[flat.length - 1] : null;
}

function excerptOf(line) {
  return String(line ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_EXCERPT);
}

/* ------------------------------------------------------------------ */
/* Regras                                                              */
/* ------------------------------------------------------------------ */

const SECRET_NAME =
  /(?:SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|PASSWORD|PASSWD|CREDENTIAL)/i;

const SECRET_LITERAL =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/;

const DELETE_CMD =
  /\bRemove-Item\b|\brm\s+-[A-Za-z]+\b|\brd\s+\/s\b|\brmdir\s+\/s\b|\bdel\s+\/[sq]\b|\berase\s+\/[sq]\b/i;

const RAW_RULES = [
  {
    id: "ssh-access",
    severity: BLOCK,
    title: "Acesso a chaves SSH",
    why: "id_rsa/id_ed25519/known_hosts permitem autenticar como o usuário.",
    test: (raw) =>
      /(?:^|[^A-Za-z0-9_.])\.ssh(?:[\\/'"`\s]|$)/i.test(raw) ||
      /\b(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|known_hosts)\b/.test(raw),
  },
  {
    id: "credential-store",
    severity: BLOCK,
    title: "Credenciais do OpenCode/PI e arquivos de segredo",
    why: "auth.json, .pi/auth, credentials.json, *.pem guardam chaves de API.",
    test: (raw) =>
      /(?:^|[\\/"'\s])(?:\.pi|opencode)[\\/](?:auth|agent|credentials|keys?)(?:[\\/.]|$)/i.test(raw) ||
      /[\\/]opencode[\\/](?:auth|credentials|settings\.local\.json)\b/i.test(raw) ||
      /[\\/]\.config[\\/]opencode\b/i.test(raw) ||
      /[\\/]\.local[\\/]share[\\/]opencode\b/i.test(raw) ||
      /(?:^|[\\/"'\s])(?:auth|credentials|secrets|providers\.local)\.json\b/i.test(raw) ||
      /(?:^|[\\/"'\s])[A-Za-z0-9_.-]+\.(?:key|pem|p12|pfx)\b/i.test(raw) ||
      // .aws/credentials guarda chaves de acesso da AWS; sem esta regra o gate
      // deixava passar e so o Permission Model barrava (descoberto na prova de
      // sandbox da Fase 2). Regra faltando, nao comportamento desejado.
      /(?:^|[\\/"'\s])\.aws(?:[\\/'"`\s]|$)/i.test(raw) ||
      /[\\/]\.aws[\\/](?:credentials|config)\b/i.test(raw) ||
      /\baws_access_key_id\b/i.test(raw),
  },
  {
    id: "userprofile-config",
    severity: BLOCK,
    title: "Configuração do usuário fora do workspace",
    why: "%USERPROFILE%\\.config e $HOME/.config concentram credenciais e preferências.",
    test: (raw) =>
      /%USERPROFILE%[\\/]*\.config/i.test(raw) ||
      /%APPDATA%[\\/]*(?:opencode|\.pi)\b/i.test(raw) ||
      /(?:process\s*\.\s*env|os\s*\.\s*env(?:iron)?|\$env:)\s*\.?\s*USERPROFILE\b[^\n]*?\.config/i.test(raw) ||
      /\$HOME[\\/]*\.config/i.test(raw) ||
      /(?:^|[^A-Za-z])~[\\/]\.config/i.test(raw) ||
      /os\.homedir\s*\(\s*\)[^;\n]*\.config/.test(raw) ||
      /C:[\\/]{1,2}Users[\\/][^\\/"'\s]+[\\/]\.config/i.test(raw),
  },
  {
    id: "registry-exe",
    severity: BLOCK,
    title: "Registro do Windows (reg.exe / hive HK*)",
    why: "Altera o Registro: persistência, política e defesa do sistema.",
    test: (raw) =>
      /\breg(?:\.exe)?\s+(?:add|delete|query|save|restore|import|export|copy|load|unload|compare|flags)\b/i.test(
        raw
      ) ||
      /\breg\.exe\b/i.test(raw) ||
      /\bHKEY_(?:CURRENT_USER|LOCAL_MACHINE|CLASSES_ROOT|USERS|CURRENT_CONFIG)\b/i.test(raw) ||
      /(?:^|[^A-Za-z])(?:HKCU|HKLM|HKCR|HKU|HKCC)[\\/:]/i.test(raw),
  },
  {
    id: "recursive-force-delete",
    severity: BLOCK,
    title: "Deleção recursiva e forçada",
    why: "Remove-Item -Recurse -Force (ou rm -rf) fora do workspace apaga trabalho do usuário.",
    test: (raw, masked, ctx) => {
      const hay = `${masked}\n${raw}`;
      if (!DELETE_CMD.test(hay)) return false;

      const psForce =
        /\bRemove-Item\b/i.test(hay) && /(?:^|\s)-Force\b/i.test(hay) && /(?:^|\s)-Recurse\b/i.test(hay);
      const rmForce =
        /\brm\s+-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*\b/i.test(hay) ||
        /\brm\s+-[A-Za-z]*f[A-Za-z]*r[A-Za-z]*\b/i.test(hay);
      const cmdForce =
        /\b(?:rd|rmdir|del|erase)\s+\/s\b.*\/q\b/i.test(hay) || /\b(?:rd|rmdir)\s+\/s\s+\/q\b/i.test(hay);
      if (!psForce && !rmForce && !cmdForce) return false;

      // devolve a severidade: apagar dentro da worktree é limpeza; fora, é dano
      return classifyPath(lastPathToken(hay.trim()), ctx.workspace) === "inside" ? "warn" : "block";
    },
  },
  {
    id: "child-process",
    severity: BLOCK,
    title: "Processo filho não autorizado",
    why: "spawn/exec sobem processo fora do cinto do Node Permission Model e do Job Object.",
    test: (raw, masked) =>
      /require\s*\(\s*['"`](?:node:)?child_process['"`]\s*\)/.test(raw) ||
      /(?:from|import)\s*\(?\s*['"`](?:node:)?child_process['"`]/.test(raw) ||
      /\bchild_process\b/.test(masked) ||
      /\b(?:spawnSync|execFileSync|execSync|spawn|execFile)\s*\(/.test(masked),
  },
  {
    id: "network-access",
    severity: BLOCK,
    title: "Rede",
    why: "fetch/http.request é exfiltração por padrão; rede abre com --allow-net explícito.",
    test: (raw, masked) =>
      /\bfetch\s*\(/.test(masked) ||
      /\b(?:https?|net|tls|dgram)\s*\.\s*(?:request|get|connect|createConnection)\s*\(/.test(masked) ||
      /\bnew\s+(?:WebSocket|XMLHttpRequest)\s*\(/.test(masked) ||
      /\b(?:axios|node-fetch|undici|got)\b/.test(masked) ||
      /\bcurl\s+-[A-Za-z]/.test(masked) ||
      /\b(?:Invoke-WebRequest|Invoke-RestMethod)\b/i.test(masked) ||
      /(?:^|\s)iwr\s+/i.test(masked),
  },
  {
    id: "dynamic-eval",
    severity: BLOCK,
    title: "Avaliação dinâmica de código",
    why: "eval/new Function transformam dado em código e escapam de qualquer análise estática.",
    test: (raw, masked) =>
      /(?<![.\w$])eval\s*\(/.test(masked) ||
      /\bnew\s+Function\s*\(/.test(masked) ||
      /(?<![.\w$])Function\s*\(\s*['"`]/.test(masked) ||
      /\bvm\s*\.\s*(?:runInNewContext|runInThisContext|compileFunction|createContext)\b/.test(masked) ||
      /\bset(?:Timeout|Interval)\s*\(\s*['"`]/.test(raw),
  },
  {
    id: "secret-env-read",
    severity: BLOCK,
    title: "Leitura de variável de ambiente sensível",
    why: "process.env.GITHUB_TOKEN e afins entregam a chave para o código gerado.",
    test: (raw, masked) => {
      // forma pontuada mora em código (sobrevive à máscara)
      const dot = /\bprocess\s*\.\s*env\s*\.\s*([A-Za-z_$][\w$]*)/g;
      let m;
      while ((m = dot.exec(masked)) !== null) if (SECRET_NAME.test(m[1])) return true;
      // forma com colchete / Python / Deno: o nome está em string, logo só o texto cru serve
      const quoted = [
        /\bprocess\s*\.\s*env\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g,
        /\bos\s*\.\s*environ\s*\[\s*['"]([^'"]+)['"]\s*\]/g,
        /\bos\s*\.\s*environ\s*\.\s*get\s*\(\s*['"]([^'"]+)['"]/g,
        /\bDeno\s*\.\s*env\s*\.\s*get\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ];
      for (const re of quoted) {
        while ((m = re.exec(raw)) !== null) if (SECRET_NAME.test(m[1])) return true;
      }
      return false;
    },
  },
  {
    id: "embedded-secret",
    severity: BLOCK,
    title: "Segredo embutido no código",
    why: "Chave em literal vira vazamento no próximo commit; o trecho é redigido no log.",
    test: (raw) => SECRET_LITERAL.test(raw),
    excerpt: (raw) => {
      const m = SECRET_LITERAL.exec(raw);
      if (!m) return excerptOf(raw);
      return `${m[0].slice(0, 4)}…[redigido ${m[0].length} chars]`;
    },
  },
  {
    id: "pi-config-access",
    severity: WARN,
    title: "Configuração do harness (.pi/)",
    why: "`.pi/harness` é do projeto, mas `.pi/` do usuário não; registrado para auditoria.",
    test: (raw) => /(?:^|[^A-Za-z0-9_.])\.pi[\\/]/.test(raw),
  },
  {
    id: "outside-workspace-path",
    severity: WARN,
    title: "Caminho fora do workspace",
    why: "Escrita ou leitura fora da worktree quebra o isolamento entre tarefas.",
    test: (raw, masked, ctx) => {
      const abs = raw.match(/['"`]([A-Za-z]:[\\/][^'"`]*|\/(?:etc|home|root|var|usr)\/[^'"`]*)['"`]/);
      if (abs) return classifyPath(abs[1], ctx.workspace) === "outside";
      if (/(?:^|[^.\w])\.\.[\\/]/.test(masked)) return true;
      return false;
    },
  },
  {
    id: "process-env-read",
    severity: WARN,
    title: "Leitura de variável de ambiente",
    why: "Ambiente do usuário vaza preferências e caminhos; permitido, mas fica no log.",
    test: (raw, masked) =>
      /\bprocess\s*\.\s*env\b/.test(masked) ||
      /\bos\s*\.\s*env(?:iron)?\b/.test(masked) ||
      /\bDeno\s*\.\s*env\b/i.test(masked),
  },
];

export const RULES = Object.freeze(
  RAW_RULES.map((r) =>
    Object.freeze({
      id: r.id,
      severity: r.severity,
      title: r.title,
      why: r.why,
      test: r.test,
      excerpt: r.excerpt ?? null,
    })
  )
);

export const RULE_IDS = Object.freeze(RULES.map((r) => r.id));

export function ruleById(id) {
  return RULES.find((r) => r.id === id) ?? null;
}

/* ------------------------------------------------------------------ */
/* Varredura                                                           */
/* ------------------------------------------------------------------ */

function sortViolations(vs) {
  return vs.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/**
 * Uma linha com bloqueio já diz tudo: avisos da mesma linha são ruído.
 * (ex.: `.pi/auth.json` gera credential-store + pi-config-access; fica só o bloqueio.)
 */
function dropShadowedWarnings(vs) {
  const blocked = new Set(vs.filter((v) => v.severity === BLOCK).map((v) => v.line));
  return vs.filter((v) => v.severity === BLOCK || !blocked.has(v.line) || v.line === 0);
}

/**
 * Analisa código em memória.
 * @param {string} code
 * @param {{file?: string, workspace?: string, allow?: Record<string, "block"|"warn"|"off">}} [opts]
 * @returns {Array<{rule: string, severity: "block"|"warn", line: number, excerpt: string}>}
 */
export function scanSource(code, opts = {}) {
  const { file = "<memoria>", workspace = process.cwd(), allow = {} } = opts;
  const src = String(code ?? "");
  const masked = maskSource(src);
  const rawLines = masked.bare.split(/\r?\n/); // comentários fora, strings intactas
  const codeLines = masked.all.split(/\r?\n/); // comentários e strings fora
  const ctx = { file, workspace };
  const found = [];
  const seen = new Set();

  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const raw = rawLines[idx];
    if (raw.trim() === "") continue;
    const code_ = codeLines[idx] ?? "";
    const line = idx + 1;

    for (const rule of RULES) {
      const configured = allow[rule.id];
      if (configured === "off") continue;

      let hit;
      try {
        hit = rule.test(raw, code_, ctx);
      } catch {
        hit = false; // regra quebrada nunca reprova por engano
      }
      if (hit === false || hit === undefined || hit === null) continue;

      // a regra pode devolver a própria severidade (caso do delete: dentro avisa, fora bloqueia)
      const severity = configured ?? (hit === "warn" || hit === "block" ? hit : rule.severity);

      const key = `${rule.id}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const excerpt = rule.excerpt ? rule.excerpt(raw) : excerptOf(raw);
      found.push({ rule: rule.id, severity, line, excerpt });
    }
  }

  return sortViolations(dropShadowedWarnings(found));
}

/**
 * Analisa um arquivo do disco. Nunca devolve o conteúdo: só caminho e trecho.
 * Arquivo grande ou binário volta como aviso `file-skipped` (linha 0), não como aprovação silenciosa.
 * @param {string} filePath
 * @param {{workspace?: string, allow?: object, maxBytes?: number}} [opts]
 */
export async function scanFile(filePath, opts = {}) {
  const { workspace = process.cwd(), allow = {}, maxBytes = MAX_BYTES } = opts;
  const skip = (rule, excerpt) => [{ rule, severity: WARN, line: 0, excerpt }];

  let buf;
  try {
    buf = await readFile(filePath);
  } catch (err) {
    return skip("file-skipped", `${filePath}: leitura falhou (${err?.code ?? "erro"})`);
  }
  if (buf.length > maxBytes) {
    return skip("file-skipped", `${filePath}: ${buf.length} bytes acima do teto de ${maxBytes}`);
  }
  if (buf.subarray(0, BINARY_PROBE).includes(0)) {
    return skip("file-skipped", `${filePath}: conteúdo binário`);
  }
  return scanSource(buf.toString("utf8"), { file: filePath, workspace, allow });
}

/* ------------------------------------------------------------------ */
/* Decisão                                                             */
/* ------------------------------------------------------------------ */

/**
 * Formato de decisão que o gate emite (ver docs/fase2/sandbox.md):
 *   { decision: "allow" | "warn" | "block", blocked: n, warned: n }
 */
export function decide(violations) {
  const list = Array.isArray(violations) ? violations : [];
  let blocked = 0;
  let warned = 0;
  for (const v of list) {
    if (v.severity === BLOCK) blocked += 1;
    else if (v.severity === WARN) warned += 1;
  }
  const decision = blocked > 0 ? "block" : warned > 0 ? "warn" : "allow";
  return { decision, blocked, warned };
}

/**
 * Laudo completo de um código: violações + decisão + regras que pesaram.
 * @param {string} code
 * @param {{file?: string, workspace?: string, allow?: object}} [opts]
 */
export function evaluate(code, opts = {}) {
  const { file = "<memoria>", workspace = process.cwd(), allow = {} } = opts;
  const violations = scanSource(code, { file, workspace, allow });
  const { decision, blocked, warned } = decide(violations);
  return {
    file,
    decision,
    blocked,
    warned,
    blockingRules: [...new Set(violations.filter((v) => v.severity === BLOCK).map((v) => v.rule))],
    warningRules: [...new Set(violations.filter((v) => v.severity === WARN).map((v) => v.rule))],
    lines: [...new Set(violations.filter((v) => v.line > 0).map((v) => v.line))],
    violations,
  };
}

/** Laudo completo a partir de um arquivo. */
export async function evaluateFile(filePath, opts = {}) {
  const { workspace = process.cwd(), allow = {} } = opts;
  const violations = await scanFile(filePath, { workspace, allow });
  const { decision, blocked, warned } = decide(violations);
  return {
    file: filePath,
    decision,
    blocked,
    warned,
    blockingRules: [...new Set(violations.filter((v) => v.severity === BLOCK).map((v) => v.rule))],
    warningRules: [...new Set(violations.filter((v) => v.severity === WARN).map((v) => v.rule))],
    lines: [...new Set(violations.filter((v) => v.line > 0).map((v) => v.line))],
    violations,
  };
}

/**
 * Uma linha para o ledger JSONL (`.pi/harness/ledger/*.jsonl`).
 * JSON aninhado: caminho com espaço não quebra o campo.
 */
export function formatDecision(result) {
  const payload = {
    decision: result.decision,
    file: result.file,
    blockingRules: result.blockingRules ?? [],
    warningRules: result.warningRules ?? [],
    lines: result.lines ?? [],
  };
  return `gate ${JSON.stringify(payload)}`;
}