# Equipe, contexto e indicadores — 22/10/2026

Implementação dos seis itens de prioridade alta da auditoria, com acabamento dos textos, estados sem dados, hierarquia e acesso pelo teclado.

## Comportamento entregue

- **Equipe:** cards de colaboradores e ex-colaboradores priorizam empresa, cargo, gestor, área, vínculo e quantidade de prazos vencidos. Os badges de perfil, estágio e data de teste permanecem nos registros de candidatos. Seleção em lote de estágio exclui colaboradores, inclusive na visualização mista.
- **Ficha:** resumo operacional antes da interpretação comportamental, que fica em seção recolhida. Informação ausente aparece como não informada. Admissão usa data de calendário, sem deslocamento por fuso.
- **Jornada:** seção chamada “Onboarding e desenvolvimento”, com orientação para encontrar horários, ponto e banco de horas em DP → Jornada de trabalho. URLs e dados históricos são preservados.
- **Visão geral:** convites repetidos são deduplicados por empresa, vaga e e-mail, mantendo o lembrete mais recente. Alertas com mais de 90 dias aparecem em seção de revisão; prazos ativos vencidos continuam na lista principal. Não se encerra nem exclui nenhum registro. A amostra é limitada aos dados já carregados, com até 30 convites consultados e 10 alertas por seção. Idades desconhecidas não aparecem como zero; atrasos disponíveis usam diferença de dias de calendário.
- **Empresa ativa:** contexto aparece no painel; telas globais indicam administração da plataforma. Formulários de cargos e vagas identificam a empresa de destino, e a ficha identifica a empresa do registro. Esses avisos não alteram nem substituem a autorização dos endpoints.
- **Indicadores:** explicações locais de aderência (0–10), HR Score (0–100), atenção (nível ou 0–100) e base da média de HR Score. O badge numérico usa a cor do score, com atenção indicada separadamente pelo ícone. Ausência de dados e valores padrão são explicitados. Fórmulas não foram alteradas.

## Dados e escopo

Uma leitura em lote por página carrega relações existentes de candidatos, cargos, áreas e gestores, preservando a chave da empresa em cada relação. Contagem de prazos considera itens pendentes de PDI ativo, check-ins de onboarding pendentes e cursos ativos ainda não concluídos. Não significa ausência de todas as possíveis pendências do sistema.

Não há migration, cadastro novo nem alteração de dados existentes. A listagem continua baseada nos registros de avaliação já usados pelo produto; esta entrega não a transforma em um novo cadastro de colaboradores únicos. Históricos de recrutamento continuam disponíveis na ficha.

## Validação

- 542 testes unitários; 78 verificações de segurança; 40 verificações offline.
- Build Next.js de produção concluído.
- 638 verificações HTTP reais no Next de produção com PostgreSQL/Redis locais: perfis, acessos negados, exportações, ficha, resumo operacional e SSR da equipe/visão geral.
- Ensaio SQL com rollback: cargo/gestor/empresa e prazos de PDI, onboarding e cursos; par candidato/empresa incorreto não retorna registro.
- Ensaio de atomicidade da ficha/DP/histórico aprovado.
- Prévia dos componentes reais no Chrome: apresentação ampla e estreita, sem transbordamento horizontal; seções comportamentais e de alertas antigos operadas por Enter; sem chaves de tradução expostas. Textos novos nos quatro idiomas do catálogo.

## Pendência observada fora destes seis itens

Um ensaio legado adicional de privacidade tem mocks desatualizados. Após adaptação temporária dos mocks, sua etapa de exclusão física de colaborador encontrou a FK `time_clock_person_history_candidate_id_fkey`. A adaptação temporária foi revertida. Esta entrega não altera a exclusão nem certifica esse fluxo; ele deve ser revisto preservando o histórico de ponto antes de liberar essa operação no beta.
