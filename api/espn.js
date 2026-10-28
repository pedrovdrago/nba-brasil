// Proxy genérico para os endpoints da ESPN usados pelo app.
// Uso: /api/espn?t=summary&id=401909848
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba';
const Q = 'region=br&lang=pt';

const ROTAS = {
  summary:  id => [`${SITE}/summary?event=${id}&${Q}`, 20],           // box score + lance a lance
  athlete:  id => [`${WEB}/athletes/${id}?${Q}`, 3600],               // bio do jogador
  overview: id => [`${WEB}/athletes/${id}/overview?${Q}`, 900],       // médias
  gamelog:  id => [`${WEB}/athletes/${id}/gamelog?${Q}`, 900],        // últimos jogos
  roster:   id => [`${SITE}/teams/${id}/roster?${Q}`, 3600],          // elenco
  schedule: id => [`${SITE}/teams/${id}/schedule?${Q}`, 600],         // calendário do time
  leaders:  sort => [`${WEB}/statistics/byathlete?${Q}&limit=15&contentorigin=espn&sort=${sort}`, 1800],
};

export default async function handler(req, res) {
  const { t, id = '' } = req.query;
  const rota = ROTAS[t];
  const valor = String(id).replace(/[^a-zA-Z0-9.:_-]/g, '');
  if (!rota || !valor) return res.status(400).json({ error: 'parâmetros inválidos' });
  const [url, cache] = rota(valor);
  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error: 'ESPN ' + r.status });
    res.setHeader('Cache-Control', `s-maxage=${cache}, stale-while-revalidate=${cache * 2}`);
    res.status(200).json(await r.json());
  } catch {
    res.status(502).json({ error: 'Falha ao buscar ESPN' });
  }
}
