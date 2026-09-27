# Sentinela

Monorepo de monitoramento de erros: uma API NestJS recebe eventos e os agrupa no SQL Server; um dashboard Angular apresenta frequência, recência e variação de volume; outra API NestJS produz erros controlados.

## Início rápido

Pré-requisitos: Node.js **22.12+ da linha 22** (validado com 22.14.0), npm 10+, Docker Desktop iniciado com containers Linux e recursos para SQL Server (mínimo de 2 GB de RAM disponíveis para o banco; recomenda-se reservar 4 GB). Portas locais: 1433, 3000, 3001 e 4200.

Execute na raiz:

```powershell
npm ci
npm run env:generate
docker compose up -d --wait
npm run db:create
npm run migration:run
npm run seed
npm run dev
```

`env:generate` cria `.env` com senha forte e chave aleatória de 32 bytes, sem exibi-las. Não sobrescreve um arquivo existente. Alternativamente, use `Copy-Item .env.example .env` e substitua os dois valores de senha pelo mesmo segredo forte e a chave por um valor aleatório de pelo menos 32 caracteres. Nunca versione `.env`.

Abra **http://127.0.0.1:4200** e, em outro terminal, gere um erro:

```powershell
curl.exe -i http://127.0.0.1:3001/scenarios/integration
```

O HTTP 502 é intencional. Atualize o dashboard ou aguarde até 15 segundos. `IntegrationError` aparecerá como uma issue. Repetir a chamada aumenta sua contagem. Alterne entre 24 horas, 7 dias e 30 dias; abra a issue para ver stack, correlation ID e eventos e marque-a como resolvida. Uma nova ocorrência a reabre.

## Arquitetura e versões

```text
requisição → sentinela-test-api :3001
                 │ fila limitada + POST /events autenticado
                 ▼
           sentinela-api :3000 ── transação ── SQL Server :1433
                 ▲
                 │ /api (proxy de desenvolvimento)
           sentinela-web :4200
```

| Componente | Decisão |
| --- | --- |
| Organização | npm workspaces, uma pasta por aplicação, sem Nx/Turborepo |
| APIs | NestJS 11.2.6 + Express 5.1.0 |
| Frontend | Angular/CLI/build 21.2.24, standalone e zoneless |
| Linguagem | TypeScript 5.9.3 |
| Reatividade | RxJS 7.8.2 |
| Banco | SQL Server 2022 Developer, imagem `mcr.microsoft.com/mssql/server:2022-CU17-ubuntu-22.04` |
| Persistência | TypeORM 0.3.31, mssql 11.0.1; SQL parametrizado para consultas agregadas |
| Validação | class-validator 0.14.2 + class-transformer 0.5.1 |
| Testes | node:test via tsx 4.20.6 e Playwright 1.56.1 |
| Gráfico | SVG nativo, sem biblioteca de gráficos |

Versões diretas são exatas; `package-lock.json` fixa dependências transitivas. Angular 21 aceita Node 22.12+ e TypeScript 5.9 ([compatibilidade oficial](https://angular.dev/reference/versions)). NestJS 11 funciona em Node 20+ ([release oficial](https://github.com/nestjs/nest/releases/tag/v11.0.0)). Mantemos essas linhas para compatibilidade com o Node instalado, sem depender do CLI Nest mais recente.

As versões foram atualizadas dentro dessas linhas durante a validação para incorporar correções de segurança. O launcher Angular limita o build a dois workers por padrão; `NG_BUILD_MAX_WORKERS` permite ajustar esse limite em máquinas com mais memória.

`sentinela-api/src/db` contém a configuração, a migration inicial e o CLI. Não há sincronização automática nem migrations implícitas no startup. Consulte [migrations TypeORM](https://typeorm.io/docs/migrations/setup/) e [SQL Server em Docker](https://learn.microsoft.com/en-us/sql/linux/quickstart-install-connect-docker).

## Configuração e operação

| Variável | Uso |
| --- | --- |
| `MSSQL_SA_PASSWORD` | Senha inicial do SQL Server no container |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | Endereço e banco; padrões 127.0.0.1, 1433 e Sentinela |
| `DB_USER`, `DB_PASSWORD` | Login de desenvolvimento; senha deve corresponder à configurada no SQL Server |
| `DB_TRUST_CERTIFICATE` | `true` para o certificado local; conexão usa criptografia |
| `SENTINELA_API_PORT`, `TEST_API_PORT` | Portas das APIs; padrões 3000 e 3001 |
| `SENTINELA_URL` | Destino dos eventos enviados pela API de teste |
| `SENTINELA_INGESTION_KEY` | Credencial backend da aplicação de teste |
| `APPLICATION_ENVIRONMENT` | Ambiente reportado pela API monitorada; padrão development |

O frontend não lê o `.env`. Seu proxy aponta para a porta 3000 em `sentinela-web/proxy.conf.json`; ajuste esse destino se mudar a porta da API. O frontend envia consultas relativas a `/api`. Todas as aplicações e a porta Docker ficam vinculadas ao localhost. O MVP não tem login no dashboard: consultas e alteração de estado destinam-se a uso local.

`db:create` cria o banco apenas se ele não existir. `migration:run` aplica apenas migrations pendentes; `migration:revert` desfaz a última migration e **remove os dados das tabelas iniciais**. O seed cria a aplicação `sentinela-test-api` ou atualiza seu hash de chave, preservando seu ID e histórico. A chave original fica apenas no `.env` dos serviços. O banco armazena SHA-256 da chave aleatória.

O volume nomeado `sqlserver-data` persiste entre reinícios e `docker compose down`. Mudar a senha no `.env` não altera a senha de um banco já existente no volume. Não use `docker compose down -v` se quiser manter os dados.

Comandos individuais:

```powershell
npm run build
npm run start -w sentinela-api
npm run start -w sentinela-test-api
npm run dev -w sentinela-web
docker compose ps
docker compose stop
```

`npm run dev` compila as APIs inicialmente e inicia os três serviços com recompilação automática. O frontend de produção fica em `sentinela-web/dist/browser`; para servi-lo fora do dev server, configure fallback de SPA e proxy `/api` no servidor HTTP. Esse deploy está fora do MVP local.

## Modelo de dados

- **Applications**: UUID, nome, slug único, hash de chave único e criação em UTC.
- **Issues**: UUID, aplicação, ambiente, assinatura SHA-256 e versão, tipo, origem, mensagem representativa sanitizada, primeira/última ocorrência e estado `open`/`resolved`.
- **LogEvents**: UUID, aplicação, issue, ambiente, nível, tipo, mensagem, stack, ocorrência, recebimento, endpoint, método/status HTTP, correlation ID e metadados opcionais.

Datas são `datetime2(3)` em UTC. O cliente SQL usa UTC e a API devolve ISO 8601 com `Z`; o browser apresenta o fuso local. Metadados usam `nvarchar(max)` com restrição `ISJSON`. Há FKs e restrições de nível, estado e status HTTP. Índices cobrem aplicação/ambiente/período, período global, issue/período e primeira/última ocorrência. A restrição única de aplicação/ambiente/assinatura protege o agrupamento.

## Contrato de `POST /events`

Headers: `Content-Type: application/json` e `X-Application-Key: <chave backend>`. A aplicação é determinada pela chave, nunca por um campo do payload.

```json
{
  "environment": "development",
  "level": "error",
  "type": "IntegrationError",
  "message": "Falha ao consultar serviço externo",
  "occurredAt": "2026-09-27T12:00:00.000Z",
  "origin": "IntegrationService.fetch",
  "stackTrace": "IntegrationError: Falha ao consultar serviço externo\n    at fetch (integration.ts:10:2)",
  "endpoint": "/scenarios/integration",
  "httpMethod": "GET",
  "httpStatus": 502,
  "correlationId": "b522644a-1f02-456a-b6e2-ac5dd09fd609",
  "metadata": { "scenario": "integration" }
}
```

Obrigatórios: `environment`, `level`, `type`, `message`, `occurredAt`. Timezone explícito é obrigatório (`Z` ou offset). Campos desconhecidos são rejeitados. Limites: ambiente 60 caracteres alfanuméricos/`_.-`; tipo 120; mensagem 8.000; origem 500; stack 32.000; endpoint 1.000; correlation ID 100 caracteres alfanuméricos/`_.-`; status HTTP 100–599. O payload completo tem limite de 256 KB.

O contrato reserva `trace`, `debug`, `info`, `warn`, `error`, `fatal`; **apenas error e fatal são aceitos no MVP**. Resposta de sucesso `201`:

```json
{ "eventId": "UUID", "issueId": "UUID" }
```

Erros: `400` por validação/JSON inválido, `401` por chave ausente/inválida, `413` por tamanho, `500` por indisponibilidade. Respostas não ecoam payloads, segredos ou erros internos.

Exemplo direto em PowerShell, sem imprimir a chave:

```powershell
$keyLine = Get-Content .env | Where-Object { $_.StartsWith('SENTINELA_INGESTION_KEY=') }
$ingestionKey = $keyLine.Substring('SENTINELA_INGESTION_KEY='.Length)
$event = @{
  environment = 'development'
  level = 'error'
  type = 'ExampleError'
  message = 'Falha controlada no pedido 123'
  origin = 'Example.run'
  occurredAt = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/events `
  -Headers @{ 'X-Application-Key' = $ingestionKey } -ContentType application/json -Body $event
```

### Sanitização e agrupamento

A API não registra headers ou payloads. Remove valores exatos da chave recebida e das credenciais locais conhecidas dos campos textuais; também mascara Bearer, JWT, atribuições reconhecíveis de senha/token/secret/cookie/chave, credenciais em URLs e query strings em URLs/endpoint. Metadados permitem somente `scenario`, `service`, `operation`, `code`, `durationMs`, `retryCount`, `version`, com valores escalares; strings limitadas a 500 caracteres. Outros campos, objetos e arrays são descartados. Não envie corpos de requisição, headers completos ou dados pessoais.

**Texto livre deve ser sanitizado na origem.** Nenhuma expressão regular reconhece todo segredo arbitrário; os mecanismos acima são defesa adicional, não autorização para enviar informações sensíveis.

Assinatura v1: SHA-256 do array JSON `[1, applicationId, environment, type, origemNormalizada]`, com UUID da aplicação em minúsculas. Usa `origin` quando informado; senão o primeiro frame `at ...` da stack que não seja `node:` ou `node_modules`; sem frame, usa mensagem normalizada. A origem remove diretórios absolutos, linhas/colunas e espaços repetidos. O fallback substitui UUIDs, datas ISO, números hexadecimais `0x...` e números isolados por marcadores. A origem/fallback tem limite de 500 caracteres.

Mensagens diferentes da mesma origem/tipo pertencem à mesma issue. Frames minificados, funções com nomes iguais e normalização de números podem agrupar erros excessivamente; mudanças de nomes podem separar o mesmo problema. Prefira `origin` explícito e estável. Não há IA, source maps nem idempotência de eventos no MVP: cada envio aceito conta como nova ocorrência.

Uma transação serializável usa lock de atualização e restrição única para criar/associar a issue e inserir o evento. Conflitos de unicidade/deadlock são repetidos até três tentativas. Datas fora de ordem atualizam mínimo/máximo; qualquer nova ocorrência reabre issue resolvida.

## Consultas e análise

Filtros comuns: `period=24h|7d|30d` (padrão 24h), `applicationId`, `environment` e `asOf` ISO com timezone (padrão agora). UUIDs, enumerações e paginação inválidos retornam 400. O dashboard envia o mesmo `asOf` a suas consultas para manter as janelas alinhadas.

| Método / endpoint | Resultado |
| --- | --- |
| `GET /health` | Disponibilidade da API e banco |
| `GET /applications` | Catálogo de ID, nome e slug; nunca credenciais |
| `GET /environments` | Ambientes com eventos na janela e aplicação filtradas |
| `GET /dashboard/summary` | `occurrences`, `distinctIssues`, `newIssues`, `affectedApplications`, `growth`, `start`, `end` |
| `GET /dashboard/timeseries` | `buckets: [{at,count}]`, incluindo zeros, e limites da janela |
| `GET /issues` | `{items,total,page,pageSize}`; `sort=count|lastOccurredAt`, `order=asc|desc` |
| `GET /issues/:id` | Issue e `representativeEvent` mais recente da janela; `periodCount` |
| `GET /issues/:id/events` | Eventos paginados, mais recentes primeiro |
| `PATCH /issues/:id/status` | Corpo `{ "status": "open" }` ou `{ "status": "resolved" }` |

Exemplo: `GET /issues?period=7d&environment=development&sort=count&order=desc&page=1&pageSize=20`.

Janelas são contínuas, UTC e semiabertas **[asOf − duração, asOf)**, calculadas por `occurredAt`, não por recebimento. 7/30 dias significam 168/720 horas, sem ajuste por calendário local. Série tem 24 buckets horários ou 7/30 buckets diários, ancorados no início da janela. Eventos futuros só entram quando alcançados pela janela.

**Issue nova**: primeira ocorrência global dentro da janela. Uma issue antiga reaberta não é nova. Contagens e ordenação de recência consideram eventos filtrados; primeira/última ocorrência e estado da issue são globais. O detalhe preserva esses dados mesmo quando não existem eventos no período. Catálogo de aplicações e alteração de estado independem do período.

`growth` contém `current`, `previous`, `percentage`, `increased` e `noPreviousOccurrences`. Comparação usa a janela anterior equivalente e os mesmos filtros. Percentual é `(atual − anterior) / anterior × 100`, arredondado a duas casas. Base zero produz `percentage: null`, nunca infinito. O dashboard sinaliza aumento quando atual > anterior; não há limiar estatístico. Issues com zero eventos atuais não aparecem na lista.

Paginação padrão 20, máximo 100, página entre 1 e 1.000.000. Desempate por ID. Resolução não apaga ocorrências nem as exclui dos indicadores.

## Cenários da API de teste

```powershell
curl.exe -i http://127.0.0.1:3001/scenarios/unexpected
curl.exe -i http://127.0.0.1:3001/scenarios/validation
curl.exe -i http://127.0.0.1:3001/scenarios/integration
curl.exe -i -H "X-Correlation-ID: demo-001" http://127.0.0.1:3001/scenarios/database
```

| Cenário | HTTP | Captura |
| --- | --- | --- |
| unexpected | 500 | Error não tratado capturado por filtro global |
| validation | 400 | Exceção de validação controlada capturada pelo filtro |
| integration | 502 | Erro tratado enviado explicitamente |
| database | 503 | Erro tratado enviado explicitamente |

O middleware valida ou gera `X-Correlation-ID`, retornado no header e JSON e incluído no evento. O filtro captura exceções do ciclo HTTP; não instala handlers para continuar processos após falhas fatais fora desse ciclo. Integração e banco são simulações sem dependências externas reais.

O sender usa fila em memória de até 100 eventos pendentes, um envio por vez e timeout de dois segundos. Rejeições HTTP/rede são absorvidas e contabilizadas internamente como descartes; não modificam a resposta original. Não há retry de rede ou fila durável: indisponibilidade, saturação e reinício podem perder eventos. Isso impede que o monitoramento derrube a aplicação monitorada.

## Testes e verificação

```powershell
npm test
npm run test:integration
npx playwright install chromium
npm run build
npm run test:e2e
```

- Unitários: DTOs, níveis, campos desconhecidos, sanitização, assinatura, períodos, crescimento e descarte seguro de envios.
- Integração: requer SQL Server disponível; cria banco temporário `Sentinela_test_<aleatório>`, aplica migrations duas vezes, testa HTTP, concorrência, rollback, filtros, limites temporais, paginação, sanitização, reabertura e API monitorada com Sentinela indisponível. Remove exclusivamente esse banco temporário ao terminar. Não limpa o banco de desenvolvimento.
- Browser: requer banco de desenvolvimento migrado e seed; inicia/reutiliza as três aplicações nas portas padrão. Gera eventos reais na aplicação de teste (que permanecem no banco), valida agrupamento, períodos, resolução/reabertura, e testa carregamento/vazio/erro/layout móvel com respostas controladas.

Relatório de execução desta entrega: ver `VERIFICATION.md`. Artefatos de falhas Playwright ficam em `test-results/` (ignorados pelo Git).

## Limitações do MVP

Uso local, sem autenticação de usuários, RBAC, rate limiting, retenção automática, alertas externos, SDK distribuído ou administração visual de aplicações. O cadastro inicial é feito pelo seed. SQL Server Developer destina-se a desenvolvimento/testes. O login `sa`, certificado local confiado e dashboard aberto são escolhas locais; uma implantação pública exige gestão de acesso e credenciais próprias. Não há IA. As regras de sanitização, normalização e entrega por melhor esforço estão descritas acima.
