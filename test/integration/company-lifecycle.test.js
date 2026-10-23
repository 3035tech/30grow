/** Isolated PostgreSQL only. Never loads .env or contacts Stripe. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import pg from 'pg';
import { BillingError } from '../../lib/billing/stripe.js';
import { TERMINAL_STATUSES } from '../../lib/billing/catalog.js';
import { validateRuntimeSchema } from '../../lib/runtime-schema.js';
const port=Number(process.env.BILLING_TEST_PG_PORT);
test('company lifecycle is atomic and cannot remove access while payment remains possible',{skip:!port},async t=>{
 assert.equal(port,55447);
 const schema='lifecycle_'+randomUUID().replaceAll('-','');
 const root=new pg.Pool({host:'127.0.0.1',port,user:'grow_billing_test',database:'postgres',max:1});await root.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({host:'127.0.0.1',port,user:'grow_billing_test',database:'postgres',options:`-c search_path=${schema}`,max:8});
 const transaction=async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const value=await fn(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 let providerSubscriptions=[],providerCheckouts=[],providerError=null,providerMode=false,providerCalls=0;
 const stripe={subscriptions:{list:async()=>{providerCalls++;if(providerError)throw providerError;return {data:providerSubscriptions};}},checkout:{sessions:{list:async()=>({data:providerCheckouts})}}};
 const context=vm.createContext({});const deps={withTransaction:transaction,BillingError,getStripe:()=>stripe,stripeMode:()=>providerMode,TERMINAL_STATUSES};
 const mod=new vm.SourceTextModule(await readFile(new URL('../../lib/company-lifecycle.js',import.meta.url),'utf8'),{context});
 await mod.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const[k,v]of Object.entries(deps))this.setExport(k,v);},{context}));await mod.evaluate();
 const {archiveCompany,withCompanyDeactivation}=mod.namespace;
 try{
  await pool.query(`CREATE TABLE companies(id SERIAL PRIMARY KEY,name TEXT,active BOOLEAN DEFAULT TRUE,deleted BOOLEAN DEFAULT FALSE);
   CREATE TABLE company_links(company_id INTEGER REFERENCES companies(id),active BOOLEAN DEFAULT TRUE,rotated_at TIMESTAMPTZ);
   CREATE TABLE vacancies(id SERIAL PRIMARY KEY,company_id INTEGER REFERENCES companies(id),deleted BOOLEAN DEFAULT FALSE);
   CREATE TABLE vacancy_links(vacancy_id INTEGER REFERENCES vacancies(id),active BOOLEAN DEFAULT TRUE,rotated_at TIMESTAMPTZ);
   CREATE TABLE company_billing_accounts(company_id INTEGER REFERENCES companies(id),livemode BOOLEAN DEFAULT FALSE,status TEXT DEFAULT 'none',customer_id TEXT,subscription_id TEXT,checkout_attempt UUID,checkout_session_id TEXT,checkout_created_at TIMESTAMPTZ,PRIMARY KEY(company_id,livemode));`);
  const company=async()=>{const id=(await pool.query("INSERT INTO companies(name) VALUES('Fixture') RETURNING id")).rows[0].id;await pool.query('INSERT INTO company_links(company_id) VALUES($1)',[id]);const v=(await pool.query('INSERT INTO vacancies(company_id) VALUES($1) RETURNING id',[id])).rows[0].id;await pool.query('INSERT INTO vacancy_links(vacancy_id) VALUES($1)',[v]);return id;};
  const state=async id=>(await pool.query(`SELECT c.active,c.deleted,l.active AS link_active,v.deleted AS vacancy_deleted,vl.active AS vacancy_link_active
    FROM companies c JOIN company_links l ON l.company_id=c.id JOIN vacancies v ON v.company_id=c.id JOIN vacancy_links vl ON vl.vacancy_id=v.id WHERE c.id=$1`,[id])).rows[0];
  const unchanged={active:true,deleted:false,link_active:true,vacancy_deleted:false,vacancy_link_active:true};
  await t.test('legacy company archives all links and vacancies together',async()=>{const id=await company();await archiveCompany(id);assert.deepEqual(await state(id),{active:false,deleted:true,link_active:false,vacancy_deleted:true,vacancy_link_active:false});});
  await t.test('every nonterminal subscription blocks archive and deactivation without provider writes',async()=>{
   for(const status of ['active','trialing','past_due','unpaid','incomplete','paused']){
    const id=await company();await pool.query('INSERT INTO company_billing_accounts(company_id,status,subscription_id) VALUES($1,$2,$3)',[id,status,'sub_test']);
    await assert.rejects(archiveCompany(id),{code:'COMPANY_BILLING_UNRESOLVED'});
    await assert.rejects(withCompanyDeactivation(id,db=>db.query('UPDATE companies SET active=FALSE WHERE id=$1',[id])),{code:'COMPANY_BILLING_UNRESOLVED'});
    assert.deepEqual(await state(id),unchanged);
   }
  });
  await t.test('fresh provider state detects subscriptions missing from the local snapshot and open checkout',async()=>{
   const id=await company();await pool.query("INSERT INTO company_billing_accounts(company_id,status,customer_id) VALUES($1,'canceled','cus_test')",[id]);
   providerSubscriptions=[{status:'active'}];await assert.rejects(archiveCompany(id),{code:'COMPANY_BILLING_UNRESOLVED'});
   providerSubscriptions=[];providerCheckouts=[{id:'cs_open'}];await assert.rejects(archiveCompany(id),{code:'COMPANY_BILLING_UNRESOLVED'});
   providerCheckouts=[];providerError=new Error('provider timeout');await assert.rejects(archiveCompany(id),/provider timeout/);providerError=null;
   providerMode=true;await assert.rejects(archiveCompany(id),{code:'COMPANY_BILLING_UNRESOLVED'});providerMode=false;
   assert.deepEqual(await state(id),unchanged);await archiveCompany(id);assert.equal((await state(id)).deleted,true);assert.ok(providerCalls>0);
  });
  await t.test('uncertain checkout intent blocks access removal even without a returned session ID',async()=>{
   const id=await company();await pool.query("INSERT INTO company_billing_accounts(company_id,customer_id,checkout_attempt,checkout_created_at) VALUES($1,'cus_test',$2,now())",[id,randomUUID()]);
   await assert.rejects(archiveCompany(id),{code:'COMPANY_BILLING_UNRESOLVED'});assert.deepEqual(await state(id),unchanged);
   await pool.query("UPDATE company_billing_accounts SET checkout_created_at=now()-interval '25 hours' WHERE company_id=$1",[id]);await archiveCompany(id);assert.equal((await state(id)).deleted,true);
  });
  await t.test('failure in the final company write rolls back all preceding updates',async()=>{
   const id=await company();await pool.query(`CREATE FUNCTION prevent_archive() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=${id} AND NEW.deleted THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_archive BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION prevent_archive();`);
   await assert.rejects(archiveCompany(id),/injected failure/);assert.deepEqual(await state(id),unchanged);await pool.query('DROP TRIGGER fail_archive ON companies');
  });
  await t.test('company row lock serializes lifecycle with checkout account creation',async()=>{
   const id=await company();const c=await pool.connect();await c.query('BEGIN');await c.query('SELECT id FROM companies WHERE id=$1 FOR UPDATE',[id]);
   const archive=archiveCompany(id);await c.query("INSERT INTO company_billing_accounts(company_id,status) VALUES($1,'active')",[id]);await c.query('COMMIT');c.release();
   await assert.rejects(archive,{code:'COMPANY_BILLING_UNRESOLVED'});assert.deepEqual(await state(id),unchanged);
  });
  await t.test('runtime preflight refuses a missing security column or capability table',async()=>{
   await pool.query(`CREATE TABLE users(id INT,role TEXT,locale TEXT,active BOOLEAN,deleted BOOLEAN,company_id INT,session_version INT);
    ALTER TABLE companies ADD COLUMN enabled_modules TEXT[];ALTER TABLE companies ADD COLUMN signup_creator_user_id INT;
    CREATE TABLE user_capability_overrides(user_id INT,capability TEXT,granted BOOLEAN);
    CREATE TABLE company_billing_terms(company_id INT,managed BOOLEAN,trial_ends_at TIMESTAMPTZ);
    CREATE TABLE billing_admin_operations(id UUID,company_id INT,actor_user_id INT,status TEXT);
    CREATE TABLE billing_admin_operation_events(id BIGINT,operation_id UUID,status TEXT);`);
   await validateRuntimeSchema(pool);await pool.query('ALTER TABLE users RENAME COLUMN session_version TO missing_session_version');
   await assert.rejects(validateRuntimeSchema(pool),{code:'42703'});await pool.query('ALTER TABLE users RENAME COLUMN missing_session_version TO session_version');
   await pool.query('DROP TABLE user_capability_overrides');await assert.rejects(validateRuntimeSchema(pool),{code:'42P01'});
  });
 }finally{await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();}
});
