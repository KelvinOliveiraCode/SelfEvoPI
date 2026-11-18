/**
 * apps/desktop/settings.js — menu de configurações do desktop.
 *
 * Duas superfícies, como o Claude Code Desktop:
 *   1. Linha de controle (abaixo do composer): modo + modelo + permissão
 *   2. Painel #settingsPanel (Ctrl+,): preferências que não mudam por turno
 *
 * Persiste em localStorage sob a chave "selfevopi.settings".
 * Não cria arquivo no disco.
 *
 * Zero dependência externa. Só node: e Web APIs.
 */

import { MODE_NAMES, MODES, describePermissions } from "./modes-data.js";

const STORAGE_KEY = "selfevopi.settings";

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

const DEFAULTS = Object.freeze({
  mode: "build",
  model: "",
  effort: "medium",
  permission: "ask",
  confirmWrites: true,
  showTips: false,
});

/* ------------------------------------------------------------------ */
/* Estado interno                                                      */
/* ------------------------------------------------------------------ */

let _state = { ...DEFAULTS };
let _onChange = null;
let _controlBarEl = null;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isBrowser() {
  return typeof globalThis.localStorage !== "undefined";
}

function load() {
  if (!isBrowser()) return { ...DEFAULTS };
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function save() {
  if (!isBrowser()) return;
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch {
    /* quota cheia ou modo privado: ignora silenciosamente */
  }
}

function emit() {
  if (typeof _onChange === "function") {
    try {
      _onChange({ ..._state });
    } catch {
      /* callback do usuário não derruba o menu */
    }
  }
  if (_controlBarEl) {
    renderControlBar();
  }
}

/* ------------------------------------------------------------------ */
/* Validação                                                           */
/* ------------------------------------------------------------------ */

const EFFORTS = Object.freeze(["off", "low", "medium", "high"]);
const PERMISSIONS = Object.freeze(["full-access", "auto", "ask"]);

function validateMode(value) {
  if (!MODE_NAMES.includes(value)) {
    throw new Error(`modo inválido: "${value}". Use: ${MODE_NAMES.join(", ")}`);
  }
}

function validateEffort(value) {
  if (!EFFORTS.includes(value)) {
    throw new Error(`esforço inválido: "${value}". Use: ${EFFORTS.join(", ")}`);
  }
}

function validatePermission(value) {
  if (!PERMISSIONS.includes(value)) {
    throw new Error(`permissão inválida: "${value}". Use: ${PERMISSIONS.join(", ")}`);
  }
}

/* ------------------------------------------------------------------ */
/* API pública — getSettings                                           */
/* ------------------------------------------------------------------ */

/**
 * Retorna o estado atual (cópia).
 */
export function getSettings() {
  const perms = describePermissions({ mode: _state.mode });

  return {
    mode: _state.mode,
    modeLabel: MODES[_state.mode]?.nota ?? "",
    model: _state.model,
    models: _state._models ?? [],
    effort: _state.effort,
    permission: _state.permission,
    permissionLabel: perms.label,
    permissionSummary: perms.summary,
    canRead: perms.canRead,
    canWrite: perms.canWrite,
    canExec: perms.canExec,
    execScope: perms.execScope,
    asks: perms.asks,
    confirmWrites: _state.confirmWrites,
    showTips: _state.showTips,
  };
}

/* ------------------------------------------------------------------ */
/* API pública — initSettings (painel Ctrl+,)                          */
/* ------------------------------------------------------------------ */

/**
 * Inicializa o painel de configurações (preferências que não mudam por turno).
 *
 * @param {object} [opts]
 * @param {object} [opts.models] — lista de modelos disponíveis [{ provider, id }]
 * @param {string} [opts.defaultModel] — modelo inicial
 * @param {function} [opts.onChange] — callback(state) ao mudar
 * @returns {object} referência do módulo
 */
/**
 * Renderiza o painel de configuracoes (#settingsPanel).
 *
 * Existe porque o initSettings original so carregava estado — o painel ficava
 * vazio na tela. Cada linha le o estado atual e chama o setter da API publica,
 * que persiste e avisa quem escuta (onChange).
 */
function renderSettingsPanel(panelEl) {
  if (!isBrowser() || !panelEl) return;

  function linhaRotulo(texto) {
    const row = _createElement("div", "settings-row");
    const label = _createElement("span", "settings-label", texto);
    row.append(label);
    return row;
  }

  function linhaBotoes(texto, opcoes, atual, aoEscolher) {
    const row = linhaRotulo(texto);
    const box = _createElement("div", "settings-value");
    box.style.display = "flex";
    box.style.gap = "6px";
    for (const op of opcoes) {
      const b = _createElement("button", "sp-opt", op);
      b.type = "button";
      b.dataset.value = op;
      if (op === atual) b.classList.add("on");
      b.addEventListener("click", () => {
        try {
          aoEscolher(op);
        } catch (err) {
          console.warn("[settings]", err && err.message ? err.message : err);
        }
      });
      box.append(b);
    }
    row.append(box);
    return row;
  }

  function linhaCheck(texto, atual, aoAlternar) {
    const row = linhaRotulo(texto);
    const b = _createElement("button", "sp-opt", atual ? "sim" : "não");
    b.type = "button";
    if (atual) b.classList.add("on");
    b.addEventListener("click", () => {
      try {
        aoAlternar(!atual);
      } catch (err) {
        console.warn("[settings]", err && err.message ? err.message : err);
      }
    });
    row.append(b);
    return row;
  }

  function linhaModelo() {
    const row = linhaRotulo("modelo");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "settings-value sp-model";
    input.value = _state.model || "";
    input.placeholder = "provedor/modelo";
    input.addEventListener("change", () => {
      try {
        _api.setModel(input.value);
      } catch (err) {
        console.warn("[settings]", err && err.message ? err.message : err);
      }
    });
    row.append(input);
    return row;
  }

  panelEl.innerHTML = "";

  const head = _createElement("div", "sp-head");
  const titulo = document.createElement("h2");
  titulo.textContent = "configurações";
  const spacer = _createElement("span", "spacer");
  const fechar = _createElement("button", "sp-close", "fechar");
  fechar.type = "button";
  fechar.addEventListener("click", () => panelEl.classList.remove("open"));
  head.append(titulo, spacer, fechar);

  const body = _createElement("div", "sp-body");
  body.append(
    linhaBotoes("modo", MODE_NAMES, _state.mode, (v) => _api.setMode(v)),
    linhaBotoes("esforço", EFFORTS, _state.effort, (v) => _api.setEffort(v)),
    linhaBotoes("permissão", PERMISSIONS, _state.permission, (v) => _api.setPermission(v)),
    linhaModelo(),
    linhaCheck("confirmar escritas", _state.confirmWrites, (v) => _api.setConfirmWrites(v)),
    linhaCheck("mostrar dicas", _state.showTips, (v) => _api.setShowTips(v)),
  );

  panelEl.append(head, body);
}

export function initSettings(opts = {}) {
  _state = load();

  if (opts.models && Array.isArray(opts.models)) {
    _state._models = opts.models.map((m) => ({
      label: typeof m === "string" ? m : `${m.provider}/${m.id}`,
      value: typeof m === "string" ? m : `${m.provider}/${m.id}`,
    }));
  }

  if (opts.defaultModel && !_state.model) {
    _state.model = opts.defaultModel;
  }

  if (typeof opts.onChange === "function") {
    _onChange = opts.onChange;
  }

  // O painel vem por `panel` (app.js) ou `container`; sem ele, nada a desenhar.
  const panelEl = opts.panel || opts.container || null;
  if (panelEl) {
    renderSettingsPanel(panelEl);
    // Redesenha quando o estado muda, para o painel refletir o que a barra fez.
    _onChange = (s) => {
      renderSettingsPanel(panelEl);
      if (typeof opts.onChange === "function") opts.onChange(s);
    };
  }

  return _api;
}

/* ------------------------------------------------------------------ */
/* API pública — initControlBar (linha abaixo do composer)             */
/* ------------------------------------------------------------------ */

/**
 * Inicializa a linha de controle compacta (modo + modelo + permissão).
 * Renderiza no elemento fornecido ou cria um novo.
 *
 * @param {object} [opts]
 * @param {HTMLElement} [opts.container] — onde renderizar (default: cria um)
 * @returns {{ el: HTMLElement, destroy: function }}
 */
export function initControlBar(opts = {}) {
  if (!isBrowser() || typeof globalThis.document === "undefined") {
    // headless: devolve stub
    return { el: null, destroy: () => {} };
  }

  const el = opts.container || opts.bar || globalThis.document.createElement("div");
  el.className = "selfevopi-control-bar";
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", "Controles de conversa");

  _controlBarEl = el;
  renderControlBar();

  return {
    el,
    destroy() {
      _controlBarEl = null;
      if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Render da control bar                                               */
/* ------------------------------------------------------------------ */

function renderControlBar() {
  if (!_controlBarEl) return;
  const s = getSettings();

  _controlBarEl.innerHTML = "";

  // ── Modo ──
  const modeWrap = _createElement("span", "selfevopi-cb-group");
  modeWrap.appendChild(_createElement("span", "selfevopi-cb-label", "Modo:"));
  const modeSel = _createElement("select", "selfevopi-cb-select");
  modeSel.setAttribute("aria-label", "Modo");
  for (const m of _api.listModes()) {
    const opt = globalThis.document.createElement("option");
    opt.value = m.name;
    opt.textContent = m.name;
    if (m.name === s.mode) opt.selected = true;
    modeSel.appendChild(opt);
  }
  modeSel.addEventListener("change", (e) => {
    try { _api.setMode(e.target.value); } catch { /* erro já reportado */ }
  });
  modeWrap.appendChild(modeSel);
  _controlBarEl.appendChild(modeWrap);

  // ── Modelo ──
  const modelWrap = _createElement("span", "selfevopi-cb-group");
  modelWrap.appendChild(_createElement("span", "selfevopi-cb-label", "Modelo:"));
  const modelSel = _createElement("select", "selfevopi-cb-select");
  modelSel.setAttribute("aria-label", "Modelo");
  if (s.models.length > 0) {
    for (const m of s.models) {
      const opt = globalThis.document.createElement("option");
      opt.value = m.value;
      opt.textContent = m.label;
      if (m.value === s.model) opt.selected = true;
      modelSel.appendChild(opt);
    }
  } else {
    const opt = globalThis.document.createElement("option");
    opt.value = "";
    opt.textContent = s.model || "(nenhum)";
    opt.selected = true;
    modelSel.appendChild(opt);
  }
  modelSel.addEventListener("change", (e) => {
    try { _api.setModel(e.target.value); } catch { /* erro já reportado */ }
  });
  modelWrap.appendChild(modelSel);
  _controlBarEl.appendChild(modelWrap);

  // ── Permissão ──
  const permWrap = _createElement("span", "selfevopi-cb-group");
  permWrap.appendChild(_createElement("span", "selfevopi-cb-label", "Permissão:"));
  const permSel = _createElement("select", "selfevopi-cb-select");
  permSel.setAttribute("aria-label", "Permissão");
  for (const p of _api.listPermissions()) {
    const opt = globalThis.document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    if (p === s.permission) opt.selected = true;
    permSel.appendChild(opt);
  }
  permSel.addEventListener("change", (e) => {
    try { _api.setPermission(e.target.value); } catch { /* erro já reportado */ }
  });
  permWrap.appendChild(permSel);
  _controlBarEl.appendChild(permWrap);
}

function _createElement(tag, className, text) {
  const el = globalThis.document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/* ------------------------------------------------------------------ */
/* API interna (setters)                                               */
/* ------------------------------------------------------------------ */

const _api = {
  /** Troca o modo. */
  setMode(value) {
    validateMode(value);
    _state.mode = value;
    save();
    emit();
  },

  /** Troca o modelo. */
  setModel(value) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error("modelo não pode ser vazio");
    }
    _state.model = value.trim();
    save();
    emit();
  },

  /** Troca o esforço de raciocínio. */
  setEffort(value) {
    validateEffort(value);
    _state.effort = value;
    save();
    emit();
  },

  /** Troca o tipo de permissão. */
  setPermission(value) {
    validatePermission(value);
    _state.permission = value;
    save();
    emit();
  },

  /** Alterna confirmação de escrita. */
  setConfirmWrites(value) {
    _state.confirmWrites = Boolean(value);
    save();
    emit();
  },

  /** Alterna dicas. */
  setShowTips(value) {
    _state.showTips = Boolean(value);
    save();
    emit();
  },

  /** Lista os modos disponíveis com nota. */
  listModes() {
    return MODE_NAMES.map((name) => ({
      name,
      nota: MODES[name]?.nota ?? "",
    }));
  },

  /** Lista os esforços disponíveis. */
  listEfforts() {
    return [...EFFORTS];
  },

  /** Lista as permissões disponíveis. */
  listPermissions() {
    return [...PERMISSIONS];
  },

  /** Restaura defaults (útil para reset). */
  reset() {
    _state = { ...DEFAULTS, _models: _state._models ?? [] };
    save();
    emit();
  },
};

export default _api;