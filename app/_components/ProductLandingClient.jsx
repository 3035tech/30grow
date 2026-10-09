'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { BrandMark } from './BrandMark';
import { PrimaryCta, PublicSiteHeader } from './PublicSiteHeader';
import { Icon } from './Icon';
import { PRODUCT_LANDING_CONTACT_EMAIL } from '../../lib/product-landing-seo';
import { useLocale } from '../../lib/useLocale';
import { localeHtmlLang, normalizeLocale } from '../../lib/i18n';
import LandingAnalytics from './LandingAnalytics';
import { ContentEnter } from './AppLoading';
import { BlogPostCard } from './BlogPostCard';
import { publicMarketingPath } from '../../lib/public-marketing-paths';
import { PublicLanguageLinks } from './PublicLanguageLinks';

const PILLAR_ICONS = ['vacancies', 'compatibility', 'team', 'academy', 'dp', 'team'];
const TYPE_BARS = [54, 72, 45, 61, 84, 57, 68, 42, 76];

const FEATURE_PREVIEW_COUNT = 6;

function FeatureList({ items, className = '' }) {
  return <ul className={`mb-0 mt-4 list-none space-y-2.5 p-0 ${className}`}>
    {items.map(item => <li key={item} className="flex gap-3 text-sm leading-6 text-ink-muted">
      <Icon name="check" className="mt-1 h-4 w-4 shrink-0 text-success" />
      <span className="min-w-0 break-words">{item}</span>
    </li>)}
  </ul>;
}

function ModuleCard({ pillar, icon, ui, href }) {
  const additional = pillar.items.slice(FEATURE_PREVIEW_COUNT);
  const headingId = `module-${pillar.id}-title`;
  return <article id={pillar.id} aria-labelledby={headingId} className="flex min-w-0 flex-col rounded-card border border-ink/10 bg-surface p-5 sm:p-6">
    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-control bg-brand-50 text-brand-700"><Icon name={icon} className="h-5 w-5" /></div>
    <h3 id={headingId} className="m-0 md:min-h-[3.5rem] font-display text-lg font-semibold text-ink"><Link href={href} className="text-inherit no-underline hover:text-brand-700">{pillar.title}</Link></h3>
    <FeatureList items={pillar.items.slice(0, FEATURE_PREVIEW_COUNT)} className="flex-1" />
    {additional.length > 0 ? <details className="group mt-5 border-t border-ink/10 pt-3">
      <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-3 rounded-control font-ui text-sm font-semibold text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">{ui.showAllFeatures}</span>
        <span className="hidden group-open:inline">{ui.showFewerFeatures}</span>
        <Icon name="chevronDown" className="h-4 w-4 shrink-0 group-open:rotate-180" />
      </summary>
      <FeatureList items={additional} />
    </details> : null}
  </article>;
}

function SectionHeading({ label, title, body, id }) {
  return <div className="max-w-2xl"><p className="mb-3 font-ui text-2xs font-medium text-brand-600">{label}</p><h2 id={id} className="m-0 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-4xl">{title}</h2>{body ? <p className="mb-0 mt-4 font-ui text-base leading-7 text-ink-muted">{body}</p> : null}</div>;
}

function ProductPreview({ copy }) {
  const u = copy.ui;
  return (
    <figure className="relative m-0 lg:translate-x-8" aria-label={u.previewAria}>

      <div className="relative overflow-hidden rounded-card border border-ink/10 bg-surface shadow-card">
        <div className="flex items-center justify-between border-b border-ink/8 px-4 py-3"><div className="flex gap-2"><span className="h-2.5 w-2.5 rounded-full bg-danger/50" /><span className="h-2.5 w-2.5 rounded-full bg-warning/50" /><span className="h-2.5 w-2.5 rounded-full bg-success/50" /></div><span className="font-ui text-[9px] font-medium text-ink-faint">30Grow · {u.liveWorkspace}</span></div>
        <div className="grid min-h-[420px] grid-cols-[64px_1fr] sm:grid-cols-[92px_1fr]">
          <div className="border-r border-white/10 bg-navy px-2 py-5 [--brand-logo-ink:#F8FAFC]">
            <div className="mx-auto mb-6 flex h-8 w-8 items-center justify-center rounded-control bg-transparent"><BrandMark size={20} /></div>
            {['overview', 'team', 'vacancies', 'compatibility', 'academy'].map((name, index) => <div key={name} className={`mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-control ${index === 1 ? 'bg-white/10 text-brand-400' : 'text-white/70'}`}><Icon name={name} className="h-4 w-4" /></div>)}
          </div>
          <div className="min-w-0 p-4 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3"><div><p className="m-0 font-ui text-[9px] font-medium text-ink-faint">{u.teamReading}</p><h3 className="mb-0 mt-1.5 font-ui text-base font-semibold text-ink">{u.previewTitle}</h3></div><span className="rounded-full bg-success/10 px-2 py-1 font-ui text-[10px] text-success">{u.updated}</span></div>
            <div className="grid gap-3 sm:grid-cols-[1.15fr_.85fr]">
              <div className="rounded-card border border-ink/8 bg-canvas/70 p-4"><div className="mb-4 flex items-start justify-between gap-2"><span className="min-w-0 font-ui text-xs font-semibold text-ink">{u.typeMap}</span><span className="shrink-0 font-ui text-[9px] leading-4 text-ink-faint">T1–T9</span></div><div className="flex h-28 items-end gap-1.5" aria-hidden>{TYPE_BARS.map((height, index) => <div key={index} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"><span className="w-full shrink-0 rounded-t-sm bg-teal" style={{ height: `${height}%` }} /><span className="font-ui text-[8px] text-ink-faint">{index + 1}</span></div>)}</div></div>
              <div className="rounded-card border border-ink/8 bg-brand-50/70 p-4"><span className="font-ui text-xs font-semibold text-ink">{u.nextConversation}</span><p className="mb-3 mt-3 font-display text-base font-semibold leading-snug text-ink">{u.hypothesis}</p><div className="h-1.5 overflow-hidden rounded-full bg-brand-100"><div className="h-full w-3/4 rounded-full bg-brand-500" /></div><p className="mb-0 mt-2 font-ui text-[10px] leading-relaxed text-ink-muted">{u.hedging}</p></div>
            </div>
            <div className="mt-3 rounded-card border border-ink/8 bg-white p-3.5"><div className="mb-3 flex items-center justify-between gap-2"><span className="font-ui text-xs font-semibold text-ink">{u.pipeline}</span><span className="font-ui text-[10px] text-ink-faint">{u.candidates}</span></div><div className="grid grid-cols-3 gap-2">{u.pipelineStages.map((stage, index) => <div key={stage} className="rounded-control border border-ink/8 bg-canvas/70 px-2 py-2"><div className={`mb-2 h-1 rounded-full ${index === 0 ? 'bg-warning' : index === 1 ? 'bg-info' : 'bg-success'}`} /><p className="m-0 truncate font-ui text-[8px] uppercase text-ink-muted">{stage}</p><p className="mb-0 mt-1 font-ui text-sm font-semibold text-ink">{[4, 2, 1][index]}</p></div>)}</div></div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center font-ui text-xs text-ink-faint">{u.previewCaption}</figcaption>
    </figure>
  );
}

function JourneyVisual({ copy }) {
  const container = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.2 });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={container} data-visible={visible} className="grow-journey relative mt-10"><div className="absolute left-6 right-6 top-6 hidden h-px overflow-hidden bg-ink/10 lg:block" aria-hidden><span className="grow-journey-progress block h-full w-full bg-brand-500" /></div><ol className="relative m-0 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">{copy.journeyStages.map((stage, index) => <li key={stage.title} className="grow-journey-stage flex flex-col rounded-card border border-ink/10 bg-surface p-5 shadow-card" style={{ animationDelay: `${index * 0.8}s` }}><span className="mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-brand-300 bg-brand-50 font-ui text-xs font-semibold text-brand-700">0{index + 1}</span><h3 className="m-0 font-ui text-base font-semibold text-ink">{stage.title}</h3><p className="mb-0 mt-2 flex-1 font-ui text-sm leading-6 text-ink-muted">{stage.body}</p><p className="mb-0 mt-4 min-h-11 border-t border-ink/8 pt-3 font-ui text-xs leading-5 text-brand-700">{stage.detail}</p></li>)}</ol></div>;
}

function EmployeeAppPreview({ copy }) {
  const app = copy.employeeApp;
  return (
    <div className="relative mx-auto w-full max-w-[340px] lg:mx-0 lg:justify-self-end" aria-label={app.eyebrow}>

      <div className="relative rounded-[42px] border border-white/15 bg-ink-muted p-2.5 shadow-card">
        <div className="overflow-hidden rounded-[33px] bg-canvas text-ink">
          <div className="mx-auto mt-2 h-5 w-24 rounded-full bg-ink" aria-hidden />
          <div className="px-5 pb-5 pt-7">
            <div className="flex items-start justify-between gap-3">
              <div><p className="m-0 text-xs text-ink-muted">{app.mockup.greeting}</p><p className="mb-0 mt-1 text-lg font-semibold text-ink">{app.mockup.context}</p></div>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700"><Icon name="bell" className="h-4 w-4" /></span>
            </div>
            <div className="mt-6 rounded-card bg-navy p-5 text-white">
              <p className="m-0 font-ui text-[9px] font-medium text-brand-200">{app.mockup.priority}</p>
              <p className="mb-0 mt-3 text-base font-semibold">{app.mockup.task}</p>
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/20"><div className="h-full w-1/2 rounded-full bg-white" /></div>
              <p className="mb-0 mt-2 text-[10px] text-white/70">{app.mockup.progress}</p>
            </div>
            <p className="mb-3 mt-6 text-xs font-semibold text-ink">{app.mockup.next}</p>
            <div className="space-y-2.5">
              {app.mockup.items.map((item, index) => <div key={item} className="flex items-center gap-3 rounded-card border border-ink/8 bg-surface p-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-700"><Icon name={index === 0 ? 'climate' : 'book'} className="h-4 w-4" /></span><span className="text-xs font-medium leading-5 text-ink">{item}</span><Icon name="chevronRight" className="ml-auto h-4 w-4 text-ink-faint" /></div>)}
            </div>
          </div>
          <div className="grid grid-cols-3 border-t border-ink/8 bg-surface px-3 py-3">{app.mockup.nav.map((item, index) => <span key={item} className={`flex flex-col items-center gap-1 text-[9px] ${index === 0 ? 'font-semibold text-brand-700' : 'text-ink-faint'}`}><Icon name={['overview', 'clipboard', 'book'][index]} className="h-4 w-4" />{item}</span>)}</div>
        </div>
      </div>
    </div>
  );
}

function HrReportsPreview({ copy }) {
  const report = copy.hrReports.preview;
  const bars = [[42, 28], [58, 34], [50, 26], [72, 39], [64, 31], [82, 44]];
  return (
    <div className="overflow-hidden rounded-card border border-ink/10 bg-surface shadow-card" aria-label={report.label}>
      <div className="flex items-start justify-between gap-4 border-b border-ink/8 px-5 py-4 sm:px-6">
        <div><p className="m-0 font-ui text-[9px] font-medium text-brand-600">{report.label}</p><h3 className="mb-0 mt-1.5 font-ui text-base font-semibold text-ink">{report.title}</h3></div>
        <span className="rounded-full border border-ink/10 px-2.5 py-1 font-ui text-[9px] text-ink-muted">{report.period}</span>
      </div>
      <div className="grid gap-px bg-ink/8 sm:grid-cols-3">{report.metrics.map((metric) => <div key={metric.label} className="bg-surface px-5 py-5"><p className="m-0 text-xs text-ink-muted">{metric.label}</p><div className="mt-2 flex items-end justify-between gap-2"><strong className="font-display text-2xl font-semibold text-ink">{metric.value}</strong><span className="font-ui text-[10px] text-success">{metric.trend}</span></div></div>)}</div>
      <div className="grid gap-5 p-5 sm:grid-cols-[1.35fr_.65fr] sm:p-6">
        <div><p className="m-0 text-xs font-semibold text-ink">{report.trendTitle}</p><div className="mt-5 flex h-28 items-end gap-3" aria-hidden>{bars.map(([hire, exit], index) => <div key={index} className="flex h-full flex-1 items-end justify-center gap-1"><span className="w-2 rounded-t-sm bg-success/65" style={{ height: `${hire}%` }} /><span className="w-2 rounded-t-sm bg-danger/45" style={{ height: `${exit}%` }} /></div>)}</div></div>
        <div className="rounded-card border border-warning/25 bg-warning/5 p-4"><div className="mb-4 flex h-9 w-9 items-center justify-center rounded-control bg-warning/10 text-warning"><Icon name="chart" className="h-4 w-4" /></div><p className="m-0 font-ui text-[9px] uppercase tracking-[0.1em] text-ink-faint">{report.alertTitle}</p><p className="mb-0 mt-2 text-xs font-medium leading-5 text-ink">{report.alert}</p></div>
      </div>
    </div>
  );
}

export default function ProductLandingClient({ copyByLocale, locale: initialLocale, blogPosts = [], analyticsId = '', nonce }) {
  const [locale, setLocale] = useLocale(initialLocale);
  const copy = copyByLocale[normalizeLocale(locale)] || copyByLocale['pt-BR'];
  const u = copy.ui;

  return (
    <div className="min-h-screen bg-canvas font-ui text-ink" lang={localeHtmlLang(locale)}>
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-white focus:px-3 focus:py-2">{copy.skipToContent}</a>
      <PublicSiteHeader copy={copy} locale={locale} onLocaleChange={setLocale} />
      <ContentEnter animKey={locale}>
        <main id="conteudo">
          <section id="produto-hero" className="relative overflow-hidden border-b border-ink/8 bg-surface"><div className="relative mx-auto grid max-w-6xl gap-10 px-5 pb-14 pt-12 sm:px-8 sm:pb-16 sm:pt-16 lg:grid-cols-[.95fr_1.05fr] lg:items-center lg:gap-12 lg:py-20"><div className="max-w-2xl"><p className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand-300/70 bg-brand-50 px-3 py-1.5 font-ui text-2xs font-medium text-brand-700"><span className="h-1.5 w-1.5 rounded-full bg-brand-500" />{copy.earlyBadge}</p><h1 className="m-0 font-display text-[clamp(2.25rem,4vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.035em] text-ink">{copy.heroTitle}</h1><p className="mb-0 mt-6 max-w-xl text-lg leading-8 text-ink-muted">{copy.heroLead}</p><p className="mb-0 mt-4 max-w-xl text-sm leading-6 text-ink-muted">{copy.heroBody}</p><div className="mt-7 flex flex-wrap items-center gap-4"><PrimaryCta copy={copy} /><a href="#modulos" className="inline-flex min-h-touch items-center gap-2 px-2 text-sm font-semibold text-brand-700 no-underline hover:text-brand-800">{u.exploreProduct}<Icon name="chevronRight" className="h-4 w-4" /></a></div><p className="mb-0 mt-5 max-w-xl text-sm leading-6 text-ink-muted"><span className="font-semibold text-ink">{copy.pricingSnapshotTitle}.</span> {copy.pricingSnapshotBody} <Link href={publicMarketingPath(locale, '/pricing')} className="whitespace-nowrap font-semibold text-brand-700 no-underline hover:text-brand-800">{copy.pricingSnapshotCta}</Link></p><div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-ink/10 pt-4">{u.heroProof.map((item) => <span key={item} className="inline-flex items-center gap-2 text-xs text-ink-muted"><Icon name="check" className="h-4 w-4 text-success" />{item}</span>)}</div></div><ProductPreview copy={copy} /></div></section>
          <section className="border-b border-ink/8 bg-canvas-alt/45" aria-label={u.coverageLabel}><div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-7 gap-y-3 px-5 py-5 sm:px-8"><span className="mr-2 font-ui text-2xs font-medium text-ink-faint">{u.coverageLabel}</span>{u.coverageItems.map((item) => <span key={item} className="text-sm font-medium text-ink-muted">{item}</span>)}</div></section>
          <section className="mx-auto max-w-5xl px-5 py-14 sm:px-8 sm:py-16" aria-labelledby="human-context-title">
            <div className="grid items-center gap-8 md:grid-cols-2"><figure className="m-0 overflow-hidden rounded-card"><Image src="/brand/landing-people-context-v1.png" alt={u.humanContextAlt} width={1536} height={1024} sizes="(max-width: 767px) calc(100vw - 40px), 480px" className="aspect-[3/2] w-full object-cover" /></figure><div>
            <p className="mb-3 font-ui text-2xs font-medium text-brand-600">{u.humanContextEyebrow}</p>
            <h2 id="human-context-title" className="m-0 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-4xl">{u.humanContextTitle}</h2>
            <p className="mb-0 mt-4 text-base leading-7 text-ink-muted">{u.humanContextBody}</p></div></div>
          </section>
          <section id="como-funciona" className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20" aria-labelledby="journey-title"><SectionHeading label={copy.journeyLabel} title={copy.journeyTitle} body={copy.journeyLead} id="journey-title" /><JourneyVisual copy={copy} /></section>
          <section id="eneagrama" className="border-y border-ink/8 bg-navy py-16 text-white sm:py-20" aria-labelledby="enneagram-title"><div className="mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-[.8fr_1.2fr] lg:items-center"><div><p className="mb-3 font-ui text-2xs font-medium text-brand-300">{u.enneagramLabel}</p><h2 id="enneagram-title" className="m-0 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.025em] text-white sm:text-4xl">{u.enneagramTitle}</h2><p className="mb-0 mt-5 max-w-xl text-base leading-7 text-white/65 sm:text-lg">{u.enneagramBody}</p><ul className="mb-0 mt-8 grid list-none gap-3 p-0 sm:grid-cols-2">{u.enneagramPoints.map((item) => <li key={item} className="flex gap-3 text-sm leading-6 text-white/80"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-300" />{item}</li>)}</ul></div><div className="grid grid-cols-3 gap-2 sm:gap-3" aria-label={u.typesAria}>{u.types.map((type, index) => <article key={type.name} className={`min-h-28 rounded-card border p-3 sm:min-h-32 sm:p-4 ${index === 4 ? 'border-brand-300 bg-brand-500/20' : 'border-white/10 bg-white/[.04]'}`}><span className="font-ui text-xs text-brand-300">T{index + 1}</span><h3 className="mb-0 mt-5 text-sm font-semibold text-white sm:text-base">{type.name}</h3><p className="mb-0 mt-1 text-[10px] leading-4 text-white/70 sm:text-xs">{type.signal}</p></article>)}</div></div></section>
          <section id="modulos" className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20" aria-labelledby="modules-title"><div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><SectionHeading label={copy.pillarsLabel} title={copy.pillarsTitle} body={copy.pillarsLead} id="modules-title" /><p className="m-0 max-w-sm text-sm leading-6 text-ink-muted">{u.modulesNote}</p></div><div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{copy.pillars.map((pillar, index) => <ModuleCard key={`${locale}-${pillar.id}`} pillar={pillar} icon={PILLAR_ICONS[index]} ui={u} href={publicMarketingPath(locale, 'solution', index)} />)}</div></section>
          <section id="relatorios" className="border-t border-ink/8 bg-surface py-16 sm:py-20" aria-labelledby="reports-title"><div className="mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-[.82fr_1.18fr] lg:items-center"><div><SectionHeading label={copy.hrReports.label} title={copy.hrReports.title} body={copy.hrReports.body} id="reports-title" /><div className="mt-8 divide-y divide-ink/10 border-y border-ink/10">{copy.hrReports.groups.map((group) => <div key={group.title} className="flex gap-4 py-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-700"><Icon name={group.icon} className="h-4 w-4" /></span><div><h3 className="m-0 text-sm font-semibold text-ink">{group.title}</h3><p className="mb-0 mt-1 text-sm leading-6 text-ink-muted">{group.body}</p></div></div>)}</div><p className="mb-0 mt-6 text-sm leading-6 text-ink-muted">{copy.hrReports.delivery}</p><p className="mb-0 mt-3 flex gap-2 text-xs leading-5 text-ink-faint"><Icon name="help" className="mt-0.5 h-4 w-4 shrink-0" />{copy.hrReports.guardrail}</p></div><HrReportsPreview copy={copy} /></div></section>
          <section id="app-colaborador" className="overflow-hidden border-y border-ink/8 bg-navy py-16 text-white sm:py-20" aria-labelledby="employee-app-title"><div className="mx-auto grid max-w-6xl gap-14 px-5 sm:px-8 lg:grid-cols-[1fr_.72fr] lg:items-center"><div className="max-w-2xl"><p className="mb-3 font-ui text-2xs font-medium text-brand-300">{copy.employeeApp.eyebrow}</p><h2 id="employee-app-title" className="m-0 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.025em] text-white sm:text-4xl">{copy.employeeApp.title}</h2><p className="mb-0 mt-6 text-base leading-7 text-white/65 sm:text-lg">{copy.employeeApp.body}</p><p className="mb-0 mt-6 inline-flex items-center gap-2 rounded-full border border-brand-300/35 bg-brand-500/10 px-3 py-1.5 font-ui text-[10px] uppercase tracking-[0.08em] text-brand-200"><span className="h-1.5 w-1.5 rounded-full bg-brand-300" />{copy.employeeApp.status}</p><ul className="mb-0 mt-8 grid list-none gap-4 p-0 sm:grid-cols-2">{copy.employeeApp.features.map((item) => <li key={item} className="flex gap-3 text-sm leading-6 text-white/80"><span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-brand-200"><Icon name="check" className="h-3.5 w-3.5" /></span>{item}</li>)}</ul><p className="mb-0 mt-8 max-w-xl border-t border-white/10 pt-5 text-xs leading-5 text-white/45">{copy.employeeApp.note}</p></div><EmployeeAppPreview copy={copy} /></div></section>
          <section className="border-y border-ink/8 bg-surface py-16 sm:py-20" aria-labelledby="outcomes-title"><div className="mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-[.7fr_1.3fr]"><SectionHeading label={copy.outcomesLabel} title={copy.outcomesTitle} id="outcomes-title" /><div className="grid gap-px overflow-hidden rounded-card border border-ink/10 bg-ink/10 sm:grid-cols-2">{copy.outcomes.map((outcome, index) => <article key={outcome.title} className="bg-canvas p-5 sm:p-6"><span className="font-ui text-xs text-brand-600">0{index + 1}</span><h3 className="mb-0 mt-5 text-base font-semibold text-ink">{outcome.title}</h3><p className="mb-0 mt-2 text-sm leading-6 text-ink-muted">{outcome.body}</p></article>)}</div></div></section>
          <section id="confianca" className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20" aria-labelledby="trust-title"><div className="rounded-card border border-brand-300/50 bg-brand-50 p-6 sm:p-8 lg:flex lg:items-center lg:justify-between lg:gap-12"><SectionHeading label={copy.trustLabel} title={copy.trustTitle} id="trust-title" /><ul className="mb-0 mt-8 grid max-w-2xl list-none gap-3 p-0 lg:mt-0">{copy.trustItems.map((item) => <li key={item} className="flex gap-3 text-sm leading-6 text-ink-muted"><Icon name="check" className="mt-1 h-4 w-4 shrink-0 text-brand-600" />{item}</li>)}</ul></div></section>
          {blogPosts.length ? (
            <section id="blog" className="border-t border-ink/8 bg-surface py-16 sm:py-20" aria-labelledby="blog-title">
              <div className="mx-auto max-w-6xl px-5 sm:px-8">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                  <SectionHeading label={copy.blog.label} title={copy.blog.title} body={copy.blog.body} id="blog-title" />
                  <Link href="/blog" className="inline-flex min-h-touch items-center gap-2 text-sm font-semibold text-brand-700 no-underline hover:text-brand-800">{copy.blog.allPosts}<Icon name="chevronRight" className="h-4 w-4" /></Link>
                </div>
                <ul className="m-0 mt-10 grid list-none gap-4 p-0 md:grid-cols-3" lang="pt-BR">
                  {blogPosts.map((post) => (
                    <li key={post.slug}><BlogPostCard post={post} headingLevel="h3" readMinutesLabel={copy.blog.readMinutes.replace('{n}', String(post.readingMinutes))} /></li>
                  ))}
                </ul>
                {normalizeLocale(locale) !== 'pt-BR' ? <p className="mb-0 mt-4 text-xs text-ink-faint">{copy.blog.contentLanguageNote}</p> : null}
              </div>
            </section>
          ) : null}
          <section id="faq" className="mx-auto max-w-4xl px-5 pb-16 sm:px-8 sm:pb-20" aria-labelledby="faq-title"><SectionHeading label={copy.faqLabel} title={copy.faqTitle} id="faq-title" /><div className="mt-8 divide-y divide-ink/10 border-y border-ink/10">{copy.faqs.map((faq) => <details key={faq.q} className="group py-1"><summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold text-ink marker:content-none [&::-webkit-details-marker]:hidden">{faq.q}<Icon name="chevronDown" className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180" /></summary><p className="mb-5 mt-0 max-w-2xl text-sm leading-6 text-ink-muted">{faq.a}</p></details>)}</div></section>
          <section id="oferta" className="bg-navy py-14 text-white sm:py-16"><div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between"><div className="max-w-2xl"><p className="mb-3 font-ui text-2xs font-medium text-brand-300">{copy.earlyLabel}</p><h2 className="m-0 font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">{copy.earlyTitle}</h2><p className="mb-0 mt-4 text-base leading-7 text-white/65">{copy.earlyBody}</p></div><div className="shrink-0"><Link href="/signup" className="inline-flex min-h-touch items-center justify-center rounded-control bg-white px-6 py-3.5 font-semibold text-brand-800 no-underline hover:bg-brand-50">{copy.ctaEarly}</Link><p className="mb-0 mt-3 text-xs text-white/70">{copy.earlyContact} <a className="text-white underline-offset-2 hover:underline" href={`mailto:${PRODUCT_LANDING_CONTACT_EMAIL}`}>{PRODUCT_LANDING_CONTACT_EMAIL}</a></p></div></div></section>
        </main>
      </ContentEnter>
      <footer className="border-t border-ink/8 bg-surface py-8"><div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8"><div><BrandMark size={26} withWordmark /><p className="mb-0 mt-2 max-w-xl text-xs leading-5 text-ink-faint">{copy.footerLegal}</p></div><div className="flex flex-wrap gap-5 text-sm"><Link href={publicMarketingPath(locale, '/pricing')} className="text-ink-muted no-underline hover:text-ink">{copy.footerPricing}</Link><Link href="/blog" className="text-ink-muted no-underline hover:text-ink">{u.navBlog}</Link><Link href="/privacy" className="text-ink-muted no-underline hover:text-ink">{copy.footerPrivacy}</Link><Link href="/terms" className="text-ink-muted no-underline hover:text-ink">{copy.footerTerms}</Link><Link href="/login" className="text-ink-muted no-underline hover:text-ink">{copy.navLogin}</Link><Link href="/employee/login" className="text-ink-muted no-underline hover:text-ink">{copy.navEmployee}</Link></div></div></footer>
      <PublicLanguageLinks locale={locale} />
      <LandingAnalytics measurementId={analyticsId} nonce={nonce} locale={locale} />
    </div>
  );
}
