import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--')) {
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        args[key.slice(2)] = value;
        i++;
      } else {
        args[key.slice(2)] = true;
      }
    }
  }
  return args;
}

function validateJson(jsonString) {
  try {
    JSON.parse(jsonString);
    return { valido: true, erros: [] };
  } catch (e) {
    return { valido: false, erros: [e.message] };
  }
}

function main() {
  const args = parseArgs(process.argv);
  const arquivo = args.arquivo;

  if (!arquivo) {
    console.error(JSON.stringify({ valido: false, erros: ['argumento --arquivo obrigatório'] }));
    process.exitCode = 2;
    return;
  }

  const filePath = resolve(__dirname, arquivo);
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(JSON.stringify({ valido: false, erros: [`erro ao ler arquivo: ${e.message}`] }));
    process.exitCode = 1;
    return;
  }

  const result = validateJson(content);
  console.log(JSON.stringify(result));
  if (!result.valido) process.exitCode = 1;
}

main();