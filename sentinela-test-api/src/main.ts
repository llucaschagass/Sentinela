import 'reflect-metadata';
import { ArgumentsHost, BadRequestException, Catch, Controller, ExceptionFilter, Get, HttpException, Module, Req, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Request, Response, NextFunction } from 'express';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventSender } from './sender';
config({path:resolve(existsSync('.env.example')?'.':'..','.env'),quiet:true});
type CorrelatedRequest=Request & {correlationId:string};
let sender: EventSender;
function capture(req: CorrelatedRequest,error: Error,status: number,scenario: string) {
  // Only controlled diagnostics: never copy request bodies, headers, cookies or query parameters.
  sender.send({environment:process.env.APPLICATION_ENVIRONMENT||'development',level:'error',type:error.name,
    message:error.message,stackTrace:error.stack,occurredAt:new Date().toISOString(),origin:`Scenarios.${scenario}`,
    endpoint:req.path,httpMethod:req.method,httpStatus:status,correlationId:req.correlationId,metadata:{scenario}});
}
@Catch()
class CaptureFilter implements ExceptionFilter {
  catch(error: unknown,host: ArgumentsHost) {
    const req=host.switchToHttp().getRequest<CorrelatedRequest>();
    const response=host.switchToHttp().getResponse<Response>();
    const status=error instanceof HttpException?error.getStatus():500;
    const safeError=error instanceof Error?error:new Error('Erro inesperado');
    capture(req,safeError,status,req.path==='/scenarios/validation'?'validation':'unexpected');
    response.status(status).json({statusCode:status,message:status===400?'Falha de validação controlada':'Erro inesperado controlado',correlationId:req.correlationId});
  }
}
@Controller()
class Scenarios {
  @Get('health') health() { return {status:'ok'}; }
  @Get('scenarios/unexpected') unexpected() { throw new Error('Erro inesperado controlado'); }
  @Get('scenarios/validation') validation() { throw new BadRequestException('Campo obrigatório ausente no cenário de validação'); }
  @Get('scenarios/integration') integration(@Req() req: CorrelatedRequest,@Res() res: Response) {
    const error=new Error('Serviço de integração simulado indisponível'); error.name='IntegrationError';
    capture(req,error,502,'integration');
    return res.status(502).json({message:error.message,correlationId:req.correlationId});
  }
  @Get('scenarios/database') database(@Req() req: CorrelatedRequest,@Res() res: Response) {
    const error=new Error('Timeout simulado ao consultar banco'); error.name='DatabaseError';
    capture(req,error,503,'database');
    return res.status(503).json({message:error.message,correlationId:req.correlationId});
  }
}
@Module({controllers:[Scenarios]}) class TestModule {}
export async function bootstrap(port=Number(process.env.TEST_API_PORT||3001)) {
  const key=process.env.SENTINELA_INGESTION_KEY;
  if (!key || key.startsWith('CHANGE_ME') || key.length<32) throw new Error('Configure SENTINELA_INGESTION_KEY');
  sender=new EventSender(process.env.SENTINELA_URL||'http://127.0.0.1:3000',key);
  const app=await NestFactory.create(TestModule,{logger:['error','warn']});
  app.use((req:CorrelatedRequest,res:Response,next:NextFunction)=>{
    const candidate=req.get('X-Correlation-ID');
    req.correlationId=candidate && /^[a-zA-Z0-9_.-]{1,100}$/.test(candidate)?candidate:randomUUID();
    res.setHeader('X-Correlation-ID',req.correlationId);next();
  });
  app.useGlobalFilters(new CaptureFilter());
  app.enableShutdownHooks();
  await app.listen(port,'127.0.0.1');
  console.log(`API de teste em http://127.0.0.1:${port}`);
  return app;
}
if(require.main===module) bootstrap().catch(()=>{console.error('Não foi possível iniciar a API de teste. Confira o .env.');process.exitCode=1;});
