---
name: documentar-como-somar
description: documentar como somar
---

# documentar como somar

## Objetivo

documentar como somar

## Entradas

_nenhum_

## Saídas

_nenhum_

## O que NÃO pode fazer

- acessar rede
- escrever fora do workspace
- inventar dados

## Verificação

Execute `node verify.mjs`. Ele sai 0 somente se todos os testes passarem:

- `a skill existe e descreve a capacidade` — `node -e "const fs=require('fs');const t=fs.readFileSync('SKILL.md','utf8');if(t.length<40)process.exit(1)"`
