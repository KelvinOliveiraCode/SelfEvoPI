# Painel do Grafo (Fase 3)

O painel mostra o grafo de execução em tempo real: nós coloridos por estado,
dependências como galhos, e o nó humano que trava a fila. Duas formas de ver a
mesma coisa — terminal (ASCII) e navegador (HTML autocontido).

Arquivos:
- `core/graph/panel.mjs` — `renderAscii` + `renderHtml` (sem dependências)
- `core/graph/panel.test.mjs` — 5 casos com `node:test`

## O que ele mostra

Cada nó aparece com um **símbolo de estado** e uma **cor** (no HTML):

| Símbolo | Estado | Cor (HTML) | Significado |
|:---:|:---|:---|:---|
| ○ | `pending` | cinza | ainda não começou |
| ◐ | `running` | azul | em execução |
| ● | `done` | verde | concluiu; libera dependentes |
| ✗ | `failed` | vermelho | erro; **não** libera dependentes |
| ⏸ | `waiting` | âmbar | parou num nó `human` |
| ⊘ | `blocked` / `skipped` | violeta / cinza | dependência falhou / não alcançado |

A árvore segue `dependsOn` (a aresta real que ordena), não as arestas visuais.
Assim o painel mostra a **estrutura de execução**, que é o que importa.

## ASCII — no terminal

```js
import { createGraph } from "./core/graph/model.mjs";
import { createRuntime } from "./core/graph/runtime.mjs";
import { renderAscii } from "./core/graph/panel.mjs";

const graph = createGraph({ nodes, edges });
const rt = createRuntime({ graph, runNode });

await rt.run();
console.log(renderAscii(graph, rt.status()));
```

Saída (exemplo real, 3 nós em cadeia com um review):

```
grafo run=run-x  checkpoints=2
● t1 (task) [done]
   └─ ● t2 (task) [done]
      └─ ○ r1 (review) [pending]
```

Cabeçalho: `run=<id>`, `⏸ aguardando <id>` quando há nó humano parado, e
`checkpoints=<n>`.

## HTML — no navegador (painel da Fase 3)

`renderHtml(graph, state, { pollUrl? })` devolve uma página **autocontida** (CSS
inline, sem CDN, sem rede). Ela desenha a árvore com o mesmo vocabulário de
símbolos/cores e — se `pollUrl` for informado — atualiza a cada 1,5 s buscando
esse JSON.

```js
import { writeFile } from "node:fs/promises";
import { renderHtml } from "./core/graph/panel.mjs";

const html = renderHtml(graph, rt.status(), { pollUrl: "/state.json" });
await writeFile("docs/fase3/painel.html", html, "utf8");
```

- **Sem `pollUrl`**: mostra o estado do momento (estático).
- **Com `pollUrl`**: faz `fetch(pollUrl)` periódico e redesenha. O `state.json`
  é o que `runtime.status()` devolve — basta gravá-lo no mesmo diretório e
  servi-lo (ou abrir o HTML e apontar o `pollUrl` para a URL do arquivo).

Para abrir: dê dois cliques no `.html` (abre no navegador padrão). Ele é legível
em qualquer resolução e não precisa de servidor para o estado inicial.

### Integração com o runtime (tempo real)

O fluxo mínimo para um painel que acompanha a execução:

1. Crie o runtime com um `runNode` real.
2. Enquanto roda, grave `rt.status()` como JSON (ex.: `state.json`).
3. Abra o HTML com `pollUrl` apontando para esse JSON.

O runtime já persiste checkpoints (`.pi/harness/graph/<runId>.json`); o painel
consome o formato `status()` (compacto: `{ runId, nodes:[{id,status}], waitingFor,
checkpoints }`), que é o mesmo formato dos checkpoints.

## Verificação

```bash
node --test core/graph/panel.test.mjs
```

Grep rápido do painel ASCII:

```bash
node -e "import('./core/graph/panel.mjs').then(async m=>{const {createGraph}=await import('./core/graph/model.mjs');const g=createGraph({nodes:[{id:'a',kind:'task'}],edges:[]});console.log(m.renderAscii(g,{nodes:[{id:'a',status:'done'}]}))})"
```

## Limites (honestos)

- O HTML mostra **topologia + estado**; não é um editor de grafo arrastável.
- Não há animação de arestas pulsando; o "tempo real" vem do polling do JSON.
- É painel de leitura, não de escrita: quem manda no fluxo é o `runtime`.