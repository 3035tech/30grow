# Verificação do RH no navegador em 29 de setembro de 2026

Resultado inicial: revisão administrativa com pendências. Os quatro grupos de achados abaixo receberam correções locais e validação de regressão, documentadas ao final. Isso não equivale à homologação integral do documento do RH nem à publicação das correções em produção.

## Base e ambiente

- Especificação: `/Users/thomasmetz/Downloads/30TEAM_Prompt_Consolidado_Revisao_Visual_e_Funcional.docx.md`, especialmente requisitos 2–9. Foi lido o texto da especificação; as imagens incorporadas não foram usadas como prova de aceite visual.
- Complementos: `docs/BACKLOG-RH-TESTES.md`, `docs/RH2-decisions.md` e relatórios de P0–P3/OKRs de 25–26/09.
- Repositório: `main`, commit `f89fabac04e32e34befaca067b98900e605924ac`, limpo no início. O SHA efetivamente publicado não foi verificado.
- Navegador: Chrome, sessão existente em `https://team.3035service.com`, usuário **Admin Eval 20**, empresa **Eval 20 Funcionários**, ID 16. Os resultados não certificam separadamente `30grow.com`.
- Método: interação real com menus, abas, seletores, formulários e teclado; leitura da árvore de acessibilidade/DOM e inspeção de capturas. Nenhuma suíte automatizada anterior foi contabilizada como executada hoje.
- Escritas de negócio: nenhuma submissão de formulário, upload, envio de convite, interpretação por IA, publicação, exclusão ou encerramento. Valores experimentais foram cancelados. Sem mudanças em código de aplicação, migrations ou deploy.

## Problemas reproduzidos

### RH-BROWSER-01 — Pesos existentes não aparecem na edição do cargo

**Prioridade alta. Requisito 7.1.**

1. Abrir **Cargos**, na empresa 16.
2. No cargo **Analista de Produto**, a lista informa **4 tipos com peso**.
3. Abrir **Ver**: o detalhe informa `1 2%, 3 2%, 5 3%, 6 1%`.
4. Fechar e abrir **Editar**: todos os nove sliders e campos numéricos aparecem em **0**; o total é **0%**.
5. Cancelar e reabrir: a divergência permanece.

Impacto confirmado: o formulário não representa os pesos existentes. Não foi testado salvar, portanto não se afirma que ocorreu perda de dados. A edição deve ser corrigida antes de homologar preservação dos pesos.

O controle em si sincroniza corretamente: digitar 37 no campo T1 atualizou o slider e o total para 37; a alteração foi cancelada. A descrição do cargo permaneceu preenchida.

Indício no código local: `RubricEditor.jsx` lê apenas chaves `T1`–`T9`; `JobRolesAdminTab.jsx` copia a rubrica recebida ao abrir o editor e o detalhe enumera suas chaves. `lib/recruiting/job-roles.js` também normaliza apenas `T1`–`T9`. Isso é compatível com uma divergência de formato legado, mas o payload/banco publicado não foi inspecionado. A correção precisa preservar a semântica dos pesos existentes.

### RH-BROWSER-02 — Escape na busca de gestor fecha o perfil inteiro

**Prioridade média. Requisitos 3.2 e 9, teclado/navegação.**

1. **Equipe → Ana Beatriz Nogueira → Resumo**.
2. Expandir **Gestor direto**.
3. Abrir **Buscar gestor** e aguardar as opções.
4. Pressionar **Escape** dentro do campo.

Resultado: o perfil fecha e o usuário volta à lista da equipe; a URL perde `candidate` e `section`. Reproduzido duas vezes, incluindo uma verificação aguardando explicitamente a opção do gestor atual.

Esperado: fechar a lista de opções e manter o perfil/contexto aberto. Nenhum vínculo foi alterado.

Indício local: `AdminRichFormDrawer.jsx:64` fecha a sobreposição ao receber Escape; a verificação de sobreposição considera diálogos, mas a busca expõe uma lista de opções. Investigar a precedência do Escape entre seletor e perfil.

### RH-BROWSER-03 — Ciclo formal com catálogo vazio não orienta o próximo passo

**Prioridade média de usabilidade. Requisitos 2.4, 5.2 e 5.6.**

Na empresa 16, **Avaliações → Novo ciclo formal** apresenta o rótulo **Catálogo de competências** seguido de um grupo vazio, sem explicação nem atalho para cadastrar/importar competências. A aba **Competências** confirma que o catálogo está vazio e oferece **Nova competência** e **Adicionar competências de exemplo**.

Não é evidência de falha da API: o catálogo está vazio e não houve erro capturado. A lacuna é a falta de orientação dentro do fluxo do ciclo. Não foi tentada publicação nem afirmado bloqueio causado exclusivamente por esse estado.

### RH-BROWSER-04 — Simplificação e nomenclatura ainda incompletas

**Prioridade baixa. Requisitos 2.1–2.3 e 3.5.**

- Remuneração posiciona a ação depois do histórico, mas o botão continua **Registrar**, em vez de **Registrar remuneração**.
- Informações cadastrais ainda exibe texto de implementação: **canvas (mouse/touch)**, **traço PNG + auditoria**; o formulário de CPF diz **Guarde só dígitos; a máscara é só visual**.
- Cargos ainda apresenta **mesmo motor da Fit da vaga** e a descrição usa fonte serifada diferente da interface na amostra inspecionada.
- Vagas mantém breadcrumb **RECRUTAMENTO / VAGAS** em caixa alta e instrução sobre **API do IBGE**.
- Estilo mostra os cinco principais motivadores corretamente, mas conserva um bloco adicional **Top motivadores (resumo)** e várias explicações repetidas. A antiga aba foi removida; a observação aqui é de redundância de conteúdo, não de aba ainda existente.

## Cobertura por requisito

“Verificado” abaixo vale apenas para o comportamento descrito na coluna de evidência. Abrir um formulário não certifica sua persistência.

| Requisito | Evidência desta rodada | Resultado |
| --- | --- | --- |
| 3.1 Resumo | Aba no mesmo nível de 1:1, Feedback, Jornada, Remuneração e Informações cadastrais; Leitura integrada, departamento, gestor e ação IA presentes; sem os três cards antigos no início | Estrutura verificada; execução da IA não testada |
| 3.2 Departamento e gestor | Valor atual explícito; busca de gestor lista opções; ações de cadastro presentes para o administrador | Parcial; Escape falha; troca/persistência não testadas |
| 3.3 Separação 1:1 e feedback | 1:1 exibe registro e histórico; Feedback contínuo tem aba própria; não há aba Top motivadores | Navegação verificada; criação e envio não testados |
| 3.4 Jornada | Check-ins contratação e Check-ins pós-contratação presentes, com D30/D60/D90 e ações; resultados de avaliações e PDI separados | Estrutura e leitura verificadas |
| 3.5 Remuneração | Estado sem histórico precede ação de registro; benefícios separados | Parcial; rótulo Registrar diverge do solicitado |
| 3.6 Ficha | Grupos Pessoal, Contato, Profissional, Dependentes e Emergência; idade calculada exibida; ausência do card DP leve; editor abre com valores | Leitura/abertura verificadas; validações e persistência não certificadas |
| 3.6 Dependentes | Sim revela Nome, CPF, Parentesco, Nascimento e ações Adicionar/Remover; cancelamento funciona | Estado condicional verificado; gravação não testada |
| 3.7 Vínculo | CLT, Estágio, Cooperado e PJ disponíveis; escolher CLT revela Data de vigência e desabilita Salvar até informá-la; cancelar mantém formato anterior | Comportamento do formulário verificado; histórico gravado não testado |
| 3.8 Documentos | Checklist e seis ações de anexo presentes na ficha | Upload/download JPG/JPEG/PDF e recuperação de erro não testados |
| 3.9 Motivadores | Mapa seguido de cinco resultados: 69, 68, 66, 57 e 57, com nomes, explicações e ajuda de ordenação | Apresentação verificada; cálculo independente não reexecutado |
| 3.10 Cadastro consolidado | Sem aba Cadastro; Dados de recrutamento presentes em Informações cadastrais; editor de recrutamento abriu com campos preenchidos | Navegação verificada; links antigos não testados |
| 4.1 Origem | Card Origem (UTM/ref) ausente da lista e das cinco seções inspecionadas da vaga aberta | Remoção visual verificada; preservação no banco não auditada |
| 4.2 Editar vaga | Abertura e cancelamento em Pipeline, Candidatos, Informações, Divulgação e Configurações, tanto na vaga aberta #22 quanto na fechada #21; título preenchido em todas | 10 combinações verificadas, sem travamento; salvar/erro de API não testados |
| 5.1 Abas de avaliações | Avaliações, Competências e 9-Box; PDI separado no menu | Verificado; menu Avaliações de Desempenho e título Avaliações ainda usam versões distintas do nome |
| 5.2 Ciclos | Formulário com título, descrição, início/fim, catálogo, instruções, escala e perguntas dissertativas | Abertura verificada; nenhum ciclo existente; ciclo completo não testado |
| 5.3 Modalidades | Seletor oferece 90°, 180° e 360°; troca para 360° funciona no rascunho | Matriz de respondentes e entregas de questionários não testadas |
| 5.4 Autoavaliação | Checkbox independente no ciclo; competência tem texto em terceira pessoa e texto em primeira pessoa | Campos verificados; geração/revisão e respostas não testadas |
| 5.5 Resultados e PDI | Jornada mostra Resultados de avaliações separado do PDI, em estado vazio | Estado vazio verificado; detalhe e criação de PDI a partir do resultado não testados |
| 5.6–5.7 Catálogo | Busca, Nova competência, Gerenciar categorias e Adicionar competências de exemplo disponíveis; formulários/estado vazio abrem | Estrutura verificada; catálogo vazio; CRUD, exemplos e snapshots históricos não testados |
| 6.1 9-Box | Nove células com combinações explícitas, Potencial vertical e Desempenho horizontal; legenda abre com Enter; 27 pessoas posicionadas | Apresentação e teclado verificados; preservação dos cálculos não auditada |
| 7.1 Cargos | Rótulos T1–T9 com nome, %, slider/número sincronizados e regra de pesos independentes | Reprovado para reabertura de pesos existentes, RH-BROWSER-01 |
| 8.1 OKRs | Ciclo/período/status; áreas Tecnologia, RH e Comercial; formulário Novo objetivo com responsável e prazo; estado Sem medição; duas atividades antigas preservadas em bloco separado | Estrutura verificada; nenhuma medição/KR novo existente na amostra; CRUD/histórico/fechamento não testados |
| 2 e 9 Visual/responsividade | Capturas desktop de Resumo, editor de vaga, cargo e 9-Box; capturas móveis de 9-Box, OKRs, ficha e editor da ficha | Amostra sem transbordamento horizontal da página; observações de texto/tipografia acima |
| Portal do colaborador | Acesso direto a /employee levou ao login e mensagem de sessão encerrada | Indisponível com a sessão atual; solicitado acesso de teste ao usuário |

## Limites da prova

- A sessão é administrativa. Não houve homologação das permissões de RH, gestor e colaborador separadamente.
- O override móvel solicitado foi 390 × 844; o navegador retornou largura CSS efetiva `innerWidth = 433` e `documentElement.scrollWidth = 416` nas leituras de 9-Box, OKRs e ficha. Portanto, as capturas comprovam a largura efetivamente observada, não uma certificação exata de 390 CSS px. O override foi restaurado.
- Não foi executada matriz claro/escuro, comparação completa PT/EN, teste de todos os breakpoints nem auditoria WCAG. Foi mantido o tema claro existente.
- O console capturado durante a navegação não apresentou entradas error/warn nas consultas feitas. Isso não substitui monitoramento de rede, prova de backend ou garantia de ausência de todos os erros.
- Persistência após salvar/recarregar, uploads, tratamento de falhas de API, integridade no banco e isolamento de empresa permanecem sem nova prova nesta rodada. Os testes locais antigos não foram reapresentados como homologação deste ambiente.

## Próxima validação necessária

Corrigir primeiro a leitura dos pesos legados e o Escape da busca; depois repetir os dois cenários. Para fechar a definição de pronto do RH, usar ambiente de teste identificado e sessões dos perfis relevantes para executar upload JPG/JPEG/PDF, edição com persistência e recuperação de falha, ciclo formal completo, resultado para PDI e OKR com KR/medição/histórico/encerramento. A visão do colaborador exige sessão própria de teste.

## Correções e regressão local — 29/09/2026

Ambiente: `http://localhost:3014`, PostgreSQL DTOV em `127.0.0.1:55432`, Redis DTOV, conta sintética RH Todos os Dados. Nenhuma escrita de negócio em produção e nenhum deploy executado nesta rodada.

| Achado | Correção | Prova nova |
| --- | --- | --- |
| RH-BROWSER-01 | Leitura e gravação aceitam chaves legadas `1`–`9` e retornam `T1`–`T9`, sem reescalonar os pesos. O cálculo de aderência aceita os dois formatos. | Cargo sintético #20 criado com `{1:2,3:2,5:3,6:1}`; editor mostra 2/2/3/1, total 8%. Salvar, recarregar e reabrir preservou os valores. Consulta ao banco confirmou `{T1:2,T3:2,T5:3,T6:1}`. Teste automatizado compara também a aderência e seu detalhamento. |
| RH-BROWSER-02 | Escape é tratado pelo seletor antes do perfil/diálogo; resposta assíncrona não reabre a lista. Foco volta ao campo antes do fechamento. | Perfil Ana Clara Mendes continuou aberto após Escape no campo, na opção Bruno e imediatamente após digitar Carla. A lista permaneceu fechada após concluir a busca. Nenhum gestor alterado. |
| RH-BROWSER-03 | Estado vazio com orientação e botão Ir para competências; a instrução também aparece no formulário de ciclo sem opções. | Botão abriu a aba Competências com ações Nova competência e Adicionar competências de exemplo. Novo ciclo exibiu a orientação. Nove competências sintéticas foram temporariamente desativadas, com IDs guardados, e todas restauradas ao estado ativo original. Nenhum ciclo criado. |
| RH-BROWSER-04 | Registrar remuneração; textos de CPF/assinatura/IA/cidade simplificados em PT/EN; fonte do editor alinhada; breadcrumb de vagas em caixa normal; menu Avaliações unificado; resumo duplicado de motivadores removido. | Navegador confirmou ação de remuneração, ajuda do CPF, orientação de assinatura, editor do cargo, menu Avaliações e cinco motivadores sem o bloco Top motivadores (resumo). Alterações de traduções e componentes revisadas; testes de clareza/consistência passaram. |

Validações executadas:

- 38 testes focados: rubricas legadas, sugestão de rubrica por IA, clareza P2 e consistência P3. Incluem precedência de zero explícito, pesos independentes, idempotência e preservação da aderência.
- 50 testes de segurança aprovados (`npm run test:security`).
- Alerta do CI reproduzido: `fast-uri@3.1.6` com vulnerabilidade alta. Atualização transitiva para `3.1.8`, compatível com o intervalo do AJV; somente versão, URL e integridade dessa entrada mudaram no `package-lock.json`. `npm audit --omit=dev --audit-level=high` retornou **0 vulnerabilidades, exit 0**. Referências: [authority injection](https://github.com/advisories/GHSA-qw65-cvwx-89v3) e [host confusion](https://github.com/advisories/GHSA-58mr-gqgx-xq4g).
- Harness DTOV: migrations conferidas e 16 probes do smoke aprovados, sem reset da base.
- Build de produção com webpack aprovado; `git diff --check` sem erros.
- Aviso adicional do React no gráfico de motivadores corrigido, separando `key` das propriedades espalhadas em `PeakDot`; nova abertura do gráfico sem repetição desse aviso. O navegador de desenvolvimento também registrou divergência de hidratação nos atributos `data-gr-*` injetados pela extensão Grammarly; não foi alterado o HTML da aplicação para ocultar o aviso da extensão.

Capturas locais: `/private/tmp/rh-cargo-pesos-preservados.png` e `/private/tmp/rh-avaliacoes-catalogo-vazio.png`. O cargo sintético de regressão foi mantido para reprodução. Não houve migration de aplicação nem alteração em massa de pesos; o formato legado é tratado na fronteira de leitura/gravação. Os limites da auditoria inicial (demais fluxos completos, perfis e matriz responsiva) continuam explícitos acima.
