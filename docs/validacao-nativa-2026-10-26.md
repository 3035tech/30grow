# Validação nativa — calendário, anexos, compartilhamento e acessibilidade

Estado: aguardando aparelhos físicos autorizados. Nenhum cenário abaixo foi certificado em hardware real nesta rodada.

## Base da validação

- App: commit `effd910645508ff1862e49fec883ccf7ae9854a6`, PR 3035tech/30team-app#2, CI aprovado.
- Ambiente: Dublin, `https://team.3035service.com`.
- Conta: seed Marina Costa, empresa App Colaborador (26). Não usar registros reais nem criar pedidos de ausência/férias.
- Simulador iOS 27 atualizado e aberto na rodada anterior; não constitui prova física.
- O único iPhone físico listado pelo CoreDevice é Virus (iPhone 15), anteriormente excluído pelo usuário. Nenhuma instalação ou interação foi feita nele.
- `adb` fora do PATH e SDK ausente no caminho padrão `~/Library/Android/sdk/platform-tools/adb`; aparelho Android ainda não identificado.
- Perfil EAS validation gera iOS de simulador e APK Android. O .app local de simulador não instala em iPhone. Antes de gerar build física, confirmar aparelho/perfil, destino Dublin e ausência de auto-submit.

## Execução e aceite

Para cada plataforma registrar modelo, versão do sistema, build/commit, versão do backend, resultado e captura ou gravação sem credenciais. Resultado permitido: aprovado, falhou, bloqueado ou não executado.

| Cenário | Aceite | iOS físico | Android físico |
| --- | --- | --- | --- |
| Abrir calendário | Um seletor por vez; data legível; sem sobreposição ou teclado indevido | Não executado | Não executado |
| Cancelar data | Alteração temporária descartada; valor original mantido | Não executado | Não executado |
| Confirmar data | Valor confirmado e formato corretos; reabrir conserva escolha | Não executado | Não executado |
| Intervalo invertido | Orientação junto ao campo, acessível; envio bloqueado; corrigir remove aviso | Não executado | Não executado |
| Voltar/fechar seletor | Cancelar, gesto/Voltar e troca de tela não deixam painel ou estado residual | Não executado | Não executado |
| Abrir foto demo | Preview sob demanda, proporção correta; fechar retorna ao aviso | Não executado | Não executado |
| Abrir arquivo demo | Nome/tamanho corretos; arquivo privado abre sem URL pública | Não executado | Não executado |
| Compartilhar | Folha nativa abre com arquivo correto; cancelar retorna ao app sem envio | Não executado | Não executado |
| Salvar cópia | Somente arquivo sintético, destino local escolhido; cópia abre corretamente | Não executado | Não executado |
| Interromper download | Sair/segundo plano/rede indisponível sem travar ou abrir arquivo tardio; retry explícito | Não executado | Não executado |
| Leitor de tela | VoiceOver/TalkBack: rótulos, valor/estado da data, ordem de foco e ações compreensíveis | Não executado | Não executado |
| Modal acessível | Foco entra no painel, fundo indisponível, fechamento devolve foco ao acionador | Não executado | Não executado |
| Fonte ampliada | Calendário, anexos e ações sem corte/sobreposição; controles alcançáveis | Não executado | Não executado |
| Reduzir movimento | Painel e navegação utilizáveis com preferência habilitada | Não executado | Não executado |
| Controles e contraste | Alvos de toque utilizáveis, estados sem depender apenas de cor; safe area preservada | Não executado | Não executado |

Compartilhamento será validado abrindo a folha nativa e cancelando; não enviar arquivos a terceiros. Não alterar preferência de acessibilidade do aparelho sem autorização; registrar valores anteriores e restaurá-los ao final quando autorizado.

## Bloqueios de entrada

1. Confirmar se o iPhone Virus pode ser usado ou conectar outro iPhone autorizado.
2. Identificar/conectar Android físico autorizado e disponibilizar depuração/controle quando necessário.
3. Disponibilizar builds físicas do commit validado, apontando para Dublin. Não iniciar distribuição em loja para executar esta matriz.

Apenas a inspeção de disponibilidade foi concluída. Não foram executados testes físicos, ativados leitores de tela, instaladas builds em hardware ou enviados arquivos.

## Preparação do iPhone pelo cabo

Usuário conectou o iPhone Virus e escolheu a equipe Fernanda Zerbin (7X74JSY374). CoreDevice reconhece iPhone 15 físico; app ainda não instalado. Expo autenticado, mas esse UDID não consta na lista EAS dessa equipe. Cadastro EAS exigiu login Apple; optado por compilação local via Xcode. Xcode sem conta e sem identidade válida de assinatura; janela Apple Accounts → Sign In aberta para autenticação do usuário, solicitada sem senha/código no chat.

Projeto nativo gerado somente no worktree isolado /private/tmp/30grow-app-community/ios (ignorado pelo Git); pod install concluído. Build Release arm64 iphoneos sem assinatura aprovada em /private/tmp/30grow-physical-derived/Build/Products/Release-iphoneos/30Grow.app. Bundle chamado pelo Xcode falhou em resolução Babel; compilação nativa concluída com SKIP_BUNDLING=1 e exportação Expo separada concluída com cache limpo. URL Dublin presente e host fictício ausente, conferidos no bundle. Log /private/tmp/30grow-physical-build.log. Não instalar artefato sem finalizar bundle, conferir URL/host fictício, provisionar e assinar com a equipe escolhida. Nenhuma validação física concluída até aqui.
