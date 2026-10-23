// Proxy da API pública da ESPN (região Brasil). Uso: /api/scoreboard?dates=20261023
export default async function handler(req, res) {
  const dates = String(req.query.dates || '').replace(/[^0-9-]/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?region=br&lang=pt&limit=50${dates ? `&dates=${dates}` : ''}`;
  try {
    const r = await fetch(url);
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Falha ao buscar dados da ESPN' });
  }
}
