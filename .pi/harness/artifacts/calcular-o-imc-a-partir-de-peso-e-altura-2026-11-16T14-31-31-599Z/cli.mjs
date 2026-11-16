const args = process.argv.slice(2);

if (args.length < 2) {
  process.exitCode = 2;
  console.log(JSON.stringify({ ok: false, erro: "peso e altura são obrigatórios" }));
  process.exit();
}

const peso = Number(args[0]);
const altura = Number(args[1]);

if (Number.isNaN(peso) || Number.isNaN(altura) || peso <= 0 || altura <= 0) {
  process.exitCode = 2;
  console.log(JSON.stringify({ ok: false, erro: "peso e altura devem ser números positivos" }));
  process.exit();
}

const imc = peso / (altura * altura);
console.log(JSON.stringify({ ok: true, imc: Number(imc.toFixed(2)) }));
