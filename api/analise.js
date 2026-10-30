// /api/analise.js - Analisador de Jogos NBA com Google Gemini
// Analisa confrontos, gera resumo de 1 parágrafo e calcula o ranking de hype com foguinho.

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { date, force } = req.query;
  const diaClean = String(date || '').replace(/[^0-9]/g, '');
  if (!diaClean || diaClean.length < 8) {
    return res.status(400).json({ error: 'Data inválida. Formato: YYYYMMDD ou YYYY-MM-DD' });
  }

  try {
    const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?region=br&lang=pt&dates=${diaClean}&limit=50`;
    const espnRes = await fetch(espnUrl);
    if (!espnRes.ok) throw new Error('Falha ao consultar ESPN');
    const espnData = await espnRes.json();
    const events = espnData.events || [];

    if (!events.length) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).json({ date: diaClean, fonte: 'sem_jogos', jogos: {} });
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

    const rawKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
    const apiKey = rawKey.trim().replace(/^["']|["']$/g, '');
    let erroGeminiMsg = '';

    if (apiKey) {
      try {
        const resultadoGemini = await analisarComGemini(jogosSimplificados, apiKey, diaClean);
        // Cache na Vercel CDN por 4 horas apenas quando a IA gerou com sucesso
        if (!force) {
          res.setHeader('Cache-Control', 's-maxage=14400, stale-while-revalidate=28800');
        } else {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
        return res.status(200).json(resultadoGemini);
      } catch (geminiErr) {
        console.error('Falha na chamada ao Gemini:', geminiErr);
        erroGeminiMsg = geminiErr.message || String(geminiErr);
      }
    } else {
      erroGeminiMsg = 'Variável de ambiente GEMINI_API_KEY não encontrada no Vercel.';
    }

    // Se o Gemini falhou ou a chave não existe, NUNCA cacheie o fallback
    // para permitir que o usuário adicione a chave e veja o Gemini imediatamente
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const fallback = gerarAnaliseHeuristica(jogosSimplificados, diaClean, erroGeminiMsg, Boolean(apiKey));
    return res.status(200).json(fallback);
  } catch (err) {
    console.error('Erro geral no endpoint de análise:', err);
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(500).json({ error: 'Erro ao processar análise da rodada', detalhe: err.message });
  }
}

async function analisarComGemini(jogos, apiKey, dataStr) {
  const prompt = `Você é um comentarista e jornalista da NBA altamente especializado no público brasileiro.
Hoje é a data ${dataStr}. Analise detalhadamente os seguintes confrontos da rodada da NBA:

${JSON.stringify(jogos, null, 2)}

INSTRUÇÕES OBRIGATÓRIAS:
1. Para CADA jogo, faça uma análise ÚNICA, vibrante e autêntica. MENCIONE NOMES DE JOGADORES ESTRELAS dos times envolvidos, rivalidades, fase recente e o peso da partida na tabela. NUNCA use frases repetidas ou genéricas como "Partida competitiva entre X e Y".
2. Atribua um "hype_score" de 0 a 100 para cada jogo.
3. Crie um campo "motivo": exatamente UM parágrafo direto, dinâmico e empolgante (em português do Brasil, de 180 a 350 caracteres) explicando por que este confronto específico vale a pena ser assistido.
4. Crie um campo "destaque" (boolean) para indicar quais jogos recebem o efeito visual de FOGO/CHAMA no site:
   - REGRA DO FOGO:
     * O jogo com maior hype_score DEVE OBRIGATORIAMENTE ter "destaque": true (mínimo 1 jogo com foguinho por dia).
     * Se houver outro confronto imperdível de nível muito próximo (hype >= 85), pode marcar um 2º jogo com "destaque": true.
     * Ocasionalmente um 3º jogo pode ser destaque se for uma rodada épica com múltiplos clássicos decisivos.
     * NUNCA marque mais de 3 jogos como destaque=true. No máximo 3.
5. Crie um campo "titulo_destaque" curto (ex: "🔥 Duelo de Gigantes", "🔥 Clássico Histórico", "🔥 Batalha de Conferência", etc.).

Responda APENAS com um JSON puro no formato:
{
  "jogos": [
    {
      "id": "ID_DO_JOGO",
      "hype_score": 95,
      "destaque": true,
      "titulo_destaque": "🔥 Duelo de Titãs",
      "motivo": "Texto vibrante citando os jogadores e contexto..."
    }
  ]
}`;

  // Descobre dinamicamente os modelos ativos na conta do usuário via ListModels da Google API
  const modelos = await listarModelosValidos(apiKey);
  const erros = [];

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
            temperature: 0.7
          }
        })
      });

      if (!res.ok) {
        const txt = await res.text();
        erros.push(`${modelo} (${res.status}): ${txt.slice(0, 160)}`);
        continue;
      }

      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) {
        erros.push(`${modelo}: resposta vazia`);
        continue;
      }
      const cleanedRaw = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleanedRaw);
      return normalizarDestaques(parsed.jogos || [], jogos, dataStr, modelo);
    } catch (e) {
      erros.push(`${modelo}: ${e.message}`);
    }
  }

  throw new Error(erros.join(' | ') || 'Falha em todos os modelos Gemini');
}

// Consulta a Google API para saber exatamente quais modelos estão disponíveis para esta chave
async function listarModelosValidos(apiKey) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (res.ok) {
      const data = await res.json();
      const disponiveis = (data.models || [])
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));

      if (disponiveis.length > 0) {
        // Ordena priorizando modelos flash modernos e eficientes
        disponiveis.sort((a, b) => {
          const rank = name => {
            if (name.includes('2.5-flash')) return 1;
            if (name.includes('2.0-flash')) return 2;
            if (name.includes('flash')) return 3;
            if (name.includes('pro')) return 4;
            return 10;
          };
          return rank(a) - rank(b);
        });
        return disponiveis.slice(0, 5);
      }
    }
  } catch (err) {
    console.warn('Falha ao consultar /models:', err);
  }
  // Fallback com modelos atuais do Google AI Studio
  return ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
}

function normalizarDestaques(itensIA, jogosOriginais, dataStr, modelo) {
  const mapIA = {};
  itensIA.forEach(j => { if (j.id) mapIA[j.id] = j; });

  const lista = jogosOriginais.map(j => {
    const ia = mapIA[j.id] || {};
    return {
      id: j.id,
      hype_score: typeof ia.hype_score === 'number' ? ia.hype_score : 75,
      destaque: Boolean(ia.destaque),
      titulo_destaque: ia.titulo_destaque || 'Destaque da Rodada',
      motivo: ia.motivo || `Confronto decisivo entre ${j.away} e ${j.home} com peso direto na tabela da temporada.`
    };
  });

  // Ordena por hype_score decrescente
  lista.sort((a, b) => b.hype_score - a.hype_score);

  // 1. O jogo #1 é SEMPRE destaque obrigatório
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
    modelo: modelo,
    geminiStatus: 'ativo',
    jogos: jogosObj
  };
}

// Fallback inteligente caso a chave ainda não tenha sido ativada ou ocorra erro
function gerarAnaliseHeuristica(jogos, dataStr, erroMsg, chaveExistia) {
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

    if (/Lakers|Warriors|Celtics|Nuggets|Bucks|Mavericks|Knicks/.test(matchupStr)) score += 8;
    score = Math.min(98, score + Math.floor(Math.random() * 6));

    let motivo = '';
    if (ehRivalidade) {
      motivo = `Grande rivalidade histórica em quadra! ${j.away} e ${j.home} se enfrentam em um jogo de muita intensidade física e rivalidade clássica entre duas torcidas apaixonadas.`;
    } else if (score >= 85) {
      motivo = `Confronto de alto nível entre ${j.away} (${j.awayRecord}) e ${j.home} (${j.homeRecord}). Duelo com grandes estrelas e disputa acirrada pelas primeiras posições da conferência.`;
    } else {
      motivo = `Duelo estratégico entre ${j.away} e ${j.home}. Ambos os times buscam impor ritmo e ajustar a rotação defensiva para subir posições na tabela.`;
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
  if (pontuados.length > 0) pontuados[0].destaque = true;
  if (pontuados.length > 1 && pontuados[1].hype_score >= 86) pontuados[1].destaque = true;
  if (pontuados.length > 2 && pontuados[2].hype_score >= 90) pontuados[2].destaque = true;

  const jogosObj = {};
  pontuados.forEach(p => { jogosObj[p.id] = p; });

  return {
    date: dataStr,
    fonte: 'heuristica',
    geminiStatus: chaveExistia ? 'erro_chamada' : 'chave_nao_configurada',
    detalheDiagnostico: erroMsg || 'Chave GEMINI_API_KEY não configurada nas variáveis de ambiente do Vercel.',
    dica: chaveExistia
      ? 'A chave GEMINI_API_KEY foi enviada, mas o Google retornou erro. Verifique sua chave no Google AI Studio.'
      : 'Configure a variável GEMINI_API_KEY no painel da Vercel (Settings -> Environment Variables) e faça um Redeploy.',
    jogos: jogosObj
  };
}
