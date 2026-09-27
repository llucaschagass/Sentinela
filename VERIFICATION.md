# Verificação — 27/09/2026

**Resultado: MVP local validado e pronto para commit.** O bloqueio anterior de espaço em disco foi resolvido; todas as verificações abaixo foram efetivamente executadas.

| Verificação | Resultado |
| --- | --- |
| `docker compose up -d --wait` | SQL Server 2022 iniciado e saudável, com volume persistente |
| `npm run db:create` | Banco de desenvolvimento criado |
| `npm run migration:run` | Migration aplicada; segunda execução sem duplicação |
| `npm run seed` | Aplicação de teste cadastrada; execução repetida sem duplicação |
| Builds das três aplicações | Passaram; APIs recompiladas após os ajustes finais e frontend com dependências finais |
| `npm test` | **6/6 testes unitários passaram** |
| `npm run test:integration` | **8/8 testes com SQL Server passaram** |
| `npm run test:e2e` | **3/3 testes Playwright/Chromium passaram** |
| Auditoria npm completa | **0 vulnerabilidades** após atualizar dependências e lockfile |
| `npm ls --depth=0` | Dependências válidas, sem conflitos de peer dependencies |
| Busca pelos valores das credenciais locais | Nenhum encontrado nos arquivos revisáveis ou no bundle do frontend |

## Fluxo comprovado

- Subir as três aplicações e chamar a rota de integração retorna HTTP 502 intencional e gera uma issue no dashboard.
- Repetir o cenário aumenta as ocorrências do mesmo grupo.
- Alternar 24 horas, 7 dias e 30 dias mantém a issue visível e preserva filtros na navegação.
- Abrir o detalhe apresenta stack trace e o correlation ID da requisição original.
- Resolver a issue altera seu estado; uma nova ocorrência a reabre.
- Os quatro cenários (inesperado, validação, integração e banco) entregam exatamente um evento por requisição, com correlation ID e status HTTP corretos.
- Carregamento, vazio, falha recuperável e ausência de overflow horizontal em viewport móvel foram verificados no navegador.

## Cobertura de integração

Autenticação, validação, JSON inválido, limite de payload, remoção da chave recebida de texto livre, criação concorrente de uma issue, associação sem perda de ocorrências, rollback transacional, reabertura, paginação, separação por aplicação/ambiente/tipo, primeira ocorrência retroativa, comparação temporal, filtros e limites semiabertos dos três períodos, precisão de milissegundos e API monitorada funcionando com Sentinela indisponível.

Os testes criaram e removeram um banco temporário isolado. Eventos gerados pelos testes E2E permanecem no banco de desenvolvimento como exemplos.

## Correções durante a verificação

- Atualização para NestJS **11.2.6**, Angular/CLI/build **21.2.24**, TypeORM **0.3.31**, concurrently **9.2.4** e dependências transitivas corrigidas, mantendo Node 22.14.0 e TypeScript 5.9.3.
- UUIDs normalizados para minúsculas tanto na assinatura quanto nos resultados do driver SQL Server.
- Parâmetros `datetime2(3)` e buckets calculados em milissegundos para preservar eventos junto ao limite final da janela.
- Encerramento do pool de conexões com o shutdown da API.
- Limite padrão de dois workers no build Angular para reduzir consumo de memória enquanto Docker/SQL Server estão ativos.

## Commit e limitações

Versionar os fontes das três aplicações, testes, scripts, configurações, `package-lock.json`, README e este relatório. `.env`, `node_modules`, builds, cache Angular e resultados Playwright estão no `.gitignore`.

A pasta ainda não tem um repositório Git inicializado; nenhum commit foi criado. O resultado atesta o MVP **local**, com dashboard sem login e entrega de eventos por melhor esforço. Não representa validação de implantação pública, escala ou carga prolongada. As limitações estão detalhadas no README.
