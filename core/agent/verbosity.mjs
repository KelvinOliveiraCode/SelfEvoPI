/**
 * core/agent/verbosity.mjs — quanto feedback a CLI mostra durante um turno.
 *
 * Cinco níveis, do mais limpo ao mais detalhado. A preferência fica fora do
 * repositório; SELFEOPI_VERBOSITY sobrescreve por execução (útil em testes/CI).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_VERBOSITY = "full";
export const LEVELS = Object.freeze(["minimal", "tools", "reasoning", "full", "verbose"]);
export const ALIASES = Object.freeze({ off: "minimal", compact: "tools", all: "verbose" });

const FILE = () =>
  process.env.SELFEOPI_VERBOSITY_FILE
    ? path.resolve(process.env.SELFEOPI_VERBOSITY_FILE)
    : path.join(os.homedir(), ".pi", "agent", "cli-verbosity.json");

export function normalize(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return ALIASES[raw] || (LEVELS.includes(raw) ? raw : null);
}

export function getVerbosity() {
  const env = normalize(process.env.SELFEOPI_VERBOSITY);
  if (env) return env;
  try {
    const doc = JSON.parse(readFileSync(FILE(), "utf8"));
    return normalize(doc?.level) || DEFAULT_VERBOSITY;
  } catch {
    return DEFAULT_VERBOSITY;
  }
}

export function setVerbosity(value) {
  const level = normalize(value);
  if (!level) return false;
  delete process.env.SELFEOPI_VERBOSITY;
  try {
    mkdirSync(path.dirname(FILE()), { recursive: true });
    writeFileSync(FILE(), JSON.stringify({ level }, null, 2) + "\n", "utf8");
  } catch {
    /* preferência em memória continua valendo */
  }
  return true;
}

/**
 * Presets: o que cada nível exibe.
 *  activity    – spinner/linha de "trabalhando"
 *  tools       – linhas ⏺ de ferramenta
 *  toolResult  – linha ⎿ com resumo do resultado
 *  reasoning   – bloco ⤷ de raciocínio
 *  metrics     – timer e contador de tokens no spinner
 */
const PRESETS = {
  minimal: { activity: false, tools: false, toolResult: false, reasoning: false, metrics: false },
  tools: { activity: true, tools: true, toolResult: false, reasoning: false, metrics: false },
  reasoning: { activity: true, tools: false, toolResult: false, reasoning: true, metrics: false },
  full: { activity: true, tools: true, toolResult: true, reasoning: true, metrics: false },
  verbose: { activity: true, tools: true, toolResult: true, reasoning: true, metrics: true },
};

export function shows(part, level = getVerbosity()) {
  return Boolean((PRESETS[level] || PRESETS[DEFAULT_VERBOSITY])[part]);
}

export function describe(level = getVerbosity()) {
  return {
    minimal: "final answer only",
    tools: "tool calls + final answer",
    reasoning: "reasoning + final answer",
    full: "reasoning + tools + final answer",
    verbose: "everything, with timer and tokens",
  }[level] || level;
}

export default { LEVELS, DEFAULT_VERBOSITY, getVerbosity, setVerbosity, normalize, shows, describe };
