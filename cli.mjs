import { readFileSync } from 'fs';

const args = process.argv.slice(2);
let arquivo = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--arquivo' && i + 1 < args.length) {
    arquivo = args[i + 1];
    break;
  }
}

if (!arquivo) {
  process.exitCode = 2;
  console.log(JSON.stringify({ ok: false, erro: 'argumento --arquivo obrigatório' }));
  process.exit(2);
}

let html;
try {
  html = readFileSync(arquivo, 'utf8');
} catch (e) {
  process.exitCode = 2;
  console.log(JSON.stringify({ ok: false, erro: 'erro ao ler arquivo: ' + e.message }));
  process.exit(2);
}

const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
if (!tableMatch) {
  console.log(JSON.stringify({ linhas: [] }));
  process.exit(0);
}

const tableContent = tableMatch[1];
const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

const linhas = [];
let rowMatch;
while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
  const rowContent = rowMatch[1];
  const cells = [];
  let cellMatch;
  while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
    let text = cellMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    text = text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'");
    cells.push(text);
  }
  if (cells.length > 0) {
    linhas.push(cells);
  }
}

console.log(JSON.stringify({ linhas }));