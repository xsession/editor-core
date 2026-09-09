import process from 'node:process';

let input = '';
for await (const chunk of process.stdin)
  input += chunk;
const request = JSON.parse(input || '{}');

async function elkLayout() {
  const mod = await import('elkjs');
  const ELK = mod.default ?? mod.ELK ?? mod;
  const elk = new ELK(request.constructorOptions);
  return elk.layout(request.graph, request.layoutCallOptions);
}

async function libavoidRoute() {
  const mod = await import('@mr_mint/elkjs-libavoid');
  await mod.init?.(request.wasmPath);
  const routes = await mod.routeEdges(request.graph, request.options ?? {});
  return Object.fromEntries([...routes.entries()]);
}

try {
  const result = request.action === 'elk-layout'
    ? await elkLayout()
    : request.action === 'libavoid-route'
      ? await libavoidRoute()
      : (() => { throw new Error(`Unknown action: ${request.action}`); })();
  process.stdout.write(JSON.stringify({ ok: true, result }));
}
catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: { name: error?.name, message: error?.message, stack: error?.stack } }));
  process.exitCode = 1;
}
