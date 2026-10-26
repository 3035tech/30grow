import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validationFields, validateFormFields } from '../../lib/form-validation.js';
import { jobRoleDescriptionSchema, jobRoleAiDescriptionSchema } from '../../lib/recruiting/job-role-description.js';
import { motivatorDimensionLabel } from '../../lib/ae/motivators-dimensions.js';

test('safe field validation identifies the field and limit without echoing input or custom messages', () => {
 const result=z.object({email:z.string().email(),description:z.string().max(4),private:z.string().refine(()=>false,'SECRET INTERNAL MESSAGE')}).safeParse({email:'PRIVATE-INPUT',description:'long text',private:'PII'});
 const errors=validationFields(result.error,'pt-BR');
 assert.match(errors.email,/e-mail/); assert.match(errors.description,/4 caracteres/); assert.equal(errors.private,'Confira o valor informado.');
 assert.ok(!JSON.stringify(errors).includes('PRIVATE')); assert.ok(!JSON.stringify(errors).includes('SECRET'));
});
test('shared form errors cover empty rich text, email, required upload and invalid numbers',()=>{
 const errors=validateFormFields([{key:'description',type:'richText',required:true},{key:'email',type:'email'},{key:'file',type:'imageUpload',required:true},{key:'count',type:'number',min:1}],{description:'<p><br></p>',email:'broken',file:{url:'',file:null},count:'0'},'pt-BR');
 assert.deepEqual(Object.keys(errors),['description','email','file','count']);
});
test('visible description size is independent of pasted safe markup and stays bounded for AI',()=>{
 const html='<b>'+ 'a'.repeat(8000)+'</b>';
 assert.equal(jobRoleDescriptionSchema.parse(html),html);
 assert.equal(jobRoleDescriptionSchema.safeParse('<b>'+'a'.repeat(8001)+'</b>').success,false);
 assert.equal(jobRoleAiDescriptionSchema.safeParse('a'.repeat(4001)).success,false);
 assert.equal(motivatorDimensionLabel('proposito','pt-BR'),'Propósito');
 assert.equal(motivatorDimensionLabel('seguranca','pt-BR'),'Segurança');
});

test('climate draft, scheduled and open dates never present creation as opening',async()=>{
 const {readFile}=await import('node:fs/promises');const vm=await import('node:vm');const {t,localeHtmlLang}=await import('../../lib/i18n.js');
 const code=await readFile(new URL('../../app/dashboard/tabs/ClimateTab.jsx',import.meta.url),'utf8');
 const functions=code.slice(code.indexOf('function dateLocale'),code.indexOf('const CLIMATE_DETAIL_SECTIONS'));
 const format=vm.runInNewContext(functions+'; formatClimateSurveyWhen',{t,localeHtmlLang,CLIMATE_SURVEY_STATUS:{DRAFT:'draft',OPEN:'open',CLOSED:'closed'}});
 assert.match(format({status:'draft',createdAt:'2020-01-01T12:00:00Z',opensAt:'2000-01-01T12:00:00Z'},'pt-BR'),/^Criada em/);
 assert.match(format({status:'open',createdAt:'2020-01-01T12:00:00Z',opensAt:'2999-01-01T12:00:00Z'},'pt-BR'),/^Abertura prevista/);
 assert.match(format({status:'open',createdAt:'2020-01-01T12:00:00Z',opensAt:'2000-01-01T12:00:00Z'},'pt-BR'),/^aberta em/);
 assert.match(format({status:'open',createdAt:'2020-01-01T12:00:00Z'},'pt-BR'),/^Criada em/);
});
