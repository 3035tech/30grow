'use client';
import { useRef, useState } from 'react';
import { DateField } from '../../../app/_components/DateField.jsx';
import { PromptFormDialog } from '../../../app/_components/PromptFormDialog.jsx';
import { SelectField } from '../../../app/_components/SelectField.jsx';
import LanguageSelect from '../../../app/_components/LanguageSelect.jsx';
import { PrivateAttachment } from '../../../app/_components/PrivateAttachment.jsx';
export default function Preview() {
 const [date, setDate] = useState('2026-09-19');
 const [time, setTime] = useState('2026-09-19T10:30');
 const [seconds, setSeconds] = useState('2026-09-19T10:30:45');
 const [dialog, setDialog] = useState(false);
 const [submits, setSubmits] = useState(0);
 const [area, setArea] = useState('product');
 const [result, setResult] = useState('');
 const [calls, setCalls] = useState(0);
 const [rowCalls, setRowCalls] = useState(0);
 const selectRef = useRef(null);
 const [locale, setLocale] = useState('pt-BR');
 return <main className="mx-auto max-w-3xl space-y-6 p-6">
 <div className="flex justify-end"><LanguageSelect locale={locale} onChange={setLocale} /></div>
 <section aria-label="Anexo privado">
 <PrivateAttachment href="/api/employee/dp/documents/address_proof/file" fileName="Comprovante de endereço.pdf" />
 </section>
 <button type="button" onClick={()=>setDialog(true)}>Abrir formulário</button>
 <PromptFormDialog open={dialog} title="Formulário de teste" fields={[
  {key:'name',label:'Nome',required:true},
  {key:'area',label:'Área do formulário',type:'select',options:[{value:'a',label:'Área A'},{value:'b',label:'Área B'}]},
  {key:'date',label:'Data do formulário',type:'date',required:true,defaultValue:'2026-09-19',min:'2026-09-10',max:'2026-09-30'}
 ]} onCancel={()=>setDialog(false)} onSubmit={async()=>{setSubmits(n=>n+1);await new Promise(resolve=>setTimeout(resolve,300));}}/>
 <output data-testid="submits">{submits}</output>
 <DateField aria-label="Data de teste" value={date} onChange={e=>setDate(e.target.value)} min="2026-09-10" max="2026-10-10" />
 <output data-testid="date">{date}</output>
 <DateField aria-label="Horário de teste" mode="datetime-local" value={time} min="2026-09-19T10:00" max="2026-09-19T12:00" onChange={e=>setTime(e.target.value)}/>
 <output data-testid="time">{time}</output>
 <DateField aria-label="Horário com segundos" mode="datetime-local" step="1" value={seconds} onChange={e=>setSeconds(e.target.value)}/>
 <output data-testid="seconds">{seconds}</output>
 <h1 className="font-display text-3xl">Controles do 30 Grow</h1>
 <p>Revisão isolada, sem dados ou conexão com produção.</p>
 <label className="flex flex-col gap-2">Área
 <SelectField aria-label="Área" value={area} onChange={e=>{setArea(e.target.value);setCalls(n=>n+1);}} className="w-full">
 <option value="product">Produto</option><option disabled value="closed">Indisponível</option>
 <optgroup label="Operação"><option value="people">Pessoas</option><option value="support">Atendimento</option></optgroup>
 </SelectField></label>
 <output data-testid="selected">{area}</output>
 <output data-testid="calls">{calls}</output>
 <div onClick={()=>setRowCalls(n=>n+1)} className="rounded-control border border-ink/12 p-4">
 <SelectField ref={selectRef} aria-label="Dentro do card" onClick={e=>e.stopPropagation()}><option>Primeira</option><option>Segunda</option></SelectField>
 </div>
 <output data-testid="row-calls">{rowCalls}</output>
 <button type="button" onClick={()=>{selectRef.current.focus();selectRef.current.click();}}>Abrir por referência</button>
 <form onSubmit={e=>{e.preventDefault();setResult(new FormData(e.currentTarget).get('company'));}} className="space-y-4 rounded-card border border-ink/12 bg-surface p-5">
 <label className="flex flex-col gap-2">Empresa
 <SelectField aria-label="Empresa" name="company" required defaultValue="" className="w-full">
 <option value="">Selecione a empresa</option><option value="demo">Empresa demonstração</option></SelectField></label>
 <button className="rounded-control bg-brand-500 px-4 py-3 text-white" type="submit">Salvar</button>
 <button className="rounded-control border px-4 py-3" type="reset">Limpar</button>
 <output data-testid="result">{result}</output>
 </form>
 <SelectField aria-label="Bloqueado" disabled><option>Não disponível</option></SelectField>
 <div className="overflow-hidden rounded-card border border-ink/12 p-4"><SelectField aria-label="Dentro do painel"><option>Primeira</option><option>Segunda</option></SelectField></div>
 </main>;
}
