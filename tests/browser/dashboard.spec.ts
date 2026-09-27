import { test,expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('fluxo real: cenário, agrupamento, períodos, detalhe, resolução e reabertura',async({page,request})=>{
  const generated=await request.get('http://127.0.0.1:3001/scenarios/integration');expect(generated.status()).toBe(502);
  const {correlationId}=await generated.json();
  await expect.poll(async()=>{const r=await request.get('http://127.0.0.1:3000/issues');return (await r.json()).items.some((i:any)=>i.type==='IntegrationError');}).toBe(true);
  await page.goto('/');await expect(page.getByRole('heading',{name:'Saúde das aplicações'})).toBeVisible();
  await expect(page.getByRole('link',{name:'IntegrationError',exact:true})).toBeVisible();
  const before=Number((await page.getByTestId('occurrences').innerText()).replace(/[^0-9]/g,''));
  await request.get('http://127.0.0.1:3001/scenarios/integration');
  await expect.poll(async()=>{const r=await request.get('http://127.0.0.1:3000/dashboard/summary');return (await r.json()).occurrences;}).toBeGreaterThan(before);
  for(const period of ['7d','30d','24h']){await page.getByLabel('Período',{exact:true}).selectOption(period);await expect(page.getByRole('link',{name:'IntegrationError',exact:true})).toBeVisible();await expect(page).toHaveURL(new RegExp('period='+period));}
  await page.getByRole('link',{name:'IntegrationError',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Detalhe da issue'})).toBeVisible();
  await page.locator('details').filter({hasText:correlationId}).locator('summary').click();
  await expect(page.locator('.event-body').filter({hasText:correlationId})).toBeVisible();
  await expect(page.locator('.stack pre')).toContainText('IntegrationError');
  await page.getByRole('button',{name:'Marcar como resolvida'}).click();await expect(page.getByRole('button',{name:'Reabrir issue'})).toBeVisible();
  await request.get('http://127.0.0.1:3001/scenarios/integration');
  await expect.poll(async()=>{const r=await request.get('http://127.0.0.1:3000'+new URL(page.url()).pathname);return (await r.json()).status;}).toBe('open');
  await page.reload();await expect(page.getByRole('button',{name:'Marcar como resolvida'})).toBeVisible();
  await page.getByRole('link',{name:'Voltar ao dashboard',exact:false}).click();await expect(page).toHaveURL(/period=24h/);
});
test('estados de carregamento, vazio e erro recuperável; layout móvel',async({page})=>{
  let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/dashboard/summary*',async route=>{await gate;await route.fulfill({json:{occurrences:0,distinctIssues:0,newIssues:0,affectedApplications:0,growth:{current:0,previous:0,percentage:null,increased:false,noPreviousOccurrences:true}}});});
  await page.route('**/api/issues?*',route=>route.fulfill({json:{items:[],total:0,page:1,pageSize:20}}));
  await page.goto('/');await expect(page.getByRole('status')).toContainText('Carregando');release();
  await expect(page.getByText('Tudo tranquilo por aqui.')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.unroute('**/api/dashboard/summary*');await page.route('**/api/dashboard/summary*',route=>route.abort());
  await page.getByRole('button',{name:'Atualizar'}).click();await expect(page.getByRole('alert')).toContainText('Não foi possível');
  await page.unroute('**/api/dashboard/summary*');await page.getByRole('button',{name:'Tentar novamente'}).click();await expect(page.getByRole('alert')).toHaveCount(0);
});
test('os quatro cenários entregam exatamente um evento com correlation ID',async({request})=>{
  for(const [scenario,status] of [['unexpected',500],['validation',400],['integration',502],['database',503]] as const){
    const correlationId='e2e-'+randomUUID();
    const response=await request.get('http://127.0.0.1:3001/scenarios/'+scenario,{headers:{'X-Correlation-ID':correlationId}});
    expect(response.status()).toBe(status);expect(response.headers()['x-correlation-id']).toBe(correlationId);
    await expect.poll(async()=>{
      const list=await (await request.get('http://127.0.0.1:3000/issues')).json();
      const pages=await Promise.all(list.items.map(async(issue:any)=>(await request.get(`http://127.0.0.1:3000/issues/${issue.id}/events`)).json()));
      return pages.flatMap((page:any)=>page.items).filter((event:any)=>event.correlationId===correlationId && event.httpStatus===status).length;
    }).toBe(1);
  }
});
