import { Inject, Injectable, NotFoundException, OnApplicationShutdown, UnauthorizedException } from '@nestjs/common';
import { DataSource, MssqlParameter } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { EventDto, FilterDto, PageDto } from './contracts';
import { cleanEvent, fingerprint, growth, hashKey, windowFor } from './domain';
type Row = Record<string, any>;
@Injectable()
export class Store implements OnApplicationShutdown {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async onApplicationShutdown() { if (this.db.isInitialized) await this.db.destroy(); }
  async authenticate(key: string | undefined): Promise<string> {
    if (!key || key.length < 32 || key.length > 256) throw new UnauthorizedException();
    const rows = await this.db.query('SELECT id FROM Applications WHERE keyHash=@0', [hashKey(key)]);
    if (!rows.length) throw new UnauthorizedException();
    return rows[0].id;
  }
  async ingest(applicationId: string, input: EventDto, key?: string) {
    const e = cleanEvent(input,[key,process.env.DB_PASSWORD,process.env.MSSQL_SA_PASSWORD,process.env.SENTINELA_INGESTION_KEY].filter((v): v is string=>Boolean(v)));
    const { signature, origin } = fingerprint(applicationId, e);
    for (let attempt=0; attempt<3; attempt++) {
      try {
        return await this.db.transaction('SERIALIZABLE', async manager => {
          const rows = await manager.query(`SELECT id FROM Issues WITH (UPDLOCK,HOLDLOCK)
            WHERE applicationId=@0 AND environment=@1 AND signature=@2`, [applicationId,e.environment,signature]);
          const issueId = rows[0]?.id || randomUUID();
          const occurredAt = new MssqlParameter(new Date(e.occurredAt),'datetime2',3);
          if (!rows.length) await manager.query(`INSERT INTO Issues
            (id,applicationId,environment,signature,signatureVersion,type,origin,message,firstOccurredAt,lastOccurredAt,status)
            VALUES(@0,@1,@2,@3,1,@4,@5,@6,@7,@7,'open')`,
            [issueId,applicationId,e.environment,signature,e.type,origin,e.message,occurredAt]);
          else await manager.query(`UPDATE Issues SET status='open',
            firstOccurredAt=CASE WHEN firstOccurredAt>@1 THEN @1 ELSE firstOccurredAt END,
            lastOccurredAt=CASE WHEN lastOccurredAt<@1 THEN @1 ELSE lastOccurredAt END WHERE id=@0`, [issueId,occurredAt]);
          const eventId = randomUUID();
          await manager.query(`INSERT INTO LogEvents
            (id,applicationId,issueId,environment,level,type,message,stackTrace,occurredAt,endpoint,httpMethod,httpStatus,correlationId,metadata)
            VALUES(@0,@1,@2,@3,@4,@5,@6,@7,@8,@9,@10,@11,@12,@13)`,
            [eventId,applicationId,issueId,e.environment,e.level,e.type,e.message,e.stackTrace ?? null,occurredAt,
              e.endpoint ?? null,e.httpMethod ?? null,e.httpStatus ?? null,e.correlationId ?? null,e.metadata ? JSON.stringify(e.metadata) : null]);
          return { eventId, issueId };
        });
      } catch (error: any) {
        const number = error?.driverError?.number ?? error?.driverError?.originalError?.info?.number;
        if (![1205,2601,2627].includes(number) || attempt===2) throw error;
        await new Promise(resolve => setTimeout(resolve, 20*(attempt+1)));
      }
    }
    throw new Error('Ingestão indisponível');
  }
  private scope(filter: FilterDto, alias='e') {
    const window = windowFor(filter);
    const params: unknown[] = [window.start,window.end,window.previous].map(value=>new MssqlParameter(value,'datetime2',3));
    let where = '1=1';
    if (filter.applicationId) { where += ` AND ${alias}.applicationId=@${params.length}`; params.push(filter.applicationId); }
    if (filter.environment) { where += ` AND ${alias}.environment=@${params.length}`; params.push(filter.environment); }
    return { ...window, params, where };
  }
  async applications() { return this.db.query('SELECT id,name,slug FROM Applications ORDER BY name,id'); }
  async environments(f: FilterDto) {
    const s=this.scope(f);
    return (await this.db.query(`SELECT DISTINCT e.environment FROM LogEvents e WHERE ${s.where}
      AND e.occurredAt>=@0 AND e.occurredAt<@1 ORDER BY e.environment`,s.params)).map((r: Row)=>r.environment);
  }
  async summary(f: FilterDto) {
    const s=this.scope(f);
    const [r] = await this.db.query(`SELECT COUNT(*) occurrences,COUNT(DISTINCT e.issueId) distinctIssues,
      COUNT(DISTINCT CASE WHEN i.firstOccurredAt>=@0 AND i.firstOccurredAt<@1 THEN i.id END) newIssues,
      COUNT(DISTINCT e.applicationId) affectedApplications
      FROM LogEvents e JOIN Issues i ON i.id=e.issueId WHERE ${s.where} AND e.occurredAt>=@0 AND e.occurredAt<@1`,s.params);
    const [p] = await this.db.query(`SELECT COUNT(*) count FROM LogEvents e WHERE ${s.where} AND e.occurredAt>=@2 AND e.occurredAt<@0`,s.params);
    return { ...r, growth:growth(r.occurrences,p.count), start:s.start, end:s.end };
  }
  async timeseries(f: FilterDto) {
    const s=this.scope(f);
    const minutes=f.period==='24h'?60:1440;
    const bucket=`CAST(DATEDIFF_BIG(millisecond,@0,e.occurredAt)/${minutes*60000} AS int)`;
    const rows: Row[] = await this.db.query(`SELECT ${bucket} bucket,COUNT(*) count
      FROM LogEvents e WHERE ${s.where} AND e.occurredAt>=@0 AND e.occurredAt<@1
      GROUP BY ${bucket}`,s.params);
    const counts = new Map(rows.map(r=>[r.bucket,r.count]));
    return { start:s.start,end:s.end,buckets:Array.from({length:s.duration/(minutes*60000)},(_,index)=>({
      at:new Date(s.start.getTime()+index*minutes*60000),count:counts.get(index)||0,
    })) };
  }
  async issues(f: PageDto) {
    const s=this.scope(f);
    const cte=`WITH counts AS (SELECT e.issueId,
      SUM(CASE WHEN e.occurredAt>=@0 THEN 1 ELSE 0 END) count,
      SUM(CASE WHEN e.occurredAt<@0 THEN 1 ELSE 0 END) previousCount,
      MAX(CASE WHEN e.occurredAt>=@0 THEN e.occurredAt END) periodLastOccurredAt
      FROM LogEvents e WHERE ${s.where} AND e.occurredAt>=@2 AND e.occurredAt<@1 GROUP BY e.issueId)
      `;
    const [total] = await this.db.query(cte+'SELECT COUNT(*) total FROM counts WHERE count>0',s.params);
    const offsetIndex=s.params.length;
    const items: Row[] = await this.db.query(cte+`SELECT i.*,a.name applicationName,c.count,c.previousCount,c.periodLastOccurredAt
      FROM counts c JOIN Issues i ON i.id=c.issueId JOIN Applications a ON a.id=i.applicationId WHERE c.count>0
      ORDER BY ${f.sort==='count'?'c.count':'c.periodLastOccurredAt'} ${f.order==='asc'?'ASC':'DESC'},i.id
      OFFSET @${offsetIndex} ROWS FETCH NEXT @${offsetIndex+1} ROWS ONLY`,[...s.params,(f.page-1)*f.pageSize,f.pageSize]);
    return { items:items.map(r=>({...r,growth:growth(r.count,r.previousCount)})), total:total.total,page:f.page,pageSize:f.pageSize };
  }
  async detail(id: string, f: FilterDto) {
    const s=this.scope(f,'i');
    const rows=await this.db.query(`SELECT i.*,a.name applicationName FROM Issues i JOIN Applications a ON a.id=i.applicationId
      WHERE i.id=@${s.params.length} AND ${s.where}`,[...s.params,id]);
    if (!rows.length) throw new NotFoundException();
    const events=await this.events(id,Object.assign(new PageDto(),f,{page:1,pageSize:1}),false);
    return { ...rows[0], representativeEvent:events.items[0] || null, periodCount:events.total };
  }
  async events(id: string,f: PageDto,check=true) {
    const s=this.scope(f);
    if (check) {
      const found=await this.db.query('SELECT id FROM Issues WHERE id=@0',[id]);
      if (!found.length) throw new NotFoundException();
    }
    const index=s.params.length;
    const where=`${s.where} AND e.issueId=@${index} AND e.occurredAt>=@0 AND e.occurredAt<@1`;
    const params=[...s.params,id];
    const [total]=await this.db.query(`SELECT COUNT(*) total FROM LogEvents e WHERE ${where}`,params);
    const items: Row[]=await this.db.query(`SELECT e.* FROM LogEvents e WHERE ${where} ORDER BY e.occurredAt DESC,e.id
      OFFSET @${index+1} ROWS FETCH NEXT @${index+2} ROWS ONLY`,[...params,(f.page-1)*f.pageSize,f.pageSize]);
    return { items:items.map(r=>({...r,metadata:r.metadata?JSON.parse(r.metadata):null})),total:total.total,page:f.page,pageSize:f.pageSize };
  }
  async status(id: string,status: string) {
    const rows=await this.db.query('UPDATE Issues SET status=@1 OUTPUT inserted.id,inserted.status WHERE id=@0',[id,status]);
    if (!rows.length) throw new NotFoundException();
    return rows[0];
  }
}
