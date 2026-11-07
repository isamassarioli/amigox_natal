// deno-lint-ignore-file no-explicit-any
// Amigo secreto da Família Santos: API em uma função do Supabase.
// Todo o estado fica na linha id=1 da tabela app_estado, lida e gravada dentro de transações.
import postgres from 'npm:postgres@3.4.4';

const sql: any = postgres(Deno.env.get('SUPABASE_DB_URL') || '', {
  max: 3,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 10,
});
const ADMIN_PASSWORD = Deno.env.get('ADMIN_PASSWORD') || '';
const ORIGEM = Deno.env.get('ALLOWED_ORIGIN') || '*';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': ORIGEM,
  'Access-Control-Allow-Headers': 'content-type, x-token, x-admin, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
};

type R = { s: number; b: any; salvar?: boolean };
const ok = (b: any): R => ({ s: 200, b });
const err = (s: number, k: string, m: string): R => ({ s, b: { erro: k, mensagem: m }, salvar: false });
class HttpErro extends Error {
  s: number;
  constructor(s: number, m: string) { super(m); this.s = s; }
}

/* ---------- utilidades ---------- */
const enc = new TextEncoder();
function hex(b: Uint8Array): string { return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(''); }
function aleatorioHex(n: number): string { const b = new Uint8Array(n); crypto.getRandomValues(b); return hex(b); }
function aleatorio(n: number): number {
  const lim = Math.floor(4294967296 / n) * n;
  const a = new Uint32Array(1);
  let x = 0;
  do { crypto.getRandomValues(a); x = a[0]; } while (x >= lim);
  return x % n;
}
function iguais(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function sha(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}
async function hmac(chave: string, v: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(chave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(v))));
}
async function lerCorpo(req: Request, limite = 100000): Promise<any> {
  const t = await req.text();
  if (t.length > limite) throw new HttpErro(413, 'Corpo grande demais.');
  if (!t) return {};
  try { return JSON.parse(t); } catch { throw new HttpErro(400, 'JSON inválido.'); }
}
function ipDe(req: Request): string {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
}
const janelas = new Map<string, number[]>();
function limitar(chave: string, max: number, ms: number): boolean {
  const agora = Date.now();
  const lista = (janelas.get(chave) || []).filter((t) => agora - t < ms);
  if (lista.length >= max) { janelas.set(chave, lista); return false; }
  lista.push(agora);
  janelas.set(chave, lista);
  return true;
}

/* ---------- dados ---------- */
function novo(): any {
  return {
    versao: 1, familia: 'Santos', ano: 2026,
    evento: { data: '2026-12-24T20:00', local: '', valorSugerido: 80 },
    participantes: [], exclusoes: [],
    sorteio: { realizado: false, realizadoEm: null, pares: {} },
    erros: [], segredo: aleatorioHex(32),
  };
}
function normalizar(o: any): any {
  const n = novo();
  const r: any = Object.assign(n, o || {});
  r.evento = Object.assign({ data: '2026-12-24T20:00', local: '', valorSugerido: 80 }, (o && o.evento) || {});
  r.sorteio = Object.assign({ realizado: false, realizadoEm: null, pares: {} }, (o && o.sorteio) || {});
  r.participantes = (Array.isArray(o && o.participantes) ? o.participantes : []).map((p: any) => ({
    id: String(p.id), nome: String(p.nome), gostos: String(p.gostos || ''),
    token: p.token || null, escolhidoEm: p.escolhidoEm || null, viuEm: p.viuEm || null,
  }));
  r.exclusoes = (Array.isArray(o && o.exclusoes) ? o.exclusoes : []).filter((e: any) => Array.isArray(e) && e.length === 2);
  r.erros = Array.isArray(o && o.erros) ? o.erros : [];
  return r;
}
async function lerDb(): Promise<any> {
  const r = await sql`select dados from app_estado where id = 1`;
  return normalizar(r[0] ? r[0].dados : {});
}
// Lê com trava, deixa a função alterar e grava. Se a função lançar erro, nada é gravado.
async function mutar(fn: (db: any) => Promise<R> | R): Promise<R> {
  return await sql.begin(async (tx: any) => {
    const r = await tx`select dados from app_estado where id = 1 for update`;
    const db = normalizar(r[0] ? r[0].dados : {});
    const out = await fn(db);
    if (out.salvar !== false) {
      await tx`insert into app_estado (id, dados, atualizado_em) values (1, ${tx.json(db)}, now())
               on conflict (id) do update set dados = excluded.dados, atualizado_em = now()`;
    }
    return out;
  });
}
function registrarErro(db: any, p: any, mensagem: string) {
  db.erros.push({
    id: 'e' + aleatorioHex(4), em: new Date().toISOString(),
    participanteId: p ? p.id : null, nome: p ? p.nome : null,
    mensagem: String(mensagem).slice(0, 500), resolvido: false,
  });
  if (db.erros.length > 200) db.erros = db.erros.slice(-200);
}
function invalidarSorteio(db: any) {
  db.sorteio = { realizado: false, realizadoEm: null, pares: {} };
  db.participantes.forEach((p: any) => { p.viuEm = null; });
}
function calcularPares(db: any): any {
  const ids: string[] = db.participantes.map((p: any) => p.id);
  if (ids.length < 3) return false;
  const bloq: Record<string, number> = {};
  db.exclusoes.forEach((x: any) => { bloq[x[0] + '>' + x[1]] = 1; bloq[x[1] + '>' + x[0]] = 1; });
  for (let t = 0; t < 30000; t++) {
    const arr = ids.slice();
    for (let i = arr.length - 1; i > 0; i--) { const j = aleatorio(i + 1); const x = arr[i]; arr[i] = arr[j]; arr[j] = x; }
    let bom = true;
    for (let i = 0; i < arr.length; i++) {
      if (bloq[arr[i] + '>' + arr[(i + 1) % arr.length]]) { bom = false; break; }
    }
    if (bom) {
      const m: Record<string, string> = {};
      for (let k = 0; k < arr.length; k++) m[arr[k]] = arr[(k + 1) % arr.length];
      return m;
    }
  }
  return null;
}

/* ---------- visões ---------- */
function estadoPublico(db: any): any {
  const lista = db.participantes.slice().sort((a: any, b: any) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return {
    familia: db.familia, ano: db.ano, evento: db.evento, sorteado: db.sorteio.realizado,
    participantes: lista.map((p: any) => ({ id: p.id, nome: p.nome, escolhido: !!p.token })),
  };
}
function amigoDe(db: any, p: any): any {
  const rid = db.sorteio.pares[p.id];
  const r = db.participantes.find((x: any) => x.id === rid);
  return r ? { nome: r.nome, gostos: r.gostos } : null;
}
function minhaVisao(db: any, p: any): any {
  return {
    id: p.id, nome: p.nome, gostos: p.gostos, sorteado: db.sorteio.realizado,
    viu: !!p.viuEm, evento: db.evento, familia: db.familia,
    amigo: p.viuEm && db.sorteio.realizado ? amigoDe(db, p) : null,
  };
}
function estadoAdmin(db: any): any {
  const nome = (id: string) => { const p = db.participantes.find((x: any) => x.id === id); return p ? p.nome : '(removido)'; };
  return {
    familia: db.familia, ano: db.ano, evento: db.evento,
    sorteio: { realizado: db.sorteio.realizado, realizadoEm: db.sorteio.realizadoEm },
    participantes: db.participantes.map((p: any) => ({
      id: p.id, nome: p.nome, escolhido: !!p.token, escolhidoEm: p.escolhidoEm,
      gostos: p.gostos.trim().length > 0, viu: !!p.viuEm,
    })),
    exclusoes: db.exclusoes.map((e: any) => ({ a: e[0], b: e[1], nomeA: nome(e[0]), nomeB: nome(e[1]) })),
    erros: db.erros.slice().reverse(),
  };
}
function porToken(db: any, req: Request): any {
  const tk = req.headers.get('x-token');
  if (!tk) return null;
  return db.participantes.find((p: any) => p.token && p.token === tk) || null;
}

/* ---------- sessão do organizador ---------- */
async function criarSessao(db: any): Promise<string> {
  const v = String(Date.now() + 7 * 864e5);
  return v + '.' + await hmac(db.segredo, v);
}
async function sessaoValida(db: any, req: Request): Promise<boolean> {
  const t = req.headers.get('x-admin') || '';
  const partes = t.split('.');
  if (partes.length !== 2) return false;
  const esperado = await hmac(db.segredo, partes[0]);
  if (!iguais(enc.encode(partes[1]), enc.encode(esperado))) return false;
  return Number(partes[0]) > Date.now();
}
async function senhaCerta(s: string): Promise<boolean> {
  if (!ADMIN_PASSWORD) return false;
  return iguais(await sha(String(s)), await sha(ADMIN_PASSWORD));
}
const NEGADO = () => err(401, 'sem_login', 'Entre com a senha de administrador.');
// Rota de administrador que altera dados
async function adminMutar(req: Request, fn: (db: any) => Promise<R> | R): Promise<R> {
  return await mutar(async (db) => (await sessaoValida(db, req)) ? await fn(db) : NEGADO());
}
// Rota de administrador que só lê
async function adminLer(req: Request, fn: (db: any) => R): Promise<R> {
  const db = await lerDb();
  return (await sessaoValida(db, req)) ? fn(db) : NEGADO();
}

/* ---------- rotas ---------- */
async function tratar(req: Request, rota: string): Promise<R> {
  const m = req.method;
  let r: RegExpMatchArray | null;

  if (m === 'GET' && rota === '/saude') return ok({ ok: true });
  if (m === 'GET' && rota === '/publico') return ok(estadoPublico(await lerDb()));

  if (m === 'POST' && rota === '/escolher') {
    if (!limitar('esc:' + ipDe(req), 40, 600000)) return err(429, 'muitas', 'Muitas tentativas. Espere alguns minutos.');
    const b = await lerCorpo(req);
    return await mutar((db) => {
      const p = db.participantes.find((x: any) => x.id === b.id);
      if (!p) return err(404, 'nome_inexistente', 'Esse nome não está na lista.');
      if (p.token) return err(409, 'nome_ocupado', 'Esse nome já foi escolhido.');
      p.token = aleatorioHex(24);
      p.escolhidoEm = new Date().toISOString();
      return ok({ token: p.token, eu: minhaVisao(db, p) });
    });
  }
  if (m === 'GET' && rota === '/eu') {
    const db = await lerDb();
    const p = porToken(db, req);
    return p ? ok(minhaVisao(db, p)) : err(401, 'sem_acesso', 'Acesso não reconhecido.');
  }
  if (m === 'PUT' && rota === '/gostos') {
    const b = await lerCorpo(req);
    return await mutar((db) => {
      const p = porToken(db, req);
      if (!p) return err(401, 'sem_acesso', 'Acesso não reconhecido.');
      if (typeof b.gostos !== 'string') return err(400, 'invalido', 'Texto inválido.');
      p.gostos = b.gostos.trim().slice(0, 600);
      return ok(minhaVisao(db, p));
    });
  }
  if (m === 'POST' && rota === '/revelar') {
    return await mutar((db) => {
      const p = porToken(db, req);
      if (!p) return err(401, 'sem_acesso', 'Acesso não reconhecido.');
      if (!db.sorteio.realizado) return err(409, 'sem_sorteio', 'O sorteio ainda não foi feito.');
      if (!amigoDe(db, p)) {
        registrarErro(db, p, 'O par do sorteio de ' + p.nome + ' não foi encontrado. Refaça o sorteio.');
        return { s: 500, b: { erro: 'par_nao_encontrado', mensagem: 'Não encontrei o seu amigo secreto.' } };
      }
      if (!p.viuEm) p.viuEm = new Date().toISOString();
      return ok(minhaVisao(db, p));
    });
  }
  if (m === 'POST' && rota === '/erro') {
    if (!limitar('err:' + ipDe(req), 10, 3600000)) return err(429, 'muitas', 'Você já avisou várias vezes. Espere um pouco.');
    const b = await lerCorpo(req);
    const msg = typeof b.mensagem === 'string' ? b.mensagem.trim() : '';
    if (!msg) return err(400, 'invalido', 'Escreva o que aconteceu.');
    return await mutar((db) => { registrarErro(db, porToken(db, req), msg); return ok({ ok: true }); });
  }

  /* ----- organizador ----- */
  if (m === 'POST' && rota === '/admin/login') {
    if (!ADMIN_PASSWORD) return err(500, 'sem_senha', 'A senha do organizador ainda não foi configurada no Supabase (ADMIN_PASSWORD).');
    if (!limitar('log:' + ipDe(req), 8, 600000)) return err(429, 'muitas', 'Muitas tentativas. Espere 10 minutos.');
    const b = await lerCorpo(req);
    if (typeof b.senha !== 'string' || !(await senhaCerta(b.senha))) return err(401, 'senha', 'Senha incorreta.');
    return ok({ ok: true, token: await criarSessao(await lerDb()) });
  }
  if (m === 'POST' && rota === '/admin/logout') return ok({ ok: true });
  if (m === 'GET' && rota === '/admin/estado') return await adminLer(req, (db) => ok(estadoAdmin(db)));

  if (m === 'PUT' && rota === '/admin/config') {
    const b = await lerCorpo(req);
    return await adminMutar(req, (db) => {
      const fam = String(b.familia || '').trim().slice(0, 40);
      if (!fam) return err(400, 'invalido', 'Escreva o sobrenome da família.');
      const ev = b.evento || {};
      if (ev.data && isNaN(new Date(ev.data).getTime())) return err(400, 'invalido', 'Data inválida.');
      db.familia = fam;
      db.ano = Number(b.ano) || db.ano;
      db.evento = {
        data: String(ev.data || ''), local: String(ev.local || '').slice(0, 80),
        valorSugerido: Math.max(0, Number(ev.valorSugerido) || 0),
      };
      return ok(estadoAdmin(db));
    });
  }
  if (m === 'POST' && rota === '/admin/participantes') {
    const b = await lerCorpo(req);
    return await adminMutar(req, (db) => {
      const nome = String(b.nome || '').trim().slice(0, 60);
      if (!nome) return err(400, 'invalido', 'Escreva o nome.');
      if (db.participantes.some((p: any) => p.nome.toLowerCase() === nome.toLowerCase())) {
        return err(409, 'repetido', 'Já existe alguém com esse nome. Use um sobrenome ou apelido para diferenciar.');
      }
      const tinha = db.sorteio.realizado;
      db.participantes.push({ id: 'p' + aleatorioHex(4), nome, gostos: '', token: null, escolhidoEm: null, viuEm: null });
      if (tinha) invalidarSorteio(db);
      return ok(Object.assign(estadoAdmin(db), { sorteioDescartado: tinha }));
    });
  }
  if (m === 'DELETE' && (r = rota.match(/^\/admin\/participantes\/([\w-]+)$/))) {
    const id = r[1];
    return await adminMutar(req, (db) => {
      const i = db.participantes.findIndex((p: any) => p.id === id);
      if (i < 0) return err(404, 'inexistente', 'Participante não encontrado.');
      const tinha = db.sorteio.realizado;
      db.participantes.splice(i, 1);
      db.exclusoes = db.exclusoes.filter((e: any) => e[0] !== id && e[1] !== id);
      if (tinha) invalidarSorteio(db);
      return ok(Object.assign(estadoAdmin(db), { sorteioDescartado: tinha }));
    });
  }
  if (m === 'POST' && (r = rota.match(/^\/admin\/liberar\/([\w-]+)$/))) {
    const id = r[1];
    return await adminMutar(req, (db) => {
      const p = db.participantes.find((x: any) => x.id === id);
      if (!p) return err(404, 'inexistente', 'Participante não encontrado.');
      p.token = null; p.escolhidoEm = null; p.viuEm = null;
      return ok(estadoAdmin(db));
    });
  }
  if (m === 'POST' && rota === '/admin/regras') {
    const b = await lerCorpo(req);
    return await adminMutar(req, (db) => {
      const a = b.a, c = b.b;
      const existe = (id: string) => db.participantes.some((p: any) => p.id === id);
      if (!existe(a) || !existe(c) || a === c) return err(400, 'invalido', 'Escolha duas pessoas diferentes.');
      if (db.exclusoes.some((x: any) => (x[0] === a && x[1] === c) || (x[0] === c && x[1] === a))) return err(409, 'repetida', 'Essa regra já existe.');
      const tinha = db.sorteio.realizado;
      db.exclusoes.push([a, c]);
      if (tinha) invalidarSorteio(db);
      return ok(Object.assign(estadoAdmin(db), { sorteioDescartado: tinha }));
    });
  }
  if (m === 'DELETE' && (r = rota.match(/^\/admin\/regras\/(\d+)$/))) {
    const i = Number(r[1]);
    return await adminMutar(req, (db) => {
      if (i >= db.exclusoes.length) return err(404, 'inexistente', 'Regra não encontrada.');
      const tinha = db.sorteio.realizado;
      db.exclusoes.splice(i, 1);
      if (tinha) invalidarSorteio(db);
      return ok(Object.assign(estadoAdmin(db), { sorteioDescartado: tinha }));
    });
  }
  if (m === 'POST' && rota === '/admin/sortear') {
    return await adminMutar(req, (db) => {
      const pares = calcularPares(db);
      if (pares === false) return err(400, 'poucos', 'Cadastre pelo menos 3 pessoas para sortear.');
      if (pares === null) return err(409, 'impossivel', 'Com essas regras não existe sorteio possível. Remova alguma regra ou adicione mais gente.');
      db.sorteio = { realizado: true, realizadoEm: new Date().toISOString(), pares };
      db.participantes.forEach((p: any) => { p.viuEm = null; });
      return ok(estadoAdmin(db));
    });
  }
  if (m === 'DELETE' && rota === '/admin/sorteio') {
    return await adminMutar(req, (db) => { invalidarSorteio(db); return ok(estadoAdmin(db)); });
  }
  if (m === 'POST' && (r = rota.match(/^\/admin\/erros\/([\w-]+)\/resolver$/))) {
    const id = r[1];
    return await adminMutar(req, (db) => {
      const e = db.erros.find((x: any) => x.id === id);
      if (e) e.resolvido = true;
      return ok(estadoAdmin(db));
    });
  }
  if (m === 'DELETE' && rota === '/admin/erros') {
    return await adminMutar(req, (db) => { db.erros = db.erros.filter((e: any) => !e.resolvido); return ok(estadoAdmin(db)); });
  }
  if (m === 'GET' && rota === '/admin/backup') {
    return await adminLer(req, (db) => { const c = Object.assign({}, db); delete c.segredo; return ok(c); });
  }
  if (m === 'POST' && rota === '/admin/restaurar') {
    const b = await lerCorpo(req, 2000000);
    return await adminMutar(req, (db) => {
      if (!b || !Array.isArray(b.participantes) || !b.participantes.every((p: any) => p && typeof p.id === 'string' && typeof p.nome === 'string')) {
        return err(400, 'invalido', 'Esse arquivo não parece um backup válido.');
      }
      const novoDb = normalizar(b);
      novoDb.segredo = db.segredo;
      Object.keys(db).forEach((k) => delete db[k]);
      Object.assign(db, novoDb);
      return ok(estadoAdmin(db));
    });
  }
  return err(404, 'nao_encontrado', 'Rota não encontrada.');
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const rota = url.pathname.replace(/^\/(functions\/v1\/)?amigo/, '') || '/';
  const resp = (s: number, b: any) =>
    new Response(JSON.stringify(b), {
      status: s,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  try {
    const out = await tratar(req, rota);
    return resp(out.s, out.b);
  } catch (e: any) {
    if (e instanceof HttpErro) return resp(e.s, { erro: 'corpo_invalido', mensagem: e.message });
    console.error('Erro interno em ' + req.method + ' ' + rota + ':', e);
    return resp(500, { erro: 'interno', mensagem: 'Algo deu errado no servidor.' });
  }
});
