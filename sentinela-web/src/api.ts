import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
export interface Filters {period:string;applicationId:string;environment:string;}
export interface Growth {current:number;previous:number;percentage:number|null;increased:boolean;noPreviousOccurrences:boolean;}
export interface Issue {id:string;applicationId:string;applicationName:string;environment:string;type:string;message:string;origin:string;firstOccurredAt:string;lastOccurredAt:string;status:'open'|'resolved';count:number;growth:Growth;}
export interface Event {id:string;message:string;stackTrace:string|null;occurredAt:string;receivedAt:string;level:string;endpoint:string|null;httpMethod:string|null;httpStatus:number|null;correlationId:string|null;metadata:Record<string,unknown>|null;}
export interface Detail extends Issue {representativeEvent:Event|null;periodCount:number;}
export interface Page<T> {items:T[];total:number;page:number;pageSize:number;}
export interface Summary {occurrences:number;distinctIssues:number;newIssues:number;affectedApplications:number;growth:Growth;}
export interface Series {buckets:{at:string;count:number}[];}
@Injectable({providedIn:'root'}) export class Api {
  private http=inject(HttpClient);
  get<T>(path:string,values:Record<string,string|number>={}) {
    let params=new HttpParams();
    for(const [key,value] of Object.entries(values)) if(value!=='') params=params.set(key,value);
    return this.http.get<T>('/api'+path,{params});
  }
  status(id:string,status:'open'|'resolved') {return this.http.patch('/api/issues/'+id+'/status',{status});}
}
export function readFilters(params:Record<string,string>):Filters {
  return {period:['24h','7d','30d'].includes(params['period'])?params['period']:'24h',applicationId:params['applicationId']||'',environment:params['environment']||''};
}
export function describeGrowth(g:Growth):string {
  if(g.noPreviousOccurrences) return g.current?'Sem ocorrências no período anterior':'Sem variação';
  return `${g.percentage!>0?'+':''}${g.percentage}% vs. período anterior`;
}
