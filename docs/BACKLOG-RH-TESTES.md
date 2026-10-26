# Backlog RH — observações dos testes (Colaborador · Gestor/Direção · RH)

Fonte canônica: `30TEAM_Backlog_Consolidado_Observacoes.docx` (testes Maria + Duda: Colaborador, Gestor/Direção, RH). **Só** essas melhorias. Não misturar com o backlog de produto genérico (`docs/BACKLOG.md`).

## Como usar

| Ação | O que fazer |
|------|-------------|
| Implementar | Agente segue o prompt + aceite; depois **remove** o item (não riscar) |
| Em andamento | Mover para “Em andamento” com branch/PR |
| Decisão de produto | Parte 2: fechar os [pontos cruzados](#pontos-cruzados) antes de codar |

**Regra geral (recorrente nos testes):** telas mais limpas; menos texto explicativo redundante; títulos autoexplicativos; hierarquia visual consistente; ação principal óbvia.

**Ordem sugerida:** (1) bugs/correções objetivas → (2) limpeza visual e nomenclaturas → (3) ciclo de vida e permissões → (4) recrutamento e acesso → (5) PDI/OKR/1:1/avaliação → (6) dashboards e IA → (7) Benefícios, Clima, Remuneração, Sucessão.

---

## Parte 1 — Ajustes objetivos (baixa complexidade aparente)

Validar dependências técnicas antes de executar. IDs: `B-RH1-*`.

_(Parte 1 concluída: B-RH1-01…20 removidos após implementação.)_

---

## Parte 2 — Análise, regra de negócio e testes

IDs: `B-RH2-*`. Decisões em [`docs/RH2-decisions.md`](./RH2-decisions.md).

_(Entregues e removidos: B-RH2-01…11, 13–14, 16–20. **12 e 15 entregues.**)_

### B-RH2-12 — Pipeline configurável (entregue)

**Prompt:** Incluir etapa “Encaminhado para gestão” / “Análise da gestão”. Avaliar colunas Kanban configuráveis por empresa (renomear, reordenar DnD, novas etapas).

**Implementação:**
- `migrations/110_company_pipeline_stages.sql` — tabela `company_pipeline_stages` (stage_key, label_pt/en, sort_order, canonical_key, system, required, soft delete) + relaxa CHECK legada em `vacancy_candidates.pipeline_stage` / `assessments.pipeline_stage` (aceita slugs `c_*`).
- `lib/company/company-pipeline-stages.js` — lazy seed (8 defaults na 1ª leitura), CRUD, reorder DnD, delete com guard `count > 0` + guard required, helpers `canonicalStageJoinSql` / `canonicalStageExprSql` p/ reports.
- APIs `app/api/admin/pipeline-stages/*` (list/create/update/delete/reorder) — cap `VACANCIES_MANAGE` (admin/direction/hr).
- Move de candidato (`app/api/admin/vacancies/[id]/candidates/[candidateId]/route.js`) resolve stage via `company_pipeline_stages`; hire/reject especiais disparam por `canonical_key`.
- Reports canônicos: `overview-metrics.js`, `hire.js`, `manager-weekly-digest.js`, `vacancy-report.js`, `assessment-filters.js` agregam via `LEFT JOIN company_pipeline_stages` + `COALESCE(canonical_key, pipeline_stage)`.
- UI: `PipelineStagesEditor.jsx` como `CollapsibleBlock` acima do Kanban dentro do detail da vaga (sub-tab pipeline). Kanban lê stages via `/api/admin/pipeline-stages` e usa cores por canonical.
- i18n pt-BR+en em `panel.pipelineEditor.*` + `errors.PIPELINE_STAGE_*` + `panel.help.pipelineStep9`.

**Aceite (fechado):** ver `docs/RH2-decisions.md` § B-RH2-12.

**Origem:** Duda/Gestor pp.8 e 11.

---

## Pontos cruzados

Fechados em [`docs/RH2-decisions.md`](./RH2-decisions.md) (ciclo de vida, perfis, fronteiras de módulos, UI, IA, auditoria).

---

## Notas

- Este markdown: Parte 1 concluída; Parte 2 entregue integralmente. Anexos visuais ficam no `.docx`.
- Motivadores (B-RH2-20): após deploy, republicar copy com `npm run db:seed-motivators-all` (desativa chaves antigas; não apaga tentativas).
- Constantes de domínio (ondas 1–3): `lib/domain-status.js` + `ROLES` em `permissions.js`. Sem schema. **B-RH2-12** entregue (`migrations/110`, `lib/company/company-pipeline-stages.js`, editor no detail da vaga).
- B-RH2-15 entregue: avaliação formal por competências (`migrations/108`, Avaliações → Competências, `/formal-review/[token]`).
