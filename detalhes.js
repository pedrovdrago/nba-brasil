// Telas de detalhe: jogo (box score + lance a lance), jogador, time e líderes da liga.
// Todas usam /api/espn (proxy) e são abertas por rotas no endereço (#/jogo/ID etc).

async function espn(t, id) {
  const r = await fetch(`/api/espn?t=${t}&id=${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`${t} ${r.status}`);
  return r.json();
}
const $det = () => document.getElementById('detalhe');
const carregando = () => { $det().innerHTML = '<p class="vazio">Carregando…</p>'; };
const erro = e => { console.error(e); $det().innerHTML = '<p class="vazio">Não foi possível carregar 😕</p>'; };
const voltar = '<button class="btn voltar" onclick="history.length > 1 ? history.back() : (location.hash = \'#/jogos\')">← Voltar</button>';
const lnkJog = (id, nome) => `<a href="#/jogador/${id}">${nome}</a>`;
let timerJogo = null;

// ===================== JOGO =====================
let jogoAba = 'box', jogoQuarto = 0;

async function viewJogo(id, silencioso = false) {
  clearTimeout(timerJogo);
  if (!silencioso) { jogoAba = 'box'; jogoQuarto = 0; carregando(); }
  try {
    const s = await espn('summary', id);
    const comp = s.header.competitions[0];
    const st = comp.status.type;
    const away = comp.competitors.find(c => c.homeAway === 'away');
    const home = comp.competitors.find(c => c.homeAway === 'home');
    const status = st.state === 'in' ? `<span class="aovivo">AO VIVO · ${comp.status.displayClock} ${comp.status.period}ºQ</span>`
      : st.completed ? 'Final' : fmtHora(comp.date) + ' · ' + new Date(comp.date).toLocaleDateString('pt-BR', { timeZone: TZ });

    const placarTime = c => `<a class="pl-time ${st.completed && !c.winner ? 'perdeu' : ''}" href="#/time/${c.team.id}">
      <img src="${c.team.logos?.[0]?.href || c.team.logo || ''}" alt=""><b>${c.team.abbreviation}</b><small>${c.record?.[0]?.summary || ''}</small></a>`;

    // pontos por quarto
    const qs = Math.max(away.linescores?.length || 0, home.linescores?.length || 0);
    const linha = c => `<tr><td>${c.team.abbreviation}</td>${Array.from({ length: qs }, (_, i) =>
      `<td>${c.linescores?.[i]?.displayValue ?? '-'}</td>`).join('')}<td><b>${c.score ?? ''}</b></td></tr>`;
    const quartos = qs ? `<table class="quartos"><thead><tr><th></th>${Array.from({ length: qs }, (_, i) =>
      `<th>${i < 4 ? i + 1 + 'º' : 'OT' + (i - 3)}</th>`).join('')}<th>T</th></tr></thead><tbody>${linha(away)}${linha(home)}</tbody></table>` : '';

    $det().innerHTML = `${voltar}
      <section class="placar-grande">
        ${placarTime(away)}
        <div class="pl-centro"><div class="pl-pts">${away.score ?? ''} <span>×</span> ${home.score ?? ''}</div><div class="pl-status">${status}</div></div>
        ${placarTime(home)}
      </section>
      ${quartos}
      <nav class="sub-abas">
        <button id="j-box" class="aba ${jogoAba === 'box' ? 'ativa' : ''}">Box score</button>
        <button id="j-times" class="aba ${jogoAba === 'times' ? 'ativa' : ''}">Times</button>
        <button id="j-lances" class="aba ${jogoAba === 'lances' ? 'ativa' : ''}">Lance a lance</button>
      </nav>
      <div id="jogo-conteudo"></div>`;

    const render = () => {
      const el = document.getElementById('jogo-conteudo');
      if (jogoAba === 'box') el.innerHTML = boxScore(s);
      else if (jogoAba === 'times') el.innerHTML = statsTimes(s);
      else el.innerHTML = lances(s, away, home);
      document.querySelectorAll('.sub-abas .aba').forEach(b => b.classList.toggle('ativa', b.id === 'j-' + jogoAba));
      document.querySelectorAll('.q-btn').forEach(b => b.onclick = () => { jogoQuarto = +b.dataset.q; render(); });
    };
    ['box', 'times', 'lances'].forEach(a => document.getElementById('j-' + a).onclick = () => { jogoAba = a; render(); });
    render();

    if (st.state === 'in') timerJogo = setTimeout(() => location.hash === '#/jogo/' + id && viewJogo(id, true), 30000);
  } catch (e) { if (!silencioso) erro(e); }
}

function boxScore(s) {
  const times = s.boxscore?.players || [];
  if (!times.length) return '<p class="vazio">Box score disponível quando o jogo começar.</p>';
  return times.map(t => {
    const st = t.statistics[0];
    const linhas = st.athletes.map(a => {
      if (a.didNotPlay || !a.stats?.length) return `<tr class="dnp"><td class="fixa">${lnkJog(a.athlete.id, a.athlete.shortName)}</td><td colspan="${st.labels.length}">${a.reason || 'Não jogou'}</td></tr>`;
      return `<tr class="${a.starter ? 'titular' : ''}"><td class="fixa">${lnkJog(a.athlete.id, a.athlete.shortName)}<small>${a.athlete.position?.abbreviation || ''}</small></td>${a.stats.map(v => `<td>${v}</td>`).join('')}</tr>`;
    }).join('');
    const tot = st.totals?.length ? `<tr class="total"><td class="fixa">Total</td>${st.totals.map(v => `<td>${v}</td>`).join('')}</tr>` : '';
    return `<div class="card-det"><h3><img src="${t.team.logo}" alt="">${t.team.displayName}</h3>
      <div class="rolagem"><table class="box"><thead><tr><th class="fixa">Jogador</th>${st.labels.map(l => `<th>${l}</th>`).join('')}</tr></thead>
      <tbody>${linhas}${tot}</tbody></table></div></div>`;
  }).join('');
}

function statsTimes(s) {
  const [a, b] = s.boxscore?.teams || [];
  if (!a || !a.statistics?.length) return '<p class="vazio">Sem estatísticas ainda.</p>';
  const linhas = a.statistics.map((st, i) => {
    const v2 = b.statistics[i]?.displayValue ?? '-';
    return `<tr><td>${st.displayValue}</td><th>${st.label}</th><td>${v2}</td></tr>`;
  }).join('');
  return `<div class="card-det"><table class="comparar"><thead><tr><th><img src="${a.team.logo}" alt=""> ${a.team.abbreviation}</th><th></th>
    <th>${b.team.abbreviation} <img src="${b.team.logo}" alt=""></th></tr></thead><tbody>${linhas}</tbody></table></div>`;
}

function lances(s, away, home) {
  const plays = s.plays || [];
  if (!plays.length) return '<p class="vazio">Lance a lance disponível quando o jogo começar.</p>';
  const nQ = Math.max(...plays.map(p => p.period?.number || 1));
  if (!jogoQuarto) jogoQuarto = nQ;
  const logo = {}; [away, home].forEach(c => logo[c.team.id] = c.team.logos?.[0]?.href || c.team.logo);
  const btns = Array.from({ length: nQ }, (_, i) => `<button class="q-btn dia ${jogoQuarto === i + 1 ? 'ativo' : ''}" data-q="${i + 1}">${i < 4 ? i + 1 + 'º Q' : 'OT' + (i - 3)}</button>`).join('');
  const itens = plays.filter(p => p.period?.number === jogoQuarto).reverse().map(p => `
    <li class="${p.scoringPlay ? 'cesta' : ''}">
      <span class="relogio">${p.clock?.displayValue || ''}</span>
      ${p.team?.id && logo[p.team.id] ? `<img src="${logo[p.team.id]}" alt="">` : '<span class="sem-logo"></span>'}
      <span class="texto">${p.text}</span>
      <span class="parcial">${p.awayScore}-${p.homeScore}</span>
    </li>`).join('');
  return `<div class="dias q-lista">${btns}</div><ul class="lances card-det">${itens}</ul>`;
}

// ===================== JOGADOR =====================
async function viewJogador(id) {
  carregando();
  try {
    const [a, ov, gl] = await Promise.all([espn('athlete', id), espn('overview', id).catch(() => null), espn('gamelog', id).catch(() => null)]);
    const p = a.athlete;
    const cor = p.team?.color ? '#' + p.team.color : '#333';

    let medias = '';
    if (ov?.statistics?.splits?.length) {
      const L = ov.statistics.labels;
      medias = `<div class="card-det"><h3>Médias</h3><div class="rolagem"><table class="box"><thead><tr><th class="fixa"></th>${L.map(l => `<th>${l}</th>`).join('')}</tr></thead>
        <tbody>${ov.statistics.splits.map(sp => `<tr><td class="fixa">${sp.displayName}</td>${sp.stats.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
      // destaques
      const idx = n => L.indexOf(n);
      const temp = ov.statistics.splits[0].stats;
      medias = `<div class="destaques">${[['PTS', 'Pontos'], ['REB', 'Rebotes'], ['AST', 'Assist.'], ['FG%', 'Arremesso %']]
        .filter(([k]) => idx(k) >= 0).map(([k, n]) => `<div><b>${temp[idx(k)]}</b><small>${n}</small></div>`).join('')}</div>` + medias;
    }

    let jogos = '';
    if (gl?.seasonTypes?.length) {
      const evs = gl.seasonTypes[0].categories.flatMap(c => c.events || []).slice(0, 10);
      jogos = `<div class="card-det"><h3>Últimos jogos</h3><div class="rolagem"><table class="box"><thead><tr><th class="fixa">Jogo</th>${gl.labels.map(l => `<th>${l}</th>`).join('')}</tr></thead><tbody>
        ${evs.map(e => {
          const g = gl.events[e.eventId] || {};
          const data = g.gameDate ? new Date(g.gameDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }) : '';
          return `<tr><td class="fixa"><a href="#/jogo/${e.eventId}">${data} ${g.atVs || ''} ${g.opponent?.abbreviation || ''}</a>
            <small class="${g.gameResult === 'V' || g.gameResult === 'W' ? 'res-v' : 'res-d'}">${g.gameResult || ''} ${g.score || ''}</small></td>${e.stats.map(v => `<td>${v}</td>`).join('')}</tr>`;
        }).join('')}</tbody></table></div></div>`;
    }

    $det().innerHTML = `${voltar}
      <section class="perfil" style="--cor:${cor}">
        <img class="foto" src="${p.headshot?.href || ''}" alt="${p.displayName}">
        <div>
          <h2>${p.displayName} <span>${p.displayJersey || ''}</span></h2>
          <p>${p.position?.displayName || ''} · ${p.team ? `<a href="#/time/${p.team.id}">${p.team.displayName}</a>` : ''}</p>
          <p class="mut">${[p.age && p.age + ' anos', p.displayHeight, p.displayWeight, p.displayBirthPlace].filter(Boolean).join(' · ')}</p>
        </div>
      </section>
      ${medias}${jogos}`;
  } catch (e) { erro(e); }
}

// ===================== TIME =====================
async function viewTime(id) {
  carregando();
  try {
    const [r, sc] = await Promise.all([espn('roster', id), espn('schedule', id)]);
    const t = r.team;
    const evs = sc.events || [];
    const feitos = evs.filter(e => e.competitions[0].status.type.completed).slice(-5).reverse();
    const proximos = evs.filter(e => !e.competitions[0].status.type.completed).slice(0, 5);
    const linhaJogo = e => {
      const c = e.competitions[0];
      const eu = c.competitors.find(x => x.team.id === String(id)) || c.competitors[0];
      const opp = c.competitors.find(x => x !== eu);
      const fim = c.status.type.completed;
      const res = fim ? `<b class="${eu.winner ? 'res-v' : 'res-d'}">${eu.winner ? 'V' : 'D'} ${eu.score?.displayValue}-${opp.score?.displayValue}</b>`
        : `${new Date(e.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ })} ${fmtHora(e.date)}`;
      return `<a class="linha-jogo" href="#/jogo/${e.id}"><span>${eu.homeAway === 'home' ? 'x' : '@'}</span>
        <img src="${opp.team.logos?.[0]?.href || ''}" alt=""><span class="flex1">${opp.team.displayName}</span>${res}</a>`;
    };
    const elenco = (r.athletes || []).map(a => `<a class="jogador-card" href="#/jogador/${a.id}">
      <img src="${a.headshot?.href || '/icons/icon-192.png'}" alt="" loading="lazy">
      <div><b>${a.displayName}</b><small>#${a.jersey || '-'} · ${a.position?.abbreviation || ''} · ${a.displayHeight || ''} · ${a.age || '-'} anos</small></div></a>`).join('');

    $det().innerHTML = `${voltar}
      <section class="perfil" style="--cor:#${t.color || '333'}">
        <img class="foto logo" src="${t.logo}" alt="${t.displayName}">
        <div><h2>${t.displayName}</h2><p>${t.recordSummary || ''} · ${t.standingSummary || ''}</p>
        ${r.coach?.[0] ? `<p class="mut">Técnico: ${r.coach[0].firstName} ${r.coach[0].lastName}</p>` : ''}</div>
      </section>
      <div class="duas-col">
        <div class="card-det"><h3>Últimos jogos</h3>${feitos.map(linhaJogo).join('') || '<p class="mut">—</p>'}</div>
        <div class="card-det"><h3>Próximos jogos</h3>${proximos.map(linhaJogo).join('') || '<p class="mut">—</p>'}</div>
      </div>
      <div class="card-det"><h3>Elenco</h3><div class="elenco">${elenco}</div></div>`;
  } catch (e) { erro(e); }
}

// ===================== LÍDERES =====================
const CATS = [
  ['Pontos', 'offensive.avgPoints'], ['Rebotes', 'general.avgRebounds'], ['Assistências', 'offensive.avgAssists'],
  ['Roubos', 'defensive.avgSteals'], ['Tocos', 'defensive.avgBlocks'], ['Bolas de 3', 'offensive.avgThreePointFieldGoalsMade'],
];

async function viewLideres() {
  const el = document.getElementById('lideres');
  if (el.dataset.ok) return;
  el.innerHTML = '<p class="vazio">Carregando…</p>';
  try {
    const res = await Promise.all(CATS.map(([, sort]) => espn('leaders', sort + ':desc')));
    el.innerHTML = res.map((j, i) => {
      const [nome, sort] = CATS[i];
      const [grupo, stat] = sort.split('.');
      const pos = j.categories.find(c => c.name === grupo).names.indexOf(stat);
      const lista = j.athletes.slice(0, 10).map((a, k) => {
        const v = a.categories.find(c => c.name === grupo)?.totals?.[pos] ?? '-';
        return `<a class="lider ${k === 0 ? 'top' : ''}" href="#/jogador/${a.athlete.id}"><span class="pos">${k + 1}</span>
          <img src="${a.athlete.headshot?.href || '/icons/icon-192.png'}" alt="" loading="lazy">
          <span class="flex1">${a.athlete.displayName}<small>${a.athlete.teamShortName || ''}</small></span><b>${v}</b></a>`;
      }).join('');
      return `<div class="card-det"><h3>${nome} <small class="mut">por jogo</small></h3>${lista}</div>`;
    }).join('');
    el.dataset.ok = 1;
  } catch (e) { console.error(e); el.innerHTML = '<p class="vazio">Não foi possível carregar 😕</p>'; }
}
