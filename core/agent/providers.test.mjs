import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';

import {
  listProviders,
  addProvider,
  removeProvider,
  fetchModels,
  ProviderError,
} from './providers.mjs';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const homes = [];

async function novoHome() {
  const dir = await mkdtemp(path.join(tmpdir(), 'selfevopi-providers-'));
  homes.push(dir);
  return dir;
}

/** Escreve um models.json mínimo no home. */
async function escreverModels(home, doc) {
  const dir = path.join(home, '.pi', 'agent');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'models.json');
  await writeFile(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return file;
}

function modelsPath(home) {
  return path.join(home, '.pi', 'agent', 'models.json');
}
function authPath(home) {
  return path.join(home, '.pi', 'agent', 'auth.json');
}

test.after(() => {
  // Limpa os homes temporários.
  for (const h of homes) rm(h, { recursive: true, force: true }).catch(() => {});
});

/* ------------------------------------------------------------------ */
/* listProviders                                                       */
/* ------------------------------------------------------------------ */

test('listProviders: arquivo ausente devolve []', async () => {
  const home = await novoHome();
  const lista = await listProviders({ home });
  assert.deepEqual(lista, []);
});

test('listProviders: lê providers e devolve models como [string], sem chave', async () => {
  const home = await novoHome();
  await escreverModels(home, {
    providers: {
      kilo4: {
        name: 'K4',
        baseUrl: 'https://api.example.com/v1',
        api: 'openai-completions',
        apiKey: 'SECRET-KEY',
        models: [{ id: 'model-a' }, { id: 'model-b' }],
      },
      p2: { baseUrl: 'https://x/v1', models: ['m1', 'm2'] },
    },
  });
  const lista = await listProviders({ home });
  assert.equal(lista.length, 2);
  const k4 = lista.find((p) => p.id === 'kilo4');
  assert.ok(k4);
  assert.equal(k4.baseUrl, 'https://api.example.com/v1');
  assert.deepEqual(k4.models, ['model-a', 'model-b']);
  // NUNCA devolve apiKey
  assert.equal(k4.apiKey, undefined);
  assert.equal(JSON.stringify(lista).includes('SECRET-KEY'), false);
});

test('listProviders: ordena por id', async () => {
  const home = await novoHome();
  await escreverModels(home, {
    providers: { b: { baseUrl: 'u', models: [] }, a: { baseUrl: 'u', models: [] }, c: { baseUrl: 'u', models: [] } },
  });
  const lista = await listProviders({ home });
  assert.deepEqual(lista.map((p) => p.id), ['a', 'b', 'c']);
});

/* ------------------------------------------------------------------ */
/* addProvider                                                         */
/* ------------------------------------------------------------------ */

test('addProvider: grava provider novo e não devolve a chave', async () => {
  const home = await novoHome();
  const r = await addProvider({
    home,
    id: 'novo',
    baseUrl: 'https://api.novo.com/v1',
    apiKey: 'CHAVE-SECRETA-123',
    models: ['m1', 'm2'],
  });
  assert.equal(r.id, 'novo');
  assert.equal(r.apiKeyRedacted, '***');
  assert.equal(JSON.stringify(r).includes('CHAVE-SECRETA-123'), false, 'resultado não pode conter a chave');

  // models.json foi escrito com a chave (formato nativo) e a lista não a expõe
  const raw = await readFile(modelsPath(home), 'utf8');
  const doc = JSON.parse(raw);
  assert.equal(doc.providers.novo.apiKey, 'CHAVE-SECRETA-123');
  const lista = await listProviders({ home });
  const novo = lista.find((p) => p.id === 'novo');
  assert.deepEqual(novo.models, ['m1', 'm2']);
  assert.equal(novo.apiKey, undefined);
});

test('addProvider: atualiza provider existente (idempotente) preservando extras', async () => {
  const home = await novoHome();
  await addProvider({ home, id: 'p', baseUrl: 'https://u1/v1', apiKey: 'k1', models: ['a'], name: 'Original' });
  // Segunda chamada sem name/api preserva name e api; troca baseUrl e models.
  await addProvider({ home, id: 'p', baseUrl: 'https://u2/v1', models: ['b', 'c'] });
  const lista = await listProviders({ home });
  const p = lista.find((x) => x.id === 'p');
  assert.equal(p.baseUrl, 'https://u2/v1');
  assert.deepEqual(p.models, ['b', 'c']);
  const doc = JSON.parse(await readFile(modelsPath(home), 'utf8'));
  assert.equal(doc.providers.p.name, 'Original', 'name preservado');
  assert.equal(doc.providers.p.apiKey, 'k1', 'chave preservada quando não fornecida');
});

test('addProvider: espelha a chave no auth.json', async () => {
  const home = await novoHome();
  await addProvider({ home, id: 'p', baseUrl: 'https://u/v1', apiKey: 'ESPELHO-1', models: [] });
  const auth = JSON.parse(await readFile(authPath(home), 'utf8'));
  assert.equal(auth.p, 'ESPELHO-1');
});

test('addProvider: exige id e baseUrl', async () => {
  const home = await novoHome();
  await assert.rejects(() => addProvider({ home, baseUrl: 'u', apiKey: 'k' }), { code: 'missing-id' });
  await assert.rejects(() => addProvider({ home, id: 'p', apiKey: 'k' }), { code: 'missing-baseUrl' });
});

/* ------------------------------------------------------------------ */
/* removeProvider                                                      */
/* ------------------------------------------------------------------ */

test('removeProvider: remove do models.json e do auth.json', async () => {
  const home = await novoHome();
  await addProvider({ home, id: 'p', baseUrl: 'https://u/v1', apiKey: 'K', models: ['m'] });
  const r = await removeProvider({ home, id: 'p' });
  assert.equal(r.removed, true);
  const lista = await listProviders({ home });
  assert.equal(lista.find((x) => x.id === 'p'), undefined);
  const auth = JSON.parse(await readFile(authPath(home), 'utf8'));
  assert.equal(auth.p, undefined);
});

test('removeProvider: id inexistente devolve removed:false e não lança', async () => {
  const home = await novoHome();
  const r = await removeProvider({ home, id: 'fantasma' });
  assert.equal(r.removed, false);
});

/* ------------------------------------------------------------------ */
/* fetchModels (mockado — sem rede real)                               */
/* ------------------------------------------------------------------ */

test('fetchModels: GET {baseUrl}/v1/models devolve [{ id }]', async () => {
  let chamado = null;
  const fetchMock = async (url, opts) => {
    chamado = { url, opts };
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ data: [{ id: 'm2' }, { id: 'm1' }, { id: 'm3' }] }) };
  };
  const out = await fetchModels({ baseUrl: 'https://api.x.com/v1', apiKey: 'k', fetchImpl: fetchMock });
  assert.deepEqual(out, [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]);
  // endpoint correto (baseUrl sem /v1 -> /v1/models)
  assert.equal(chamado.url, 'https://api.x.com/v1/models');
  // header de autorização presente
  assert.equal(chamado.opts.headers.Authorization, 'Bearer k');
});

test('fetchModels: baseUrl que já termina em /v1 não duplica o segmento', async () => {
  let chamado = null;
  const fetchMock = async (url, opts) => {
    chamado = { url };
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'm1' }] }) };
  };
  const out = await fetchModels({ baseUrl: 'https://gateway.example.com/api/v1', fetchImpl: fetchMock });
  assert.equal(chamado.url, 'https://gateway.example.com/api/v1/models');
  assert.deepEqual(out, [{ id: 'm1' }]);
});

test('fetchModels: aceita body como array puro', async () => {
  const fetchMock = async () => ({ ok: true, status: 200, json: async () => [{ id: 'a' }, { id: 'b' }] });
  const out = await fetchModels({ baseUrl: 'https://x/v1', fetchImpl: fetchMock });
  assert.deepEqual(out, [{ id: 'a' }, { id: 'b' }]);
});

test('fetchModels: erro HTTP vira ProviderError code "http" sem ecoar a chave', async () => {
  const fetchMock = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) });
  await assert.rejects(
    () => fetchModels({ baseUrl: 'https://x/v1', apiKey: 'SUPER-SECRET', fetchImpl: fetchMock }),
    (err) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.code, 'http');
      assert.equal(String(err.message).includes('SUPER-SECRET'), false, 'erro não pode conter a chave');
      return true;
    },
  );
});

test('fetchModels: falha de rede vira ProviderError code "network"', async () => {
  const fetchMock = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    () => fetchModels({ baseUrl: 'https://x/v1', apiKey: 'k', fetchImpl: fetchMock }),
    { code: 'network' },
  );
});

test('fetchModels: resposta não-JSON vira ProviderError code "bad-json"', async () => {
  const fetchMock = async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } });
  await assert.rejects(
    () => fetchModels({ baseUrl: 'https://x/v1', fetchImpl: fetchMock }),
    { code: 'bad-json' },
  );
});

test('fetchModels: timeout aborta e vira ProviderError code "timeout"', async () => {
  const fetchMock = (url, opts) => new Promise((_res, rej) => {
    opts.signal.addEventListener('abort', () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      rej(e);
    });
  });
  await assert.rejects(
    () => fetchModels({ baseUrl: 'https://x/v1', timeoutMs: 50, fetchImpl: fetchMock }),
    { code: 'timeout' },
  );
});

/* ------------------------------------------------------------------ */
/* Segurança — chave nunca aparece                                     */
/* ------------------------------------------------------------------ */

test('nenhuma saída pública contém a chave', async () => {
  const home = await novoHome();
  const CHAVE = 'CHAVE-ULTRA-SECRETA-XYZ';
  await addProvider({ home, id: 'p', baseUrl: 'https://u/v1', apiKey: CHAVE, models: ['m'] });
  const lista = await listProviders({ home });
  assert.equal(JSON.stringify(lista).includes(CHAVE), false);
  const r = await addProvider({ home, id: 'p2', baseUrl: 'https://u/v1', apiKey: CHAVE, models: [] });
  assert.equal(JSON.stringify(r).includes(CHAVE), false);
  // removeProvider não devolve a chave
  const rm = await removeProvider({ home, id: 'p' });
  assert.equal(JSON.stringify(rm).includes(CHAVE), false);
});