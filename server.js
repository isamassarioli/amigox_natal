'use strict';
/* Amigo secreto da família: servidor sem dependências (só Node 18+). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'familia.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(6).toString('hex');
  console.log('ATENCAO: ADMIN_PASSWORD nao foi definida. Senha temporaria desta execucao: ' + ADMIN_PASSWORD);
}

/* ---------- dados ---------- */
function novo() {
  return {
    versao: 1,
    familia: 'Santos',
    ano: 2026,
    evento: { data: '2026-12-24T20:00', local: '', valorSugerido: 80 },
    participantes: [],
    exclusoes: [],
    sorteio: { realizado: false, realizadoEm: null, pares: {} },
    erros: [],
    segredo: crypto.randomBytes(32).toString('hex')
  };
}
function normalizar(o) {
  const n = novo();
  const r = Object.assign(n, o);
  r.evento = Object.assign(n.evento, o.evento || {});
  r.sorteio = Object.assign({ realizado: false, realizadoEm: null, pares: {} }, o.sorteio || {});
  r.participantes = (Array.isArray(o.participantes) ? o.participantes : []).map(function (p) {
    return {
      id: String(p.id), nome: String(p.nome), gostos: String(p.gostos || ''),
      token: p.token || null, escolhidoEm: p.escolhidoEm || null, viuEm: p.viuEm || null
    };
  });
  r.exclusoes = (Array.isArray(o.exclusoes) ? o.exclusoes : []).filter(function (e) { return Array.isArray(e) && e.length === 2; });
  r.erros = Array.isArray(o.erros) ? o.erros : [];
  return r;
}
function gravar(o) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function ler() {
  let txt;
  try { txt = fs.readFileSync(DATA_FILE, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') console.error('Erro lendo dados:', e.message);
    const n = novo(); gravar(n); return n;
  }
  try { return normalizar(JSON.parse(txt)); }
  catch (e) {
    const bak = DATA_FILE + '.corrompido-' + Date.now();
    fs.renameSync(DATA_FILE, bak);
    console.error('Arquivo de dados corrompido. Copia guardada em ' + bak);
    const n = novo(); gravar(n); return n;
  }
}
let db = ler();
function salvar() { gravar(db); }
function idCurto() { return 'p' + crypto.randomBytes(4).toString('hex'); }
function registrarErro(p, mensagem) {
  db.erros.push({
    id: 'e' + crypto.randomBytes(4).toString('hex'),
    em: new Date().toISOString(),
    participanteId: p ? p.id : null,
    nome: p ? p.nome : null,
    mensagem: String(mensagem).slice(0, 500),
    resolvido: false
  });
  if (db.erros.length > 200) db.erros = db.erros.slice(-200);
  salvar();
}
function invalidarSorteio() {
  db.sorteio = { realizado: false, realizadoEm: null, pares: {} };
  db.participantes.forEach(function (p) { p.viuEm = null; });
}

/* ---------- utilidades http ---------- */
function resp(res, codigo, obj, extra) {
  const corpo = JSON.stringify(obj);
  res.writeHead(codigo, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, extra || {}));
  res.end(corpo);
}
function erro(res, codigo, chave, msg) { resp(res, codigo, { erro: chave, mensagem: msg || chave }); }
function lerCorpo(req, limite) {
  return new Promise(function (ok, falha) {
    let tam = 0; const partes = [];
    req.on('data', function (c) {
      tam += c.length;
      if (tam > (limite || 100000)) { falha(Object.assign(new Error('grande'), { codigo: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', function () {
      if (!partes.length) return ok({});
      try { ok(JSON.parse(Buffer.concat(partes).toString('utf8'))); }
      catch (e) { falha(Object.assign(new Error('json'), { codigo: 400 })); }
    });
    req.on('error', falha);
  });
}
function cookies(req) {
  const o = {};
  String(req.headers.cookie || '').split(';').forEach(function (par) {
    const i = par.indexOf('=');
    if (i > 0) o[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  });
  return o;
}
function ip(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'x';
}
const janelas = new Map();
function limitar(chave, max, ms) {
  const agora = Date.now();
  const lista = (janelas.get(chave) || []).filter(function (t) { return agora - t < ms; });
  if (lista.length >= max) { janelas.set(chave, lista); return false; }
  lista.push(agora); janelas.set(chave, lista); return true;
}
setInterval(function () {
  const agora = Date.now();
  janelas.forEach(function (lista, k) {
    const f = lista.filter(function (t) { return agora - t < 3600000; });
    if (f.length) janelas.set(k, f); else janelas.delete(k);
  });
}, 600000).unref();

/* ---------- sessão do administrador ---------- */
function assinar(v) { return crypto.createHmac('sha256', db.segredo).update(v).digest('hex'); }
function criarSessao() { const v = String(Date.now() + 7 * 864e5); return v + '.' + assinar(v); }
function sessaoValida(req) {
  const c = cookies(req).adm;
  if (!c) return false;
  const partes = c.split('.');
  if (partes.length !== 2) return false;
  const a = Buffer.from(partes[1]), b = Buffer.from(assinar(partes[0]));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(partes[0]) > Date.now();
}
function senhaCerta(s) {
  const a = crypto.createHash('sha256').update(String(s)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
function seguro(req) { return req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted; }

/* ---------- sorteio ---------- */
function embaralhar(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function calcularPares() {
  const ids = db.participantes.map(function (p) { return p.id; });
  if (ids.length < 3) return false;
  const bloq = {};
  db.exclusoes.forEach(function (x) { bloq[x[0] + '>' + x[1]] = 1; bloq[x[1] + '>' + x[0]] = 1; });
  for (let t = 0; t < 30000; t++) {
    const arr = embaralhar(ids.slice());
    let ok = true;
    for (let i = 0; i < arr.length; i++) {
      if (bloq[arr[i] + '>' + arr[(i + 1) % arr.length]]) { ok = false; break; }
    }
    if (ok) {
      const m = {};
      for (let k = 0; k < arr.length; k++) m[arr[k]] = arr[(k + 1) % arr.length];
      return m;
    }
  }
  return null;
}

/* ---------- visões ---------- */
function estadoPublico() {
  const lista = db.participantes.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return {
    familia: db.familia, ano: db.ano, evento: db.evento, sorteado: db.sorteio.realizado,
    participantes: lista.map(function (p) { return { id: p.id, nome: p.nome, escolhido: !!p.token }; })
  };
}
function amigoDe(p) {
  const rid = db.sorteio.pares[p.id];
  const r = db.participantes.find(function (x) { return x.id === rid; });
  return r ? { nome: r.nome, gostos: r.gostos } : null;
}
function minhaVisao(p) {
  return {
    id: p.id, nome: p.nome, gostos: p.gostos, sorteado: db.sorteio.realizado,
    viu: !!p.viuEm, evento: db.evento, familia: db.familia,
    amigo: p.viuEm && db.sorteio.realizado ? amigoDe(p) : null
  };
}
function estadoAdmin() {
  const nome = function (id) { const p = db.participantes.find(function (x) { return x.id === id; }); return p ? p.nome : '(removido)'; };
  return {
    familia: db.familia, ano: db.ano, evento: db.evento,
    sorteio: { realizado: db.sorteio.realizado, realizadoEm: db.sorteio.realizadoEm },
    participantes: db.participantes.map(function (p) {
      return { id: p.id, nome: p.nome, escolhido: !!p.token, escolhidoEm: p.escolhidoEm, gostos: p.gostos.trim().length > 0, viu: !!p.viuEm };
    }),
    exclusoes: db.exclusoes.map(function (e) { return { a: e[0], b: e[1], nomeA: nome(e[0]), nomeB: nome(e[1]) }; }),
    erros: db.erros.slice().reverse()
  };
}
function participantePorToken(req) {
  const tk = req.headers['x-token'];
  if (!tk || typeof tk !== 'string') return null;
  return db.participantes.find(function (p) { return p.token && p.token === tk; }) || null;
}

/* ---------- rotas da API ---------- */
async function api(req, res, url) {
  const m = req.method, rota = url.pathname;
  if (m !== 'GET' && req.headers['x-requested-with'] !== 'natal') return erro(res, 403, 'proibido', 'Requisicao nao permitida.');

  if (m === 'GET' && rota === '/api/saude') return resp(res, 200, { ok: true });
  if (m === 'GET' && rota === '/api/publico') return resp(res, 200, estadoPublico());

  if (m === 'POST' && rota === '/api/escolher') {
    if (!limitar('esc:' + ip(req), 40, 600000)) return erro(res, 429, 'muitas', 'Muitas tentativas. Espere alguns minutos.');
    const b = await lerCorpo(req);
    const p = db.participantes.find(function (x) { return x.id === b.id; });
    if (!p) return erro(res, 404, 'nome_inexistente', 'Esse nome nao esta na lista.');
    if (p.token) return erro(res, 409, 'nome_ocupado', 'Esse nome ja foi escolhido.');
    p.token = crypto.randomBytes(24).toString('hex');
    p.escolhidoEm = new Date().toISOString();
    salvar();
    return resp(res, 200, { token: p.token, eu: minhaVisao(p) });
  }
  if (m === 'GET' && rota === '/api/eu') {
    const p = participantePorToken(req);
    if (!p) return erro(res, 401, 'sem_acesso', 'Acesso nao reconhecido.');
    return resp(res, 200, minhaVisao(p));
  }
  if (m === 'PUT' && rota === '/api/gostos') {
    const p = participantePorToken(req);
    if (!p) return erro(res, 401, 'sem_acesso', 'Acesso nao reconhecido.');
    const b = await lerCorpo(req);
    if (typeof b.gostos !== 'string') return erro(res, 400, 'invalido', 'Texto invalido.');
    p.gostos = b.gostos.trim().slice(0, 600);
    salvar();
    return resp(res, 200, minhaVisao(p));
  }
  if (m === 'POST' && rota === '/api/revelar') {
    const p = participantePorToken(req);
    if (!p) return erro(res, 401, 'sem_acesso', 'Acesso nao reconhecido.');
    if (!db.sorteio.realizado) return erro(res, 409, 'sem_sorteio', 'O sorteio ainda nao foi feito.');
    if (!amigoDe(p)) {
      registrarErro(p, 'O par do sorteio de ' + p.nome + ' nao foi encontrado. Refaca o sorteio.');
      return erro(res, 500, 'par_nao_encontrado', 'Nao encontrei o seu amigo secreto.');
    }
    if (!p.viuEm) { p.viuEm = new Date().toISOString(); salvar(); }
    return resp(res, 200, minhaVisao(p));
  }
  if (m === 'POST' && rota === '/api/erro') {
    if (!limitar('err:' + ip(req), 10, 3600000)) return erro(res, 429, 'muitas', 'Voce ja avisou varias vezes. Espere um pouco.');
    const b = await lerCorpo(req);
    const msg = typeof b.mensagem === 'string' ? b.mensagem.trim() : '';
    if (!msg) return erro(res, 400, 'invalido', 'Escreva o que aconteceu.');
    registrarErro(participantePorToken(req), msg);
    return resp(res, 200, { ok: true });
  }

  /* ----- administrador ----- */
  if (m === 'POST' && rota === '/api/admin/login') {
    if (!limitar('log:' + ip(req), 8, 600000)) return erro(res, 429, 'muitas', 'Muitas tentativas. Espere 10 minutos.');
    const b = await lerCorpo(req);
    if (typeof b.senha !== 'string' || !senhaCerta(b.senha)) return erro(res, 401, 'senha', 'Senha incorreta.');
    const cookie = 'adm=' + encodeURIComponent(criarSessao()) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + 7 * 86400 + (seguro(req) ? '; Secure' : '');
    return resp(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }
  if (rota.startsWith('/api/admin/')) {
    if (!sessaoValida(req)) return erro(res, 401, 'sem_login', 'Entre com a senha de administrador.');

    if (m === 'POST' && rota === '/api/admin/logout') {
      return resp(res, 200, { ok: true }, { 'Set-Cookie': 'adm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (m === 'GET' && rota === '/api/admin/estado') return resp(res, 200, estadoAdmin());

    if (m === 'PUT' && rota === '/api/admin/config') {
      const b = await lerCorpo(req);
      const fam = String(b.familia || '').trim().slice(0, 40);
      if (!fam) return erro(res, 400, 'invalido', 'Escreva o sobrenome da familia.');
      const ev = b.evento || {};
      if (ev.data && isNaN(new Date(ev.data))) return erro(res, 400, 'invalido', 'Data invalida.');
      db.familia = fam;
      db.ano = Number(b.ano) || db.ano;
      db.evento = {
        data: String(ev.data || ''), local: String(ev.local || '').slice(0, 80),
        valorSugerido: Math.max(0, Number(ev.valorSugerido) || 0)
      };
      salvar();
      return resp(res, 200, estadoAdmin());
    }
    if (m === 'POST' && rota === '/api/admin/participantes') {
      const b = await lerCorpo(req);
      const nome = String(b.nome || '').trim().slice(0, 60);
      if (!nome) return erro(res, 400, 'invalido', 'Escreva o nome.');
      if (db.participantes.some(function (p) { return p.nome.toLowerCase() === nome.toLowerCase(); })) return erro(res, 409, 'repetido', 'Ja existe alguem com esse nome. Use um sobrenome ou apelido para diferenciar.');
      const tinha = db.sorteio.realizado;
      db.participantes.push({ id: idCurto(), nome: nome, gostos: '', token: null, escolhidoEm: null, viuEm: null });
      if (tinha) invalidarSorteio();
      salvar();
      return resp(res, 200, Object.assign(estadoAdmin(), { sorteioDescartado: tinha }));
    }
    let r = rota.match(/^\/api\/admin\/participantes\/([\w-]+)$/);
    if (m === 'DELETE' && r) {
      const i = db.participantes.findIndex(function (p) { return p.id === r[1]; });
      if (i < 0) return erro(res, 404, 'inexistente', 'Participante nao encontrado.');
      const tinha = db.sorteio.realizado;
      db.participantes.splice(i, 1);
      db.exclusoes = db.exclusoes.filter(function (e) { return e[0] !== r[1] && e[1] !== r[1]; });
      if (tinha) invalidarSorteio();
      salvar();
      return resp(res, 200, Object.assign(estadoAdmin(), { sorteioDescartado: tinha }));
    }
    r = rota.match(/^\/api\/admin\/liberar\/([\w-]+)$/);
    if (m === 'POST' && r) {
      const p = db.participantes.find(function (x) { return x.id === r[1]; });
      if (!p) return erro(res, 404, 'inexistente', 'Participante nao encontrado.');
      p.token = null; p.escolhidoEm = null; p.viuEm = null;
      salvar();
      return resp(res, 200, estadoAdmin());
    }
    if (m === 'POST' && rota === '/api/admin/regras') {
      const b = await lerCorpo(req);
      const a = b.a, c = b.b;
      const existe = function (id) { return db.participantes.some(function (p) { return p.id === id; }); };
      if (!existe(a) || !existe(c) || a === c) return erro(res, 400, 'invalido', 'Escolha duas pessoas diferentes.');
      if (db.exclusoes.some(function (x) { return (x[0] === a && x[1] === c) || (x[0] === c && x[1] === a); })) return erro(res, 409, 'repetida', 'Essa regra ja existe.');
      const tinha = db.sorteio.realizado;
      db.exclusoes.push([a, c]);
      if (tinha) invalidarSorteio();
      salvar();
      return resp(res, 200, Object.assign(estadoAdmin(), { sorteioDescartado: tinha }));
    }
    r = rota.match(/^\/api\/admin\/regras\/(\d+)$/);
    if (m === 'DELETE' && r) {
      const i = Number(r[1]);
      if (i >= db.exclusoes.length) return erro(res, 404, 'inexistente', 'Regra nao encontrada.');
      const tinha = db.sorteio.realizado;
      db.exclusoes.splice(i, 1);
      if (tinha) invalidarSorteio();
      salvar();
      return resp(res, 200, Object.assign(estadoAdmin(), { sorteioDescartado: tinha }));
    }
    if (m === 'POST' && rota === '/api/admin/sortear') {
      const pares = calcularPares();
      if (pares === false) return erro(res, 400, 'poucos', 'Cadastre pelo menos 3 pessoas para sortear.');
      if (pares === null) return erro(res, 409, 'impossivel', 'Com essas regras nao existe sorteio possivel. Remova alguma regra ou adicione mais gente.');
      db.sorteio = { realizado: true, realizadoEm: new Date().toISOString(), pares: pares };
      db.participantes.forEach(function (p) { p.viuEm = null; });
      salvar();
      return resp(res, 200, estadoAdmin());
    }
    if (m === 'DELETE' && rota === '/api/admin/sorteio') {
      invalidarSorteio(); salvar();
      return resp(res, 200, estadoAdmin());
    }
    r = rota.match(/^\/api\/admin\/erros\/([\w-]+)\/resolver$/);
    if (m === 'POST' && r) {
      const e = db.erros.find(function (x) { return x.id === r[1]; });
      if (e) { e.resolvido = true; salvar(); }
      return resp(res, 200, estadoAdmin());
    }
    if (m === 'DELETE' && rota === '/api/admin/erros') {
      db.erros = db.erros.filter(function (e) { return !e.resolvido; });
      salvar();
      return resp(res, 200, estadoAdmin());
    }
    if (m === 'GET' && rota === '/api/admin/backup') {
      const copia = Object.assign({}, db); delete copia.segredo;
      const dia = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="familia-santos-' + dia + '.json"',
        'Cache-Control': 'no-store'
      });
      return res.end(JSON.stringify(copia, null, 2));
    }
    if (m === 'POST' && rota === '/api/admin/restaurar') {
      const b = await lerCorpo(req, 2000000);
      if (!b || !Array.isArray(b.participantes) || !b.participantes.every(function (p) { return p && typeof p.id === 'string' && typeof p.nome === 'string'; })) {
        return erro(res, 400, 'invalido', 'Esse arquivo nao parece um backup valido.');
      }
      const segredo = db.segredo;
      db = normalizar(b); db.segredo = segredo;
      salvar();
      return resp(res, 200, estadoAdmin());
    }
  }
  return erro(res, 404, 'nao_encontrado', 'Rota nao encontrada.');
}

/* ---------- arquivos estáticos ---------- */
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};
function estatico(req, res, url) {
  let p = url.pathname;
  if (p === '/') p = '/index.html';
  if (p === '/admin') p = '/admin.html';
  let alvo;
  try { alvo = path.join(PUBLIC_DIR, decodeURIComponent(p)); } catch (e) { res.writeHead(400); return res.end('Pedido invalido'); }
  if (alvo !== PUBLIC_DIR && !alvo.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Proibido'); }
  fs.readFile(alvo, function (err, dados) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Pagina nao encontrada'); }
    const ext = path.extname(alvo).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TIPOS[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin'
    });
    res.end(req.method === 'HEAD' ? undefined : dados);
  });
}

const servidor = http.createServer(async function (req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); return res.end(); }
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return estatico(req, res, url);
  } catch (e) {
    if (e && e.codigo) return erro(res, e.codigo, 'corpo_invalido', 'Dados invalidos.');
    console.error('Erro interno em ' + req.method + ' ' + url.pathname + ':', e);
    try { registrarErro(null, 'Erro interno do servidor em ' + url.pathname); } catch (x) {}
    if (!res.headersSent) return erro(res, 500, 'interno', 'Algo deu errado no servidor.');
    res.end();
  }
});
servidor.listen(PORT, function () {
  console.log('Amigo secreto no ar na porta ' + PORT + '. Dados em ' + DATA_FILE);
});
