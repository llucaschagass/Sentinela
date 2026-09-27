import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, catchError, forkJoin, map, merge, startWith, switchMap, tap, timer } from 'rxjs';
import { Api, Detail, Event, Filters, Issue, Page, Series, Summary, describeGrowth, readFilters } from './api';
@Component({selector:'app-root',standalone:true,imports:[RouterOutlet,RouterLink],template:`
  <header class="topbar"><a routerLink="/" class="brand"><span class="brand-icon">S</span> sentinela<span class="brand-dot">.</span></a><span class="topbar-note">MONITORAMENTO DE ERROS</span><span class="local-badge"><i></i> Ambiente local</span></header>
  <main><router-outlet /></main><footer>Sentinela · Diagnósticos claros. Respostas rápidas.<span>Horários exibidos no seu fuso local</span></footer>`})
export class AppComponent {}

@Component({selector:'app-dashboard',standalone:true,imports:[CommonModule,FormsModule,RouterLink],template:`
  <section class="page-heading"><div><p class="eyebrow">VISÃO GERAL</p><h1>Saúde das aplicações</h1><p class="muted">Acompanhe ocorrências, identifique padrões e priorize o que importa.</p></div><button class="secondary" (click)="refresh.next()" [disabled]="loading()">↻ Atualizar</button></section>
  <section class="filters" aria-label="Filtros do dashboard">
    <label>Período<select aria-label="Período" [ngModel]="filters().period" (ngModelChange)="change('period',$event)"><option value="24h">24 horas</option><option value="7d">7 dias</option><option value="30d">30 dias</option></select></label>
    <label>Aplicação<select aria-label="Aplicação" [ngModel]="filters().applicationId" (ngModelChange)="change('applicationId',$event)"><option value="">Todas as aplicações</option>@for(a of applications();track a.id){<option [value]="a.id">{{a.name}}</option>}</select></label>
    <label>Ambiente<select aria-label="Ambiente" [ngModel]="filters().environment" (ngModelChange)="change('environment',$event)"><option value="">Todos os ambientes</option>@for(e of environments();track e){<option [value]="e">{{e}}</option>}</select></label><span class="filter-note">Atualiza a cada 15 segundos</span>
  </section>
  @if(error()){<div class="notice error" role="alert">Não foi possível carregar o dashboard. Verifique a API e tente novamente. <button (click)="refresh.next()">Tentar novamente</button></div>}
  @if(loading() && !summary()){<div class="notice" role="status">Carregando indicadores…</div>}
  @if(summary();as s){
    <section class="metrics" [attr.aria-busy]="loading()"><article><span>Ocorrências</span><strong data-testid="occurrences">{{s.occurrences|number}}</strong><small [class.increase]="s.growth.increased">{{growth(s.growth)}}</small></article><article><span>Issues distintas</span><strong>{{s.distinctIssues|number}}</strong><small>Com ocorrências no período</small></article><article><span>Issues novas</span><strong>{{s.newIssues|number}}</strong><small>Primeira ocorrência no período</small></article><article><span>Aplicações afetadas</span><strong>{{s.affectedApplications|number}}</strong><small>Com ao menos uma ocorrência</small></article></section>
    <section class="panel chart-panel"><div class="panel-heading"><div><h2>Evolução de ocorrências</h2><p class="muted">{{filters().period==='24h'?'Volume por hora':'Volume por dia'}} · janela contínua selecionada</p></div><span class="legend"><i></i> Ocorrências</span></div>
      @if(s.occurrences===0){<div class="empty chart-empty">Nenhuma ocorrência neste período.<small>Gere um cenário na API de teste para começar.</small></div>}
      @else{<div class="chart"><div class="chart-scale">{{maxCount()}}<span>0</span></div><svg viewBox="0 0 900 180" preserveAspectRatio="none" role="img" [attr.aria-label]="'Evolução de '+s.occurrences+' ocorrências'"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4361ee" stop-opacity=".22"/><stop offset="100%" stop-color="#4361ee" stop-opacity="0"/></linearGradient></defs><path d="M0 20H900 M0 95H900 M0 170H900" stroke="#e9edf5" fill="none"/><polygon [attr.points]="'0,170 '+points()+' 900,170'" fill="url(#fill)"/><polyline [attr.points]="points()" fill="none" stroke="#4361ee" stroke-width="3" vector-effect="non-scaling-stroke"/></svg></div><div class="chart-labels"><span>{{series().buckets[0]?.at|date:'dd/MM HH:mm'}}</span><span>{{series().buckets[series().buckets.length-1]?.at|date:'dd/MM HH:mm'}}</span></div>}
    </section>
    <section class="panel"><div class="panel-heading"><div><h2>Principais issues <span class="count-badge">{{issues().total}}</span></h2><p class="muted">Erros agrupados por aplicação, ambiente, tipo e origem.</p></div><label class="sort">Ordenar por<select aria-label="Ordenar issues" [ngModel]="sort()" (ngModelChange)="changeSort($event)"><option value="count">Maior frequência</option><option value="lastOccurredAt">Mais recentes</option></select></label></div>
    @if(!issues().items.length){<div class="empty">Tudo tranquilo por aqui.<small>Nenhuma issue corresponde aos filtros selecionados.</small></div>}
    @else{<div class="table-scroll"><table><thead><tr><th>Issue / aplicação</th><th>Ambiente</th><th>Ocorrências</th><th>Última ocorrência</th><th>Estado</th></tr></thead><tbody>@for(i of issues().items;track i.id){<tr><td><a class="issue-link" [routerLink]="['/issues',i.id]" [queryParams]="filters()">{{i.type}}</a><p class="truncate">{{i.message}}</p><small>{{i.applicationName}}</small></td><td><span class="environment">{{i.environment}}</span></td><td><strong>{{i.count}}</strong><small [class.increase]="i.growth.increased">{{growth(i.growth)}}</small></td><td>{{i.lastOccurredAt|date:'dd/MM/yy HH:mm:ss'}}</td><td><span class="status" [class.resolved]="i.status==='resolved'">{{i.status==='open'?'Aberta':'Resolvida'}}</span></td></tr>}</tbody></table></div>}
    <div class="pagination"><span>{{issues().total}} issues · página {{page()}}</span><div><button class="secondary" [disabled]="page()===1 || loading()" (click)="changePage(-1)">Anterior</button><button class="secondary" [disabled]="page()*20>=issues().total || loading()" (click)="changePage(1)">Próxima</button></div></div></section>
  }
`})
export class DashboardComponent {
  private api=inject(Api);private route=inject(ActivatedRoute);private router=inject(Router);private destroy=inject(DestroyRef);
  refresh=new Subject<void>(); filters=signal<Filters>({period:'24h',applicationId:'',environment:''});sort=signal('count');page=signal(1);
  loading=signal(true);error=signal(false);applications=signal<{id:string;name:string}[]>([]);environments=signal<string[]>([]);
  summary=signal<Summary|null>(null);series=signal<Series>({buckets:[]});issues=signal<Page<Issue>>({items:[],total:0,page:1,pageSize:20});growth=describeGrowth;
  maxCount=computed(()=>Math.max(1,...this.series().buckets.map(b=>b.count)));
  points=computed(()=>this.series().buckets.map((b,i,all)=>`${i*900/Math.max(1,all.length-1)},${170-b.count/this.maxCount()*150}`).join(' '));
  constructor(){
    this.route.queryParams.pipe(tap(params=>{this.filters.set(readFilters(params));this.sort.set(params['sort']==='lastOccurredAt'?'lastOccurredAt':'count');this.page.set(Math.max(1,Number(params['page'])||1));this.summary.set(null);}),
      switchMap(()=>merge(timer(0,15000),this.refresh).pipe(switchMap(()=>{
        this.loading.set(true);this.error.set(false);const f={...this.filters(),asOf:new Date().toISOString()};
        return forkJoin({summary:this.api.get<Summary>('/dashboard/summary',f),series:this.api.get<Series>('/dashboard/timeseries',f),issues:this.api.get<Page<Issue>>('/issues',{...f,sort:this.sort(),page:this.page()}),applications:this.api.get<{id:string;name:string}[]>('/applications'),environments:this.api.get<string[]>('/environments',{...f,environment:''})}).pipe(catchError(()=>{this.error.set(true);this.loading.set(false);return EMPTY;}));
      }))),takeUntilDestroyed(this.destroy)).subscribe(data=>{this.summary.set(data.summary);this.series.set(data.series);this.issues.set(data.issues);this.applications.set(data.applications);this.environments.set([...new Set([...data.environments,...(this.filters().environment?[this.filters().environment]:[])])]);this.loading.set(false);});
  }
  change(key:keyof Filters,value:string){void this.router.navigate([],{queryParams:{...this.filters(),[key]:value,sort:this.sort(),page:1,...(key==='applicationId'?{environment:''}:{})}});}
  changeSort(sort:string){void this.router.navigate([],{queryParams:{...this.filters(),sort,page:1}});}
  changePage(delta:number){void this.router.navigate([],{queryParams:{...this.filters(),sort:this.sort(),page:this.page()+delta}});}
}

@Component({selector:'app-detail',standalone:true,imports:[CommonModule,FormsModule,RouterLink],template:`
  <a class="back-link" routerLink="/" [queryParams]="filters()">← Voltar ao dashboard</a>
  <section class="page-heading"><div><p class="eyebrow">INVESTIGAÇÃO</p><h1>Detalhe da issue</h1></div><label>Período<select aria-label="Período" [ngModel]="filters().period" (ngModelChange)="period($event)"><option value="24h">24 horas</option><option value="7d">7 dias</option><option value="30d">30 dias</option></select></label></section>
  @if(loading()){<div class="notice" role="status">Carregando ocorrências…</div>}
  @if(error()){<div class="notice error" role="alert">Não foi possível carregar a issue. <button (click)="refresh.next()">Tentar novamente</button></div>}
  @if(detail();as d){<section class="panel detail-summary"><div class="panel-heading"><div><span class="status" [class.resolved]="d.status==='resolved'">{{d.status==='open'?'Aberta':'Resolvida'}}</span><h2>{{d.type}}</h2><p class="muted">{{d.applicationName}} · {{d.environment}}</p></div><button class="primary" [disabled]="saving()" (click)="toggle()">{{saving()?'Salvando…':d.status==='open'?'Marcar como resolvida':'Reabrir issue'}}</button></div>
    @if(saveError()){<p role="alert" class="error-text">Não foi possível alterar o estado. Tente novamente.</p>}
    <p class="message">{{d.representativeEvent?.message || d.message}}</p><dl><div><dt>Primeira ocorrência</dt><dd>{{d.firstOccurredAt|date:'dd/MM/yyyy HH:mm:ss'}}</dd></div><div><dt>Última ocorrência</dt><dd>{{d.lastOccurredAt|date:'dd/MM/yyyy HH:mm:ss'}}</dd></div><div><dt>Ocorrências no período</dt><dd>{{d.periodCount}}</dd></div><div><dt>Origem</dt><dd>{{d.origin}}</dd></div></dl>
  </section><section class="panel stack"><h2>Stack trace</h2><pre>{{d.representativeEvent?.stackTrace || 'Stack trace não disponível no período selecionado.'}}</pre></section>
  <section class="panel"><div class="panel-heading"><div><h2>Ocorrências</h2><p class="muted">Selecione um evento para consultar seus diagnósticos.</p></div><span class="count-badge">{{events().total}}</span></div>
    @if(!events().items.length){<div class="empty">Nenhum evento neste período.</div>}
    @for(e of events().items;track e.id){<details class="event"><summary><span>{{e.occurredAt|date:'dd/MM/yyyy HH:mm:ss'}}</span><span class="environment">{{e.level}}</span><span>{{e.httpMethod}} {{e.endpoint || 'Sem endpoint'}}</span><span>{{e.httpStatus}}</span></summary><div class="event-body"><p>{{e.message}}</p><p><strong>Correlation ID:</strong> <code>{{e.correlationId || 'Não informado'}}</code></p><p><strong>Recebido em:</strong> {{e.receivedAt|date:'dd/MM/yyyy HH:mm:ss'}}</p><pre>{{e.stackTrace || 'Sem stack trace'}}</pre>@if(e.metadata){<pre>{{e.metadata|json}}</pre>}</div></details>}
    <div class="pagination"><span>Página {{page()}} · {{events().total}} eventos</span><div><button class="secondary" [disabled]="page()===1 || loading()" (click)="paginate(-1)">Anterior</button><button class="secondary" [disabled]="page()*20>=events().total || loading()" (click)="paginate(1)">Próxima</button></div></div>
  </section>}
`})
export class DetailComponent {
  private api=inject(Api);private route=inject(ActivatedRoute);private router=inject(Router);private destroy=inject(DestroyRef);
  refresh=new Subject<void>();filters=signal<Filters>({period:'24h',applicationId:'',environment:''});page=signal(1);detail=signal<Detail|null>(null);events=signal<Page<Event>>({items:[],total:0,page:1,pageSize:20});loading=signal(true);error=signal(false);saving=signal(false);saveError=signal(false);private id='';
  constructor(){this.route.queryParams.pipe(tap(p=>{this.filters.set(readFilters(p));this.page.set(Math.max(1,Number(p['page'])||1));this.id=this.route.snapshot.paramMap.get('id')!;this.detail.set(null);}),switchMap(()=>this.refresh.pipe(startWith(undefined),switchMap(()=>{this.loading.set(true);this.error.set(false);const f={...this.filters(),asOf:new Date().toISOString()};return forkJoin({detail:this.api.get<Detail>('/issues/'+this.id,f),events:this.api.get<Page<Event>>('/issues/'+this.id+'/events',{...f,page:this.page()})}).pipe(catchError(()=>{this.loading.set(false);this.error.set(true);return EMPTY;}));}))),takeUntilDestroyed(this.destroy)).subscribe(data=>{this.detail.set(data.detail);this.events.set(data.events);this.loading.set(false);});}
  period(period:string){void this.router.navigate([],{queryParams:{...this.filters(),period,page:1}});}
  paginate(delta:number){void this.router.navigate([],{queryParams:{...this.filters(),page:this.page()+delta}});}
  toggle(){const d=this.detail();if(!d)return;this.saving.set(true);this.saveError.set(false);this.api.status(d.id,d.status==='open'?'resolved':'open').pipe(takeUntilDestroyed(this.destroy)).subscribe({next:()=>{this.saving.set(false);this.refresh.next();},error:()=>{this.saving.set(false);this.saveError.set(true);}});}
}
