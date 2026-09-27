import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
const {EventDto,FilterDto,PageDto}=require('../sentinela-api/dist/contracts.js');
const {cleanEvent,fingerprint,normalizeMessage,sanitizeText,windowFor,growth}=require('../sentinela-api/dist/domain.js');
const {EventSender}=require('../sentinela-test-api/dist/sender.js');
const base={environment:'development',level:'error',type:'Error',message:'Falha ao buscar pedido 123',occurredAt:'2026-09-27T12:00:00.000Z'};
test('DTO aceita error/fatal e timezone explícito, rejeita níveis futuros e campos inválidos',async()=>{
  for(const level of ['error','fatal']) assert.equal((await validate(plainToInstance(EventDto,{...base,level}))).length,0);
  for(const change of [{level:'info'},{occurredAt:'2026-09-27T12:00:00'},{message:''},{environment:'x y'},{httpStatus:700},{metadata:'secret'},{httpMethod:'INVALID'},{message:'x'.repeat(8001)}]) {
    assert.ok((await validate(plainToInstance(EventDto,{...base,...change}))).length>0);
  }
  assert.ok((await validate(plainToInstance(EventDto,{...base,password:'should-not-be-accepted'}),{whitelist:true,forbidNonWhitelisted:true})).length>0);
});
test('sanitização remove credenciais reconhecíveis, query strings e metadados fora da lista',()=>{
  const e=cleanEvent({...base,message:'password=secret token=abc Bearer sensitive',endpoint:'/orders?token=secret',
    stackTrace:'Error https://user:pass@example.test/a?token=abc',metadata:{password:'secret',body:{senha:'abc'},scenario:'test',operation:'token=abc',retryCount:3}});
  assert.ok(!e.message.includes('secret'));assert.ok(!e.message.includes('sensitive'));assert.equal(e.endpoint,'/orders');
  assert.ok(!e.stackTrace.includes('user:pass'));assert.ok(!e.stackTrace.includes('?'));
  assert.deepEqual(e.metadata,{scenario:'test',operation:'token=[REDACTED]',retryCount:3});
  assert.equal(sanitizeText('"password": "with spaces"'),'"password": [REDACTED]');
});
test('assinatura agrupa mensagens variáveis e separa aplicação, ambiente, tipo e origem',()=>{
  const signature=fingerprint('a',base).signature;
  assert.equal(signature,fingerprint('A',base).signature);
  assert.equal(signature,fingerprint('a',{...base,message:'Falha ao buscar pedido 999'}).signature);
  for(const [app,change] of [['b',{}],['a',{environment:'production'}],['a',{type:'Other'}],['a',{origin:'service.a'}]])
    assert.notEqual(signature,fingerprint(app,{...base,...change}).signature);
  assert.equal(fingerprint('a',{...base,origin:'Service.run',message:'one'}).signature,fingerprint('a',{...base,origin:'Service.run',message:'two'}).signature);
  assert.equal(fingerprint('a',{...base,stackTrace:'Error\n at run (/app/src/file.js:2:1)'}).signature,
    fingerprint('a',{...base,stackTrace:'Error\n at run (C:\\repo\\src\\file.js:80:2)'}).signature);
  assert.equal(normalizeMessage('id 550e8400-e29b-41d4-a716-446655440000 at 2026-09-27T12:00:00Z 0xff 33'),'id <uuid> at <date> <hex> <n>');
});
test('janelas UTC são contínuas, com período anterior equivalente',async()=>{
  for(const [period,hours] of [['24h',24],['7d',168],['30d',720]] as const){
    const f=plainToInstance(FilterDto,{period,asOf:'2026-09-27T12:00:00-03:00'});
    assert.equal((await validate(f)).length,0);
    const w=windowFor(f);assert.equal(w.end.toISOString(),'2026-09-27T15:00:00.000Z');
    assert.equal(w.end-w.start,hours*3600000);assert.equal(w.start-w.previous,hours*3600000);
  }
  assert.ok((await validate(plainToInstance(FilterDto,{period:'1h'}))).length>0);
  assert.ok((await validate(plainToInstance(PageDto,{pageSize:101}))).length>0);
});
test('crescimento trata base zero, estabilidade e redução',()=>{
  assert.deepEqual(growth(3,0),{current:3,previous:0,percentage:null,increased:true,noPreviousOccurrences:true});
  assert.equal(growth(10,5).percentage,100);assert.equal(growth(5,10).percentage,-50);assert.equal(growth(0,0).increased,false);
});
test('sender limita fila e tolera falha de rede sem rejeição não tratada',async()=>{
  const sender=new EventSender('http://127.0.0.1:1','x'.repeat(64),50,2);
  for(let i=0;i<10;i++) sender.send({...base,origin:'test',endpoint:'/test',httpMethod:'GET',httpStatus:500,correlationId:'test'});
  await sender.idle();assert.equal(sender.dropped,10);
});
