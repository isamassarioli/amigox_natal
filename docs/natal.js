/* Enfeites de Natal e utilidades compartilhadas pelas duas páginas */
(function () {
'use strict';
var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function $(s) { return document.querySelector(s); }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

var toastT = 0;
function toast(msg) {
  var t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('mostra');
  clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('mostra'); }, 4200);
}

/* sessão do organizador: o código vai no cabeçalho X-Admin */
var adminMem = '';
var ADMIN_KEY = 'natal-admin';
var admin = {
  get: function () { try { return localStorage.getItem(ADMIN_KEY) || adminMem; } catch (e) { return adminMem; } },
  set: function (t) { adminMem = t; try { localStorage.setItem(ADMIN_KEY, t); } catch (e) {} },
  limpar: function () { adminMem = ''; try { localStorage.removeItem(ADMIN_KEY); } catch (e) {} }
};

/* chamada à API (função do Supabase): lança erro com status e chave de erro */
function api(metodo, url, corpo, token) {
  var base = String(window.API_BASE || '').replace(/\/+$/, '');
  if (!base || base.indexOf('SEU-PROJETO') > -1) {
    var ec = new Error('sem_config'); ec.status = 0; ec.erro = 'sem_config';
    ec.mensagem = 'O site ainda não foi ligado ao Supabase. Falta preencher o endereço no arquivo config.js.';
    return Promise.reject(ec);
  }
  var h = {};
  if (corpo !== undefined && corpo !== null) h['Content-Type'] = 'application/json';
  if (token) h['X-Token'] = token;
  if (url.indexOf('/api/admin/') === 0 && url !== '/api/admin/login') { var a = admin.get(); if (a) h['X-Admin'] = a; }
  return fetch(base + url.replace(/^\/api/, ''), { method: metodo, headers: h, body: corpo != null ? JSON.stringify(corpo) : undefined })
    .catch(function () { var e = new Error('sem_conexao'); e.status = 0; e.erro = 'sem_conexao'; e.mensagem = 'Sem conexão com o servidor.'; throw e; })
    .then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        if (!r.ok) {
          var e = new Error((d && d.erro) || 'erro');
          e.status = r.status; e.erro = d && d.erro; e.mensagem = (d && d.mensagem) || 'Algo deu errado.';
          throw e;
        }
        return d;
      });
    });
}

/* botão que pede uma segunda confirmação antes de agir */
function armar(btn, textoArmado, acao) {
  var original = btn.getAttribute('data-original') || btn.textContent;
  btn.setAttribute('data-original', original);
  if (btn.classList.contains('armado')) {
    btn.classList.remove('armado'); btn.textContent = original; clearTimeout(btn._t); acao(); return;
  }
  btn.classList.add('armado'); btn.textContent = textoArmado;
  clearTimeout(btn._t);
  btn._t = setTimeout(function () { btn.classList.remove('armado'); btn.textContent = original; }, 4500);
}

/* ---------- estrelas, guirlanda, bolas ---------- */
function estrelas() {
  var el = $('#estrelas'); if (!el) return; var h = '';
  for (var i = 0; i < 70; i++) {
    var s = (Math.random() * 2 + 1).toFixed(1);
    h += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;top:' + (Math.random() * 70).toFixed(1) + '%;width:' + s + 'px;height:' + s + 'px;animation-delay:' + (Math.random() * 3).toFixed(2) + 's;animation-duration:' + (2 + Math.random() * 3).toFixed(1) + 's"></i>';
  }
  el.innerHTML = h;
}
function guirlanda() {
  var el = $('#guirlanda'); if (!el) return;
  var w = Math.max(320, window.innerWidth), n = Math.max(2, Math.round(w / 150)), seg = w / n, cores = ['#ff4d5e', '#ffd24a', '#4ade80', '#5cc8ff'], k = 0;
  var s = '<svg viewBox="0 0 ' + w + ' 64" preserveAspectRatio="xMidYMin slice">';
  for (var i = 0; i < n; i++) {
    var x0 = i * seg, x1 = x0 + seg, xm = (x0 + x1) / 2;
    s += '<path d="M' + x0 + ' 6 Q' + xm + ' 52 ' + x1 + ' 6" fill="none" stroke="#0d4a2d" stroke-width="3"/>';
    for (var j = 1; j <= 5; j++) {
      var t = j / 6, u = 1 - t, x = u * u * x0 + 2 * u * t * xm + t * t * x1, y = u * u * 6 + 2 * u * t * 52 + t * t * 6, c = cores[k % 4];
      s += '<rect x="' + (x - 2.5).toFixed(1) + '" y="' + y.toFixed(1) + '" width="5" height="6" rx="1" fill="#0d4a2d"/><circle class="bulbo" cx="' + x.toFixed(1) + '" cy="' + (y + 11).toFixed(1) + '" r="6" style="--c:' + c + ';animation-delay:' + ((k * 0.37) % 2).toFixed(2) + 's"/>';
      k++;
    }
  }
  el.innerHTML = s + '</svg>';
}
function bolas() {
  var el = $('#bolas'); if (!el) return;
  var cfg = [[5, 26, '#ff4d5e', 0, 30], [16, 58, '#ffc94a', .6, 24], [28, 34, '#4ade80', 1.2, 28], [41, 64, '#5cc8ff', .3, 22], [57, 30, '#ff4d5e', 1.6, 26], [70, 60, '#ffc94a', .9, 30], [82, 38, '#4ade80', .2, 24], [94, 62, '#5cc8ff', 1.4, 28]];
  el.innerHTML = cfg.map(function (c) {
    return '<div class="bola" style="left:' + c[0] + '%;--fio:' + c[1] + 'px;--cor:' + c[2] + ';--t:' + c[4] + 'px;animation-delay:-' + c[3] + 's"><i></i></div>';
  }).join('');
}
function luzesArvore() {
  var el = $('#luzes'); if (!el) return;
  var luzes = [[120, 64, '#ff4d5e'], [104, 100, '#ffd24a'], [138, 104, '#5cc8ff'], [92, 138, '#ffd24a'], [122, 142, '#4ade80'], [150, 138, '#ff4d5e'], [78, 172, '#ff4d5e'], [108, 176, '#4ade80'], [136, 170, '#5cc8ff'], [164, 172, '#ffd24a'], [70, 212, '#5cc8ff'], [98, 208, '#ff4d5e'], [128, 214, '#ffd24a'], [156, 208, '#4ade80'], [182, 222, '#ff4d5e'], [56, 228, '#ffd24a']];
  el.innerHTML = luzes.map(function (l, i) {
    return '<circle class="luz" cx="' + l[0] + '" cy="' + l[1] + '" r="4.6" style="--c:' + l[2] + ';--d:' + ((i * 0.23) % 1.8).toFixed(2) + 's"/>';
  }).join('');
}

/* ---------- neve ---------- */
var sn = $('#neve'), sc = sn ? sn.getContext('2d') : null, W = 0, H = 0, flocos = [];
function criarFloco() { var r = Math.random() * 2.6 + 0.8; return { x: Math.random() * W, y: Math.random() * H, r: r, vy: r * 0.35 + 0.3, fase: Math.random() * 6.28, amp: Math.random() * 0.6 + 0.2 }; }
function dimensionar() {
  var d = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  if (sn) {
    sn.width = W * d; sn.height = H * d; sn.style.width = W + 'px'; sn.style.height = H + 'px';
    sc.setTransform(d, 0, 0, d, 0, 0);
    var n = Math.round(Math.min(170, W / 7));
    flocos = []; for (var i = 0; i < n; i++) flocos.push(criarFloco());
  }
  var cf = $('#confete'); if (cf) { cf.width = W; cf.height = H; }
  if (reduce && sc) desenharNeve(0);
}
function desenharNeve(t) {
  sc.clearRect(0, 0, W, H); sc.fillStyle = '#fff';
  var vento = Math.sin(t / 4000) * 0.35;
  for (var i = 0; i < flocos.length; i++) {
    var f = flocos[i];
    if (!reduce) {
      f.y += f.vy; f.fase += 0.012; f.x += Math.sin(f.fase) * f.amp + vento;
      if (f.y > H + 6) { f.y = -6; f.x = Math.random() * W; }
      if (f.x > W + 6) f.x = -6; else if (f.x < -6) f.x = W + 6;
    }
    sc.globalAlpha = 0.45 + f.r / 6;
    sc.beginPath(); sc.arc(f.x, f.y, f.r, 0, 6.2832); sc.fill();
  }
  sc.globalAlpha = 1;
}
function quadroNeve(t) { desenharNeve(t); requestAnimationFrame(quadroNeve); }

/* ---------- confete ---------- */
var cv = $('#confete'), cx = cv ? cv.getContext('2d') : null, parts = [], raf = 0, CORES = ['#ff4d5e', '#ffd24a', '#4ade80', '#5cc8ff', '#ffffff', '#ff9ad5'];
function confete(x, y, n) {
  if (reduce || !cx) return;
  for (var i = 0; i < n; i++) {
    parts.push({ x: x, y: y, vx: (Math.random() - .5) * 15, vy: -Math.random() * 14 - 3, g: .34, w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, c: CORES[i % CORES.length], rot: Math.random() * 6, vr: (Math.random() - .5) * .45 });
  }
  if (!raf) raf = requestAnimationFrame(laco);
}
function laco() {
  cx.clearRect(0, 0, cv.width, cv.height);
  parts = parts.filter(function (p) { return p.y < cv.height + 30; });
  parts.forEach(function (p) {
    p.vy += p.g; p.vx *= .992; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); cx.restore();
  });
  if (parts.length) raf = requestAnimationFrame(laco); else { raf = 0; cx.clearRect(0, 0, cv.width, cv.height); }
}

/* ---------- contagem regressiva ---------- */
function iniciarContagem(obterEvento, obterFamilia) {
  function tick() {
    var d = new Date(obterEvento().data), msg = $('#conta-msg'), z = function () { ['d', 'h', 'm', 's'].forEach(function (k) { $('#c-' + k).textContent = '0'; }); };
    if (isNaN(d)) { z(); msg.textContent = 'A data da ceia ainda não foi definida.'; return; }
    var diff = d - new Date();
    if (diff <= 0) { z(); msg.textContent = 'Feliz Natal, família ' + obterFamilia() + '!'; return; }
    var s = Math.floor(diff / 1000);
    $('#c-d').textContent = Math.floor(s / 86400);
    $('#c-h').textContent = Math.floor(s % 86400 / 3600);
    $('#c-m').textContent = Math.floor(s % 3600 / 60);
    $('#c-s').textContent = s % 60;
    msg.textContent = 'Faltam para a ceia de Natal.';
  }
  tick(); setInterval(tick, 1000);
  return tick;
}
function textoQuando(ev) {
  var d = new Date(ev.data), info = 'Data da ceia ainda não definida';
  if (!isNaN(d)) info = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) + ', às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (ev.local) info += ', ' + ev.local;
  return info;
}

var rt = 0;
window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { guirlanda(); dimensionar(); }, 150); });
estrelas(); guirlanda(); bolas(); luzesArvore(); dimensionar();
if (!reduce && sc) requestAnimationFrame(quadroNeve);

window.Natal = { $: $, esc: esc, toast: toast, api: api, admin: admin, armar: armar, confete: confete, iniciarContagem: iniciarContagem, textoQuando: textoQuando, reduce: reduce };
})();
