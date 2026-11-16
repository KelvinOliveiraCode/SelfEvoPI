export default function(pi) {
  pi.registerCommand('soma', {
    description: 'Soma dois números',
    handler: async (args, ctx) => {
      const a = Number(args.a);
      const b = Number(args.b);
      if (Number.isNaN(a) || Number.isNaN(b)) {
        ctx.ui.notify('Erro: --a e --b devem ser números', 'error');
        return;
      }
      const resultado = a + b;
      console.log(JSON.stringify({ soma: resultado }));
    }
  });
}
