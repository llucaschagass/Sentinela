import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
const database='Sentinela_test_'+randomBytes(6).toString('hex');
process.env.DB_NAME=database;
let db:any,master:any,app:any,testApp:any,store:any;
let baseUrl:string,testUrl:string;
const key=randomBytes(32).toString('hex');const applicationId=randomUUID();const otherId=randomUUID();
const anchor='2026-09-27T12:00:00.000Z';
const base={environment:'integration',level:'error',type:'TestError',message:'Pedido 123 falhou',occurredAt:'2026-09-27T11:00:00.000Z',origin:'Integration.run'};
async function request(path:string,method='GET',body?:unknown,auth:string|null=key){
  return fetch(baseUrl+path,{method,headers:{'Content-Type':'application/json',...(auth?{'X-Application-Key':auth}:{})},body:body===undefined?undefined:JSON.stringify(body)});
}
before(async()=>{
  const {createSource}=require('../sentinela-api/dist/db/source.js');
  const {hashKey}=require('../sentinela-api/dist/domain.js');
  master=await createSource('master').initialize();
  await master.query(`CREATE DATABASE [${database}]`);
  db=await createSource(database).initialize();
  assert.equal((await db.runMigrations()).length,1);assert.equal((await db.runMigrations()).length,0);
  for(const [id,slug,hash] of [[applicationId,'integration',hashKey(key)],[otherId,'other',hashKey('other'.repeat(16))]])
    await db.query('INSERT INTO Applications(id,name,slug,keyHash) VALUES(@0,@1,@1,@2)',[id,slug,hash]);
  app=await require('../sentinela-api/dist/main.js').bootstrap(0);baseUrl=await app.getUrl();
  store=app.get(require('../sentinela-api/dist/store.js').Store);
},{timeout:60000});
after(async()=>{
  if(testApp) await testApp.close();
  if(app){const {DataSource}=require('typeorm');const source=app.get(DataSource);await app.close();if(source.isInitialized)await source.destroy();}
  if(db?.isInitialized)await db.destroy();
  if(master?.isInitialized){
    // Only the disposable database generated in this process can be removed.
    if(/^Sentinela_test_[0-9a-f]{12}$/.test(database))await master.query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}]`);
    await master.destroy();
  }
});
test('auth, validação, níveis e limite de payload pelo HTTP',async()=>{
  assert.equal((await request('/events','POST',base,null)).status,401);
  assert.equal((await request('/events','POST',base,'invalid'.repeat(8))).status,401);
  for(const patch of [{level:'info'},{occurredAt:'2026-09-27T12:00:00'},{password:'secret'},{httpStatus:999}])
    assert.equal((await request('/events','POST',{...base,...patch})).status,400);
  const huge=await request('/events','POST',{...base,message:'x'.repeat(270000)});assert.equal(huge.status,413);
  assert.equal((await request('/issues?period=wrong')).status,400);
  assert.equal((await request('/issues?pageSize=101')).status,400);
  const response=await request('/events','POST',{...base,level:'fatal'});assert.equal(response.status,201);
  const apps=await(await request('/applications')).json();assert.ok(apps.every((a:any)=>!('keyHash'in a)));
});
test('chave recebida nunca é persistida em texto livre e JSON inválido não é ecoado',async()=>{
  const response=await request('/events','POST',{...base,origin:'Secret.redaction',message:`Falha ${key}`,
    stackTrace:`Error: ${key}`,metadata:{scenario:key,headers:{authorization:key}}});
  assert.equal(response.status,201);
  const {issueId}=await response.json();
  const detail=await(await request(`/issues/${issueId}?asOf=${anchor}`)).text();
  assert.ok(!detail.includes(key));assert.ok(detail.includes('[REDACTED]'));
  const invalid=await fetch(baseUrl+'/events',{method:'POST',headers:{'Content-Type':'application/json','X-Application-Key':key},body:'{"password":"sensitive",'});
  assert.equal(invalid.status,400);assert.ok(!(await invalid.text()).includes('sensitive'));
});
test('ingestão concorrente cria uma issue, sanitiza e reabre sem perder ocorrências',async()=>{
  const concurrent={...base,origin:'Concurrent.first'};
  const responses=await Promise.all(Array.from({length:8},(_,i)=>request('/events','POST',{...concurrent,message:`Pedido ${i} falhou password=secret`,metadata:{scenario:'safe',token:'unsafe'}})));
  assert.ok(responses.every(r=>r.status===201));
  const ids=await Promise.all(responses.map(r=>r.json()));assert.equal(new Set(ids.map(r=>r.issueId)).size,1);
  const id=ids[0].issueId;
  assert.equal((await request(`/issues/${id}/status`,'PATCH',{status:'resolved'})).status,200);
  await request('/events','POST',concurrent);
  const detail=await(await request(`/issues/${id}?asOf=${anchor}`)).json();assert.equal(detail.status,'open');assert.equal(detail.periodCount,9);
  const events=await(await request(`/issues/${id}/events?asOf=${anchor}&pageSize=3`)).json();assert.equal(events.items.length,3);assert.equal(events.total,9);
  const persisted=await db.query('SELECT message,metadata FROM LogEvents WHERE issueId=@0',[id]);
  assert.ok(persisted.every((e:any)=>!e.message.includes('secret') && !e.metadata?.includes('unsafe')));
});
test('transação reverte criação da issue quando gravação do evento falha',async()=>{
  await assert.rejects(store.ingest(applicationId,{...base,origin:'Rollback.only',httpStatus:900}));
  const rows=await db.query("SELECT id FROM Issues WHERE origin='Rollback.only'");assert.equal(rows.length,0);
});
test('períodos, bordas semiabertas, aplicação/ambiente, novos grupos e série sem lacunas',async()=>{
  const environment='periods';
  for(const hours of [0,1,24,25,168,169,720,721]){
    const occurredAt=new Date(new Date(anchor).getTime()-hours*3600000).toISOString();
    await store.ingest(applicationId,{...base,environment,occurredAt,origin:`Period.${hours}`});
  }
  await store.ingest(otherId,{...base,environment,origin:'Other.application'});
  for(const [period,count,buckets] of [['24h',2,24],['7d',4,7],['30d',6,30]] as const){
    const query=`period=${period}&environment=${environment}&applicationId=${applicationId}&asOf=${anchor}`;
    const summary=await(await request('/dashboard/summary?'+query)).json();
    assert.equal(summary.occurrences,count);assert.equal(summary.distinctIssues,count);assert.equal(summary.newIssues,count);assert.equal(summary.affectedApplications,1);
    const series=await(await request('/dashboard/timeseries?'+query)).json();assert.equal(series.buckets.length,buckets);assert.equal(series.buckets.reduce((a:number,b:any)=>a+b.count,0),count);
    const list=await(await request('/issues?'+query+'&pageSize=1&sort=lastOccurredAt')).json();assert.equal(list.total,count);assert.equal(list.items.length,1);
    const envs=await(await request('/environments?'+query)).json();assert.deepEqual(envs,['periods']);
  }
  const summary=await(await request(`/dashboard/summary?environment=${environment}&applicationId=${applicationId}&asOf=${anchor}`)).json();
  assert.equal(summary.growth.previous,1);assert.equal(summary.growth.percentage,100);
});
test('separa grupos por ambiente, aplicação e tipo; datas antigas atualizam primeira ocorrência',async()=>{
  const first=await store.ingest(applicationId,{...base,environment:'separation'});
  for(const [id,patch] of [[otherId,{}],[applicationId,{environment:'different'}],[applicationId,{type:'OtherType'}]]){
    const result=await store.ingest(id,{...base,environment:'separation',...patch});assert.notEqual(result.issueId,first.issueId);
  }
  await store.ingest(applicationId,{...base,environment:'separation',occurredAt:'2026-08-01T00:00:00Z'});
  const d=await(await request(`/issues/${first.issueId}?asOf=${anchor}`)).json();assert.equal(d.firstOccurredAt,'2026-08-01T00:00:00.000Z');
  const s=await(await request(`/dashboard/summary?environment=separation&applicationId=${applicationId}&asOf=${anchor}`)).json();assert.equal(s.newIssues,1);
});
test('preserva milissegundos e inclui o último milissegundo no último bucket',async()=>{
  const asOf='2026-09-27T12:00:00.456Z';
  const start=new Date(new Date(asOf).getTime()-24*3600000);
  for(const occurredAt of [new Date(start.getTime()-1).toISOString(),start.toISOString(),'2026-09-27T12:00:00.455Z',asOf])
    await store.ingest(applicationId,{...base,environment:'milliseconds',occurredAt});
  const query=`environment=milliseconds&asOf=${asOf}`;
  const summary=await(await request('/dashboard/summary?'+query)).json();assert.equal(summary.occurrences,2);
  const series=await(await request('/dashboard/timeseries?'+query)).json();
  assert.equal(series.buckets[0].count,1);assert.equal(series.buckets[23].count,1);
  assert.equal(series.buckets.reduce((sum:number,b:any)=>sum+b.count,0),2);
});
test('API monitorada preserva todos os cenários quando Sentinela está indisponível',async()=>{
  process.env.SENTINELA_URL='http://127.0.0.1:1';process.env.SENTINELA_INGESTION_KEY=key;
  testApp=await require('../sentinela-test-api/dist/main.js').bootstrap(0);testUrl=await testApp.getUrl();
  for(const [scenario,status] of [['unexpected',500],['validation',400],['integration',502],['database',503]]){
    const response=await fetch(`${testUrl}/scenarios/${scenario}`,{headers:{'X-Correlation-ID':'integration-correlation'}});
    assert.equal(response.status,status);assert.equal(response.headers.get('X-Correlation-ID'),'integration-correlation');
    const body=await response.json();assert.equal(body.correlationId,'integration-correlation');
  }
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal((await fetch(testUrl+'/health')).status,200);
});
