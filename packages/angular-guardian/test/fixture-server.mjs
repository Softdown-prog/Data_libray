import { createServer } from 'node:http';
const port = 4783;
const html = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><title>Guardian Fixture</title></head>
<body><main id="ready">Carregado</main><button id="open" type="button">Abrir</button>
<section id="panel" hidden>Estoque aberto</section>
<script>document.querySelector('#open').addEventListener('click', () => { document.querySelector('#panel').hidden = false; });</script>
</body></html>`;
createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (req.url !== '/') { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(port, '127.0.0.1', () => console.log(`fixture listening on 127.0.0.1:${port}`));
