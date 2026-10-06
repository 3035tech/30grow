'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminCreateButton, AdminPageHeader, S } from '../dashboard/dashboard-shared';
import { useAppFeedback } from './AppFeedback';
import { SelectField } from './SelectField';
import { CollapsibleBlock } from './CollapsibleBlock';
import { MeterBar } from './MeterBar';
import { formatDisplayDate } from '../../lib/format-display-date';
import { cn } from '../../lib/cn';
import { AppLoading, ContentEnter } from './AppLoading';
import { FormField } from './FormField';
import { RowActionsMenu } from './RowActionsMenu';
import { RichTextView } from './RichTextView';
import { EmptyState } from './EmptyState';
import { htmlToPlainText, plainOrMarkdownToSimpleHtml } from '../../lib/sanitize-html';
import { OKR_CYCLE_STATUS, OKR_WEIGHT_MAX, OKR_WEIGHT_MIN } from '../../lib/domain-status';
import { t, tCount } from '../../lib/i18n';

const RICH_TEXT_MAX = 2000;
const I18N = 'panel.okr.hierarchy';
const asRichHtml = value => !value ? '' : /<[a-z][\s\S]*>/i.test(value) ? value : plainOrMarkdownToSimpleHtml(value);

export function OkrHierarchyBlock({ locale = 'pt-BR', companyId }) {
  return <OkrHierarchyContent key={companyId ?? 'session'} locale={locale} companyId={companyId} />;
}

function OkrHierarchyContent({ locale, companyId }) {
  const active = useRef(true);
  const requestVersion = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; requestVersion.current += 1; }; }, []);
  const tr = (key, values) => t(locale, `${I18N}.${key}`, values);
  const { promptForm, confirm } = useAppFeedback();
  const [notice, setNotice] = useState(null);
  const [cycles, setCycles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);
  const [areaId, setAreaId] = useState('all');
  const [detailId, setDetailId] = useState(null);
  const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true); setError(false);
    try {
      const response = await fetch(`/api/admin/okr/hierarchy${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`);
      if (!response.ok) throw new Error('load');
      const data = await response.json();
      if (!active.current || version !== requestVersion.current) return false;
      setCycles(data.cycles || []);
      setActiveId(id => data.cycles?.some(c => c.id === id) ? id : data.cycles?.[0]?.id ?? null);
      return true;
    } catch { if (active.current && version === requestVersion.current) setError(true); return false; }
    finally { if (active.current && version === requestVersion.current) setLoading(false); }
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);
  const cycle = cycles.find(c => c.id === activeId);
  useEffect(() => { if (areaId !== 'all' && !cycle?.areas.some(area => String(area.id) === areaId)) setAreaId('all'); }, [cycle, areaId]);
  const visibleAreas = cycle?.areas.filter(area => areaId === 'all' || String(area.id) === areaId) || [];
  const cycleClosed = cycle?.status === OKR_CYCLE_STATUS.CLOSED;
  const locked = busy || cycleClosed;
  const date = value => formatDisplayDate(value, locale);
  const number = value => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  const pct = value => value == null ? tr('noMeasurement') : `${number(value)}%`;
  const muted = 'text-sm leading-relaxed text-ink-muted';
  const validDeadline = (start, end) => value => value < start || value > end ? tr('dateBetween', { start: date(start), end: date(end) }) : null;
  const personField = (key, required = false) => ({ key, label:tr('owner'), type:'entitySearch', searchUrl:`/api/admin/employees/search${qs}`, required });
  const richField = (key, fieldLabel, value, placeholder) => ({ key, type:'richText', label:fieldLabel, placeholder, minHeight:96, defaultValue:asRichHtml(value), validate:v => htmlToPlainText(v || '').length > RICH_TEXT_MAX ? tr('richTextMax', { max: RICH_TEXT_MAX }) : null });
  const titleField = value => ({ key:'title', label:tr('title'), required:true, maxLength:300, defaultValue:value || '' });
  async function mutate(body, url = '/api/admin/okr/hierarchy', method = 'POST', form = false) {
    if (!active.current) throw new Error(tr('companyChanged'));
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(url, { method, headers:{'Content-Type':'application/json'}, ...(method === 'DELETE' ? {} : {body:JSON.stringify({...body, ...(companyId ? {companyId} : {})})}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || tr('saveError'));
      if (!active.current) return data;
      setHistory(null);
      const refreshed = await load();
      if (!active.current) return data;
      if (data.cycle?.id) setActiveId(data.cycle.id);
      setNotice({message:refreshed ? tr('saved') : tr('savedRefreshFailed'),error:!refreshed});
      return data;
    } catch (e) {
      const message = e instanceof TypeError ? tr('connectionFailed') : e.message;
      if(form) throw new Error(message);
      if (!active.current) return null;
      setNotice({message,error:true}); return null;
    }
    finally { if (active.current) setBusy(false); }
  }
  async function newCycle() {
    await promptForm({title:tr('newCycle'), fields:[{...titleField(),maxLength:200}, {key:'startsOn',type:'date',row:'period',label:tr('start'),required:true}, {key:'endsOn',type:'date',row:'period',label:tr('end'),required:true,validate:(value,values)=>value<values.startsOn ? tr('endBeforeStart') : null}],submit:values=>mutate(values,'/api/admin/okr/cycles','POST',true)});
  }
  async function editArea(area) {
    await promptForm({title:area ? tr('editArea') : tr('newArea'),fields:[{...titleField(area?.title),maxLength:200}],submit:values=>area ? mutate(values,`/api/admin/okr/areas/${area.id}`,'PATCH',true) : mutate({...values,cycleId:cycle.id},'/api/admin/okr/areas','POST',true)});
  }
  async function editObjective(area, objective) {
    const earliest = (objective?.keyResults || []).reduce((latest,k)=>k.deadline>latest?k.deadline:latest,cycle.startsOn);
    await promptForm({title:objective ? tr('editObjective') : tr('newObjective'),fields:[
      titleField(objective?.title),
      richField('description',tr('description'),objective?.description),
      {...personField('ownerCandidateId'),row:'owner',defaultValue:objective?.ownerCandidateId ? String(objective.ownerCandidateId) : '',initialSelection:objective?.ownerCandidateId ? {id:objective.ownerCandidateId,label:objective.ownerName} : undefined},
      {key:'periodEnd',type:'date',row:'owner',label:tr('objectiveDeadline'),required:true,defaultValue:objective?.periodEnd || cycle.endsOn,min:earliest,max:cycle.endsOn,validate:validDeadline(earliest,cycle.endsOn),help:tr('objectiveDeadlineHelp')},
    ],submit:values=>mutate({...values,action:'objective',areaId:area.id,objectiveId:objective?.id,ownerCandidateId:values.ownerCandidateId ? Number(values.ownerCandidateId) : null},undefined,'POST',true)});
  }
  const krBody = k => ({action:'keyResult',keyResultId:k.id,title:k.title,unit:k.unit,startValue:k.startValue,targetValue:k.targetValue,weight:k.weight,deadline:k.deadline,assigneeIds:k.assignees.map(p=>p.candidateId)});
  async function editKr(objective, k) {
    await promptForm({title:k ? tr('editKeyResult') : tr('newKeyResult'),fields:[
      titleField(k?.title),
      {key:'startValue',type:'number',row:'values',label:tr('baseline'),required:true,step:0.01,defaultValue:String(k?.startValue ?? 0)},
      {key:'targetValue',type:'number',row:'values',label:tr('target'),required:true,step:0.01,defaultValue:k ? String(k.targetValue) : '',validate:(value,values)=>Number(value)===Number(values.startValue) ? tr('targetEqualsBaseline') : null,help:tr('targetHelp')},
      {key:'unit',row:'unit',label:tr('unit'),placeholder:tr('unitPlaceholder'),required:true,maxLength:40,defaultValue:k?.unit || ''},
      {key:'weight',type:'range',row:'unit',label:tr('weight'),required:true,min:OKR_WEIGHT_MIN,max:OKR_WEIGHT_MAX,step:1,minLabel:t(locale,'panel.okr.weightMinLabel'),maxLabel:t(locale,'panel.okr.weightMaxLabel'),defaultValue:String(k?.weight ?? 1),help:tr('weightHelp')},
      {key:'deadline',type:'date',row:'deadline',width:'half',label:tr('deadline'),required:true,defaultValue:k?.deadline || objective.periodEnd,min:cycle.startsOn,max:objective.periodEnd,validate:validDeadline(cycle.startsOn,objective.periodEnd)},
      ...(!k ? [{...personField('candidateId',true),row:'deadline'}] : []),
      richField('notes',tr('notes'),k?.notes,tr('notesPlaceholder')),
    ],submit:values=>mutate({action:'keyResult',objectiveId:objective.id,keyResultId:k?.id,...values,startValue:Number(values.startValue),targetValue:Number(values.targetValue),weight:Number(values.weight),assigneeIds:k ? k.assignees.map(p=>p.candidateId) : [Number(values.candidateId)]},undefined,'POST',true)});
  }
  async function assign(k) {
    await promptForm({title:tr('addOwner'),fields:[personField('candidateId',true)],submit:values=>mutate({...krBody(k),assigneeIds:[...new Set([...k.assignees.map(p=>p.candidateId),Number(values.candidateId)])]},undefined,'POST',true)});
  }
  async function unassign(k, person) {
    if(await confirm({title:tr('removeOwner'),message:person.fullName,confirmLabel:tr('remove')})) await mutate({...krBody(k),assigneeIds:k.assignees.filter(p=>p.candidateId!==person.candidateId).map(p=>p.candidateId)});
  }
  async function checkin(k) {
    await promptForm({title:tr('recordCheckin'),fields:[{key:'currentValue',type:'number',width:'half',label:tr('currentValueUnit', { unit: k.unit }),required:true,step:0.01,defaultValue:String(k.currentValue)},{key:'note',type:'textarea',label:tr('comment'),maxLength:500}],submit:values=>mutate({action:'checkin',keyResultId:k.id,currentValue:Number(values.currentValue),note:values.note || ''},undefined,'POST',true)});
  }
  async function showHistory(k) {
    setBusy(true);
    try {
      const response=await fetch(`/api/admin/okr/hierarchy${qs || '?'}${qs ? '&' : ''}keyResultId=${k.id}`);
      if(!response.ok) throw new Error(tr('historyLoadError'));
      const data=await response.json(); if (active.current) setHistory({id:k.id,items:data.items || []});
    } catch(e) { if (active.current) setNotice({message:e.message,error:true}); } finally { if (active.current) setBusy(false); }
  }
  async function remove(kind, item, url) {
    if(await confirm({title:tr('deleteRecord'),message:tr('deleteConfirm', { title: item.title }),danger:true,confirmLabel:tr('delete')})) await mutate({action:'delete',kind,id:item.id},url || '/api/admin/okr/hierarchy',url ? 'DELETE' : 'POST');
  }
  const eventLabel = kind => kind==='created' ? tr('eventCreated') : kind==='configuration' ? tr('eventConfiguration') : tr('eventCheckin');
  const progress = (name,value,className='sm:w-36') => <div className={cn('w-full shrink-0',className)}><span className="text-sm font-medium tabular-nums text-ink">{pct(value)}</span><MeterBar percent={value ?? 0} height={6} aria-label={`${name}: ${pct(value)}`} /></div>;
  const moreLabel = name => tr('moreActions', { name });
  if(loading && !cycles.length) return <AppLoading locale={locale} variant="panel" label={tr('loading')} />;
  if(error) return <div role="alert" className="flex flex-col items-start gap-3">{notice && <p className={muted}>{notice.message}</p>}<p className={muted}>{tr('loadError')}</p><button className={S.btnBrandSoft} onClick={load}>{tr('retry')}</button></div>;
  return <section className="flex min-w-0 flex-col gap-5" aria-label="OKRs" aria-busy={busy || loading}>
    {notice && <div role={notice.error?'alert':'status'} className={`flex items-center justify-between gap-3 rounded-control border p-3 text-sm ${notice.error?'border-danger/30 text-red-800 dark:text-danger':'border-success/30 text-ink'}`}><span>{notice.message}</span><button className="min-h-touch min-w-touch" aria-label={tr('dismissNotice')} onClick={()=>setNotice(null)}>×</button></div>}
    <AdminPageHeader title="OKRs" subtitle={tr('subtitle')} actions={<AdminCreateButton label={tr('newCycle')} onClick={newCycle} disabled={busy} />} />
    {!cycle ? <EmptyState title={tr('emptyTitle')} message={tr('emptyMessage')} actionLabel={tr('newCycle')} onAction={newCycle} actionDisabled={busy} /> : <ContentEnter animKey={cycle.id} className="flex min-w-0 flex-col gap-5">
      <div className="rounded-card border border-ink/12 bg-surface p-4">
        <div className="grid min-w-0 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
          <FormField label={tr('activeCycle')} htmlFor="okr-cycle"><SelectField className="w-full" disabled={busy || loading} id="okr-cycle" aria-label={tr('activeCycle')} value={activeId} onChange={e=>{setActiveId(Number(e.target.value));setAreaId('all');setDetailId(null);setHistory(null);setNotice(null);}}>{cycles.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</SelectField></FormField>
          <FormField label={tr('area')} htmlFor="okr-area"><SelectField className="w-full" id="okr-area" aria-label={tr('area')} disabled={busy || loading} value={areaId} onChange={event => { setAreaId(event.target.value); setDetailId(null); setHistory(null); }}>
            <option value="all">{tr('allAreas')}</option>
            {cycle.areas.map(area => <option key={area.id} value={area.id}>{area.title}</option>)}
          </SelectField></FormField>
          <div className="flex flex-wrap items-center justify-end gap-2 md:col-span-2 xl:col-span-1">
            <AdminCreateButton variant="secondary" label={tr('newArea')} onClick={()=>editArea()} disabled={locked} />
            <RowActionsMenu label={moreLabel(cycle.title)} disabled={busy} items={[
              {id:'status',label:cycleClosed?tr('reopenCycle'):tr('closeCycle'),onSelect:()=>mutate({status:cycleClosed?OKR_CYCLE_STATUS.ACTIVE:OKR_CYCLE_STATUS.CLOSED},`/api/admin/okr/cycles/${cycle.id}`,'PATCH')},
              {id:'delete',label:tr('deleteCycle'),danger:true,disabled:locked,onSelect:()=>remove('cycle',cycle,`/api/admin/okr/cycles/${cycle.id}${qs}`)},
            ]} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink/12 pt-3">
          <p className={cn(muted,'m-0')}>{tr('period', { start: date(cycle.startsOn), end: date(cycle.endsOn) })} · {cycleClosed?tr('statusClosed'):tr('statusActive')}</p>
          {progress(cycle.title,cycle.progressPct,'sm:w-48')}
        </div>
        <CollapsibleBlock locale={locale} className="mt-2" bordered={false} title={tr('progressHowTitle')} titleClassName="font-ui text-prose text-ink-muted"><p className={cn(muted,'m-0 pb-1')}>{tr('progressHowBody')}</p></CollapsibleBlock>
      </div>
      {!cycle.areas.length && <p className={muted}>{cycleClosed ? tr('closedNoAreas') : tr('noAreas')}</p>}
      {visibleAreas.map(area=><section key={area.id} className="min-w-0 rounded-card border border-ink/12 bg-surface p-4" aria-label={`${tr('area')}: ${area.title}`}>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className={`${S.cardTitle} m-0 min-w-0 flex-1 break-words`}>{area.title}</h3>
          {progress(area.title,area.progressPct)}
          <div className="flex items-center gap-2">
            <AdminCreateButton variant="secondary" label={tr('newObjective')} onClick={()=>editObjective(area)} disabled={locked} />
            <RowActionsMenu label={moreLabel(area.title)} disabled={locked} items={[
              {id:'edit',label:tr('editArea'),onSelect:()=>editArea(area)},
              {id:'delete',label:tr('deleteArea'),danger:true,onSelect:()=>remove('area',area,`/api/admin/okr/areas/${area.id}${qs}`)},
            ]} />
          </div>
        </div>
        {!area.objectives.length && <p className={cn(muted,'mb-0 mt-3')}>{tr('noObjectives')}</p>}
        {!!area.objectives.length && <div className="mt-4 flex flex-col gap-4">{area.objectives.map((objective,index)=><article key={objective.id} className="min-w-0 border-t border-ink/12 pt-3" aria-label={`${tr('objective')}: ${objective.title}`}>
          <CollapsibleBlock locale={locale} title={objective.title} defaultOpen={index===0} bordered={false} headerAside={<span className="font-ui text-sm font-medium tabular-nums">{pct(objective.progressPct)}</span>} collapsedHint={`${objective.ownerName || tr('noOwner')} · ${date(objective.periodEnd)} · ${tCount(locale, `${I18N}.keyResultCount`, objective.keyResults.length)}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className={cn(muted,'m-0')}>{objective.ownerName || tr('noObjectiveOwner')} · {tr('deadline')}: {date(objective.periodEnd)}</p>
              {objective.description && <RichTextView html={asRichHtml(objective.description)} className="mt-1 max-w-prose" />}
            </div>
            <div className="flex items-center gap-2">
              <AdminCreateButton variant="secondary" label={tr('newKeyResult')} onClick={()=>editKr(objective)} disabled={locked} />
              <RowActionsMenu label={moreLabel(objective.title)} disabled={locked} items={[
                {id:'edit',label:tr('editObjective'),onSelect:()=>editObjective(area,objective)},
                {id:'delete',label:tr('deleteObjective'),danger:true,onSelect:()=>remove('objective',objective)},
              ]} />
            </div>
          </div>
          {!objective.keyResults.length && <p className={cn(muted,'mb-0 mt-3')}>{tr('noKeyResults')}</p>}
          {!!objective.keyResults.length && <ul className="m-0 mt-3 list-none divide-y divide-ink/12 rounded-control border border-ink/12 p-0">{objective.keyResults.map(k=><li key={k.id} className="min-w-0 p-3" aria-label={`${tr('keyResult')}: ${k.title}`}>
            <div className="grid min-w-0 items-center gap-3 lg:grid-cols-[minmax(0,1fr)_9rem_auto]">
              <div className="min-w-0">
                <h5 className="m-0 break-words font-ui text-sm font-semibold text-ink">{k.title}</h5>
                <p className="mb-0 mt-1 break-words text-prose text-ink-muted">
                  <span className="font-medium tabular-nums text-ink">{tr('current')}: {number(k.currentValue)} · {tr('target')}: {number(k.targetValue)} {k.unit}</span>
                  {' · '}<span className="whitespace-nowrap">{date(k.deadline)}</span>{' · '}
                  <span className={cn('whitespace-nowrap',k.urgency==='overdue' && k.progressPct<100 && 'text-red-800 dark:text-danger')}>{k.progressPct>=100?tr('complete'):k.urgency==='overdue'?tr('overdue'):tr('inProgress')}</span>
                </p>
                {!!k.assignees.length && <p className="mb-0 mt-1 break-words text-prose text-ink-muted" title={k.assignees.map(p=>p.fullName).join(', ')}>
                  {k.assignees.length===1 ? tr('owner') : tr('owners')}: <span className="text-ink">{k.assignees.slice(0,2).map(p=>p.fullName).join(', ')}{k.assignees.length>2 && ` +${k.assignees.length-2}`}</span>
                </p>}
              </div>
              {progress(k.title,k.progressPct,'sm:w-auto')}
              <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:justify-end">
                <button disabled={locked} className={cn(S.btnBrandSoft,'max-sm:w-full')} onClick={()=>checkin(k)}>{tr('recordCheckin')}</button>
                <button type="button" disabled={busy} className={cn(S.btnGhost,'max-sm:flex-1')} aria-expanded={detailId===k.id} aria-controls={detailId===k.id ? `okr-details-${k.id}` : undefined} onClick={()=>{setDetailId(detailId===k.id ? null : k.id);setHistory(null);}}>{detailId===k.id ? tr('closeDetails') : tr('viewDetails')}</button>
                <RowActionsMenu label={moreLabel(k.title)} disabled={locked} items={[
                  {id:'edit',label:tr('editKeyResult'),onSelect:()=>editKr(objective,k)},
                  {id:'delete',label:tr('deleteKeyResult'),danger:true,onSelect:()=>remove('kr',k)},
                ]} />
              </div>
            </div>
            {detailId===k.id && <ContentEnter animKey={k.id} className="mt-3"><div id={`okr-details-${k.id}`} className="grid min-w-0 gap-4 rounded-control bg-canvas p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" role="region" aria-label={`${tr('details')}: ${k.title}`}>
              <div className="min-w-0">
                <p className={cn(S.label,'mb-2')}>{tr('measurements')}</p>
                <dl className="my-0 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={tr('measurements')}>
                  {[[tr('baselineShort'),number(k.startValue),k.unit],[tr('target'),number(k.targetValue),k.unit],[tr('current'),number(k.currentValue),k.unit],[tr('weightShort'),k.weight,tr('inObjective')]].map(([name,value,sub])=><div key={name} className="min-w-0"><dt className="text-prose text-ink-muted">{name}</dt><dd className="m-0 break-words text-base font-semibold tabular-nums text-ink">{value}<span className="block text-prose font-normal text-ink-muted">{sub}</span></dd></div>)}
                </dl>
              </div>
              <div className="min-w-0">
                <p className={cn(S.label,'mb-2')}>{tr('owners')}</p>
                <div className="flex flex-wrap items-center gap-2">{k.assignees.map(p=><span key={p.candidateId} className={cn('inline-flex min-h-touch max-w-full items-center gap-1 break-words rounded-control border border-ink/12 bg-surface pl-3 text-sm text-ink',k.assignees.length<2 && 'pr-3')}>{p.fullName}{k.assignees.length>1 && <button className="min-h-touch min-w-touch text-ink-muted hover:text-ink" disabled={locked} aria-label={tr('removeOwnerName', { name: p.fullName })} onClick={()=>unassign(k,p)}>×</button>}</span>)}<AdminCreateButton variant="secondary" label={tr('addOwner')} onClick={()=>assign(k)} disabled={locked || k.assignees.length>=20} /></div>
              </div>
              {k.notes && <div className="min-w-0 lg:col-span-2">
                <p className={cn(S.label,'mb-1')}>{tr('notes')}</p>
                <RichTextView html={asRichHtml(k.notes)} className="max-w-prose" />
              </div>}
              <div className="min-w-0 border-t border-ink/12 pt-3 lg:col-span-2">
                <button disabled={busy} aria-expanded={history?.id===k.id} className={S.btnGhost} onClick={()=>history?.id===k.id?setHistory(null):showHistory(k)}>{history?.id===k.id ? tr('hideHistory') : tr('viewHistory')}</button>
                {history?.id===k.id && <ContentEnter animKey={`h-${k.id}`} className="mt-3"><p className={cn(muted,'m-0')}>{tr('historyNote')}</p><ol className="mt-3 grid list-none gap-4 p-0 md:grid-cols-2" aria-label={tr('historyAria')}>{history.items.map(h=><li key={h.id} className="break-words border-l-2 border-brand-500/30 pl-3 text-sm text-ink"><span className="block text-prose text-ink-muted">{new Date(h.createdAt).toLocaleString(locale)} · {h.actorName} · {eventLabel(h.eventKind)}</span><p className="my-1 font-medium tabular-nums">{tr('current')}: {number(h.currentValue)} {h.unit} · {pct(h.progressPct)}</p><p className="my-1 text-ink-muted">{tr('baselineShort')}: {number(h.startValue)} → {tr('target')}: {number(h.targetValue)} {h.unit}</p>{h.note && <p className="my-1 whitespace-pre-wrap">{h.note}</p>}</li>)}</ol></ContentEnter>}
              </div>
            </div></ContentEnter>}
          </li>)}</ul>}
        </CollapsibleBlock></article>)}</div>}
        {!!area.activities?.length && <CollapsibleBlock locale={locale} className="mt-3" bordered={false} count={area.activities.length} title={tr('previousActivities')} titleClassName="font-ui text-prose text-ink-muted"><ul className="m-0 list-none space-y-1 p-0 pb-1">{area.activities.map(a=><li className={`${muted} break-words`} key={a.id}>{a.title} · {a.progressPct}%</li>)}</ul></CollapsibleBlock>}
      </section>)}
    </ContentEnter>}
  </section>;
}
