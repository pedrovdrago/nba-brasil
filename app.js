const TZ = 'America/Sao_Paulo';
const ESPN = 'https://site.api.espn.com/apis';
let diaSel = hojeBR();
let overrides = { padrao: [], jogos: {} };
let lakersBR = []; // jogos do dia extraídos de lakersbrasil.com

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
const mesmoTime = (espn, lb) => { const a = norm(espn), b = norm(lb); return a && b && (a.includes(b) || b.includes(a)); };

// ---------- utilidades de data ----------
function hojeBR(offset = 0) {
  const d = new Date(Date.now() + offset * 864e5);
  return d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
}
const fmtHora = iso => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

// A ESPN agrupa jogos pela data dos EUA; buscamos o dia e o seguinte e filtramos pelo dia em Brasília.
async function buscarJSON(api, direto) {
  try { const r = await fetch(api); if (r.ok) return r.json(); } catch {}
  return (await fetch(direto)).json(); // fallback (abrir localmente sem Vercel)
}
async function scoreboard(ymd) {
  const d = ymd.replaceAll('-', '');
  return buscarJSON(`/api/scoreboard?dates=${d}`,
    `${ESPN}/site/v2/sports/basketball/nba/scoreboard?region=br&lang=pt&limit=50&dates=${d}`);
}

// ---------- transmissões ----------
function canaisDoJogo(ev) {
  const comp = ev.competitions[0];
  const away = comp.competitors.find(c => c.homeAway === 'away').team.abbreviation;
  const home = comp.competitors.find(c => c.homeAway === 'home').team.abbreviation;
  const manual = overrides.jogos[ev.id] || overrides.jogos[`${away}@${home}`];
  if (manual) return { lista: manual, tv: true };
  const nomes = comp.competitors.map(c => c.team.name);
  // "Rodada" de hoje = das 06h de hoje às 06h de amanhã (jogos de 0h/1h pertencem à rodada anterior)
  const ehHoje = new Date(new Date(ev.date).getTime() - 6 * 36e5).toLocaleDateString('en-CA', { timeZone: TZ })
    === new Date(Date.now() - 6 * 36e5).toLocaleDateString('en-CA', { timeZone: TZ });
  const lb = ehHoje && lakersBR.find(j => nomes.every(n => j.times.some(t => mesmoTime(n, t))));
  if (lb && lb.canais.length) return { lista: lb.canais, tv: lb.canais.some(c => !/league pass/i.test(c)) };
  const api = new Set();
  (comp.broadcasts || []).forEach(b => (b.names || []).forEach(n => api.add(n)));
  (comp.geoBroadcasts || []).forEach(b => b.media?.shortName && api.add(b.media.shortName));
  const br = [...api].filter(n => /espn|prime|amazon|disney|band|sportv|star/i.test(n));
  if (br.length) return { lista: br, tv: true };
  return { lista: overrides.padrao, tv: false };
}
function classeCanal(n) {
  return /espn/i.test(n) ? 'espn' : /prime|amazon/i.test(n) ? 'prime' : /disney|star/i.test(n) ? 'disney'
    : /league/i.test(n) ? 'league' : /band/i.test(n) ? 'band' : /sportv/i.test(n) ? 'sportv' : '';
}

// ---------- render jogos ----------
function renderDias() {
  const el = document.getElementById('dias');
  el.innerHTML = '';
  const hoje = hojeBR();
  const dSel = new Date(diaSel + 'T12:00:00');
  const dHoje = new Date(hoje + 'T12:00:00');
  const diffDias = Math.round((dSel - dHoje) / 864e5);

  // Se estiver no intervalo comum de dias (-3 a +7 de hoje)
  if (diffDias >= -3 && diffDias <= 7) {
    for (let i = -3; i <= 7; i++) {
      const ymd = hojeBR(i);
      const d = new Date(ymd + 'T12:00:00');
      const rot = i === 0 ? 'Hoje' : i === -1 ? 'Ontem' : i === 1 ? 'Amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short' });
      const b = document.createElement('div');
      b.className = 'dia' + (ymd === diaSel ? ' ativo' : '');
      b.id = 'dia-' + ymd;
      b.innerHTML = `<small>${rot}</small><b>${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</b>`;
      b.onclick = () => { diaSel = ymd; renderDias(); carregarJogos(); };
      el.appendChild(b);
    }
  } else {
    // Data histórica selecionada: mostra janela de 5 dias em torno da data
    for (let i = -2; i <= 2; i++) {
      const dOffset = new Date(dSel.getTime() + i * 864e5);
      const ymd = dOffset.toLocaleDateString('en-CA');
      const rot = i === 0 ? 'Escolhida' : dOffset.toLocaleDateString('pt-BR', { weekday: 'short' });
      const b = document.createElement('div');
      b.className = 'dia' + (ymd === diaSel ? ' ativo' : '');
      b.id = 'dia-' + ymd;
      b.innerHTML = `<small>${rot}</small><b>${dOffset.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</b><span class="ano-sub">${dOffset.getFullYear()}</span>`;
      b.onclick = () => { diaSel = ymd; renderDias(); carregarJogos(); };
      el.appendChild(b);
    }
  }

  // Controles do seletor de calendário e atalho de voltar para hoje
  const inputData = document.getElementById('data-escolhida');
  if (inputData) inputData.value = diaSel;
  const btnHoje = document.getElementById('btn-hoje');
  if (btnHoje) btnHoje.classList.toggle('oculto', diaSel === hoje);
  const lbl = document.getElementById('label-calendario');
  if (lbl) {
    lbl.textContent = diaSel === hoje ? 'Calendário' : dSel.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
}

function linhaTime(c, final, vencedor) {
  const rec = c.records?.[0]?.summary || '';
  return `<div class="time ${final && !vencedor ? 'perdeu' : ''}">
    <img src="${c.team.logo}" alt="${c.team.abbreviation}" loading="lazy">
    <div class="nome">${c.team.displayName}<small>${rec}</small></div>
    <div class="pts">${c.score ?? ''}</div></div>`;
}

async function carregarJogos() {
  const el = document.getElementById('jogos');
  el.innerHTML = '<p class="vazio">Carregando…</p>';
  try {
    const amanha = new Date(new Date(diaSel + 'T12:00:00').getTime() + 864e5).toLocaleDateString('en-CA');
    const ontem = new Date(new Date(diaSel + 'T12:00:00').getTime() - 864e5).toLocaleDateString('en-CA');
    const res = await Promise.all([ontem, diaSel, amanha].map(scoreboard));
    const vistos = new Set();
    let eventos = res.flatMap(r => r.events || [])
      .filter(e => !vistos.has(e.id) && vistos.add(e.id))
      .filter(e => new Date(e.date).toLocaleDateString('en-CA', { timeZone: TZ }) === diaSel)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const soTv = document.getElementById('so-tv').checked;
    if (soTv) eventos = eventos.filter(e => canaisDoJogo(e).tv);
    if (!eventos.length) { el.innerHTML = '<p class="vazio">Nenhum jogo neste dia 😴</p>'; return; }

    el.innerHTML = eventos.map((ev, i) => {
      const comp = ev.competitions[0];
      const st = comp.status.type;
      const final = st.completed;
      const away = comp.competitors.find(c => c.homeAway === 'away');
      const home = comp.competitors.find(c => c.homeAway === 'home');
      const statusTxt = st.state === 'in' ? `<span class="aovivo">AO VIVO · ${comp.status.displayClock} ${comp.status.period}ºQ</span>`
        : final ? '<b>Final</b>' : `<b>${fmtHora(ev.date)}</b>`;
      const { lista } = canaisDoJogo(ev);
      const lid = final ? comp.competitors.map(c => {
        const p = c.leaders?.find(l => l.name === 'points')?.leaders?.[0];
        return p ? `${p.athlete.shortName} ${p.displayValue} pts` : '';
      }).filter(Boolean).join(' · ') : '';
      return `<a class="jogo" id="jogo-${ev.id}" href="#/jogo/${ev.id}" style="animation-delay:${i * 40}ms">
        <div class="status">${statusTxt}<span>${comp.venue?.fullName || ''}</span></div>
        ${linhaTime(away, final, away.winner)}${linhaTime(home, final, home.winner)}
        ${lid ? `<div class="lideres">🔥 ${lid}</div>` : ''}
        <div class="canais">📺 ${lista.map(n => `<span class="canal ${classeCanal(n)}">${n}</span>`).join('')}</div>
      </a>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<p class="vazio">Erro ao carregar jogos. Tente atualizar.</p>';
    console.error(e);
  }
}

// ---------- classificação histórica ----------
let temporadaSel = '';

function popularSeletorTemporadas() {
  const sel = document.getElementById('sel-temporada');
  if (!sel || sel.options.length > 0) return;
  // A temporada da NBA usa o ano de término (ex: 2026-27 = 2027 na ESPN)
  const anoAtual = new Date().getFullYear() + 1;
  for (let ano = anoAtual; ano >= 2002; ano--) {
    const opt = document.createElement('option');
    opt.value = ano;
    const inicio = ano - 1;
    const fim = String(ano).slice(2);
    opt.textContent = `${inicio}-${fim}${ano === anoAtual ? ' (Atual)' : ''}`;
    sel.appendChild(opt);
  }
  sel.onchange = () => {
    temporadaSel = sel.value;
    carregarTabela(temporadaSel);
  };
}

async function carregarTabela(ano) {
  popularSeletorTemporadas();
  const el = document.getElementById('tabela');
  el.innerHTML = '<p class="vazio">Carregando…</p>';
  const sel = document.getElementById('sel-temporada');
  const temp = ano || (sel ? sel.value : '') || '';
  const q = temp ? `?season=${temp}` : '';
  const data = await buscarJSON(`/api/standings${q}`, `${ESPN}/v2/sports/basketball/nba/standings?region=br&lang=pt${temp ? `&season=${temp}` : ''}`);
  const stat = (e, n) => e.stats?.find(s => s.name === n || s.type === n)?.displayValue ?? '-';
  if (!data?.children?.length) {
    el.innerHTML = '<p class="vazio">Classificação não disponível para esta temporada.</p>';
    return;
  }
  el.innerHTML = (data.children || []).map(conf => {
    const linhas = [...conf.standings.entries]
      .sort((a, b) => parseFloat(stat(b, 'winPercent')) - parseFloat(stat(a, 'winPercent')))
      .map((e, i) => `<tr><td>${i + 1}</td><td><a href="#/time/${e.team.id}"><img src="${e.team.logos?.[0]?.href || ''}" alt="">${e.team.shortDisplayName}</a></td>
        <td>${stat(e, 'wins')}</td><td>${stat(e, 'losses')}</td><td>${stat(e, 'winPercent')}</td>
        <td>${stat(e, 'gamesBehind')}</td><td>${stat(e, 'streak')}</td></tr>`).join('');
    return `<div class="conf"><h2>${conf.name}</h2><table>
      <thead><tr><th>#</th><th>Time</th><th>V</th><th>D</th><th>%</th><th>GB</th><th>Seq</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>`;
  }).join('');
}

// ---------- rotas (#/jogos, #/tabela, #/lideres, #/jogo/ID, #/jogador/ID, #/time/ID) ----------
function rotear() {
  const [, rota = 'jogos', id] = (location.hash || '#/jogos').split('/');
  const detalhe = ['jogo', 'jogador', 'time'].includes(rota);
  const view = detalhe ? 'detalhe' : rota;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('oculto', v.id !== 'view-' + view));
  document.querySelectorAll('.abas .aba').forEach(b => b.classList.toggle('ativa', b.dataset.view === rota));
  if (rota !== 'jogo') clearTimeout(timerJogo);
  window.scrollTo(0, 0);
  if (rota === 'tabela') carregarTabela();
  else if (rota === 'lideres') viewLideres();
  else if (rota === 'jogo') viewJogo(id);
  else if (rota === 'jogador') viewJogador(id);
  else if (rota === 'time') viewTime(id);
}

// ---------- init ----------
document.querySelectorAll('.abas .aba').forEach(b => b.onclick = () => { location.hash = '#/' + b.dataset.view; });
window.addEventListener('hashchange', rotear);
document.getElementById('btn-atualizar').onclick = carregarJogos;
document.getElementById('so-tv').onchange = carregarJogos;

const inputDataEl = document.getElementById('data-escolhida');
const btnCalEl = document.getElementById('btn-calendario');

if (btnCalEl && inputDataEl) {
  if (!('showPicker' in HTMLInputElement.prototype)) {
    // Fallback para navegadores muito antigos: sobrepõe o input invisível sobre o botão
    inputDataEl.style.width = '100%';
    inputDataEl.style.height = '100%';
    inputDataEl.style.pointerEvents = 'auto';
  } else {
    btnCalEl.onclick = () => {
      try {
        inputDataEl.showPicker();
      } catch (err) {
        inputDataEl.focus();
        inputDataEl.click();
      }
    };
  }
}

if (inputDataEl) {
  inputDataEl.onchange = (e) => {
    if (e.target.value) {
      diaSel = e.target.value;
      renderDias();
      carregarJogos();
    }
  };
}
const btnHojeEl = document.getElementById('btn-hoje');
if (btnHojeEl) {
  btnHojeEl.onclick = () => {
    diaSel = hojeBR();
    renderDias();
    carregarJogos();
  };
}

(async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try { overrides = await (await fetch('transmissoes.json', { cache: 'no-store' })).json(); } catch {}
  try { lakersBR = (await (await fetch('/api/transmissoes')).json()).jogos || []; } catch {}
  renderDias();
  carregarJogos();
  rotear();
  // atualiza placares a cada 60s só quando a lista de jogos está visível
  setInterval(() => { if (!document.getElementById('view-jogos').classList.contains('oculto')) carregarJogos(); }, 60000);
})();
