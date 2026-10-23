// Proxy da classificação da NBA (ESPN)
export default async function handler(req, res) {
  const url = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?region=br&lang=pt';
  try {
    const r = await fetch(url);
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Falha ao buscar classificação' });
  }
}
