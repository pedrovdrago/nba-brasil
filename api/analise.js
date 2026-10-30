// /api/analise.js - Analisador de Jogos NBA com IA (Google Gemini)
// Analisa confrontos, gera resumo de 1 parágrafo e calcula o ranking de hype com foguinho.

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { date } = req.query;
  const diaClean = String(date || '').replace(/[^0-9]/g, '');
  if (!diaClean || diaClean.length < 8) {
    return res.status(400).json({ error: 'Data inválida. Formato: YYYYMMDD ou YYYY-MM-DD' });
  }

  // Cache no Vercel CDN por 3 horas, stale-while-revalidate por 6 horas
  res.setHeader('Cache-Control', 's-maxage=10800, stale-while-revalidate=21600');

  try {
    const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?region=br&lang=pt&dates=${diaClean}&limit=50`;
    const espnRes = await fetch(espnUrl);
    if (!espnRes.ok) throw new Error('Falha ao consultar ESPN');
    const espnData = await espnRes.json();
    const events = espnData.events || [];

    if (!events.length) {
      return res.status(200).json({ date: diaClean, jogos: {} });
    }

    const jogosSimplificados = events.map(ev => {
      const comp = ev.competitions[0];
      const away = comp.competitors.find(c => c.homeAway === 'away');
      const home = comp.competitors.find(c => c.homeAway === 'home');
      return {
        id: ev.id,
        away: away?.team?.displayName || 'Visitante',
        awayRecord: away?.records?.[0]?.summary || '',
        home: home?.team?.displayName || 'Mandante',
        homeRecord: home?.records?.[0]?.summary || '',
        dataHora: ev.date
      };
    });

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (apiKey) {
      try {
        const resultadoGemini = await analisarComGemini(jogosSimplificados, apiKey, diaClean);
        return res.status(200).json(resultadoGemini);
      } catch (geminiErr) {
        console.error('Erro na chamada ao Gemini, usando gerador heurístico:', geminiErr);
      }
    }

    // Fallback inteligente caso a chave não esteja configurada ou atinja cota
    const fallback = gerarAnaliseHeuristica(jogosSimplificados, diaClean);
    return res.status(200).json(fallback);
  } catch (err) {
    console.error('Erro no endpoint de análise:', err);
    return res.status(500).json({ error: 'Erro ao processar análise da rodada' });
  }
}

async function analisarComGemini(jogos, apiKey, dataStr) {
  const prompt = `Você é um analista especialista em basquete da NBA focado no público brasileiro.
Hoje é a data ${dataStr}. Analise os seguintes confrontos da rodada da NBA:

${JSON.stringify(jogos, null, 2)}

INSTRUÇÕES OBRIGATÓRIAS:
1. Para CADA jogo da lista, avalie o nível de interesse considerando rivalidades históricas, astros em quadra, briga direta por classificação/playoffs, sequências de vitórias e momento dos times.
2. Atribua um "hype_score" de 0 a 100 para cada jogo.
3. Crie um campo "motivo": exatamente UM parágrafo direto, dinâmico e empolgante (em português do Brasil, no máximo 350 caracteres) explicando por que este jogo vale muito a pena ser assistido pelo fã de basquete.
4. Crie um campo "destaque" (boolean) para indicar quais jogos recebem o efeito visual de FOGO/CHAMA no site:
   - REGRA DO FOGO:
     * O jogo com maior hype_score DEVE OBRIGATORIAMENTE ter "destaque": true (mínimo 1 jogo com foguinho por dia).
     * Se houver outro confronto imperdível de nível muito próximo (hype >= 85), pode marcar um 2º jogo com "destaque": true.
     * Ocasionalmente um 3º jogo pode ser destaque se for uma rodada épica com múltiplos clássicos decisivos.
     * NUNCA marque mais de 3 jogos como destaque=true. No máximo 3.
5. Crie um campo "titulo_destaque" curto (ex: "🔥 Duelo de Gigantes", "🔥 Clássico Histórico", "🔥 Batalha de Conferência", etc.).

Responda APENAS com um JSON puro no seguinte formato:
{
  "jogos": [
    {
      "id": "ID_DO_JOGO",
      "hype_score": 95,
      "destaque": true,
      "titulo_destaque": "🔥 Duelo de Titãs",
      "motivo": "Texto vibrante de um parágrafo..."
    }
  ]
}`;

  // Tenta gemini-2.5-flash e fallback para gemini-1.5-flash
  const modelos = ['gemini-2.5-flash', 'gemini-1.5-flash'];
  let lastErr = null;

  for (const modelo of modelos) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.3
          }
        })
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${modelo} retornou status ${res.status}: ${txt}`);
      }

      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) throw new Error('Resposta vazia');
      const parsed = JSON.parse(raw);
      return normalizarDestaques(parsed.jogos || [], jogos, dataStr);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('Falha em todos os modelos Gemini');
}

function normalizarDestaques(itensIA, jogosOriginais, dataStr) {
  const mapIA = {};
  itensIA.forEach(j => { if (j.id) mapIA[j.id] = j; });

  const lista = jogosOriginais.map(j => {
    const ia = mapIA[j.id] || {};
    return {
      id: j.id,
      hype_score: typeof ia.hype_score === 'number' ? ia.hype_score : 70,
      destaque: Boolean(ia.destaque),
      titulo_destaque: ia.titulo_destaque || 'Destaque da Rodada',
      motivo: ia.motivo || `Confronto decisivo entre ${j.away} e ${j.home} com peso direto na tabela.`
    };
  });

  // Ordena por hype_score decrescente
  lista.sort((a, b) => b.hype_score - a.hype_score);

  // Regra do Foguinho:
  // 1. O jogo #1 é SEMPRE destaque
  if (lista.length > 0) lista[0].destaque = true;

  // 2. Limita o número de destaques entre 1 e 3
  let totalDestaques = 0;
  lista.forEach((item, index) => {
    if (index === 0) {
      item.destaque = true;
      totalDestaques++;
    } else if (item.destaque && totalDestaques < 3 && item.hype_score >= 84) {
      totalDestaques++;
    } else {
      item.destaque = false;
    }
  });

  const jogosObj = {};
  lista.forEach(item => {
    jogosObj[item.id] = item;
  });

  return {
    date: dataStr,
    fonte: 'gemini',
    jogos: jogosObj
  };
}

// Gerador heurístico caso a chave ainda não tenha sido configurada no Vercel
function gerarAnaliseHeuristica(jogos, dataStr) {
  const rivalidades = [
    ['Lakers', 'Celtics'], ['Warriors', 'Cavaliers'], ['Knicks', 'Celtics'],
    ['Bucks', 'Celtics'], ['Heat', 'Knicks'], ['Clippers', 'Lakers'],
    ['Mavericks', 'Suns'], ['76ers', 'Celtics'], ['Nuggets', 'Timberwolves'],
    ['Warriors', 'Lakers'], ['Rockets', 'Spurs'], ['Bulls', 'Pistons']
  ];

  const pontuados = jogos.map(j => {
    let score = 65;
    const matchupStr = `${j.away} ${j.home}`;
    const ehRivalidade = rivalidades.some(([a, b]) => matchupStr.includes(a) && matchupStr.includes(b));
    if (ehRivalidade) score += 25;

    // Astros / times de grande apelo
    if (/Lakers|Warriors|Celtics|Nuggets|Bucks|Mavericks|Knicks/.test(matchupStr)) score += 8;

    score = Math.min(98, score + Math.floor(Math.random() * 6));

    let motivo = '';
    if (ehRivalidade) {
      motivo = `Um dos maiores clássicos da liga coloca frente a frente ${j.away} e ${j.home}. Uma partida carregada de tensão histórica, rivalidade acirrada e promessa de final emocionante até o último segundo.`;
    } else if (score >= 85) {
      motivo = `Confronto de alto impacto entre ${j.away} (${j.awayRecord}) e ${j.home} (${j.homeRecord}). Duelo estratégico com estrelas decisivas em quadra e implicações diretas na disputa de posições na conferência.`;
    } else {
      motivo = `Partida competitiva entre ${j.away} e ${j.home}. Ambos os times buscam impor ritmo e ajustar a rotação, com matchups individuais intensos nas duas pontas da quadra.`;
    }

    return {
      id: j.id,
      hype_score: score,
      destaque: false,
      titulo_destaque: ehRivalidade ? '🔥 Grande Rivalidade' : '🔥 Jogo Imperdível',
      motivo
    };
  });

  pontuados.sort((a, b) => b.hype_score - a.hype_score);

  // Aplica as regras: mínimo 1, máximo 3
  if (pontuados.length > 0) pontuados[0].destaque = true;
  if (pontuados.length > 1 && pontuados[1].hype_score >= 86) pontuados[1].destaque = true;
  if (pontuados.length > 2 && pontuados[2].hype_score >= 90) pontuados[2].destaque = true;

  const jogosObj = {};
  pontuados.forEach(p => { jogosObj[p.id] = p; });

  return {
    date: dataStr,
    fonte: 'heuristica',
    jogos: jogosObj
  };
}
