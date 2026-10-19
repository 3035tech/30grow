# Fechamento da versão de ponto — 18/10/2026

Status atual: correções locais de AFD/AEJ implementadas e testadas. Ver [correções, limitações e implantação](rep-layout-corrections.md). A liberação real permanece condicionada à migração 165, configuração e ensaios reais; períodos legados incompatíveis e regras fiscais sem suporte ficam bloqueados para exportação.

Status anterior: escopo de desenvolvimento congelado, validação local aprovada. Publicação e aceite do ambiente real pendentes. Não representa homologação legal nem confirmação de assinatura ICP-Brasil real.

## Versão e evidências

- Web: worktree `codex/rep-p-code-compliance`, base `86d6e03a42ffaaa04e154724e0dc9864707e3027`. Alterações ainda locais, sem commit/tag de release.
- App: worktree `codex/rep-p-mobile`, base `a6b9fc5`. Alterações ainda locais; nenhuma publicação OTA ou de loja.
- Build web passou após o último polish (`npm run build`).
- 95 testes focados passaram: certificado com material efêmero, S3/Secrets simulados, assinatura verificável, formatos, jornadas, banco de horas, contratos mobile, operações e avisos.
- 68 testes de segurança passaram (`npm run test:security`).
- Integração PostgreSQL descartável passou (`node --experimental-vm-modules --test test/rep/closing.test.js`): bootstrap até 164, fechamento, reabertura, concorrência, histórico, conciliação e fila simulada. Não executa contra produção.
- Gate estático passou com 164 migrations (`npm run db:validate-schema:static`).
- App: lint, TypeScript e 267 testes em 26 suítes passaram (`npm run validate`).
- `git diff --check` passou. Os resultados anteriores de navegador estão em `time-clock-evolution.md`; o último polish foi validado por build e testes, sem novo ensaio de navegador.

## Ordem de implantação

1. Identificar a imagem/revisão realmente ativa e registrar o destino de rollback. Confirmar backup recente e restaurável. O estado atual de produção não foi consultado com sucesso: sessão AWS expirada.
2. Criar commits revisáveis dos dois worktrees, excluindo o symlink local `node_modules` do app. Gerar imagem identificada pelo commit/digest; não publicar a partir de pasta temporária sem identificar sua revisão.
3. Em homologação, aplicar todas as migrations pendentes pelo runner canônico (`npm run db:migrate`), incluindo 160–165, e executar `npm run db:validate-schema` no mesmo banco. Repetir depois no ambiente de destino. Não presumir que apenas as cinco últimas estão pendentes.
4. A imagem runner atual não inclui `scripts/` e `migrations/`. Executar migração e rotina operacional de um checkout/artefato controlado com dependências e acesso autorizado; não presumir que esses comandos existem dentro do container web.
5. Configurar identidade REP do desenvolvedor, cadeia confiável e OpenSSL 3. Configurar referência privada do A1 no S3 e senha no Secrets Manager dedicado, com IAM restrito. Não colocar senha em código, documento de release ou conversa.
6. Validar o A1 real na tela de certificado e conferir titularidade, validade, cadeia e assinatura de comprovante/exportações. Nenhum desses testes reais foi realizado nesta versão.
7. Implantar a aplicação e validar saúde, autenticação e fluxos de empregado/RH. Substituir todos os processos antigos antes de ativar o novo worker.
8. Configurar a execução de `scripts/time-clock-maintenance.mjs` uma vez por minuto, com APP_URL/CRON_SECRET protegidos. Para observação NTP, permitir UDP/123 e executar no host efetivamente monitorado. O script observa, não sincroniza o relógio. Validar também a sincronização dos demais nós e banco.
9. Tratar o intervalo de transição da fila conforme `time-clock-evolution.md`: o código antigo pode ter enviado push imediato para notificações cujos jobs novos ainda estão pendentes. Não reenviar esse intervalo sem conferir.
10. Publicar o app somente após aceite em aparelho físico e confirmação de compatibilidade com o backend implantado.

## Aceite real ainda necessário

- Marcar ponto no portal e no app; obter comprovante e validar assinatura.
- Conferir jornada semanal, madrugada e 12×36 com dados de teste autorizados.
- Solicitar ajuste, aprovar no RH, fechar período, conferir espelho, contestar, reabrir e exportar; verificar bloqueios e conciliação.
- Verificar entrega e reenvio de push em aparelho opt-in, sem usar empregados reais como teste implícito.
- Conferir monitor operacional: certificado, falhas de assinatura, fila e medição recente de relógio.
- Confirmar mapeamento contábil do CSV `30grow-time-v2`.

## Rollback

Parar a rotina operacional antes de voltar à imagem anterior para impedir dois caminhos de push. Preservar migrations, originais, histórico e snapshots; não executar down migration ou restauração destrutiva automática. Validar previamente a imagem anterior contra o schema expandido: existem novas proteções e regras de dia lógico, portanto a compatibilidade de rollback não deve ser presumida apenas por as tabelas serem aditivas.

Referências: `rep-p-671.md`, `time-clock-evolution.md`, `../release-runbook.md`.


A imagem anterior não constitui rollback fiscal validado. Se for necessário utilizá-la, impedir exportações fiscais até haver imagem com as correções; não remover dados/migrations.
