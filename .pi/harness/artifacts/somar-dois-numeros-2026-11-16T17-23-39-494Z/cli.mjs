import { exit } from "node:process";

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 2) {
  const key = argv[i].replace(/^--/, "");
  args[key] = argv[i + 1];
}

if (args.a === undefined || args.b === undefined) {
  process.exitCode = 2;
  exit();
}

const a = Number(args.a);
const b = Number(args.b);

console.log(JSON.stringify({ soma: a + b }));
