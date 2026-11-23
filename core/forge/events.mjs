/**
 * core/forge/events.mjs — eventos externos disparando o Forge.
 *
 * Um "evento" é um arquivo JSONL (uma linha JSON) em
 * `.pi/harness/events/`. Cada evento é um arquivo próprio, com nome único e
 * ordenável; o conteúdo é `{ id, type, payload, at }`. O watcher observa a
 * pasta, entrega cada arquivo novo ao callback e persegue um cursor (conjunto
 * de nomes já processados) gravado em disco — assim um restart não redelivera
 * o que já foi entregue.
 *
 * Três peças, e nada além delas:
 *   emitEvent({ dir, type, payload, at?, id?, now? }) -> { ok, event, file }
 *   watchEvents({ dir, onEvent, intervalMs, now, sleep, ... }) -> { ok, ... }
 *   runForgeOnEvent(event, handlers) -> { ok, type, handled, action?, error? }
 *
 * `runForgeOnEvent` NÃO conhece o Forge por dentro: recebe um registro de
 * handlers (Map ou objeto) que mapeia `type` -> ação e apenas invoca a ação
 * registrada. Quem monta o registro é a integração.
 *
 * Windows nativo, ESM puro, zero dependência (só `node:`). Toda gravação é
 * atómica (tmp + rename). Nunca lança em arquivo corrompido: devolve
 * `{ ok:false, error }` explícito.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

/** Versão do cursor de eventos. */
export const EVENTS_CURSOR_VERSION = 1;

/** Nome do arquivo de cursor dentro da pasta de eventos. */
export const EVENTS_CURSOR_FILE = ".cursor.json";

/** Sufixo dos arquivos de evento. */
const EVENT_SUFFIX = ".jsonl";

/** Sono padrão (injetável em teste). */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Conjunto de ids já usados na pasta (evita colisão de nome no tmp). */
let tmpSeq = 0;

/** Diretório padrão de eventos, relativo a `root`. */
export function defaultEventsDir(root = process.cwd()) {
  return join(String(root), ".pi", "harness", "events");
}

/** Um nome de arquivo é evento quando termina em .jsonl e não é tmp. */
function isEventFile(name) {
  return typeof name === "string" && name.endsWith(EVENT_SUFFIX) && !name.includes(".tmp-");
}

/** Normaliza um tipo de evento para slug de nome de arquivo. */
export function slugifyEventType(type) {
  return String(type ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "event";
}

/** Escreve um arquivo atomicamente: tmp no mesmo diretório + rename. */
async function writeAtomic(file, text) {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  tmpSeq = (tmpSeq + 1) % 1_000_000;
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${tmpSeq}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

/** Faz parse de uma linha JSON de evento (a primeira não vazia). */
export function parseEventLine(text) {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== "");
  if (!line) return { ok: false, error: "evento vazio" };
  try {
    return { ok: true, event: JSON.parse(line) };
  } catch {
    return { ok: false, error: "evento corrompido (JSON inválido)" };
  }
}

/* ------------------------------------------------------------------ */
/* Cursor persistido                                                   */
/* ------------------------------------------------------------------ */

/** Caminho do arquivo de cursor. */
function cursorPath(dir) {
  return join(dir, EVENTS_CURSOR_FILE);
}

/**
 * Lê o cursor (conjunto de nomes já processados).
 * NUNCA lança: ausente -> vazio; corrompido -> `{ ok:false }`.
 */
async function readCursor(dir) {
  const raw = await readFile(cursorPath(dir), "utf8").catch(() => null);
  if (raw == null) return { ok: true, processed: new Set() };
  if (raw.trim() === "") return { ok: true, processed: new Set() };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "events: cursor corrompido (JSON inválido)" };
  }
  const list = parsed && Array.isArray(parsed.processed) ? parsed.processed : [];
  return { ok: true, processed: new Set(list.map(String)) };
}

/** Grava o cursor atomicamente. */
async function writeCursor(dir, processed, at) {
  const doc = {
    version: EVENTS_CURSOR_VERSION,
    updatedAt: at,
    processed: [...processed].sort(),
  };
  await writeAtomic(cursorPath(dir), JSON.stringify(doc, null, 2) + "\n");
}

/* ------------------------------------------------------------------ */
/* emitEvent                                                           */
/* ------------------------------------------------------------------ */

/**
 * Grava um evento como arquivo JSONL (uma linha JSON) na pasta de eventos.
 *
 * @param {object} p
 * @param {string} p.dir      pasta de eventos (default `.pi/harness/events`)
 * @param {string} p.type     tipo do evento (obrigatório)
 * @param {*}      [p.payload] carga do evento (qualquer JSON-serializável)
 * @param {string} [p.at]     instante ISO (default now())
 * @param {string} [p.id]     id do evento (default randomUUID)
 * @param {Function} [p.now]  relógio injetável
 * @returns {Promise<{ ok: boolean, event?: object, file?: string, error?: string }>}
 */
export async function emitEvent({ dir, type, payload = null, at, id, now } = {}) {
  const kind = String(type ?? "").trim();
  if (!kind) return { ok: false, error: "events: `type` vazio" };

  const baseDir = dir || defaultEventsDir();
  const atIso = typeof at === "string" && at.trim() !== ""
    ? at
    : (typeof now === "function" ? now().toISOString() : new Date().toISOString());
  const eventId = typeof id === "string" && id.trim() !== "" ? id : randomUUID();

  const event = { id: eventId, type: kind, payload, at: atIso };

  // Nome único e ordenável: carimbo ISO (sem `:`/`.`) + slug + seq + sufixo curto.
  const stamp = atIso.replace(/[:.]/g, "-");
  tmpSeq = (tmpSeq + 1) % 1_000_000;
  const rand = randomUUID().replace(/-/g, "").slice(0, 8);
  const name = `${stamp}-${slugifyEventType(kind)}-${tmpSeq}-${rand}${EVENT_SUFFIX}`;
  const file = join(baseDir, name);

  const res = await writeAtomic(file, JSON.stringify(event) + "\n").then(
    () => ({ ok: true }),
    (err) => ({ ok: false, error: `events: falha ao gravar: ${String(err?.message ?? err)}` }),
  );
  return res.ok ? { ok: true, event, file } : res;
}

/* ------------------------------------------------------------------ */
/* watchEvents                                                         */
/* ------------------------------------------------------------------ */

/**
 * Observa a pasta de eventos e entrega cada arquivo novo ao `onEvent`, com
 * deduplicação por nome e cursor persistido (sobrevive a restart).
 *
 * Um "round" varre a pasta uma vez. O loop repete a cada `intervalMs` até
 * `shouldStop()` (ou `maxRounds`) — em produção isso é um watcher contínuo; em
 * teste, `sleep`/`now` falsos e `maxRounds` tornam tudo determinístico.
 *
 * @param {object} p
 * @param {string} p.dir          pasta de eventos (default `.pi/harness/events`)
 * @param {Function} p.onEvent    callback(event) por arquivo novo
 * @param {number} [p.intervalMs=1000]  espera entre rounds
 * @param {Function} [p.now]      relógio (default new Date)
 * @param {Function} [p.sleep]    sono injetável (default setTimeout)
 * @param {Function} [p.shouldStop] default () => false
 * @param {number} [p.maxRounds]  teto de rounds (default Infinity)
 * @returns {Promise<{ ok: boolean, rounds?: number, delivered?: number,
 *   errors?: Array, skipped?: Array, error?: string }>}
 */
export async function watchEvents({
  dir,
  onEvent,
  intervalMs = 1000,
  now = () => new Date(),
  sleep = defaultSleep,
  shouldStop = () => false,
  maxRounds = Infinity,
} = {}) {
  if (typeof onEvent !== "function") {
    return { ok: false, error: "events: `onEvent` precisa ser função" };
  }
  const baseDir = dir || defaultEventsDir();
  await mkdir(baseDir, { recursive: true }).catch(() => {});

  // Cursor do disco: sobrevive a restart (não redelivra o já entregue).
  const cur = await readCursor(baseDir);
  if (!cur.ok) return cur;
  const processed = cur.processed;

  const errors = [];
  const skipped = [];
  let delivered = 0;
  let rounds = 0;

  const scanOnce = async () => {
    let changed = false;
    const names = (await readdir(baseDir).catch(() => []))
      .filter(isEventFile)
      .sort();

    for (const name of names) {
      if (processed.has(name)) continue;

      const text = await readFile(join(baseDir, name), "utf8").catch(() => null);
      const parsed = text == null ? { ok: false, error: "arquivo não pôde ser lido" } : parseEventLine(text);
      if (!parsed.ok) {
        // Arquivo ilegível: marca como processado (evita retry infinito) e registra.
        processed.add(name);
        changed = true;
        skipped.push({ name, reason: parsed.error });
        continue;
      }

      try {
        await onEvent(parsed.event);
        delivered += 1;
      } catch (err) {
        // Falha do consumidor: marca como processado (entrega é "no máximo uma
        // vez") e registra o erro, sem derrubar o watcher.
        errors.push({ name, error: String(err?.message ?? err) });
      }
      processed.add(name);
      changed = true;
    }
    return changed;
  };

  while (true) {
    const changed = await scanOnce();
    if (changed) await writeCursor(baseDir, processed, now().toISOString());
    rounds += 1;

    if (Number.isFinite(maxRounds) && rounds >= maxRounds) break;
    if (shouldStop()) break;

    await sleep(intervalMs);
    if (shouldStop()) break;
  }

  return { ok: true, rounds, delivered, errors, skipped };
}

/* ------------------------------------------------------------------ */
/* runForgeOnEvent                                                     */
/* ------------------------------------------------------------------ */

/** Resolve o handler de um tipo (Map ou objeto; função ou { run|handle }). */
function resolveHandler(handlers, type) {
  if (handlers instanceof Map) return handlers.get(type) ?? null;
  if (handlers && typeof handlers === "object") return handlers[type] ?? null;
  return null;
}

/** Invoca um handler (função pura, ou objeto com run/handle). */
function invokeHandler(handler, event) {
  if (typeof handler === "function") return handler(event);
  if (handler && typeof handler.run === "function") return handler.run(event);
  if (handler && typeof handler.handle === "function") return handler.handle(event);
  throw new Error("handler inválido (esperado função ou { run|handle })");
}

/**
 * Mapeia o tipo do evento para a ação registrada e a executa. Não conhece o
 * Forge por dentro: só consulta o registro de handlers recebido.
 *
 * @param {object} event   { type, payload, ... }
 * @param {Map|object} handlers  registro type -> função | { run|handle }
 * @returns {Promise<{ ok: boolean, type: string, handled: boolean,
 *   action?: *, error?: string }>}
 */
export async function runForgeOnEvent(event, handlers) {
  const type = event && typeof event.type === "string" ? event.type.trim() : "";
  if (!type) return { ok: false, type: "", handled: false, error: "events: evento sem `type`" };

  const handler = resolveHandler(handlers, type);
  if (!handler) return { ok: true, type, handled: false };

  try {
    const action = await invokeHandler(handler, event);
    return { ok: true, type, handled: true, action };
  } catch (err) {
    return { ok: false, type, handled: true, error: String(err?.message ?? err) };
  }
}

export default {
  emitEvent,
  watchEvents,
  runForgeOnEvent,
  parseEventLine,
  defaultEventsDir,
  slugifyEventType,
  EVENTS_CURSOR_VERSION,
  EVENTS_CURSOR_FILE,
};