// Extrai "onde assistir" do dia em lakersbrasil.com/onde-assistir-nba/
// Cache na CDN do Vercel até as próximas 15h (Brasília) → busca 1x por dia, à tarde.
const FONTE = 'https://lakersbrasil.com/onde-assistir-nba/';

function segundosAte15hBR() {
  const agora = new Date();
  const alvo = new Date(agora);
  alvo.setUTCHours(18, 0, 0, 0); // 15h BRT = 18h UTC
  if (alvo <= agora) alvo.setUTCDate(alvo.getUTCDate() + 1);
  return Math.max(60, Math.floor((alvo - agora) / 1000));
}

const limpar = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();

export function extrair(html) {
  const ini = html.indexOf('lbr-hoje:inicio');
  const fim = html.indexOf('lbr-hoje:fim', ini);
  const bloco = html.slice(ini, fim > 0 ? fim : ini + 60000);
  const data = limpar((bloco.match(/Jogos de hoje<\/div><div[^>]*>([^<]+)</) || [])[1] || '');
  // cada linha de jogo começa com o horário (ex: "20h" ou "20h30")
  const partes = bloco.split(/(?=<div style="flex:0 0 50px)/).slice(1);
  const jogos = partes.map(p => {
    const hora = limpar((p.match(/flex:0 0 50px[^>]*>([^<]+)</) || [])[1] || '');
    const times = [...p.matchAll(/<span style="font-size:15px[^>]*>([^<]+)<\/span>/g)].map(m => limpar(m[1]));
    const canais = [...p.matchAll(/<span style="display:inline-block[^>]*>([^<]+)<\/span>/g)].map(m => limpar(m[1]));
    return { hora, times, canais };
  }).filter(j => j.times.length === 2);
  return { data, jogos };
}

export default async function handler(req, res) {
  try {
    const r = await fetch(FONTE, { headers: { 'User-Agent': 'Mozilla/5.0 (uso pessoal)' } });
    const out = extrair(await r.text());
    out.atualizadoEm = new Date().toISOString();
    res.setHeader('Cache-Control', `s-maxage=${segundosAte15hBR()}, stale-while-revalidate=3600`);
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: 'Falha ao ler Lakers Brasil', jogos: [] });
  }
}
