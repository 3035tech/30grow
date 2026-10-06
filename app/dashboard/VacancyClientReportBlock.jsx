'use client';

import { SelectField } from '../_components/SelectField';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { errorMessage, t, contentLocale } from '../../lib/i18n';
import { typeHintTooltip, typeShortLabel } from '../../lib/type-en';
import { S } from './dashboard-shared';
import { RichTextEditor } from '../_components/RichTextEditor';
import { FormField } from '../_components/FormField';
import { useAppFeedback } from '../_components/AppFeedback';
import { AppLoading } from '../_components/AppLoading';
import { CopyableLink } from '../_components/CopyableLink';
import { copyToClipboard } from '../../lib/clipboard';
import { htmlToPlainText } from '../../lib/sanitize-html';
import { getTypeData } from '../../lib/i18n-data';
import {
  REPORT_NOTE_MIN_CHARS,
  REPORT_RECOMMENDATIONS,
  STRUCTURED_FIELD_MAX_CHARS,
  normalizeRecommendation,
} from '../../lib/vacancy-report-shared';
import { PIPELINE_STAGE } from '../../lib/pipeline';
import {
  REPORT_TEMPLATE_KINDS,
  getReportNoteTemplate,
  inferReportTemplateKind,
} from '../../lib/vacancy-report-note-templates';

const REPORT_EXPIRY_DAYS = [7, 14, 30];
const DEFAULT_REPORT_EXPIRY_DAYS = 14;

const INTERVIEW_PLUS = new Set([
  PIPELINE_STAGE.INTERVIEW,
  PIPELINE_STAGE.APPROVED,
  PIPELINE_STAGE.HIRED,
]);

/**
 * Generate / list / revoke public client report links for a vacancy.
 */
export function VacancyClientReportBlock({
  vacancyId,
  locale = 'pt-BR',
  appUrl = '',
  clientReportShowSalary: clientReportShowSalaryProp = false,
  onClientReportShowSalaryChange,
}) {
  const { confirm, notice, toast } = useAppFeedback();
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [candidates, setCandidates] = useState([]);
  const [vacancyMeta, setVacancyMeta] = useState(null);
  const [rubricMeta, setRubricMeta] = useState(null);
  const [showSalary, setShowSalary] = useState(Boolean(clientReportShowSalaryProp));
  const [salaryBusy, setSalaryBusy] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [overrides, setOverrides] = useState({});
  const [stageFilter, setStageFilter] = useState('shortlist');
  const [expiresInDays, setExpiresInDays] = useState(DEFAULT_REPORT_EXPIRY_DAYS);
  const [note, setNote] = useState('');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState('');
  const [noteActionBusy, setNoteActionBusy] = useState('');
  const [noteEditorKey, setNoteEditorKey] = useState(0);
  const [lastUrl, setLastUrl] = useState('');
  const [editingReportId, setEditingReportId] = useState(null);
  const [editNoteDraft, setEditNoteDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [reportTemplateKind, setReportTemplateKind] = useState('technical');
  const [compositionRisks, setCompositionRisks] = useState(null);
  const [compositionLoading, setCompositionLoading] = useState(false);

  const actionsLocked = Boolean(aiBusy) || Boolean(noteActionBusy);

  const writeNote = (html) => {
    setNote(html);
    setNoteEditorKey((k) => k + 1);
  };

  const showError = async (message) => {
    await notice({
      title: t(locale, 'panel.common.errorTitle'),
      message: String(message || t(locale, 'panel.common.error')),
      tone: 'error',
    });
  };

  const showOk = (message) => {
    toast(String(message), 'ok');
  };

  const notePlainLen = htmlToPlainText(note).length;
  const noteOk = notePlainLen >= REPORT_NOTE_MIN_CHARS;

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/vacancies/${vacancyId}/reports`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.errorCode ? errorMessage(locale, data.errorCode, data.error) : data?.error);
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.common.error'));
    }
  }, [vacancyId, locale]);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/vacancies/${vacancyId}/reports?candidates=1`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.errorCode ? errorMessage(locale, data.errorCode, data.error) : data?.error);
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      setVacancyMeta(data.vacancy || null);
      setRubricMeta(data.rubricSummary || null);
      if (data.vacancy?.title) {
        setReportTemplateKind(
          inferReportTemplateKind({ title: data.vacancy.title, jobRoleName: '' })
        );
      }
      if (typeof data.vacancy?.clientReportShowSalary === 'boolean') {
        setShowSalary(Boolean(data.vacancy.clientReportShowSalary));
      }
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.common.error'));
      setCandidates([]);
      setVacancyMeta(null);
      setRubricMeta(null);
    } finally {
      setLoading(false);
    }
  }, [vacancyId, locale]);

  useEffect(() => {
    setShowSalary(Boolean(clientReportShowSalaryProp));
  }, [clientReportShowSalaryProp, vacancyId]);

  useEffect(() => {
    if (!open) return;
    loadCandidates();
    loadReports();
  }, [open, loadCandidates, loadReports]);

  const persistShowSalary = async (next) => {
    const prev = showSalary;
    setShowSalary(next);
    setSalaryBusy(true);
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientReportShowSalary: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.errorCode ? errorMessage(locale, data.errorCode, data.error) : data?.error);
      }
      setVacancyMeta((cur) => (cur ? { ...cur, clientReportShowSalary: next } : cur));
      onClientReportShowSalaryChange?.(next);
      showOk(t(locale, 'panel.report.showSalarySaved'));
    } catch (e) {
      setShowSalary(prev);
      void showError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setSalaryBusy(false);
    }
  };

  const visible = useMemo(() => {
    if (stageFilter === 'interview_plus') {
      return candidates.filter((c) => INTERVIEW_PLUS.has(c.pipelineStage));
    }
    if (stageFilter === 'shortlist') {
      return candidates.filter((c) => !c.excludedFromClient && c.recommendation !== 'exclude');
    }
    return candidates;
  }, [candidates, stageFilter]);

  const selectedPeople = useMemo(
    () => candidates.filter((c) => selected.has(c.candidateId)),
    [candidates, selected]
  );

  useEffect(() => {
    if (!open || selected.size < 2) {
      setCompositionRisks(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setCompositionLoading(true);
      try {
        const ids = [...selected].join(',');
        const res = await fetch(
          `/api/admin/vacancies/${encodeURIComponent(vacancyId)}/reports?compositionRisks=1&candidateIds=${encodeURIComponent(ids)}&locale=${encodeURIComponent(locale)}`
        );
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setCompositionRisks(data);
        else if (!cancelled) setCompositionRisks(null);
      } catch {
        if (!cancelled) setCompositionRisks(null);
      } finally {
        if (!cancelled) setCompositionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, vacancyId, selected, locale]);

  const ensureOverride = (c) => {
    setOverrides((prev) => {
      if (prev[c.candidateId]) return prev;
      const typeData = getTypeData(locale);
      const probe = c.topType != null ? typeData[c.topType]?.challenge || '' : '';
      return {
        ...prev,
        [c.candidateId]: {
          recommendation: normalizeRecommendation(c.recommendation, 'bank'),
          why: '',
          watchOut: '',
          interviewProbe: String(probe).slice(0, STRUCTURED_FIELD_MAX_CHARS),
        },
      };
    });
  };

  const toggle = (c) => {
    const id = c.candidateId;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        ensureOverride(c);
      }
      return next;
    });
  };

  const selectVisible = () => {
    setSelected(new Set(visible.map((c) => c.candidateId)));
    setOverrides((prev) => {
      const next = { ...prev };
      const typeData = getTypeData(locale);
      for (const c of visible) {
        if (!next[c.candidateId]) {
          const probe = c.topType != null ? typeData[c.topType]?.challenge || '' : '';
          next[c.candidateId] = {
            recommendation: normalizeRecommendation(c.recommendation, 'bank'),
            why: '',
            watchOut: '',
            interviewProbe: String(probe).slice(0, STRUCTURED_FIELD_MAX_CHARS),
          };
        }
      }
      return next;
    });
  };

  const clearSelected = () => setSelected(new Set());

  const effectiveRec = (c) =>
    normalizeRecommendation(overrides[c.candidateId]?.recommendation, c.recommendation || 'bank');

  const setRec = (id, recommendation) => {
    setOverrides((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        recommendation: normalizeRecommendation(recommendation, 'bank'),
      },
    }));
  };

  const setStructured = (id, field, text) => {
    setOverrides((prev) => ({
      ...prev,
      [id]: {
        recommendation: normalizeRecommendation(prev[id]?.recommendation, 'bank'),
        why: prev[id]?.why || '',
        watchOut: prev[id]?.watchOut || '',
        interviewProbe: prev[id]?.interviewProbe || '',
        [field]: String(text || '').slice(0, STRUCTURED_FIELD_MAX_CHARS),
      },
    }));
  };

  const applyNoteTemplate = async () => {
    if (actionsLocked) return;
    if (htmlToPlainText(note).length) {
      const ok = await confirm({
        message: t(locale, 'panel.report.noteOverwriteConfirm'),
      });
      if (!ok) return;
    }
    setNoteActionBusy('template');
    try {
      writeNote(getReportNoteTemplate(locale, reportTemplateKind));
      showOk(t(locale, 'panel.report.noteTemplateDone'));
    } finally {
      setNoteActionBusy('');
    }
  };

  /** Preenche o parecer com a shortlist selecionada (passa o mínimo de 80 chars). */
  const generateNoteFromShortlist = async () => {
    if (actionsLocked) return;
    const people = selectedPeople.filter((c) => !c.excludedFromClient && c.recommendation !== 'exclude');
    if (!people.length) {
      void showError(t(locale, 'panel.report.generateNoteNeedSelection'));
      return;
    }
    if (htmlToPlainText(note).length) {
      const ok = await confirm({
        message: t(locale, 'panel.report.noteOverwriteConfirm'),
      });
      if (!ok) return;
    }
    setNoteActionBusy('shortlist');
    try {
      const vacTitle = vacancyMeta?.title || '';
      const byRec = (rec) =>
        people
          .filter((c) => effectiveRec(c) === rec)
          .map((c) => {
            const ov = overrides[c.candidateId] || {};
            const fit =
              c.vacancyFitScore010 != null ? ` (fit ${Number(c.vacancyFitScore010).toFixed(1)}/10)` : '';
            const why = ov.why ? `: ${ov.why}` : '';
            return `${c.name}${c.topType != null ? ` T${c.topType}` : ''}${fit}${why}`;
          });

      const advance = byRec('advance');
      const discuss = byRec('discuss');
      const bank = byRec('bank');
      const alerts = people
        .map((c) => {
          const w = overrides[c.candidateId]?.watchOut || '';
          return w ? `${c.name}: ${w}` : null;
        })
        .filter(Boolean);

      const en = contentLocale(locale) === 'en';
      const html = en
        ? `<p><strong>Who to advance:</strong> ${advance.length ? advance.join('; ') : '—'}${discuss.length ? `. Discuss further: ${discuss.join('; ')}` : ''}.</p>
<p><strong>Why (fit / role context):</strong> Shortlist for ${vacTitle || 'this role'} ranked by rubric alignment and interview notes. ${bank.length ? `Hold for now: ${bank.join('; ')}.` : ''}</p>
<p><strong>Watch-outs / interview probes:</strong> ${alerts.length ? alerts.join(' · ') : 'Validate technical depth and delivery cadence in the client interview.'}</p>
<p><strong>Suggested next step:</strong> Schedule technical interviews with the client team for those marked Advance; keep Discuss for a second pass if capacity allows.</p>`
        : `<p><strong>Quem avançar:</strong> ${advance.length ? advance.join('; ') : '—'}${discuss.length ? `. Conversar antes: ${discuss.join('; ')}` : ''}.</p>
<p><strong>Por quê (fit / contexto da vaga):</strong> Shortlist para ${vacTitle || 'esta vaga'} com base na rubrica T1–T9 e nas notas de triagem. ${bank.length ? `Banco por ora: ${bank.join('; ')}.` : ''}</p>
<p><strong>Alertas / pontos a explorar na entrevista:</strong> ${alerts.length ? alerts.join(' · ') : 'Validar profundidade técnica e ritmo de entrega na entrevista com o time do cliente.'}</p>
<p><strong>Próximo passo sugerido:</strong> Agendar entrevistas técnicas com o time do cliente para quem está em Avançar; manter Conversar para segunda passagem se houver capacidade.</p>`;

      writeNote(html);
      showOk(t(locale, 'panel.report.generateNoteDone'));
    } finally {
      setNoteActionBusy('');
    }
  };

  const peoplePayloadForAi = () =>
    selectedPeople
      .filter((c) => !c.excludedFromClient && c.recommendation !== 'exclude')
      .map((c) => {
        const ov = overrides[c.candidateId] || {};
        return {
          candidateId: c.candidateId,
          name: c.name,
          topType: c.topType,
          vacancyFitScore010: c.vacancyFitScore010,
          recommendation: effectiveRec(c),
          why: ov.why || '',
          watchOut: ov.watchOut || '',
          interviewProbe: ov.interviewProbe || '',
          interviewNotes: c.interviewNotes || '',
          motivatorsTop: c.motivatorsTop || [],
        };
      });

  const generateNoteWithAi = async () => {
    if (actionsLocked) return;
    const candidates = peoplePayloadForAi();
    if (!candidates.length) {
      void showError(t(locale, 'panel.report.generateNoteNeedSelection'));
      return;
    }
    if (htmlToPlainText(note).length) {
      const ok = await confirm({
        message: t(locale, 'panel.report.noteOverwriteConfirm'),
      });
      if (!ok) return;
    }
    setAiBusy('note');
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}/assist-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'executiveNote', candidates, locale }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.errorCode
            ? errorMessage(locale, data.errorCode, data.error)
            : data?.error || t(locale, 'panel.report.aiFailed')
        );
      }
      if (data.executiveNote) writeNote(String(data.executiveNote));
      showOk(t(locale, 'panel.report.generateNoteAiDone'));
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.report.aiFailed'));
    } finally {
      setAiBusy('');
    }
  };

  const fillFieldsWithAi = async () => {
    if (actionsLocked) return;
    const candidates = peoplePayloadForAi();
    if (!candidates.length) {
      void showError(t(locale, 'panel.report.generateNoteNeedSelection'));
      return;
    }
    setAiBusy('fields');
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}/assist-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'candidateFields', candidates, locale }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.errorCode
            ? errorMessage(locale, data.errorCode, data.error)
            : data?.error || t(locale, 'panel.report.aiFailed')
        );
      }
      const fields = data.fields || {};
      setOverrides((prev) => {
        const next = { ...prev };
        for (const [id, row] of Object.entries(fields)) {
          const person = selectedPeople.find((c) => String(c.candidateId) === String(id));
          next[id] = {
            recommendation: normalizeRecommendation(
              prev[id]?.recommendation,
              person?.recommendation || 'bank'
            ),
            why: String(row.why || '').slice(0, STRUCTURED_FIELD_MAX_CHARS),
            watchOut: String(row.watchOut || '').slice(0, STRUCTURED_FIELD_MAX_CHARS),
            interviewProbe: String(row.interviewProbe || '').slice(0, STRUCTURED_FIELD_MAX_CHARS),
          };
        }
        return next;
      });
      showOk(t(locale, 'panel.report.fillFieldsAiDone'));
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.report.aiFailed'));
    } finally {
      setAiBusy('');
    }
  };

  const fillFieldsFromBrief = async () => {
    if (actionsLocked) return;
    const eligible = selectedPeople.filter(
      (c) => !c.excludedFromClient && c.recommendation !== 'exclude'
    );
    if (!eligible.length) {
      void showError(t(locale, 'panel.report.fillFromBriefNeedSelection'));
      return;
    }
    setNoteActionBusy('fromBrief');
    try {
      const loc = contentLocale(locale);
      const results = await Promise.all(
        eligible.map(async (c) => {
          const res = await fetch(
            `/api/admin/candidates/${encodeURIComponent(c.candidateId)}?locale=${encodeURIComponent(loc)}`
          );
          const data = await res.json().catch(() => ({}));
          if (!res.ok) return { id: c.candidateId, ok: false };
          const brief = data?.people?.decisionBrief || null;
          const why =
            String(brief?.synthesis?.headline || '').trim() ||
            String(brief?.actionsDo?.[0]?.text || '').trim();
          const watchOut = String(brief?.alerts?.[0]?.text || '').trim();
          const interviewProbe = String(brief?.interviewQuestions?.[0]?.text || '').trim();
          return {
            id: c.candidateId,
            ok: Boolean(why || watchOut || interviewProbe),
            why,
            watchOut,
            interviewProbe,
            recommendation: normalizeRecommendation(
              overrides[c.candidateId]?.recommendation,
              c.recommendation || 'bank'
            ),
          };
        })
      );
      let filled = 0;
      const patch = {};
      for (const row of results) {
        if (!row.ok) continue;
        filled += 1;
        patch[row.id] = {
          recommendation: row.recommendation,
          why: String(row.why || '').slice(0, STRUCTURED_FIELD_MAX_CHARS),
          watchOut: String(row.watchOut || '').slice(0, STRUCTURED_FIELD_MAX_CHARS),
          interviewProbe: String(row.interviewProbe || '').slice(0, STRUCTURED_FIELD_MAX_CHARS),
        };
      }
      if (filled === 0) {
        void showError(t(locale, 'panel.report.fillFromBriefEmpty'));
      } else {
        setOverrides((prev) => {
          const next = { ...prev };
          for (const [id, fields] of Object.entries(patch)) {
            next[id] = {
              recommendation: fields.recommendation,
              why: fields.why || prev[id]?.why || '',
              watchOut: fields.watchOut || prev[id]?.watchOut || '',
              interviewProbe: fields.interviewProbe || prev[id]?.interviewProbe || '',
            };
          }
          return next;
        });
        showOk(t(locale, 'panel.report.fillFromBriefDone', { n: filled }));
      }
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setNoteActionBusy('');
    }
  };

  const suggestShortlistWithAi = async () => {
    if (actionsLocked) return;
    const eligibleCandidates = candidates
      .filter((c) => !c.excludedFromClient && c.recommendation !== 'exclude')
      .slice(0, 12)
      .map((c) => ({
        candidateId: c.candidateId,
        name: c.name,
        topType: c.topType,
        vacancyFitScore010: c.vacancyFitScore010,
        recommendation: effectiveRec(c),
        why: overrides[c.candidateId]?.why || '',
        watchOut: overrides[c.candidateId]?.watchOut || '',
        interviewNotes: c.interviewNotes || '',
        motivatorsTop: c.motivatorsTop || [],
      }));
    if (!eligibleCandidates.length) {
      void showError(t(locale, 'panel.report.noCandidates'));
      return;
    }

    setAiBusy('shortlist');
    try {
      const res = await fetch(`/api/admin/vacancies/${encodeURIComponent(vacancyId)}/assist-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'suggestShortlist', candidates: eligibleCandidates, locale }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.errorCode
            ? errorMessage(locale, data.errorCode, data.error)
            : data?.error || t(locale, 'panel.report.aiFailed')
        );
      }

      const allowedIds = new Set(eligibleCandidates.map((c) => Number(c.candidateId)));
      const suggestedIds = [...new Set(
        (Array.isArray(data.candidateIds) ? data.candidateIds : [])
          .map(Number)
          .filter((id) => Number.isFinite(id) && allowedIds.has(id))
      )].slice(0, 5);
      if (!suggestedIds.length) {
        void showError(t(locale, 'panel.report.suggestShortlistAiEmpty'));
        return;
      }

      const suggestedIdSet = new Set(suggestedIds);
      const suggestedCandidates = candidates.filter((candidate) =>
        suggestedIdSet.has(Number(candidate.candidateId))
      );
      setSelected(new Set(suggestedCandidates.map((candidate) => candidate.candidateId)));
      setOverrides((prev) => {
        const next = { ...prev };
        const typeData = getTypeData(locale);
        for (const c of suggestedCandidates) {
          if (next[c.candidateId]) continue;
          const probe = c.topType != null ? typeData[c.topType]?.challenge || '' : '';
          next[c.candidateId] = {
            recommendation: normalizeRecommendation(c.recommendation, 'discuss'),
            why: '',
            watchOut: '',
            interviewProbe: String(probe).slice(0, STRUCTURED_FIELD_MAX_CHARS),
          };
        }
        return next;
      });
      if (data.rationaleHtml && !htmlToPlainText(note).length) {
        writeNote(String(data.rationaleHtml));
      }
      showOk(t(locale, 'panel.report.suggestShortlistAiDone', { n: suggestedIds.length }));
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.report.aiFailed'));
    } finally {
      setAiBusy('');
    }
  };

  const recommendationLabel = (rec) => {
    const key =
      rec === 'advance'
        ? 'panel.report.recAdvance'
        : rec === 'discuss'
          ? 'panel.report.recDiscuss'
          : rec === 'exclude'
            ? 'panel.report.recExclude'
            : 'panel.report.recBank';
    return t(locale, key);
  };

  const generate = async () => {
    if (!noteOk) {
      void showError(t(locale, 'panel.report.noteTooShort', { n: REPORT_NOTE_MIN_CHARS }));
      return;
    }
    const excluded = selectedPeople.filter((c) => c.excludedFromClient || c.recommendation === 'exclude');
    if (excluded.length && excluded.length === selectedPeople.length) {
      void showError(t(locale, 'panel.report.onlyExcludedSelected'));
      return;
    }
    if (excluded.length) {
      const ok = await confirm({
        message: t(locale, 'panel.report.stripExcludedConfirm', { n: excluded.length }),
      });
      if (!ok) return;
    }

    const candidateOverrides = {};
    for (const c of selectedPeople) {
      if (c.excludedFromClient || c.recommendation === 'exclude') continue;
      const ov = overrides[c.candidateId] || {};
      candidateOverrides[String(c.candidateId)] = {
        recommendation: normalizeRecommendation(ov.recommendation, c.recommendation),
        why: ov.why || '',
        watchOut: ov.watchOut || '',
        interviewProbe: ov.interviewProbe || '',
      };
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/vacancies/${vacancyId}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateIds: [...selected],
          expiresInDays,
          executiveNote: note,
          candidateOverrides,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.errorCode ? errorMessage(locale, data.errorCode, data.error) : data?.error);
      const url = data.url || (appUrl ? `${appUrl}/r/${data.token}` : `/r/${data.token}`);
      setLastUrl(url);
      showOk(t(locale, 'panel.report.generated'));
      await loadReports();
      const copied = await copyToClipboard(url);
      if (copied) showOk(t(locale, 'panel.report.generatedCopied'));
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (reportId) => {
    const ok = await confirm({
      message: t(locale, 'panel.report.revokeConfirm'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/vacancies/${vacancyId}/reports/${reportId}/revoke`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.errorCode ? errorMessage(locale, data.errorCode, data.error) : data?.error);
      showOk(t(locale, 'panel.report.revoked'));
      await loadReports();
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setBusy(false);
    }
  };

  const startEditReport = (r) => {
    setEditingReportId(r.id);
    setEditNoteDraft(r.executiveNote || '');
  };

  const cancelEditReport = () => {
    setEditingReportId(null);
    setEditNoteDraft('');
  };

  const saveReportNote = async (reportId) => {
    const plain = htmlToPlainText(editNoteDraft);
    if (plain.length < REPORT_NOTE_MIN_CHARS) {
      void showError(t(locale, 'panel.report.noteTooShort', { n: REPORT_NOTE_MIN_CHARS }));
      return;
    }
    setEditBusy(true);
    try {
      const res = await fetch(`/api/admin/vacancies/${vacancyId}/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executiveNote: editNoteDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.errorCode ? errorMessage(locale, data.errorCode, data.error) : data?.error);
      showOk(t(locale, 'panel.report.noteUpdated'));
      setEditingReportId(null);
      setEditNoteDraft('');
      await loadReports();
    } catch (e) {
      void showError(e?.message || t(locale, 'panel.common.error'));
    } finally {
      setEditBusy(false);
    }
  };

  const canGenerate = selected.size > 0 && noteOk && !busy;

  const rubricTypesLabel = (rubricMeta?.weightedTypes || [])
    .map((w) => `T${w.type} · ${typeShortLabel(w.type, locale)}`)
    .join(', ');

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="min-h-touch cursor-pointer rounded-control border border-brand-500/35 bg-brand-500/[0.09] px-2.5 py-2 font-mono text-xs text-brand-500"
      >
        {open ? t(locale, 'panel.report.hidePanel') : t(locale, 'panel.report.openPanel')}
      </button>

      {open ? (
        <div
          className="mt-3 rounded-xl border border-ink/12 bg-surface p-4"
        >
          <span className={S.label}>{t(locale, 'panel.report.title')}</span>
          <p className="mt-[8px] mx-[0] mb-[0] text-xs text-ink-muted leading-[1.55]">
            {t(locale, 'panel.report.intro')}
          </p>

          {lastUrl ? (
            <div className="mt-3 rounded-control border border-brand-500/25 bg-brand-500/[0.04] px-3 py-2.5">
              <CopyableLink url={lastUrl} locale={locale} />
            </div>
          ) : null}

          <div
            className="mt-3.5 rounded-control border border-ink/12 bg-ink/[0.02] px-3.5 py-3"
          >
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              className="p-0 text-2xs font-mono text-ink-muted bg-transparent border-none cursor-pointer uppercase tracking-[0.08em]"
            >
              {previewOpen ? t(locale, 'panel.report.previewHide') : t(locale, 'panel.report.previewShow')}
            </button>
            {previewOpen ? (
              <div className="mt-2.5 text-xs text-ink leading-[1.55]">
                <p className="mt-[0] mx-[0] mb-[8px] text-ink-muted">{t(locale, 'panel.report.previewHint')}</p>
                <ol className="m-0">
                  <li>
                    {t(locale, 'panel.report.previewSeeks')}
                    {rubricMeta?.hasRubric && rubricTypesLabel
                      ? `: ${rubricTypesLabel}`
                      : `: ${t(locale, 'panel.report.previewNoRubric')}`}
                    {vacancyMeta?.hasDescription ? ` · ${t(locale, 'panel.report.previewHasDesc')}` : ''}
                    {rubricMeta?.hasNotes ? ` · ${t(locale, 'panel.report.previewHasRubricNotes')}` : ''}
                  </li>
                  {!rubricMeta?.hasRubric ? (
                    <li className="text-danger">{t(locale, 'panel.report.previewNoRubricWarn')}</li>
                  ) : null}
                  <li>
                    {t(locale, 'panel.report.previewNote')}
                    {noteOk
                      ? ` ✓ (${notePlainLen} ${t(locale, 'panel.report.chars')})`
                      : `: ${t(locale, 'panel.report.previewNoteMissing')}`}
                  </li>
                  <li>
                    {t(locale, 'panel.report.previewShortlist', { n: selectedPeople.length })}
                    {selectedPeople.length
                      ? `: ${selectedPeople.map((c) => `${c.name} (${recommendationLabel(effectiveRec(c))})`).join('; ')}`
                      : ''}
                  </li>
                  <li>
                    {showSalary
                      ? t(locale, 'panel.report.previewSalaryOn')
                      : t(locale, 'panel.report.previewSalaryOff')}
                  </li>
                  <li>{t(locale, 'panel.report.previewReadings')}</li>
                </ol>
              </div>
            ) : null}
          </div>

          <label
            className="flex items-start gap-2.5 mt-3 text-xs text-ink-muted leading-[1.45]"
          >
            <input
              type="checkbox"
              checked={showSalary}
              disabled={salaryBusy || busy}
              onChange={(e) => persistShowSalary(e.target.checked)}
              className="mt-[2px] accent-brand-500"
            />
            <span>
              <strong className="text-ink">{t(locale, 'panel.report.showSalaryLabel')}</strong>
              <br />
              {t(locale, 'panel.report.showSalaryHelp')}
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2 mt-3.5">
            <SelectField value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className={S.select}>
              <option value="shortlist">{t(locale, 'panel.report.filterShortlist')}</option>
              <option value="interview_plus">{t(locale, 'panel.report.filterInterviewPlus')}</option>
              <option value="all">{t(locale, 'panel.report.filterAllTested')}</option>
            </SelectField>
            <button type="button" onClick={selectVisible} className={btnGhostClass()} disabled={loading || !visible.length}>
              {t(locale, 'panel.report.selectVisible')}
            </button>
            <button type="button" onClick={clearSelected} className={btnGhostClass()} disabled={!selected.size}>
              {t(locale, 'panel.report.clearSelection')}
            </button>
            <button
              type="button"
              onClick={suggestShortlistWithAi}
              className={btnGhostClass({ busy: aiBusy === 'shortlist', locked: actionsLocked && aiBusy !== 'shortlist' })}
              disabled={loading || actionsLocked}
              aria-busy={aiBusy === 'shortlist' || undefined}
              title={t(locale, 'panel.report.suggestShortlistAi')}
            >
              {aiBusy === 'shortlist' ? (
                <AppLoading locale={locale} variant="button" label={t(locale, 'panel.report.aiWorking')} />
              ) : (
                t(locale, 'panel.report.suggestShortlistAi')
              )}
            </button>
            <SelectField
              value={String(expiresInDays)}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className={S.select}
            >
              {REPORT_EXPIRY_DAYS.map((d) => (
                <option key={d} value={d}>
                  {t(locale, 'panel.report.expiresInDays', { n: d })}
                </option>
              ))}
            </SelectField>
          </div>

          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-xs text-ink-muted">{t(locale, 'panel.report.noteRequiredLabel')}</span>
              <SelectField
                value={reportTemplateKind}
                onChange={(e) => setReportTemplateKind(e.target.value)}
                className={S.selectCompact}
                disabled={actionsLocked}
                aria-label={t(locale, 'panel.report.templateKindLabel')}
              >
                {REPORT_TEMPLATE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(locale, `panel.report.templateKind.${kind}`)}
                  </option>
                ))}
              </SelectField>
              <button
                type="button"
                onClick={applyNoteTemplate}
                className={btnGhostClass({ busy: noteActionBusy === 'template', locked: actionsLocked && noteActionBusy !== 'template' })}
                disabled={actionsLocked}
                aria-busy={noteActionBusy === 'template' || undefined}
              >
                {noteActionBusy === 'template' ? (
                  <AppLoading locale={locale} variant="button" label={t(locale, 'panel.common.loading')} />
                ) : (
                  t(locale, 'panel.report.noteTemplate')
                )}
              </button>
              <button
                type="button"
                onClick={generateNoteFromShortlist}
                className={btnGhostClass({
                  busy: noteActionBusy === 'shortlist',
                  locked: actionsLocked && noteActionBusy !== 'shortlist',
                })}
                disabled={actionsLocked}
                aria-busy={noteActionBusy === 'shortlist' || undefined}
                title={t(locale, 'panel.report.generateNote')}
              >
                {noteActionBusy === 'shortlist' ? (
                  <AppLoading locale={locale} variant="button" label={t(locale, 'panel.common.loading')} />
                ) : (
                  t(locale, 'panel.report.generateNote')
                )}
              </button>
              <button
                type="button"
                onClick={generateNoteWithAi}
                className={btnGhostClass({ busy: aiBusy === 'note', locked: actionsLocked && aiBusy !== 'note' })}
                disabled={actionsLocked}
                aria-busy={aiBusy === 'note' || undefined}
                title={t(locale, 'panel.report.generateNoteAi')}
              >
                {aiBusy === 'note' ? (
                  <AppLoading locale={locale} variant="button" label={t(locale, 'panel.report.aiWorking')} />
                ) : (
                  t(locale, 'panel.report.generateNoteAi')
                )}
              </button>
              <button
                type="button"
                onClick={fillFieldsWithAi}
                className={btnGhostClass({ busy: aiBusy === 'fields', locked: actionsLocked && aiBusy !== 'fields' })}
                disabled={actionsLocked}
                aria-busy={aiBusy === 'fields' || undefined}
                title={t(locale, 'panel.report.fillFieldsAi')}
              >
                {aiBusy === 'fields' ? (
                  <AppLoading locale={locale} variant="button" label={t(locale, 'panel.report.aiWorking')} />
                ) : (
                  t(locale, 'panel.report.fillFieldsAi')
                )}
              </button>
              <button
                type="button"
                onClick={fillFieldsFromBrief}
                className={btnGhostClass({
                  busy: noteActionBusy === 'fromBrief',
                  locked: actionsLocked && noteActionBusy !== 'fromBrief',
                })}
                disabled={actionsLocked}
                aria-busy={noteActionBusy === 'fromBrief' || undefined}
                title={t(locale, 'panel.report.fillFromBrief')}
              >
                {noteActionBusy === 'fromBrief' ? (
                  <AppLoading locale={locale} variant="button" label={t(locale, 'panel.common.loading')} />
                ) : (
                  t(locale, 'panel.report.fillFromBrief')
                )}
              </button>
              <span
                className={cn('font-mono text-2xs', noteOk ? 'text-ink-muted' : 'text-danger')}
              >
                {t(locale, 'panel.report.noteCharCount', { n: notePlainLen, min: REPORT_NOTE_MIN_CHARS })}
              </span>
            </div>
            {aiBusy ? (
              <AppLoading
                locale={locale}
                variant="banner"
                label={t(locale, 'panel.report.aiWorkingHint')}
              />
            ) : null}
            <RichTextEditor
              key={`report-note-${noteEditorKey}`}
              value={note}
              onChange={setNote}
              placeholder={t(locale, 'panel.report.notePlaceholder')}
              minHeight={110}
              locale={locale}
              disabled={actionsLocked}
            />
          </div>

          <div
            className="mt-3 max-h-[360px] overflow-auto rounded-control border border-ink/12"
          >
            {loading ? (
              <div className="p-3">
                <AppLoading variant="inline" label={t(locale, 'panel.common.loading')} />
              </div>
            ) : visible.length === 0 ? (
              <p className="p-3 text-xs text-ink-muted">{t(locale, 'panel.report.noCandidates')}</p>
            ) : (
              <table className="text-xs w-full border-collapse">
                <thead>
                  <tr className="font-mono text-ink-muted text-left">
                    <th className="py-2 px-2.5 w-[36px]" />
                    <th className="py-2 px-2.5">{t(locale, 'panel.report.colName')}</th>
                    <th className="py-2 px-2.5">{t(locale, 'panel.report.colRec')}</th>
                    <th className="py-2 px-2.5">{t(locale, 'panel.report.colFit')}</th>
                    <th className="py-2 px-2.5">{t(locale, 'panel.report.colType')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => {
                    const isOn = selected.has(c.candidateId);
                    const rec = effectiveRec(c);
                    return (
                      <tr key={c.candidateId} className="border-t border-ink/12 align-top">
                        <td className="py-2 px-2.5">
                          <input
                            type="checkbox"
                            checked={isOn}
                            onChange={() => toggle(c)}
                            className="accent-brand-500"
                          />
                        </td>
                        <td className="py-2 px-2.5 text-ink">
                          <div>{c.name}</div>
                          {c.hasMotivators ? (
                            <div className="mt-[2px] text-2xs font-mono text-ink-muted">
                              {t(locale, 'panel.report.hasMotivatorsBadge')}
                            </div>
                          ) : null}
                          {isOn ? (
                            <div className="mt-2 flex flex-col gap-1.5">
                              <FormField label={t(locale, 'panel.report.fieldWhy')}>
                                <input
                                  type="text"
                                  value={overrides[c.candidateId]?.why || ''}
                                  onChange={(e) => setStructured(c.candidateId, 'why', e.target.value)}
                                  placeholder={t(locale, 'panel.report.fieldWhyPh')}
                                  maxLength={STRUCTURED_FIELD_MAX_CHARS}
                                  className={fieldInputClass()}
                                />
                              </FormField>
                              <FormField label={t(locale, 'panel.report.fieldWatch')}>
                                <input
                                  type="text"
                                  value={overrides[c.candidateId]?.watchOut || ''}
                                  onChange={(e) => setStructured(c.candidateId, 'watchOut', e.target.value)}
                                  placeholder={t(locale, 'panel.report.fieldWatchPh')}
                                  maxLength={STRUCTURED_FIELD_MAX_CHARS}
                                  className={fieldInputClass()}
                                />
                              </FormField>
                              <FormField label={t(locale, 'panel.report.fieldProbe')}>
                                <input
                                  type="text"
                                  value={overrides[c.candidateId]?.interviewProbe || ''}
                                  onChange={(e) => setStructured(c.candidateId, 'interviewProbe', e.target.value)}
                                  placeholder={t(locale, 'panel.report.fieldProbePh')}
                                  maxLength={STRUCTURED_FIELD_MAX_CHARS}
                                  className={fieldInputClass()}
                                />
                              </FormField>
                            </div>
                          ) : null}
                        </td>
                        <td className="py-2 px-2.5">
                          {isOn ? (
                            <SelectField
                              value={rec}
                              onChange={(e) => setRec(c.candidateId, e.target.value)}
                              className={cn(S.selectCompact, 'py-1')}
                            >
                              {REPORT_RECOMMENDATIONS.map((r) => (
                                <option key={r} value={r}>
                                  {recommendationLabel(r)}
                                </option>
                              ))}
                            </SelectField>
                          ) : (
                            <span className="font-mono text-ink-muted">{recommendationLabel(rec)}</span>
                          )}
                        </td>
                        <td className="py-2 px-2.5 font-mono">
                          {c.vacancyFitScore010 != null ? c.vacancyFitScore010.toFixed(1) : '—'}
                        </td>
                        <td
                          className="py-2 px-2.5 font-mono"
                          title={c.topType != null ? typeHintTooltip(c.topType, locale) : undefined}
                        >
                          {c.topType != null ? `T${c.topType}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {selected.size >= 2 ? (
            <div className="mt-3 rounded-control border border-warning/25 bg-warning/[0.05] px-3 py-2.5">
              <span className={cn(S.label, 'mb-1')}>{t(locale, 'panel.report.compositionRisksTitle')}</span>
              <p className={cn(S.muted, 'm-0 mb-2 text-xs')}>{t(locale, 'panel.report.compositionRisksHint')}</p>
              {compositionLoading ? (
                <AppLoading locale={locale} variant="inline" />
              ) : compositionRisks && !compositionRisks.empty ? (
                <div className="space-y-2 text-xs text-ink-muted">
                  {(compositionRisks.pairTensions || []).length > 0 ? (
                    <div>
                      <span className="font-mono text-2xs uppercase text-warning">
                        {t(locale, 'panel.report.compositionPairTensions')}
                      </span>
                      <ul className="m-0 mt-1 pl-4">
                        {compositionRisks.pairTensions.map((row) => (
                          <li key={`${row.candidateA.id}-${row.candidateB.id}`} className="mb-1">
                            <strong className="text-ink">{row.title}</strong>
                            {': '}
                            {row.candidateA.name || `T${row.candidateA.topType}`} ×{' '}
                            {row.candidateB.name || `T${row.candidateB.topType}`}
                            {row.desc ? `. ${row.desc}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {(compositionRisks.nucleusRisks || []).length > 0 ? (
                    <div>
                      <span className="font-mono text-2xs uppercase text-warning">
                        {t(locale, 'panel.report.compositionNucleusRisks')}
                      </span>
                      <ul className="m-0 mt-1 pl-4">
                        {compositionRisks.nucleusRisks.map((row, i) => (
                          <li key={`nr-${i}`} className="mb-1">
                            {row.text || row.title || String(row)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {(compositionRisks.nucleusCompleters || []).length > 0 ? (
                    <div>
                      <span className="font-mono text-2xs uppercase text-success">
                        {t(locale, 'panel.report.compositionCompleters')}
                      </span>
                      <ul className="m-0 mt-1 pl-4">
                        {compositionRisks.nucleusCompleters.map((row, i) => (
                          <li key={`nc-${i}`} className="mb-1">
                            {row.text || row.title || String(row)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className={cn(S.faint, 'm-0 text-xs italic')}>
                  {t(locale, 'panel.report.compositionRisksEmpty')}
                </p>
              )}
            </div>
          ) : null}

          <div className="mt-3">
            <button
              type="button"
              onClick={generate}
              disabled={!canGenerate}
              className={cn(
                'min-h-touch rounded-control border px-3.5 py-2.5 font-mono text-xs',
                canGenerate
                  ? 'cursor-pointer border-brand-500/35 bg-brand-500/[0.09] text-brand-500'
                  : 'cursor-default border-ink/12 bg-transparent text-ink-muted'
              )}
            >
              {busy ? t(locale, 'panel.common.loading') : t(locale, 'panel.report.generate', { n: selected.size })}
            </button>
            {!noteOk && selected.size > 0 ? (
              <p className="mt-[8px] mx-[0] mb-[0] text-2xs text-ink-muted leading-[1.45]">
                {t(locale, 'panel.report.noteGateHint', { n: REPORT_NOTE_MIN_CHARS })}
              </p>
            ) : null}
          </div>

          <div className="mt-5">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className={S.label}>{t(locale, 'panel.report.historyTitle')}</span>
              {reports.some((r) => r.isLive) ? (
                <button
                  type="button"
                  className={S.btnGhost}
                  disabled={busy}
                  onClick={async () => {
                    const urls = reports
                      .filter((r) => r.isLive)
                      .map((r) => r.url || (appUrl ? `${appUrl}/r/${r.token}` : `/r/${r.token}`));
                    if (!urls.length) return;
                    const ok = await copyToClipboard(urls.join('\n'));
                    if (ok) showOk(t(locale, 'panel.report.copyAllLinksDone', { n: urls.length }));
                    else void showError(t(locale, 'panel.common.copyFailed'));
                  }}
                >
                  {t(locale, 'panel.report.copyAllLinks')}
                </button>
              ) : null}
            </div>
            {reports.length === 0 ? (
              <p className="text-xs text-ink-muted">{t(locale, 'panel.report.historyEmpty')}</p>
            ) : (
              <ul className="mt-[8px] mx-[0] mb-[0] p-0">
                {reports.map((r) => {
                  const url = r.url || (appUrl ? `${appUrl}/r/${r.token}` : `/r/${r.token}`);
                  const exp = r.expiresAt ? new Date(r.expiresAt) : null;
                  const isEditing = Number(editingReportId) === Number(r.id);
                  return (
                    <li
                      key={r.id}
                      className="border-t border-ink/12 py-2.5"
                    >
                      <div
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-ink">
                            {r.candidateCount != null
                              ? t(locale, 'panel.report.historyItem', { n: r.candidateCount })
                              : r.title}
                            {' · '}
                            <span
                              className={cn('font-mono', r.isLive ? 'text-success' : 'text-ink-faint')}
                            >
                              {r.isLive ? t(locale, 'panel.report.statusLive') : t(locale, 'panel.report.statusDead')}
                            </span>
                          </div>
                          <div className="mt-[2px] text-2xs font-mono text-ink-muted">
                            {exp ? t(locale, 'panel.report.expiresAt', { date: exp.toLocaleString(locale) }) : ''}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <CopyableLink
                            url={url}
                            locale={locale}
                            compact
                            iconOnly
                            label={t(locale, 'panel.report.title')}
                            disabled={!r.isLive}
                          />
                          {r.isLive ? (
                            <button
                              type="button"
                              onClick={() => (isEditing ? cancelEditReport() : startEditReport(r))}
                              className={btnGhostClass()}
                              disabled={busy || editBusy}
                            >
                              {isEditing ? t(locale, 'panel.report.editNoteCancel') : t(locale, 'panel.report.editNote')}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => revoke(r.id)}
                            className={cn(btnGhostClass(), 'border-danger/35 text-danger')}
                            disabled={busy || !r.active}
                          >
                            {t(locale, 'panel.report.revoke')}
                          </button>
                        </div>
                      </div>
                      {isEditing ? (
                        <div className="mt-2.5">
                          <p className="mt-[0] mx-[0] mb-[6px] text-2xs text-ink-muted">
                            {t(locale, 'panel.report.editNoteHint')}
                          </p>
                          <RichTextEditor
                            value={editNoteDraft}
                            onChange={setEditNoteDraft}
                            minHeight={90}
                            placeholder={t(locale, 'panel.report.notePlaceholder')}
                            locale={locale}
                          />
                          <div className="flex gap-2 mt-2">
                            <button
                              type="button"
                              onClick={() => saveReportNote(r.id)}
                              disabled={editBusy}
                              className={S.btnBrandSoft}
                            >
                              {editBusy ? t(locale, 'panel.common.loading') : t(locale, 'panel.report.saveNote')}
                            </button>
                            <button type="button" onClick={cancelEditReport} className={btnGhostClass()} disabled={editBusy}>
                              {t(locale, 'panel.report.editNoteCancel')}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fieldInputClass() {
  return 'rounded-lg border border-ink/12 bg-ink/[0.05] px-2 py-1.5 font-ui text-2xs text-ink';
}

function btnGhostClass({ busy = false, locked = false } = {}) {
  return busy || locked ? cn(S.btnGhost.replace('cursor-pointer', 'cursor-wait'), 'opacity-65') : S.btnGhost;
}
