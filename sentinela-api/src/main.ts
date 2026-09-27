import 'reflect-metadata';
import './config';
import { ArgumentsHost, BadRequestException, Body, CanActivate, Catch, Controller, ExecutionContext, ExceptionFilter, Get, HttpException, Inject, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { createSource } from './db/source';
import { EventDto, FilterDto, PageDto, StatusDto } from './contracts';
import { Store } from './store';
type AuthRequest = Request & { applicationId: string };
@Injectable()
class ApplicationGuard implements CanActivate {
  constructor(@Inject(Store) private readonly store: Store) {}
  async canActivate(context: ExecutionContext) {
    const req=context.switchToHttp().getRequest<AuthRequest>();
    req.applicationId=await this.store.authenticate(req.get('X-Application-Key'));
    return true;
  }
}
@Catch()
class SafeErrors implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const status=error instanceof HttpException?error.getStatus():error?.type==='entity.too.large'?413:error?.type==='entity.parse.failed'?400:500;
    const messages: Record<number,string>={400:'Requisição inválida',401:'Chave de aplicação inválida',404:'Não encontrado',413:'Payload excede 256 KB',500:'Serviço temporariamente indisponível'};
    host.switchToHttp().getResponse<Response>().status(status).json({statusCode:status,message:messages[status] || 'Não foi possível concluir a requisição'});
  }
}
@Controller()
class ApiController {
  constructor(@Inject(Store) private readonly store: Store) {}
  @Get('health') async health() { await this.store.applications(); return {status:'ok'}; }
  @Post('events') @UseGuards(ApplicationGuard)
  ingest(@Req() req: AuthRequest,@Body() event: EventDto) { return this.store.ingest(req.applicationId,event,req.get('X-Application-Key')); }
  @Get('applications') applications() { return this.store.applications(); }
  @Get('environments') environments(@Query() f: FilterDto) { return this.store.environments(f); }
  @Get('dashboard/summary') summary(@Query() f: FilterDto) { return this.store.summary(f); }
  @Get('dashboard/timeseries') series(@Query() f: FilterDto) { return this.store.timeseries(f); }
  @Get('issues') issues(@Query() f: PageDto) { return this.store.issues(f); }
  @Get('issues/:id') detail(@Param('id',ParseUUIDPipe) id: string,@Query() f: FilterDto) { return this.store.detail(id,f); }
  @Get('issues/:id/events') events(@Param('id',ParseUUIDPipe) id: string,@Query() f: PageDto) { return this.store.events(id,f); }
  @Patch('issues/:id/status') status(@Param('id',ParseUUIDPipe) id: string,@Body() body: StatusDto) { return this.store.status(id,body.status); }
}
@Module({controllers:[ApiController],providers:[Store,ApplicationGuard,{provide:DataSource,useFactory:async()=>createSource().initialize()}]})
class ApiModule {}
export async function bootstrap(port=Number(process.env.SENTINELA_API_PORT||3000)) {
  const app=await NestFactory.create(ApiModule,{bodyParser:false,logger:['error','warn'],abortOnError:false});
  app.use(json({limit:'256kb'}));
  app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true,
    exceptionFactory:()=>new BadRequestException(),validationError:{target:false,value:false}}));
  app.useGlobalFilters(new SafeErrors());
  app.enableShutdownHooks();
  await app.listen(port,'127.0.0.1');
  console.log(`Sentinela API em http://127.0.0.1:${port}`);
  return app;
}
if (require.main===module) bootstrap().catch(()=>{console.error('Não foi possível iniciar a API. Verifique o banco e as migrations.');process.exitCode=1;});
