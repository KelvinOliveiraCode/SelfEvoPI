import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const rl = createInterface({ input: stdin, output: stdout, terminal: false });

const tools = [
  {
    name: 'soma',
    description: 'Soma dois números',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'Primeiro número' },
        b: { type: 'number', description: 'Segundo número' }
      },
      required: ['a', 'b']
    }
  }
];

function respond(id, result) {
  stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function error(id, code, message) {
  stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

rl.on('line', line => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return error(null, -32700, 'Parse error');
  }

  const { id, method, params } = req;

  switch (method) {
    case 'initialize': {
      respond(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'soma-server', version: '1.0.0' }
      });
      break;
    }
    case 'tools/list': {
      respond(id, { tools });
      break;
    }
    case 'tools/call': {
      const { name, arguments: args } = params || {};
      if (name !== 'soma') return error(id, -32601, 'Tool not found');
      const a = Number(args?.a);
      const b = Number(args?.b);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return error(id, -32602, 'Invalid arguments');
      respond(id, { content: [{ type: 'text', text: String(a + b) }] });
      break;
    }
    default:
      error(id, -32601, 'Method not found');
  }
});
