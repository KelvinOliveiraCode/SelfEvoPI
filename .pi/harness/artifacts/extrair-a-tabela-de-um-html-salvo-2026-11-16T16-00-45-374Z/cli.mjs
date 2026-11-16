import { readFileSync } from 'fs';

const args = process.argv.slice(2);
let arquivo = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--arquivo' && i + 1 < args.length) {
    arquivo = args[++i];
  }
}

if (!arquivo) {
  process.exitCode = 2;
  console.log(JSON.stringify({ ok: false, erro: 'argumento --arquivo obrigatório' }));
  process.exit();
}

let conteudo;
try {
  conteudo = readFileSync(arquivo, 'utf8');
} catch (e) {
  process.exitCode = 2;
  console.log(JSON.stringify({ ok: false, erro: `falha ao ler arquivo: ${e.message}` }));
  process.exit();
}

function extrairTabelaHTML(html) {
  const linhas = [];
  const regexLinha = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = regexLinha.exec(html)) !== null) {
    const celulas = [];
    const regexCelula = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let matchCelula;
    while ((matchCelula = regexCelula.exec(match[1])) !== null) {
      const texto = matchCelula[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      celulas.push(texto);
    }
    if (celulas.length > 0) linhas.push(celulas);
  }
  return linhas;
}

function extrairCSV(texto) {
  return texto.trim().split('\n').map(l => l.split(',').map(c => c.trim()));
}

let linhas;
if (conteudo.includes('<table') || conteudo.includes('<tr') || conteudo.includes('<td') || conteudo.includes('<th')) {
  linhas = extrairTabelaHTML(conteudo);
} else {
  linhas = extrairCSV(conteudo);
}

console.log(JSON.stringify({ linhas }));
