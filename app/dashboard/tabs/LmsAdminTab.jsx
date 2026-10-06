'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../lib/cn';
import { t, contentLocale } from '../../../lib/i18n';
import { PAGE_SIZE_OPTIONS } from '../../../lib/assessment-filters';
import { useAppFeedback } from '../../_components/AppFeedback';
import { EmptyState } from '../../_components/EmptyState';
import { AppLoading, ContentEnter } from '../../_components/AppLoading';
import { DateField } from '../../_components/DateField';
import { FormField } from '../../_components/FormField';
import {
  AdminListFilters,
  AdminListFilterSelect,
  AdminListResults,
} from '../../_components/AdminListFilters';
import { EntitySearchSelect } from '../../_components/EntitySearchSelect';
import { CopyableLink } from '../../_components/CopyableLink';
import { CollapsibleBlock } from '../../_components/CollapsibleBlock';
import {
  AdminActionsCell,
  AdminActionsTh,
  AdminCreateButton,
  AdminDeleteButton,
  AdminEditButton,
  AdminIconButton,
  AdminListPager,
  AdminListSearch,
  AdminPageHeader,
  AdminTableShell,
  AdminTh,
  AdminViewButton,
  PanelSubNav,
  S,
  SortableTh,
  clientSortNextDir,
} from '../dashboard-shared';
import { StatusToneChip } from '../../_components/StatusToneChip';
import { RichTextView } from '../../_components/RichTextView';
import { MeterBar } from '../../_components/MeterBar';
import { InlineCallout } from '../../_components/InlineCallout';

const ENROLL_PAGE_THRESHOLD = 10;
const LMS_DETAIL_SECTIONS = Object.freeze(['content', 'enrollments', 'tracking']);

function normalizeLmsDetailSection(value) {
  return LMS_DETAIL_SECTIONS.includes(value) ? value : 'content';
}

function companyQs(companyId) {
  return companyId ? `companyId=${encodeURIComponent(companyId)}` : '';
}

function lmsText(locale, key, fallback) {
  const path = `panel.lms.${key}`;
  const translated = t(locale, path);
  return translated === path ? fallback : translated;
}

/**
 * LMS admin — courses, ordered URL/PDF lessons, cohort enrollment + progress.
 * List-first grid; detail opens via Ver or URL `course=`.
 */
export function LmsAdminTab({ locale = 'pt-BR', companyId, courseId, courseSection, navigateDashboard }) {
  const { confirm, promptForm, toast } = useAppFeedback();
  const [loading, setLoading] = useState(() => Boolean(companyId));
  const [courses, setCourses] = useState([]);
  const [courseQ, setCourseQ] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [ops, setOps] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [enrollPick, setEnrollPick] = useState('');
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [lessonBusy, setLessonBusy] = useState(false);
  const [cohortName, setCohortName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState('title');
  const [sortDir, setSortDir] = useState('asc');
  const [enrollPage, setEnrollPage] = useState(1);
  const [enrollPageSize, setEnrollPageSize] = useState(ENROLL_PAGE_THRESHOLD);
  const [cohortReport, setCohortReport] = useState(null);
  const [cohortReportLoading, setCohortReportLoading] = useState(false);
  const [detailSection, setDetailSection] = useState('content');

  const openCourse = useCallback(
    (id) => {
      const nextId = Number(id);
      if (!Number.isFinite(nextId) || nextId <= 0) return;
      setSelectedId(nextId);
      setDetailSection('content');
      navigateDashboard?.({ tab: 'lms', course: nextId, lmsSection: 'content' });
    },
    [navigateDashboard]
  );

  const backToList = useCallback(() => {
    setSelectedId(null);
    setDetail(null);
    setEnrollments([]);
    setOps(null);
    setCohortReport(null);
    setDetailSection('content');
    navigateDashboard?.({ tab: 'lms', course: null, lmsSection: null });
  }, [navigateDashboard]);

  // Full-panel skeleton only on the first load per company; reloads after saves stay in place.
  const coursesLoadedForRef = useRef(null);
  const loadCourses = useCallback(async () => {
    if (!companyId) {
      setCourses([]);
      setLoading(false);
      return;
    }
    if (coursesLoadedForRef.current !== companyId) setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/lms/courses?${companyQs(companyId)}&includeInactive=1&limit=80`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'load');
      setCourses(json.courses || []);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.loadError'), 'error');
    } finally {
      coursesLoadedForRef.current = companyId;
      setLoading(false);
    }
  }, [companyId, locale, toast]);

  const loadDetail = useCallback(
    async (id) => {
      if (!companyId || !id) return;
      setDetailLoading(true);
      try {
        const [cRes, eRes] = await Promise.all([
          fetch(
            `/api/admin/lms/courses/${encodeURIComponent(id)}?${companyQs(companyId)}&includeInactiveLessons=1`
          ),
          fetch(
            `/api/admin/lms/courses/${encodeURIComponent(id)}/enrollments?${companyQs(companyId)}`
          ),
        ]);
        const cJson = await cRes.json().catch(() => ({}));
        const eJson = await eRes.json().catch(() => ({}));
        if (!cRes.ok) throw new Error(cJson?.error || 'detail');
        setDetail({ course: cJson.course, lessons: cJson.lessons || [] });
        setEnrollments(eRes.ok ? eJson.enrollments || [] : []);
        setOps(eRes.ok ? eJson.ops || null : null);
      } catch (e) {
        toast(e?.message || t(locale, 'panel.lms.loadError'), 'error');
        setDetail(null);
        setEnrollments([]);
        setOps(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [companyId, locale, toast]
  );

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    const queryParams = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : null;
    setDetailSection(normalizeLmsDetailSection(courseSection || queryParams?.get('lmsSection')));
    const passedId = Number(courseId);
    if (Number.isFinite(passedId) && passedId > 0) {
      setSelectedId(passedId);
      return;
    }
    if (queryParams) {
      const queryId = Number(queryParams.get('course'));
      if (Number.isFinite(queryId) && queryId > 0) {
        setSelectedId(queryId);
        return;
      }
    }
    setSelectedId(null);
  }, [courseId, courseSection]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else {
      setDetail(null);
      setEnrollments([]);
      setOps(null);
    }
  }, [selectedId, loadDetail]);

  useEffect(() => {
    setEnrollPage(1);
  }, [selectedId, enrollments.length]);

  const createCourse = async () => {
    const values = await promptForm({
      title: t(locale, 'panel.lms.createCourse'),
      fields: [
        { name: 'title', label: t(locale, 'panel.lms.fieldTitle'), type: 'text', required: true },
        {
          name: 'description',
          label: t(locale, 'panel.lms.fieldDescription'),
          type: 'richText',
          minHeight: 120,
          placeholder: t(locale, 'panel.lms.fieldDescriptionPh'),
        },
        {
          name: 'completionPct',
          label: t(locale, 'panel.lms.fieldCompletionPct'),
          type: 'range',
          min: 1,
          max: 100,
          step: 1,
          suffix: '%',
          defaultValue: '100',
        },
      ],
    });
    if (!values) return;
    try {
      const res = await fetch('/api/admin/lms/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          title: values.title,
          description: values.description || '',
          completionPct: Number(values.completionPct) || 100,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'create');
      toast(t(locale, 'panel.lms.courseCreated'), 'ok');
      await loadCourses();
      if (json.course?.id) openCourse(json.course.id);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
    }
  };

  const editCourse = async (courseRow = null) => {
    const c = courseRow || detail?.course;
    if (!c) return;
    const values = await promptForm({
      title: t(locale, 'panel.lms.editCourse'),
      fields: [
        {
          name: 'title',
          label: t(locale, 'panel.lms.fieldTitle'),
          type: 'text',
          required: true,
          defaultValue: c.title,
        },
        {
          name: 'description',
          label: t(locale, 'panel.lms.fieldDescription'),
          type: 'richText',
          minHeight: 120,
          placeholder: t(locale, 'panel.lms.fieldDescriptionPh'),
          defaultValue: c.description || '',
        },
        {
          name: 'completionPct',
          label: t(locale, 'panel.lms.fieldCompletionPct'),
          type: 'range',
          min: 1,
          max: 100,
          step: 1,
          suffix: '%',
          defaultValue: String(c.completionPct ?? 100),
        },
        {
          name: 'active',
          label: t(locale, 'panel.lms.fieldActive'),
          type: 'boolean',
          defaultValue: c.active !== false,
        },
      ],
    });
    if (!values) return;
    try {
      const res = await fetch(`/api/admin/lms/courses/${encodeURIComponent(c.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          title: values.title,
          description: values.description || '',
          completionPct: Number(values.completionPct) || 100,
          active: values.active !== false,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'update');
      toast(t(locale, 'panel.lms.courseUpdated'), 'ok');
      await Promise.all([
        loadCourses(),
        selectedId && Number(selectedId) === Number(c.id) ? loadDetail(c.id) : null,
      ]);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
    }
  };

  const setCourseActive = async (courseRow, nextActive) => {
    const c = courseRow || detail?.course;
    if (!c) return;
    if (!nextActive) {
      const ok = await confirm({
        title: t(locale, 'panel.lms.deactivateCourse'),
        message: `${c.title}\n\n${t(locale, 'panel.lms.deactivateCourseConfirm')}`,
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const res = await fetch(`/api/admin/lms/courses/${encodeURIComponent(c.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, active: Boolean(nextActive) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'update');
      toast(
        nextActive
          ? t(locale, 'panel.lms.courseReactivated')
          : t(locale, 'panel.lms.courseDeactivated'),
        'ok'
      );
      await loadCourses();
      if (selectedId && Number(selectedId) === Number(c.id)) {
        if (!nextActive) backToList();
        else await loadDetail(c.id);
      }
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
    }
  };

  const addLesson = async () => {
    if (!selectedId) return;
    const values = await promptForm({
      title: t(locale, 'panel.lms.addLesson'),
      fields: [
        {
          name: 'lessonType',
          label: t(locale, 'panel.lms.fieldLessonType'),
          type: 'select',
          defaultValue: 'link',
          options: [
            { value: 'link', label: t(locale, 'panel.lms.lessonTypeVideo') },
            { value: 'pdf', label: t(locale, 'panel.lms.lessonTypePdf') },
          ],
        },
        { name: 'title', label: t(locale, 'panel.lms.fieldTitle'), type: 'text', required: true },
        {
          name: 'description',
          label: t(locale, 'panel.lms.fieldLessonDescription'),
          type: 'textarea',
          rows: 4,
          maxLength: 8000,
          placeholder: t(locale, 'panel.lms.fieldLessonDescriptionPlaceholder'),
        },
        {
          name: 'contentUrl',
          label: t(locale, 'panel.lms.fieldVideoUrl'),
          type: 'text',
          required: true,
          placeholder: 'https://…',
          showWhen: (formValues) => formValues.lessonType === 'link',
        },
        {
          name: 'pdfFile',
          label: t(locale, 'panel.lms.fieldPdf'),
          type: 'file',
          accept: 'application/pdf,.pdf',
          uploadLabel: t(locale, 'panel.lms.choosePdf'),
          help: t(locale, 'panel.lms.pdfHelp'),
          showWhen: (formValues) => formValues.lessonType === 'pdf',
        },
      ],
    });
    if (!values) return;
    const isPdf = values.lessonType === 'pdf';
    const file = values.pdfFile;
    if (isPdf && !file) {
      toast(t(locale, 'panel.lms.pdfRequired'), 'error');
      return;
    }
    if (isPdf && Number(file.size) > 5 * 1024 * 1024) {
      toast(t(locale, 'errors.INVALID_LMS_FILE_SIZE'), 'error');
      return;
    }
    try {
      setLessonBusy(true);
      let res;
      if (isPdf) {
        const form = new FormData();
        form.append('file', file);
        form.append('title', values.title);
        form.append('description', values.description || '');
        form.append('companyId', String(companyId));
        res = await fetch(
          `/api/admin/lms/courses/${encodeURIComponent(selectedId)}/lessons/upload`,
          { method: 'POST', body: form }
        );
      } else {
        res = await fetch(`/api/admin/lms/courses/${encodeURIComponent(selectedId)}/lessons`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            title: values.title,
            description: values.description || '',
            contentUrl: values.contentUrl,
          }),
        });
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = json?.errorCode;
        const localized = code ? t(locale, `errors.${code}`) : '';
        throw new Error(
          (localized && localized !== `errors.${code}` && localized) || json?.error || 'lesson'
        );
      }
      toast(t(locale, 'panel.lms.lessonCreated'), 'ok');
      await Promise.all([loadDetail(selectedId), loadCourses()]);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
    } finally {
      setLessonBusy(false);
    }
  };

  const editLesson = async (lesson) => {
    const values = await promptForm({
      title: lmsText(locale, 'lessonEdit', 'Editar aula'),
      fields: [
        {
          name: 'title',
          label: t(locale, 'panel.lms.fieldTitle'),
          type: 'text',
          required: true,
          defaultValue: lesson.title,
        },
        {
          name: 'description',
          label: t(locale, 'panel.lms.fieldLessonDescription'),
          type: 'textarea',
          rows: 4,
          maxLength: 8000,
          defaultValue: lesson.description || '',
        },
        {
          name: 'contentUrl',
          label: t(locale, 'panel.lms.fieldUrl'),
          type: 'text',
          required: true,
          defaultValue: lesson.contentUrl,
        },
      ],
    });
    if (!values) return;
    setLessonBusy(true);
    try {
      const res = await fetch(`/api/admin/lms/lessons/${encodeURIComponent(lesson.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          title: values.title,
          description: values.description || '',
          contentUrl: values.contentUrl,
          contentKind: lesson.contentKind,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'lesson update');
      toast(lmsText(locale, 'lessonUpdated', 'Aula atualizada.'), 'ok');
      await loadDetail(selectedId);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
    } finally {
      setLessonBusy(false);
    }
  };

  const reorderLesson = async (lessonIndex, direction) => {
    const nextIndex = lessonIndex + direction;
    const lessons = [...(detail?.lessons || [])];
    if (!selectedId || nextIndex < 0 || nextIndex >= lessons.length) return;
    [lessons[lessonIndex], lessons[nextIndex]] = [lessons[nextIndex], lessons[lessonIndex]];
    setLessonBusy(true);
    try {
      const res = await fetch(
        `/api/admin/lms/courses/${encodeURIComponent(selectedId)}/lessons/reorder`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            lessonIds: lessons.map((lesson) => Number(lesson.id)),
          }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'lesson reorder');
      setDetail((current) => (current ? { ...current, lessons } : current));
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
    } finally {
      setLessonBusy(false);
    }
  };

  const deactivateLesson = async (lesson) => {
    const ok = await confirm({
      title: t(locale, 'panel.lms.deactivateLesson'),
      message: lesson.title,
    });
    if (!ok) return;
    setLessonBusy(true);
    try {
      const res = await fetch(`/api/admin/lms/lessons/${encodeURIComponent(lesson.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, active: false }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || 'deactivate');
      }
      toast(t(locale, 'panel.lms.lessonDeactivated'), 'ok');
      await loadDetail(selectedId);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
    } finally {
      setLessonBusy(false);
    }
  };

  const editLessonQuiz = async (lesson) => {
    setLessonBusy(true);
    let existing = [];
    try {
      const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
      const res = await fetch(
        `/api/admin/lms/lessons/${encodeURIComponent(lesson.id)}/quiz${qs}`
      );
      const json = await res.json().catch(() => ({}));
      if (res.ok) existing = Array.isArray(json.questions) ? json.questions : [];
    } catch {
      /* empty quiz */
    } finally {
      setLessonBusy(false);
    }
    const fields = [];
    const QUIZ_SLOTS = 5;
    for (let i = 0; i < QUIZ_SLOTS; i += 1) {
      const q = existing[i];
      const choices = (q?.choices || []).map((c) => c.text).join(' | ');
      fields.push(
        {
          key: `q${i}prompt`,
          type: 'text',
          label: t(locale, 'panel.lms.quizPromptN', { n: i + 1 }),
          defaultValue: q?.prompt || '',
        },
        {
          key: `q${i}choices`,
          type: 'text',
          label: t(locale, 'panel.lms.quizChoicesN', { n: i + 1 }),
          help: i === 0 ? t(locale, 'panel.lms.quizChoicesHelp') : undefined,
          defaultValue: choices,
        },
        {
          key: `q${i}correct`,
          type: 'select',
          label: t(locale, 'panel.lms.quizCorrectN', { n: i + 1 }),
          defaultValue: '0',
          options: [
            { value: '0', label: 'A' },
            { value: '1', label: 'B' },
            { value: '2', label: 'C' },
            { value: '3', label: 'D' },
          ],
        }
      );
      if (q?.correctChoiceId && Array.isArray(q.choices)) {
        const idx = q.choices.findIndex((c) => c.id === q.correctChoiceId);
        if (idx >= 0) fields[fields.length - 1].defaultValue = String(idx);
      }
    }
    const values = await promptForm({
      title: t(locale, 'panel.lms.quizEditTitle', { title: lesson.title }),
      confirmLabel: t(locale, 'panel.common.save'),
      fields,
    });
    if (!values) return;
    const questions = [];
    for (let i = 0; i < QUIZ_SLOTS; i += 1) {
      const prompt = String(values[`q${i}prompt`] || '').trim();
      if (!prompt) continue;
      const parts = String(values[`q${i}choices`] || '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4);
      if (parts.length < 2) {
        toast(t(locale, 'panel.lms.quizNeedChoices'), 'error');
        return;
      }
      const correctIdx = Math.min(parts.length - 1, Math.max(0, Number(values[`q${i}correct`]) || 0));
      const choices = parts.map((text, j) => ({
        id: String.fromCharCode(97 + j),
        text,
      }));
      questions.push({
        prompt,
        choices,
        correctChoiceId: choices[correctIdx].id,
      });
    }
    setLessonBusy(true);
    try {
      const res = await fetch(`/api/admin/lms/lessons/${encodeURIComponent(lesson.id)}/quiz`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, questions }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'quiz');
      toast(t(locale, 'panel.lms.quizSaved'), 'ok');
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
    } finally {
      setLessonBusy(false);
    }
  };

  const loadCohortReport = async () => {
    if (!selectedId || !companyId) return;
    setCohortReportLoading(true);
    try {
      const params = new URLSearchParams({
        companyId: String(companyId),
        courseId: String(selectedId),
      });
      const res = await fetch(`/api/admin/lms/cohort-report?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'report');
      setCohortReport(json);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
      setCohortReport(null);
    } finally {
      setCohortReportLoading(false);
    }
  };

  const enroll = async (target) => {
    if (!selectedId) return;
    setEnrollBusy(true);
    try {
      const res = await fetch(
        `/api/admin/lms/courses/${encodeURIComponent(selectedId)}/enrollments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyId,
            ...target,
            cohortName: cohortName.trim() || null,
            dueDate: dueDate || null,
            mandatory,
            notify: true,
          }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'enroll');
      toast(
        t(locale, 'panel.lms.enrolled', {
          n: json.enrolled ?? 0,
          skipped: json.skipped ?? 0,
        }),
        'ok'
      );
      setEnrollPick('');
      await Promise.all([loadDetail(selectedId), loadCourses()]);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
    } finally {
      setEnrollBusy(false);
    }
  };

  const enrollSelected = async () => {
    const candidateId = Number(enrollPick);
    if (!Number.isFinite(candidateId) || candidateId <= 0) return;
    await enroll({ candidateIds: [candidateId] });
  };

  const enrollAllEmployees = async () => {
    const ok = await confirm({
      title: lmsText(locale, 'batchAllEmployees', 'Matricular todos os colaboradores'),
      message: detail?.course?.title || '',
    });
    if (ok) await enroll({ allEmployees: true });
  };

  const enrollTeamGroup = async () => {
    setEnrollBusy(true);
    try {
      const res = await fetch(`/api/admin/team-groups?${companyQs(companyId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'groups');
      const groups = Array.isArray(json.items) ? json.items : [];
      const values = await promptForm({
        title: lmsText(locale, 'batchTeamGroup', 'Matricular grupo'),
        fields: [
          {
            name: 'teamGroupId',
            label: lmsText(locale, 'batchTeamGroup', 'Grupo'),
            type: 'select',
            required: true,
            options: groups.map((group) => ({
              value: String(group.id),
              label: group.name,
            })),
          },
        ],
      });
      if (!values) return;
      const teamGroupId = Number(values.teamGroupId);
      if (Number.isFinite(teamGroupId) && teamGroupId > 0) await enroll({ teamGroupId });
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.loadError'), 'error');
    } finally {
      setEnrollBusy(false);
    }
  };

  const editEnrollment = async (row) => {
    const values = await promptForm({
      title: lmsText(locale, 'enrollmentDue', 'Prazo da matrícula'),
      fields: [
        {
          name: 'dueDate',
          label: lmsText(locale, 'fieldDueDate', 'Data limite'),
          type: 'date',
          defaultValue: row.dueDate || '',
        },
        {
          name: 'mandatory',
          label: lmsText(locale, 'fieldMandatory', 'Obrigatório'),
          type: 'boolean',
          defaultValue: row.mandatory,
        },
      ],
    });
    if (!values) return;
    setEnrollBusy(true);
    try {
      const res = await fetch(`/api/admin/lms/enrollments/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          dueDate: values.dueDate || null,
          mandatory: values.mandatory === true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'enrollment update');
      await loadDetail(selectedId);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
    } finally {
      setEnrollBusy(false);
    }
  };

  const resetEnrollment = async (row) => {
    const ok = await confirm({
      title: lmsText(locale, 'resetProgress', 'Zerar progresso'),
      message: row.fullName,
    });
    if (!ok) return;
    setEnrollBusy(true);
    try {
      const res = await fetch(`/api/admin/lms/enrollments/${encodeURIComponent(row.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, resetProgress: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || 'reset progress');
      await Promise.all([loadDetail(selectedId), loadCourses()]);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
    } finally {
      setEnrollBusy(false);
    }
  };

  const removeEnrollment = async (row) => {
    const ok = await confirm({
      title: t(locale, 'panel.lms.removeEnrollment'),
      message: row.fullName,
    });
    if (!ok) return;
    setEnrollBusy(true);
    try {
      const res = await fetch(
        `/api/admin/lms/enrollments/${encodeURIComponent(row.id)}?${companyQs(companyId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || 'remove');
      }
      toast(t(locale, 'panel.lms.enrollmentRemoved'), 'ok');
      await Promise.all([loadDetail(selectedId), loadCourses()]);
    } catch (e) {
      toast(e?.message || t(locale, 'panel.lms.saveError'), 'error');
    } finally {
      setEnrollBusy(false);
    }
  };

  const sortedCourses = useMemo(() => {
    const dirMul = sortDir === 'asc' ? 1 : -1;
    const q = String(courseQ || '').trim().toLowerCase();
    const rows = courses.filter((c) => {
      if (activeFilter === 'active' && !c.active) return false;
      if (activeFilter === 'inactive' && c.active) return false;
      if (!q) return true;
      return String(c.title || '').toLowerCase().includes(q);
    });
    rows.sort((a, b) => {
      if (sort === 'lessonCount' || sort === 'enrollmentCount') {
        return (Number(a[sort] || 0) - Number(b[sort] || 0)) * dirMul;
      }
      if (sort === 'active') {
        return (Number(Boolean(a.active)) - Number(Boolean(b.active))) * dirMul;
      }
      return (
        String(a.title || '').localeCompare(String(b.title || ''), contentLocale(locale)) *
        dirMul
      );
    });
    return rows;
  }, [courses, courseQ, activeFilter, sort, sortDir, locale]);

  const total = sortedCourses.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(page, totalPages);
  const pageRows = sortedCourses.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (columnKey) => {
    const nextDir = clientSortNextDir(columnKey, sort, sortDir);
    setSort(columnKey);
    setSortDir(nextDir);
    setPage(1);
  };

  const enrollTotal = enrollments.length;
  const enrollTotalPages = Math.max(1, Math.ceil(enrollTotal / Math.max(1, enrollPageSize)));
  const safeEnrollPage = Math.min(enrollPage, enrollTotalPages);
  const enrollPageRows = enrollments.slice(
    (safeEnrollPage - 1) * enrollPageSize,
    safeEnrollPage * enrollPageSize
  );
  const showEnrollPager = enrollTotal > ENROLL_PAGE_THRESHOLD;

  if (!companyId) {
    return <p className={S.muted}>{t(locale, 'panel.lms.needCompany')}</p>;
  }

  if (loading) return <AppLoading variant="panel" />;

  /* ── Detail mode ─────────────────────────────────────────────── */
  if (selectedId) {
    const course = detail?.course;
    return (
      <ContentEnter animKey={String(selectedId)} className={S.stack}>
        <div>
          <button type="button" className={cn(S.btnGhost, 'min-h-touch')} onClick={backToList}>
            {t(locale, 'panel.lms.backToList')}
          </button>
        </div>

        {detailLoading && !course ? (
          <AppLoading variant="panel" />
        ) : !course ? (
          <EmptyState
            title={t(locale, 'panel.lms.loadError')}
            actionLabel={t(locale, 'panel.lms.backToList')}
            onAction={backToList}
          />
        ) : (
          <>
            <AdminPageHeader
              title={course.title}
              subtitle={t(locale, 'panel.lms.detailSubtitle')}
              actions={
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <AdminEditButton
                    onClick={() => editCourse(course)}
                    label={t(locale, 'panel.lms.editCourse')}
                  />
                  {course.active !== false ? (
                    <AdminDeleteButton
                      onClick={() => setCourseActive(course, false)}
                      label={t(locale, 'panel.lms.deactivateCourse')}
                    />
                  ) : (
                    <AdminIconButton
                      icon="refresh"
                      tint="success"
                      label={t(locale, 'panel.lms.reactivateCourse')}
                      onClick={() => setCourseActive(course, true)}
                    />
                  )}
                </div>
              }
            />

            <div className="flex flex-wrap items-center gap-2">
              {course.active !== false ? (
                <StatusToneChip tone="success" bordered={false}>
                  {t(locale, 'panel.lms.statusActive')}
                </StatusToneChip>
              ) : (
                <StatusToneChip tone="neutral" bordered={false}>
                  {t(locale, 'panel.lms.statusInactive')}
                </StatusToneChip>
              )}
              <span className={cn(S.muted, 'text-prose')}>
                {t(locale, 'panel.lms.completionRule', { pct: course.completionPct })}
              </span>
            </div>

            {course.description ? (
              <RichTextView
                html={course.description}
                className="m-0 max-w-3xl text-sm leading-relaxed text-ink-muted"
              />
            ) : null}

            {ops ? (
              <p
                className={cn(
                  'm-0 font-mono text-prose',
                  ops.overdue > 0 ? 'text-red-800 dark:text-danger' : 'text-ink-muted'
                )}
              >
                {t(locale, 'panel.lms.opsSummary', {
                  completed: ops.completed,
                  enrolled: ops.enrolled,
                  overdue: ops.overdue,
                })}
              </p>
            ) : null}

            {detailLoading ? <AppLoading variant="inline" /> : null}

            <PanelSubNav
              ariaLabel={t(locale, 'panel.lms.detailTabsAria')}
              active={detailSection}
              onChange={(section) => {
                const next = normalizeLmsDetailSection(section);
                setDetailSection(next);
                navigateDashboard?.({ tab: 'lms', course: selectedId, lmsSection: next, scroll: false, clientOnly: true });
              }}
              tabs={[
                { id: 'content', label: t(locale, 'panel.lms.detailTabContent'), badge: (detail.lessons || []).length },
                { id: 'enrollments', label: t(locale, 'panel.lms.detailTabEnrollments'), badge: enrollments.length },
                { id: 'tracking', label: t(locale, 'panel.lms.detailTabTracking') },
              ]}
            />

            <ContentEnter animKey={detailSection}>
            {detailSection === 'content' ? (
            <section className={cn(S.cardShell, 'p-4 sm:p-5')}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="m-0 font-ui text-base font-semibold text-ink">
                  {t(locale, 'panel.lms.lessonsTitle')}
                  <span className="ml-2 font-ui text-prose font-normal text-ink/75">
                    {(detail.lessons || []).length}
                  </span>
                </h3>
                <AdminCreateButton
                  onClick={addLesson}
                  disabled={lessonBusy}
                  label={t(locale, 'panel.lms.addLesson')}
                />
              </div>
              {(detail.lessons || []).length === 0 ? (
                <EmptyState
                  title={t(locale, 'panel.lms.noLessons')}
                  message={t(locale, 'panel.lms.noLessonsHint')}
                  actionLabel={t(locale, 'panel.lms.addLesson')}
                  onAction={addLesson}
                  className="py-5"
                />
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {detail.lessons.map((l, index) => (
                    <li
                      key={l.id}
                      className="grid grid-cols-1 items-start gap-3 rounded-control border border-ink/10 bg-surface px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                          <span className="font-ui text-prose text-ink/75">{index + 1}.</span>
                          <span className="font-medium">{l.title}</span>
                          {!l.active ? (
                            <StatusToneChip tone="neutral" bordered={false}>
                              {t(locale, 'panel.lms.inactive')}
                            </StatusToneChip>
                          ) : null}
                        </div>
                        {l.description ? (
                          <RichTextView
                            html={l.description}
                            className="mb-0 mt-1.5 max-w-3xl text-prose leading-relaxed text-ink-muted"
                          />
                        ) : null}
                        <div className="mt-1.5">
                          <CopyableLink
                            url={l.contentUrl}
                            locale={locale}
                            compact
                            iconOnly
                            label={String(l.contentKind || 'url')}
                          />
                        </div>
                      </div>
                      <AdminActionsCell className="sm:pt-0.5">
                        <AdminIconButton
                          icon="chevronDown"
                          label={lmsText(locale, 'lessonReorderUp', 'Mover aula para cima')}
                          disabled={lessonBusy || index === 0}
                          onClick={() => reorderLesson(index, -1)}
                          className="rotate-180"
                        />
                        <AdminIconButton
                          icon="chevronDown"
                          label={lmsText(locale, 'lessonReorderDown', 'Mover aula para baixo')}
                          disabled={lessonBusy || index === detail.lessons.length - 1}
                          onClick={() => reorderLesson(index, 1)}
                        />
                        <AdminEditButton
                          onClick={() => editLesson(l)}
                          disabled={lessonBusy}
                          label={lmsText(locale, 'lessonEdit', 'Editar aula')}
                        />
                        <AdminIconButton
                          icon="clipboard"
                          label={t(locale, 'panel.lms.quizEdit')}
                          disabled={lessonBusy}
                          onClick={() => void editLessonQuiz(l)}
                        />
                        {l.active ? (
                          <AdminDeleteButton
                            onClick={() => deactivateLesson(l)}
                            disabled={lessonBusy}
                            label={t(locale, 'panel.lms.deactivateLesson')}
                          />
                        ) : null}
                      </AdminActionsCell>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            ) : null}

            {detailSection === 'tracking' ? (
            <CollapsibleBlock
              locale={locale}
              variant="card"
              title={t(locale, 'panel.lms.cohortReportTitle')}
              defaultOpen={false}
              collapsedHint={t(locale, 'panel.lms.cohortReportHint')}
            >
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={cn(S.btnBrandSoft, 'min-h-touch')}
                  disabled={cohortReportLoading}
                  onClick={() => void loadCohortReport()}
                >
                  {cohortReportLoading
                    ? t(locale, 'panel.common.loading')
                    : t(locale, 'panel.lms.cohortReportLoad')}
                </button>
              </div>
              {cohortReportLoading ? (
                <AppLoading variant="panel" />
              ) : cohortReport?.items?.length ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {cohortReport.items.map((row, idx) => (
                    <li
                      key={row.id ?? `unassigned-${idx}`}
                      className={cn(
                        'rounded-control border bg-surface px-3 py-2.5',
                        row.overdue ? 'border-warning/30' : 'border-ink/10'
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-ui text-sm text-ink">
                            {row.name || t(locale, 'panel.lms.cohortUnassigned')}
                          </span>
                          {row.overdue ? (
                            <StatusToneChip tone="warning">
                              {t(locale, 'panel.lms.cohortOverdueN', { n: row.overdue })}
                            </StatusToneChip>
                          ) : null}
                        </div>
                        <span className="font-ui text-prose text-ink-muted">
                          {row.completionPct}% · {row.completed}/{row.enrolled}
                        </span>
                      </div>
                      <MeterBar
                        percent={row.completionPct}
                        height={6}
                        className="mt-2"
                        toneClass={
                          row.completionPct >= 100
                            ? 'bg-success'
                            : row.overdue
                              ? 'bg-warning'
                              : 'bg-brand-500'
                        }
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <InlineCallout tone="info">
                  {cohortReport
                    ? t(locale, 'panel.lms.cohortReportNone')
                    : t(locale, 'panel.lms.cohortReportIdle')}
                </InlineCallout>
              )}
            </CollapsibleBlock>
            ) : null}

            {detailSection === 'enrollments' ? (
            <>
            <CollapsibleBlock
              locale={locale}
              variant="card"
              title={lmsText(locale, 'enrollBatchOpts', 'Opções da turma')}
              defaultOpen={false}
            >
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <FormField label={lmsText(locale, 'batchCohortName', 'Nome da turma (opcional)')}>
                  <input
                    type="text"
                    value={cohortName}
                    onChange={(event) => setCohortName(event.target.value)}
                    className={cn(S.input, 'w-full')}
                  />
                </FormField>
                <FormField as="div" label={lmsText(locale, 'fieldDueDate', 'Data limite')}>
                  <DateField
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                    aria-label={lmsText(locale, 'fieldDueDate', 'Data limite')}
                  />
                </FormField>
              </div>
              <label className="mt-3 flex min-h-touch cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={mandatory}
                  onChange={(event) => setMandatory(event.target.checked)}
                  className={S.checkbox}
                />
                {lmsText(locale, 'fieldMandatory', 'Obrigatório')}
              </label>
            </CollapsibleBlock>

            <CollapsibleBlock
              locale={locale}
              variant="card"
              title={t(locale, 'panel.lms.enrollmentsTitle')}
              count={enrollments.length}
              defaultOpen
            >
              <div className={cn(S.fieldRow, 'items-end')}>
                <div className="min-w-[220px] flex-1">
                  <FormField label={t(locale, 'panel.lms.enrollSearchPh')}>
                    <EntitySearchSelect
                      value={enrollPick}
                      onChange={setEnrollPick}
                      searchUrl={`/api/admin/employees/search?${companyQs(companyId)}`}
                      locale={locale}
                      placeholder={t(locale, 'panel.lms.enrollSearchPh')}
                      aria-label={t(locale, 'panel.lms.enrollSearchPh')}
                    />
                  </FormField>
                </div>
                <button
                  type="button"
                  className={cn(S.btnPrimary, 'min-h-touch shrink-0')}
                  disabled={enrollBusy || !enrollPick}
                  onClick={enrollSelected}
                >
                  {t(locale, 'panel.lms.enrollBtn')}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={cn(S.btnBrandSoft, 'min-h-touch')}
                  disabled={enrollBusy}
                  onClick={enrollAllEmployees}
                >
                  {lmsText(locale, 'batchAllEmployees', 'Matricular todos os colaboradores')}
                </button>
                <button
                  type="button"
                  className={cn(S.btnGhost, 'min-h-touch')}
                  disabled={enrollBusy}
                  onClick={enrollTeamGroup}
                >
                  {lmsText(locale, 'batchTeamGroup', 'Matricular grupo')}
                </button>
              </div>
              {enrollments.length === 0 ? (
                <EmptyState
                  title={t(locale, 'panel.lms.noEnrollments')}
                  message={t(locale, 'panel.lms.noEnrollmentsHint')}
                  className="mt-3 py-5"
                />
              ) : (
                <>
                  <AdminTableShell locale={locale}
                    minWidth="560px"
                    className="mt-3"
                    animKey={`${selectedId}|${safeEnrollPage}|${enrollPageSize}`}
                  >
                    <thead>
                      <tr className="border-b border-ink/10 bg-canvas-alt">
                        <AdminTh>{t(locale, 'panel.lms.colPerson')}</AdminTh>
                        <AdminTh>{t(locale, 'panel.lms.colProgress')}</AdminTh>
                        <AdminActionsTh>{t(locale, 'panel.admin.colActions')}</AdminActionsTh>
                      </tr>
                    </thead>
                    <tbody>
                      {enrollPageRows.map((row) => (
                        <tr key={row.id} className="border-b border-ink/8">
                          <td className="px-4 py-3">
                            <div className="text-sm text-ink">{row.fullName}</div>
                            <div className="font-ui text-prose text-ink/75">{row.email}</div>
                            {row.cohortName ? (
                              <div className="mt-1 text-prose text-ink-muted">
                                {lmsText(locale, 'cohortLabel', 'Turma')}: {row.cohortName}
                              </div>
                            ) : null}
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-prose text-ink-muted">
                              {row.dueDate ? (
                                <span>
                                  {lmsText(locale, 'enrollmentDue', 'Prazo')}: {row.dueDate}
                                </span>
                              ) : null}
                              {row.mandatory ? (
                                <StatusToneChip tone="warning" bordered={false}>
                                  {lmsText(locale, 'fieldMandatory', 'Obrigatório')}
                                </StatusToneChip>
                              ) : null}
                              {row.overdue ? (
                                <StatusToneChip tone="danger" bordered={false}>
                                  {lmsText(locale, 'enrollmentOverdue', 'Em atraso')}
                                </StatusToneChip>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-prose text-ink-muted">
                            {row.progressPct}%
                            {row.isComplete ? (
                              <span className="ml-2 text-success">
                                {t(locale, 'panel.lms.completed')}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <AdminActionsCell>
                              <AdminIconButton
                                label={lmsText(locale, 'resetProgress', 'Zerar progresso')}
                                icon="refresh"
                                tint="warning"
                                disabled={enrollBusy}
                                onClick={() => resetEnrollment(row)}
                              />
                              <AdminEditButton
                                onClick={() => editEnrollment(row)}
                                disabled={enrollBusy}
                                label={lmsText(locale, 'enrollmentDue', 'Editar prazo')}
                              />
                              <AdminDeleteButton
                                onClick={() => removeEnrollment(row)}
                                disabled={enrollBusy}
                                label={t(locale, 'panel.lms.removeEnrollment')}
                              />
                            </AdminActionsCell>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </AdminTableShell>
                  {showEnrollPager ? (
                    <AdminListPager
                      locale={locale}
                      page={safeEnrollPage}
                      pageSize={enrollPageSize}
                      total={enrollTotal}
                      pageSizeOptions={PAGE_SIZE_OPTIONS}
                      onPageChange={setEnrollPage}
                      onPageSizeChange={(ps) => {
                        setEnrollPageSize(ps);
                        setEnrollPage(1);
                      }}
                    />
                  ) : null}
                </>
              )}
            </CollapsibleBlock>
            </>
            ) : null}
            </ContentEnter>
          </>
        )}
      </ContentEnter>
    );
  }

  /* ── List mode ───────────────────────────────────────────────── */
  return (
    <div className={S.stack}>
      <AdminPageHeader
        title={t(locale, 'panel.lms.title')}
        subtitle={t(locale, 'panel.lms.subtitle')}
        actions={<AdminCreateButton onClick={createCourse} label={t(locale, 'panel.lms.createCourse')} />}
      />

      {courses.length === 0 ? (
        <EmptyState
          title={t(locale, 'panel.lms.empty')}
          message={t(locale, 'panel.lms.emptyHint')}
          actionLabel={t(locale, 'panel.lms.createCourse')}
          onAction={createCourse}
        />
      ) : (
        <>
          <AdminListFilters
            aria-label={t(locale, 'panel.lms.title')}
            locale={locale}
            onClear={() => {
              setCourseQ('');
              setActiveFilter('');
              setPage(1);
            }}
            clearEnabled={Boolean(String(courseQ || '').trim() || activeFilter)}
          >
            <AdminListSearch
              locale={locale}
              value={courseQ}
              onChange={(v) => {
                setCourseQ(v);
                setPage(1);
              }}
              placeholder={t(locale, 'panel.lms.searchCoursePh')}
            />
            <AdminListFilterSelect
              label={t(locale, 'panel.admin.filterActive')}
              value={activeFilter}
              onChange={(v) => {
                setActiveFilter(v);
                setPage(1);
              }}
            >
              <option value="">{t(locale, 'panel.admin.filterAll')}</option>
              <option value="active">{t(locale, 'panel.admin.filterActiveYes')}</option>
              <option value="inactive">{t(locale, 'panel.admin.filterActiveNo')}</option>
            </AdminListFilterSelect>
          </AdminListFilters>

          <AdminListResults animKey={`${courseQ}|${activeFilter}|${sort}|${sortDir}|${safePage}|${pageSize}`}>
            {total === 0 ? (
              <EmptyState title={t(locale, 'panel.lms.listEmptyFilter')} />
            ) : (
              <>
                <AdminTableShell locale={locale} minWidth="640px">
                  <thead className="border-b border-ink/10 bg-canvas-alt">
                    <tr>
                      <SortableTh columnKey="title" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                        {t(locale, 'panel.lms.colCourse')}
                      </SortableTh>
                      <SortableTh
                        columnKey="lessonCount"
                        sortKey={sort}
                        dir={sortDir}
                        onSort={toggleSort}
                      >
                        {t(locale, 'panel.lms.colLessons')}
                      </SortableTh>
                      <SortableTh
                        columnKey="enrollmentCount"
                        sortKey={sort}
                        dir={sortDir}
                        onSort={toggleSort}
                      >
                        {t(locale, 'panel.lms.colEnrolled')}
                      </SortableTh>
                      <SortableTh columnKey="active" sortKey={sort} dir={sortDir} onSort={toggleSort}>
                        {t(locale, 'panel.lms.colStatus')}
                      </SortableTh>
                      <AdminActionsTh>{t(locale, 'panel.admin.colActions')}</AdminActionsTh>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {pageRows.map((c) => (
                      <tr key={c.id} className="hover:bg-canvas-alt/50">
                        <td className="px-4 py-3 text-sm text-ink">{c.title}</td>
                        <td className="px-4 py-3 font-mono text-prose text-ink-muted">{c.lessonCount}</td>
                        <td className="px-4 py-3 font-mono text-prose text-ink-muted">
                          {c.completedCount}/{c.enrollmentCount}
                        </td>
                        <td className="px-4 py-3">
                          {c.active ? (
                            <StatusToneChip tone="success" bordered={false}>
                              {t(locale, 'panel.admin.filterActiveYes')}
                            </StatusToneChip>
                          ) : (
                            <StatusToneChip tone="neutral" bordered={false}>
                              {t(locale, 'panel.lms.inactive')}
                            </StatusToneChip>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <AdminActionsCell>
                            <AdminViewButton
                              onClick={() => openCourse(c.id)}
                              label={t(locale, 'panel.lms.open')}
                            />
                            <AdminEditButton
                              onClick={() => editCourse(c)}
                              label={t(locale, 'panel.lms.editCourse')}
                            />
                            {c.active ? (
                              <AdminDeleteButton
                                onClick={() => setCourseActive(c, false)}
                                label={t(locale, 'panel.lms.deactivateCourse')}
                              />
                            ) : (
                              <AdminIconButton
                                icon="refresh"
                                tint="success"
                                label={t(locale, 'panel.lms.reactivateCourse')}
                                onClick={() => setCourseActive(c, true)}
                              />
                            )}
                          </AdminActionsCell>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </AdminTableShell>
                <AdminListPager
                  locale={locale}
                  page={safePage}
                  pageSize={pageSize}
                  total={total}
                  loading={loading}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  onPageChange={setPage}
                  onPageSizeChange={(ps) => {
                    setPageSize(ps);
                    setPage(1);
                  }}
                />
              </>
            )}
          </AdminListResults>
        </>
      )}
    </div>
  );
}
