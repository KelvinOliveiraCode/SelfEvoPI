/**
 * core/agent/settings-view.mjs — visão TUI do estado de configuração.
 *
 * Uma linha por item, alinhado, ≤ 72 colunas.
 * Função pura: recebe objeto, devolve string[]. Sem efeito colateral.
 */

const DASH = "—";
const COL_LABEL = 13; // largura da primeira coluna
const COL_VALUE = 16; // largura da segunda coluna
const MAX_COLS = 72;

function pad(str, len) {
  if (str.length >= len) return str + " ";
  return str + " ".repeat(len - str.length);
}

function truncate(str, len) {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + "…";
}

/**
 * Monta uma linha: label + valor + comando.
 * - label: alinhado à esquerda, COL_LABEL colunas
 * - valor: alinhado à esquerda, COL_VALUE colunas; "—" se ausente
 * - comando: só aparece quando existe; truncado para caber em 72
 */
function row(label, value, command) {
  const v = value == null || value === "" ? DASH : String(value);
  const c = command ? String(command) : null;

  const labelPart = pad(label, COL_LABEL);
  const valuePart = pad(v, COL_VALUE);

  if (!c) {
    return truncate(labelPart + valuePart, MAX_COLS);
  }

  const prefix = labelPart + valuePart;
  const remaining = MAX_COLS - prefix.length;
  if (remaining <= 0) return truncate(prefix, MAX_COLS);

  return prefix + truncate(c, remaining);
}

/**
 * Renderiza o estado de configuração como linhas prontas para a TUI.
 *
 * @param {object} state
 * @param {string} [state.model]
 * @param {string} [state.effort]
 * @param {string} [state.mode]
 * @param {string} [state.permission]
 * @param {string} [state.theme]
 * @param {number|string} [state.mcp]
 * @param {number|string} [state.skills]
 * @param {number|string} [state.sessions]
 * @returns {string[]}
 */
export function renderSettings(state = {}) {
  const lines = [];

  lines.push(row("modo", state.mode, "/mode"));
  lines.push(row("permissao", state.permission, "/settings"));
  lines.push(row("modelo", state.model, "/model"));
  lines.push(row("esforco", state.effort, "/effort"));
  lines.push(row("tema", state.theme, "/theme"));

  const mcp = state.mcp != null
    ? (typeof state.mcp === "number" ? `${state.mcp} servidores` : String(state.mcp))
    : null;
  lines.push(row("mcp", mcp, "/mcp"));

  const skills = state.skills != null
    ? (typeof state.skills === "number" ? `${state.skills} do pc` : String(state.skills))
    : null;
  lines.push(row("skills", skills, "/skills"));

  const sessions = state.sessions != null
    ? (typeof state.sessions === "number" ? String(state.sessions) : String(state.sessions))
    : null;
  lines.push(row("sessoes", sessions, "/sessions"));

  return lines;
}

export default { renderSettings };