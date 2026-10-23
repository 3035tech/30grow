'use client';

import {useEffect,useRef,useState} from 'react';
import {BILLING_COMPANY_FILTERS,BILLING_OPERATION_REASONS} from '../../../lib/billing/catalog.js';
import {t,localeNumberLocale} from '../../../lib/i18n';
import {S,AdminPageHeader,AdminTableShell,AdminTh,AdminListPager} from '../dashboard-shared';
import {AdminRichFormDrawer} from '../../_components/AdminRichFormDrawer';
import {InlineCallout} from '../../_components/InlineCallout';
import {StatusToneChip} from '../../_components/StatusToneChip';
import {EmptyState} from '../../_components/EmptyState';
import {AppLoading} from '../../_components/AppLoading';
import {FormField} from '../../_components/FormField';

const field='min-h-touch w-full rounded-control border border-ink/20 bg-surface px-3 py-2 text-sm text-ink';
const box='rounded-card border border-ink/10 bg-surface p-4 sm:p-5';
const categories=BILLING_COMPANY_FILTERS;
const reasons=BILLING_OPERATION_REASONS;
const tone=status=>['active','succeeded'].includes(status)?'success':['past_due','failed','needs_review'].includes(status)?'danger':['trial','pending','processing'].includes(status)?'warning':'neutral';
const localInput=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const cents=value=>{if(!/^\d+(?:[.,]\d{1,2})?$/.test(value))return null;const[whole,fraction='']=value.replace(',','.').split('.');const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));return Number.isSafeInteger(result)?result:null;};

export function SubscriptionsAdminTab({locale='pt-BR'}){
  const c=(key,vars)=>t(locale,`billingAdmin.${key}`,vars);
  const b=key=>t(locale,`billing.${key}`);
  const date=value=>value?new Date(value).toLocaleString(localeNumberLocale(locale)):'—';
  const money=(value,currency)=>value==null?'—':new Intl.NumberFormat(localeNumberLocale(locale),{style:'currency',currency:currency.toUpperCase()}).format(value/100);
  const [filters,setFilters]=useState({q:'',status:'all',page:1,pageSize:20});
  const [list,setList]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [selected,setSelected]=useState(null),[detail,setDetail]=useState(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
  const [action,setAction]=useState(null),[preview,setPreview]=useState(null),[actionError,setActionError]=useState(''),[busy,setBusy]=useState(false),[previewLoading,setPreviewLoading]=useState(false);
  const [revision,setRevision]=useState(0);
  const detailSequence=useRef(0),previewSequence=useRef(0);
  async function request(path,options){const response=await fetch(path,{cache:'no-store',...options});const data=await response.json();if(!response.ok)throw new Error(data.error||b('notConfigured'));return data;}
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    request('/api/admin/billing/companies?'+new URLSearchParams(filters),{signal:controller.signal}).then(setList).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[filters,revision]);
  async function loadDetail(id,refresh=false){
    const sequence=++detailSequence.current;setDetailLoading(true);setDetailError('');
    try{const result=await request(`/api/admin/billing/companies?companyId=${id}&refresh=${refresh}`);if(sequence===detailSequence.current)setDetail(result);}
    catch(e){if(sequence===detailSequence.current)setDetailError(e.message);}
    finally{if(sequence===detailSequence.current)setDetailLoading(false);}
  }
  function openDetail(id){setSelected(id);setDetail(null);setNotice('');loadDetail(id);}
  function closeDetail(){detailSequence.current++;setSelected(null);setDetail(null);}
  async function loadPreview(form){
    const sequence=++previewSequence.current;setPreviewLoading(true);setPreview(null);setActionError('');
    const at=new Date(form.receivedAt);
    if(!Number.isFinite(at.getTime())){setActionError(t(locale,'errors.BILLING_REFUND_DATE'));setPreviewLoading(false);return;}
    try{
      const result=await request('/api/admin/billing/operations?'+new URLSearchParams({companyId:String(form.companyId),invoiceId:form.invoiceId,requestedAt:at.toISOString()}));
      if(sequence!==previewSequence.current)return;
      setPreview(result);setAction(current=>current?.requestId===form.requestId?{...current,amount:current.amount||String(result.available/100),basis:current.basis==='annual'&&!result.annualEligible?'full':current.basis}:current);
    }catch(e){if(sequence===previewSequence.current)setActionError(e.message);}
    finally{if(sequence===previewSequence.current)setPreviewLoading(false);}
  }
  function begin(kind,invoice=null){
    const form={kind,companyId:selected,requestId:crypto.randomUUID(),reason:'customer_request',note:'',confirmed:false,basis:'full',amount:'',receivedAt:localInput(new Date()),initialReceivedAt:localInput(new Date()),invoiceId:invoice?.id};
    setAction(form);setActionError('');setPreview(null);if(kind==='refund')loadPreview(form);
  }
  function closeAction(){previewSequence.current++;setAction(null);setPreview(null);setActionError('');}
  async function submit(){
    if(!action?.confirmed||busy)return;setBusy(true);setActionError('');
    try{
      const body={companyId:action.companyId,requestId:action.requestId,kind:action.kind,reason:action.reason,note:action.note,confirmed:true,
        ...(action.kind==='refund'?{invoiceId:action.invoiceId,basis:action.basis,amount:refundAmount,requestedAt:preview?.requestedAt}:{} )};
      const result=await request('/api/admin/billing/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(['failed','needs_review','processing'].includes(result.operation.status)){setActionError(c(result.operation.status));return;}
      setNotice(result.operation.status==='pending'?c('pendingHint'):c('success'));closeAction();setRevision(x=>x+1);await loadDetail(selected,true);
    }catch(e){setActionError(e.message);}
    finally{setBusy(false);}
  }
  const company=detail?.company;
  const hasSubscription=Boolean(detail?.configured&&company?.subscriptionId)&&!['none','canceled','incomplete_expired'].includes(company?.status);
  const refundAmount=action?.basis==='partial'?cents(action.amount):action?.basis==='annual'?preview?.proportional:preview?.available;
  const canSubmit=Boolean(action?.confirmed)&&!busy&&!previewLoading&&(action?.kind!=='refund'||Boolean(preview&&refundAmount>0&&refundAmount<=preview.available));
  return <div className="grid gap-5">
    <AdminPageHeader title={c('title')} subtitle={c('subtitle')} actions={<button className={S.btnGhost} disabled={loading} onClick={()=>setRevision(x=>x+1)}>{b('refresh')}</button>}/>
    {list&&!list.configured?<InlineCallout tone="warning">{b('notConfigured')}</InlineCallout>:list?.livemode===false?<InlineCallout tone="info">{c('testMode')}</InlineCallout>:null}
    {list?.summary?<dl className="m-0 grid grid-cols-2 gap-3 lg:grid-cols-6">{['total','paying','trial','overdue','canceling','legacy'].map(key=><div key={key} className={box}><dt className="text-xs text-ink-muted">{c(key)}</dt><dd className="m-0 mt-2 text-2xl font-semibold">{list.summary[key]}</dd></div>)}</dl>:null}
    <div className="grid gap-3 rounded-card border border-ink/10 bg-canvas/35 p-4 sm:grid-cols-[minmax(0,1fr)_240px]">
      <FormField label={c('search')}><input type="search" className={field} value={filters.q} onChange={e=>setFilters({...filters,q:e.target.value,page:1})} maxLength={200}/></FormField>
      <FormField label={b('status')}><select className={field} value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value,page:1})}>{categories.map(status=><option key={status} value={status}>{c(status)}</option>)}</select></FormField>
    </div>
    {error?<div role="alert"><InlineCallout tone="danger">{error}</InlineCallout></div>:null}
    {loading?<AppLoading locale={locale} variant="panel"/>:!error&&!list?.items?.length?<EmptyState title={c('empty')}/>:null}
    {!loading&&list?.items?.length?<><AdminTableShell locale={locale} ariaLabel={c('title')} minWidth="960px"><thead><tr>{['company','owner','plan','period'].map(key=><AdminTh key={key}>{c(key)}</AdminTh>)}<AdminTh>{b('status')}</AdminTh><AdminTh>{c('details')}</AdminTh></tr></thead>
      <tbody>{list.items.map(row=><tr key={row.id} className="border-t border-ink/10"><td className="px-3 py-4 font-semibold">{row.name}<span className="ml-2 text-xs font-normal text-ink-muted">#{row.id}</span>{(!row.active||row.deleted)?<div className="mt-1 text-xs text-warning">{c('companyInactive')}</div>:null}</td><td className="px-3 py-4 text-sm">{row.ownerEmail||c('noOwner')}</td><td className="px-3 py-4 text-sm">{row.amount==null?c(row.category==='legacy'?'legacy':'none'):<>{money(row.amount,row.currency)}<div className="text-xs text-ink-muted">{b(row.interval==='year'?'annual':'monthly')}</div></>}</td><td className="px-3 py-4 text-sm">{date(row.periodEnd||row.trialEndsAt||row.originalLicenseExpiresAt)}</td><td className="px-3 py-4"><StatusToneChip tone={tone(row.category)}>{c(row.category)}</StatusToneChip>{row.cancelAtPeriodEnd?<p className="mb-0 mt-2 text-xs text-ink-muted">{c('canceling')}</p>:null}</td><td className="px-3 py-4"><button type="button" className={S.btnGhost} onClick={()=>openDetail(row.id)}>{c('details')}</button></td></tr>)}</tbody></AdminTableShell>
      <AdminListPager locale={locale} page={filters.page} pageSize={filters.pageSize} total={list.total} loading={loading} onPageChange={page=>setFilters({...filters,page})} onPageSizeChange={pageSize=>setFilters({...filters,pageSize,page:1})}/></>:null}
    <AdminRichFormDrawer open={selected!=null} onClose={closeDetail} locale={locale} title={company?.name||c('details')} protectChanges={false} maxWidth="1100px">
      {detailLoading?<AppLoading locale={locale} variant="panel"/>:null}
      {detailError?<div role="alert"><InlineCallout tone="danger">{detailError}</InlineCallout><button className={`${S.btnGhost} mt-3`} onClick={()=>loadDetail(selected,true)}>{c('refresh')}</button></div>:null}
      {company?<div className="grid gap-6">
        {notice?<InlineCallout tone="info">{notice}</InlineCallout>:null}
        {!company.managed?<InlineCallout tone="info">{c('legacyHint')}</InlineCallout>:null}
        <div className="flex flex-wrap items-center justify-between gap-3"><StatusToneChip tone={tone(company.category)}>{c(company.category)}</StatusToneChip><div className="flex flex-wrap gap-2"><button className={S.btnGhost} disabled={detailLoading||busy} onClick={()=>loadDetail(selected,true)}>{c('refresh')}</button>{company.customerId?<a href={`https://dashboard.stripe.com/${detail.livemode?'':'test/'}customers/${encodeURIComponent(company.customerId)}`} target="_blank" rel="noopener noreferrer" className={S.btnGhost}>{c('openStripe')}</a>:null}</div></div>
        <dl className="m-0 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[[c('owner'),company.ownerEmail||c('noOwner')],[c('plan'),money(company.amount,company.currency||'brl')],[c('period'),date(company.periodEnd||company.trialEndsAt)],[c('originalLicense'),date(company.originalLicenseExpiresAt)],[c('commercialAccess'),c(company.commercialAccess?'accessGranted':'accessRestricted')],[c('synced'),date(company.syncedAt)]].map(([label,value])=><div key={label} className={box}><dt className="text-xs text-ink-muted">{label}</dt><dd className="m-0 mt-2 break-words text-sm font-semibold">{value}</dd></div>)}</dl>
        {hasSubscription?<div className="flex flex-wrap gap-3"><button className={S.btnGhost} onClick={()=>begin(company.cancelAtPeriodEnd?'resume_renewal':'cancel_renewal')}>{c(company.cancelAtPeriodEnd?'resume_renewal':'cancel_renewal')}</button><button className={S.btnDanger} onClick={()=>begin('terminate')}>{c('terminate')}</button></div>:null}
        <section><h3 className="m-0 mb-4 text-base font-semibold">{c('payments')}</h3>{detail.invoicesUnavailable?<InlineCallout tone="warning">{b('invoiceUnavailable')}</InlineCallout>:null}{!detail.invoices.length?<EmptyState title={b('noInvoices')}/>:<ul className="m-0 list-none divide-y divide-ink/10 p-0">{detail.invoices.map(invoice=><li key={invoice.id} className="flex flex-wrap items-center justify-between gap-4 py-4"><div><p className="m-0 font-semibold">{invoice.number||invoice.id} · {money(invoice.amountPaid||invoice.amount,invoice.currency)}</p><p className="mb-0 mt-1 text-xs text-ink-muted">{date(invoice.createdAt)} · {b(`status_${invoice.status}`)}</p></div><div className="flex flex-wrap gap-2">{invoice.url?<a href={invoice.url} target="_blank" rel="noopener noreferrer" className={S.btnGhost}>{b('openInvoice')}</a>:null}{invoice.status==='paid'&&invoice.amountPaid>0?<button className={S.btnGhost} onClick={()=>begin('refund',invoice)}>{c('refund')}</button>:null}</div></li>)}</ul>}</section>
        <section><h3 className="m-0 mb-4 text-base font-semibold">{c('history')}</h3>{!detail.history.length?<EmptyState title={c('noHistory')}/>:<ol className="m-0 list-none space-y-3 p-0">{detail.history.map(event=><li key={event.id} className={box}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{c(event.kind)}{event.amount!=null?` · ${money(event.amount,event.currency)}`:''}</strong><StatusToneChip tone={tone(event.status)}>{c(event.status)}</StatusToneChip></div><p className="mb-0 mt-2 text-xs text-ink-muted">{date(event.created_at)} · {event.actorEmail||'—'} · {c(event.reason)}</p>{event.note?<p className="mb-0 mt-2 whitespace-pre-wrap text-sm text-ink-muted">{event.note}</p>:null}{event.error_code?<p className="mb-0 mt-2 text-xs text-danger">{t(locale,`errors.${event.error_code}`)}</p>:null}</li>)}</ol>}</section>
      </div>:null}
    </AdminRichFormDrawer>
    <AdminRichFormDrawer open={Boolean(action)} onClose={closeAction} locale={locale} title={action?c(action.kind):''} busy={busy} dirty={Boolean(action&&(action.note||action.confirmed||action.basis!=='full'||action.reason!=='customer_request'||action.receivedAt!==action.initialReceivedAt))} footer={<div className="flex flex-wrap justify-end gap-3"><button className={S.btnGhost} disabled={busy} onClick={closeAction}>{c('back')}</button><button className={S.btnDanger} disabled={!canSubmit} onClick={submit}>{c('confirm')}</button></div>}>
      {action?<div className="grid gap-4">
        <div className={box}><p className="m-0 font-semibold">{company?.name}</p><p className="mb-0 mt-2 text-sm leading-6 text-ink-muted">{c(action.kind==='refund'?'refundHint':action.kind==='terminate'?'terminateHint':action.kind==='resume_renewal'?'resumeHint':'cancelHint')}</p></div>
        {actionError?<div role="alert"><InlineCallout tone="danger">{actionError}</InlineCallout></div>:null}
        {action.kind==='refund'?<>
          <InlineCallout tone="info">{c('legalHint')}</InlineCallout>
          <FormField label={c('requestedAt')}><input type="datetime-local" className={field} value={action.receivedAt} max={localInput(new Date())} disabled={busy} onChange={e=>{setAction({...action,receivedAt:e.target.value,confirmed:false});setPreview(null);}}/></FormField>
          <button className={S.btnGhost} disabled={previewLoading||busy} onClick={()=>loadPreview(action)}>{c('recalculate')}</button>
          {previewLoading?<AppLoading locale={locale} variant="panel"/>:null}
          {preview?<><div className={box}><p className="m-0 text-sm">{preview.invoiceNumber||preview.invoiceId}</p><p className="mb-0 mt-2 font-semibold">{c('available')}: {money(preview.available,preview.currency)}</p></div>{preview.refunds.length?<div className={box}><h3 className="m-0 text-sm font-semibold">{c('paymentRefunds')}</h3><ul className="mb-0 mt-3 space-y-2 pl-4 text-sm">{preview.refunds.map(refund=><li key={refund.id}>{money(refund.amount,preview.currency)} · {c(refund.status)} · {date(refund.createdAt)}</li>)}</ul></div>:null}
            <FormField label={c('basis')}><select className={field} value={action.basis} disabled={busy} onChange={e=>setAction({...action,basis:e.target.value,reason:e.target.value==='annual'?'annual_early_termination':'customer_request',confirmed:false})}><option value="full">{c('full')}</option><option value="partial">{c('partial')}</option>{preview.annualEligible?<option value="annual">{c('annual')}</option>:null}</select></FormField>
            {action.basis==='partial'?<FormField label={`${c('amount')} (${preview.currency.toUpperCase()})`}><input className={field} inputMode="decimal" value={action.amount} disabled={busy} onChange={e=>setAction({...action,amount:e.target.value,confirmed:false})}/></FormField>:null}
            <p className="m-0 font-semibold">{c('amount')}: {refundAmount>0?money(refundAmount,preview.currency):'—'}</p>
          </>:null}
        </>:null}
        <FormField label={c('reason')}><select className={field} value={action.reason} disabled={busy||action.basis==='annual'} onChange={e=>setAction({...action,reason:e.target.value,confirmed:false})}>{reasons.map(reason=><option key={reason} value={reason}>{c(reason)}</option>)}</select></FormField>
        <FormField label={c('note')}><textarea className={field} rows={3} maxLength={1000} disabled={busy} value={action.note} onChange={e=>setAction({...action,note:e.target.value})}/></FormField>
        <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={action.confirmed} disabled={busy} onChange={e=>setAction({...action,confirmed:e.target.checked})}/><span>{c('acknowledge')}</span></label>
      </div>:null}
    </AdminRichFormDrawer>
  </div>;
}
