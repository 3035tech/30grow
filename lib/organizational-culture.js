/**
 * Organizational Culture — leitura hedged a partir de clima + mix T1–T9 + pulso (B-1007, Epic B-1000).
 * Valores declarados (company.about_html) vs praticados (sinais). Sem novo instrumento.
 */

import { asDb } from './ae/as-db.js';
import { CLIMATE_SURVEY_STATUS } from './domain-status.js';
import { getClimateSurveyAggregate } from './people/climate-surveys.js';

/**
 * Get organizational culture insights for a company.
 * Synthesizes climate, T1-T9 mix, and team pulse data into hedged culture reading.
 */
export async function getOrganizationalCulture(dbOrQuery, { companyId }) {
  const db = asDb(dbOrQuery);

  const [company, climateData, typeMix, pulseData] = await Promise.all([
    getCompanyValues(db, companyId),
    getClimateCultureSignals(db, companyId),
    getCompanyTypeMixPercentages(db, companyId),
    getTeamPulseCultureSignals(db, companyId),
  ]);

  const insights = synthesizeCultureInsights({
    declaredValues: company.aboutHtml,
    climate: climateData,
    typeMix,
    pulse: pulseData,
  });

  return {
    company: {
      name: company.name,
      declaredValues: company.aboutHtml,
    },
    signals: {
      climate: climateData,
      typeMix,
      pulse: pulseData,
    },
    insights,
  };
}

async function getCompanyValues(db, companyId) {
  const res = await db.query(
    `SELECT name, about_html AS "aboutHtml"
     FROM companies
     WHERE id = $1 AND deleted = FALSE
     LIMIT 1`,
    [companyId]
  );
  if (res.rowCount === 0) return { name: '', aboutHtml: null };
  return res.rows[0];
}

/**
 * Type mix as [{ type, percentage }] for culture insights (latest assessment per candidate).
 * Stays DISTINCT ON: it aggregates the whole company (no LIMIT), where one sort beats a
 * per-person LATERAL probe 2–3× (B-2804.9 benchmark, docs/performance-hotpaths.md).
 */
async function getCompanyTypeMixPercentages(db, companyId) {
  const res = await db.query(
    `SELECT latest.top_type AS "topType", COUNT(*)::int AS n
     FROM (
       SELECT DISTINCT ON (a.candidate_id) a.candidate_id, a.top_type
       FROM assessments a
       WHERE a.company_id = $1 AND a.top_type BETWEEN 1 AND 9
       ORDER BY a.candidate_id, a.created_at DESC NULLS LAST, a.id DESC
     ) latest
     INNER JOIN candidates c
       ON c.id = latest.candidate_id AND c.company_id = $1
     GROUP BY latest.top_type
     ORDER BY n DESC`,
    [companyId]
  );
  const total = res.rows.reduce((s, r) => s + (r.n || 0), 0);
  if (!total) return [];
  return res.rows.map((r) => ({
    type: `T${r.topType}`,
    percentage: Math.round((r.n / total) * 1000) / 10,
    count: r.n,
  }));
}

async function getClimateCultureSignals(db, companyId) {
  const surveyRes = await db.query(
    `SELECT id, title, closes_at AS "closedAt"
     FROM climate_surveys
     WHERE company_id = $1 AND status = '${CLIMATE_SURVEY_STATUS.CLOSED}' AND deleted = FALSE
     ORDER BY closes_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [companyId]
  );

  if (surveyRes.rowCount === 0) {
    return { hasSurvey: false, meanLevel: null, themes: [], textResponseCount: 0 };
  }

  const survey = surveyRes.rows[0];
  const agg = await getClimateSurveyAggregate(db, { companyId, surveyId: survey.id });
  const meanLevel =
    agg?.ok && !agg.suppressed && agg.overallMean != null ? Number(agg.overallMean) : null;
  const textResponseCount = Array.isArray(agg?.textByQuestion)
    ? agg.textByQuestion.reduce((s, q) => s + (Number(q.responses) || 0), 0)
    : 0;

  return {
    hasSurvey: true,
    surveyTitle: survey.title,
    closedAt: survey.closedAt,
    meanLevel: Number.isFinite(meanLevel) ? meanLevel : null,
    textResponseCount,
    suppressed: Boolean(agg?.suppressed),
  };
}

async function getTeamPulseCultureSignals(db, companyId) {
  const res = await db.query(
    `SELECT id, title, status, created_at AS "createdAt"
     FROM team_pulses
     WHERE company_id = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [companyId]
  );

  if (res.rowCount === 0) {
    return { hasPulse: false, recentCount: 0 };
  }

  return {
    hasPulse: true,
    recentCount: res.rows.length,
    recentPulses: res.rows.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      createdAt: p.createdAt,
    })),
  };
}

function synthesizeCultureInsights({ declaredValues, climate, typeMix, pulse }) {
  const insights = [];

  if (climate.hasSurvey && climate.meanLevel !== null) {
    const level = Number(climate.meanLevel);
    if (level >= 4.0) {
      insights.push({
        category: 'climate',
        signal: 'positive',
        strength: 'strong',
        description: 'Sinais de clima organizacional predominantemente positivo',
        details: `Pesquisa recente indica média ${level.toFixed(1)}/5. Colaboradores tendem a reportar boa experiência no dia a dia.`,
        hedging: 'Indicador baseado em auto-relato; não substitui observação direta.',
      });
    } else if (level >= 3.0) {
      insights.push({
        category: 'climate',
        signal: 'neutral',
        strength: 'medium',
        description: 'Clima organizacional em território neutro',
        details: `Média ${level.toFixed(1)}/5: espaço para melhoria em reconhecimento, clareza e sustentabilidade.`,
        hedging: 'Média pode mascarar variação entre áreas ou grupos.',
      });
    } else {
      insights.push({
        category: 'climate',
        signal: 'concern',
        strength: 'high',
        description: 'Sinais de clima organizacional desafiador',
        details: `Média ${level.toFixed(1)}/5: atenção a carga, clareza e espaço para feedback.`,
        hedging: 'Priorizar conversas 1:1 e ações de curto prazo.',
      });
    }
  }

  if (typeMix && typeMix.length > 0) {
    const dominant = typeMix.filter((t) => t.percentage >= 20);
    if (dominant.length > 0) {
      const dominantTypes = dominant.map((t) => t.type).join(', ');
      insights.push({
        category: 'type_mix',
        signal: 'archetype',
        strength: 'medium',
        description: `Perfis dominantes: ${dominantTypes}`,
        details: `${dominant.map((t) => `${t.type}: ${t.percentage}%`).join(', ')}: cultura tende a refletir essas orientações de trabalho.`,
        hedging: 'Arquétipo cultural é indicador, não determinante. Diversidade e contexto importam.',
      });
    }

    const veryDominant = typeMix.find((t) => t.percentage > 50);
    if (veryDominant) {
      insights.push({
        category: 'type_mix',
        signal: 'homogeneity',
        strength: 'medium',
        description: `Alta concentração em ${veryDominant.type}`,
        details: `${veryDominant.percentage}% do time: pode indicar cultura forte ou risco de groupthink.`,
        hedging: 'Avaliar se a homogeneidade é intencional (fit) ou limitante (falta de perspectivas).',
      });
    }
  }

  if (pulse.hasPulse) {
    insights.push({
      category: 'pulse',
      signal: 'engagement',
      strength: 'low',
      description: `${pulse.recentCount} pulso(s) recente(s) registrado(s)`,
      details: 'Pulsos de grupo indicam prática de escuta e acompanhamento contínuo.',
      hedging: 'Frequência de pulsos é proxy de comunicação, não de qualidade das conversas.',
    });
  }

  if (declaredValues && declaredValues.length > 50) {
    const declaredShort = declaredValues.replace(/<[^>]+>/g, '').slice(0, 200);
    insights.push({
      category: 'alignment',
      signal: 'declared_values',
      strength: 'low',
      description: 'Valores declarados registrados',
      details: `"${declaredShort}...": compare com sinais de clima, mix de perfis e pulsos para gap de alinhamento.`,
      hedging: 'Valores declarados são intenção; cultura praticada emerge dos sinais de comportamento e clima.',
    });
  }

  return insights;
}

/**
 * Get culture summary (high-level rollup for dashboard card).
 */
export async function getCultureSummary(dbOrQuery, { companyId }) {
  const culture = await getOrganizationalCulture(dbOrQuery, { companyId });
  const { signals, insights } = culture;

  let overallHealth = 'unknown';
  if (signals.climate.hasSurvey && signals.climate.meanLevel !== null) {
    const level = Number(signals.climate.meanLevel);
    if (level >= 4.0) overallHealth = 'positive';
    else if (level >= 3.0) overallHealth = 'neutral';
    else overallHealth = 'concern';
  }

  let dominantArchetype = null;
  if (signals.typeMix && signals.typeMix.length > 0) {
    const top = signals.typeMix[0];
    if (top.percentage >= 15) {
      dominantArchetype = { type: top.type, percentage: top.percentage };
    }
  }

  return {
    overallHealth,
    dominantArchetype,
    hasClimateData: signals.climate.hasSurvey,
    hasPulseData: Boolean(signals.pulse?.hasPulse),
    hasTypeMixData: Array.isArray(signals.typeMix) && signals.typeMix.length > 0,
    insightCount: insights.length,
    hasDeclaredValues: Boolean(
      culture.company?.declaredValues && String(culture.company.declaredValues).replace(/<[^>]+>/g, '').trim().length > 20
    ),
    declaredSnippet: (() => {
      const raw = culture.company?.declaredValues;
      if (!raw) return null;
      const plain = String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (plain.length < 20) return null;
      return plain.length > 180 ? `${plain.slice(0, 180)}…` : plain;
    })(),
  };
}
