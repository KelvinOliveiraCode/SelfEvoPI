const args = process.argv.slice(2);
const params = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  const val = args[i + 1];
  if (key.startsWith('--')) params[key.slice(2)] = val;
}

if (!params.peso || !params.altura) {
  process.exitCode = 2;
  console.log(JSON.stringify({ ok: false, erro: 'peso e altura sao obrigatorios' }));
  process.exit();
}

const peso = Number(params.peso);
const altura = Number(params.altura);

if (!Number.isFinite(peso) || !Number.isFinite(altura) || peso <= 0 || altura <= 0) {
  process.exitCode = 2;
  console.log(JSON.stringify({ ok: false, erro: 'peso e altura devem ser numeros positivos' }));
  process.exit();
}

const imc = peso / (altura * altura);
let classificacao;
if (imc < 18.5) classificacao = 'Abaixo do peso';
else if (imc < 25) classificacao = 'Peso normal';
else if (imc < 30) classificacao = 'Sobrepeso';
else if (imc < 35) classificacao = 'Obesidade grau 1';
else if (imc < 40) classificacao = 'Obesidade grau 2';
else classificacao = 'Obesidade grau 3';

console.log(JSON.stringify({ imc: Number(imc.toFixed(2)), classificacao }));
