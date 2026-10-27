'use client';

import { EmployeePageLoading } from '../../../_components/EmployeeDedicatedShell';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { t, localeHtmlLang } from '../../../../lib/i18n';
import { cn } from '../../../../lib/cn';
import { S } from '../../../dashboard/dashboard-shared';
import { ContentEnter } from '../../../_components/AppLoading';
import { EmptyState } from '../../../_components/EmptyState';
import { useAppFeedback } from '../../../_components/AppFeedback';
import { redirectEmployeeIfUnauthorized } from '../../../../lib/employee/employee-client-session';

function formatCertDate(value, locale) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(localeHtmlLang(locale), {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function EmployeeLmsCertificateClient({ locale = 'pt-BR' }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useAppFeedback();
  const enrollmentId = Number(searchParams?.get('enrollmentId') || 0);
  const [cert, setCert] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!enrollmentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/employee/lms/certificate?enrollmentId=${encodeURIComponent(enrollmentId)}`
      );
      if (redirectEmployeeIfUnauthorized(router, res.status)) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'cert');
      setCert(data.certificate || null);
    } catch (e) {
      toast(e?.message || t(locale, 'employeeHome.lmsCertError'), 'error');
      setCert(null);
    } finally {
      setLoading(false);
    }
  }, [enrollmentId, locale, router, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const prev = document.title;
    document.title = t(locale, 'employeeHome.lmsCertDocumentTitle');
    return () => {
      document.title = prev;
    };
  }, [locale]);

  if (loading) return <EmployeePageLoading locale={locale} />;

  if (!cert) {
    return (
      <ContentEnter animKey="cert-empty">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          <EmptyState
            title={t(locale, 'employeeHome.lmsCertificate')}
            message={t(locale, 'employeeHome.lmsCertUnavailable')}
            actionLabel={t(locale, 'employeeHome.lmsBackToCourses')}
            actionHref="/employee/lms"
          />
        </div>
      </ContentEnter>
    );
  }

  return (
    <ContentEnter animKey={`cert|${cert.enrollmentId}`}>
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-wrap gap-2 print:hidden">
          <button
            type="button"
            className={cn(S.btnPrimary, 'min-h-touch')}
            onClick={() => window.print()}
          >
            {t(locale, 'employeeHome.lmsCertPrint')}
          </button>
          <Link href="/employee/lms" className={cn(S.btnGhost, 'min-h-touch no-underline')}>
            {t(locale, 'employeeHome.lmsBackToCourses')}
          </Link>
        </div>
        <article className="mx-auto max-w-2xl rounded-card border-2 border-ink/20 bg-canvas px-8 py-10 text-center shadow-sm print:border-ink/40 print:shadow-none">
          <p className="m-0 font-mono text-2xs uppercase tracking-wider text-ink-faint">
            {cert.companyName}
          </p>
          <h1 className="mt-3 font-display text-2xl font-semibold text-ink">
            {t(locale, 'employeeHome.lmsCertTitle')}
          </h1>
          <p className="mt-6 mb-0 font-ui text-prose text-ink-muted">
            {t(locale, 'employeeHome.lmsCertBody', { name: cert.candidateName })}
          </p>
          <p className="mt-4 mb-0 font-display text-xl font-semibold text-ink">{cert.courseTitle}</p>
          <p className="mt-6 mb-0 font-mono text-2xs text-ink-faint">
            {t(locale, 'employeeHome.lmsCertDate', {
              date: formatCertDate(cert.completedAt, locale),
            })}
          </p>
          <p className="mt-8 mb-0 font-mono text-2xs text-ink-faint print:mt-12">
            {t(locale, 'employeeHome.lmsCertDisclaimer')}
          </p>
        </article>
      </div>
    </ContentEnter>
  );
}
