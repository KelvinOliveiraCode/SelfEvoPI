/**
 * modes-data.js — os modos e as permissoes, congelados para o browser.
 *
 * GERADO a partir de core/governance/modes.mjs. Nao edite a mao:
 * apps/desktop/modes-data.test.mjs compara este arquivo com o core e falha
 * se divergirem.
 */
export const MODE_NAMES = ["plan","build","manual","ask","goal"];

export const MODES = {
  "plan": {
    "name": "plan",
    "canRead": true,
    "canWrite": false,
    "canExec": true,
    "execScope": "readonly",
    "ask": "write",
    "base": null,
    "nota": "lê, roda leitura, propõe; não escreve"
  },
  "build": {
    "name": "build",
    "canRead": true,
    "canWrite": true,
    "canExec": true,
    "execScope": "workspace",
    "ask": "outside-workspace",
    "base": null,
    "nota": "escreve e executa no workspace; fora dele, pausa"
  },
  "manual": {
    "name": "manual",
    "canRead": true,
    "canWrite": true,
    "canExec": true,
    "execScope": "workspace",
    "ask": "write",
    "base": null,
    "nota": "como build, mas confirma cada escrita dentro do workspace"
  },
  "ask": {
    "name": "ask",
    "canRead": true,
    "canWrite": false,
    "canExec": false,
    "execScope": "none",
    "ask": null,
    "base": null,
    "nota": "responde sobre o código e nunca toca em disco"
  },
  "goal": {
    "name": "goal",
    "canRead": true,
    "canWrite": true,
    "canExec": true,
    "execScope": "inherit",
    "ask": "outside-workspace",
    "base": "build",
    "nota": "não muda permissão; acrescenta uma condição de conclusão verificada por avaliador separado"
  }
};

export const PERMS = {
  "plan": {
    "mode": "plan",
    "label": "Leitura apenas",
    "summary": "lê e consulta, propõe um plano e não escreve até você aprovar",
    "canRead": true,
    "canWrite": false,
    "canExec": true,
    "execScope": "readonly",
    "asks": [
      {
        "trigger": "write",
        "question": "A escrita não é permitida aqui. Aprovar o plano ou trocar para build?"
      },
      {
        "trigger": "exec",
        "question": "Este comando não é comprovadamente de leitura. Executar mesmo assim?"
      }
    ]
  },
  "build": {
    "mode": "build",
    "label": "Aceita edições",
    "summary": "lê, escreve e executa dentro do workspace; fora dele, pede",
    "canRead": true,
    "canWrite": true,
    "canExec": true,
    "execScope": "workspace",
    "asks": [
      {
        "trigger": "outside-workspace",
        "question": "Qual caminho fora do workspace precisa ser escrito, e por quê?"
      },
      {
        "trigger": "approval",
        "question": "O artefato mexe em rede, credencial ou caminho externo. Aprovar?"
      }
    ]
  },
  "manual": {
    "mode": "manual",
    "label": "Confirma cada escrita",
    "summary": "faz o que o build faz, mas confirma cada escrita antes de aplicá-la",
    "canRead": true,
    "canWrite": true,
    "canExec": true,
    "execScope": "workspace",
    "asks": [
      {
        "trigger": "write",
        "question": "Confirmar esta escrita dentro do workspace?"
      },
      {
        "trigger": "approval",
        "question": "O artefato mexe em rede, credencial ou caminho externo. Aprovar?"
      }
    ]
  },
  "ask": {
    "mode": "ask",
    "label": "Consulta apenas",
    "summary": "lê e responde sobre o código; não escreve nem executa",
    "canRead": true,
    "canWrite": false,
    "canExec": false,
    "execScope": "none",
    "asks": [
      {
        "trigger": "write",
        "question": "Este modo não escreve. Trocar para build?"
      },
      {
        "trigger": "exec",
        "question": "Este modo não executa. Trocar para build?"
      }
    ]
  },
  "goal": {
    "mode": "goal",
    "label": "Aceita edições",
    "summary": "lê, escreve e executa dentro do workspace; fora dele, pede",
    "canRead": true,
    "canWrite": true,
    "canExec": true,
    "execScope": "workspace",
    "asks": [
      {
        "trigger": "outside-workspace",
        "question": "Qual caminho fora do workspace precisa ser escrito, e por quê?"
      },
      {
        "trigger": "approval",
        "question": "O artefato mexe em rede, credencial ou caminho externo. Aprovar?"
      }
    ]
  }
};

export function describePermissions(opts) {
  const mode = opts && opts.mode;
  return PERMS[mode] || PERMS.build;
}
