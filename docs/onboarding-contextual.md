# Onboarding Contextual — Melhoria #1 (Sprint Quick Wins)

**Objetivo:** Reduzir abandono early-stage com ajuda contextual, progresso visível e tour guiado.

## Componentes Implementados

### 1. Sistema de Tooltips Contextuais

**Arquivo:** `app/_components/ContextualTooltip.jsx`

- Tooltips dismissíveis com tracking em `localStorage`
- Suporta "Não mostrar novamente"
- 4 posições: `top`, `bottom`, `left`, `right`
- Hook `useTooltipManager()` para gerenciamento avançado

**Uso:**

```jsx
import { ContextualTooltip } from '@/app/_components/ContextualTooltip';

<ContextualTooltip
  id="first-vacancy"
  title="Primeira vaga"
  message="Crie sua primeira vaga para começar a avaliar candidatos."
  position="bottom"
>
  <button>Criar Vaga</button>
</ContextualTooltip>
```

### 2. Checklist de Progresso

**Arquivos:**
- `app/_components/OnboardingChecklist.jsx` (UI)
- `lib/development/onboarding-progress.js` (lógica de tracking)

**7 tarefas críticas:**
1. Criar primeira vaga (20%)
2. Enviar assessment (20%)
3. Ver resultado (15%)
4. Mover no pipeline (15%)
5. Criar pesquisa de clima (10%)
6. Explorar Analytics (10%)
7. Convidar gestor (10%)

**Integração:**
- Aparece automaticamente no Overview quando progresso < 100%
- Colapsável e dismissível
- Clique na tarefa navega para a tab correspondente ("Criar primeira vaga" abre `?tab=vacancies&create=1`)
- Tarefas cuja aba o gestor não acessa (módulo desligado ou sem capability, ex.: "Convidar gestor" sem `users.manage`) ficam ocultas; o % é recalculado só com as tarefas visíveis (`canOpenTab` vindo de `canAccessDashboardTab`)

**SQL:** Verifica automaticamente conclusão via queries existentes (assessments, vacancies, climate_surveys, users, etc.)

### 3. Empty States Acionáveis

**Arquivo:** `app/_components/EmptyStateActionable.jsx`

**3 pré-configurados:**
- `EmptyVacancies` — CTA "Criar primeira vaga" + tips
- `EmptyCandidates` — CTA "Convidar pessoas" + tips
- `EmptyAnalytics` — Explicação de aguardando dados + preview

**Uso:**

```jsx
import { EmptyVacancies } from '@/app/_components/EmptyStateActionable';

{vacancies.length === 0 && (
  <EmptyVacancies
    onCreateVacancy={() => openVacancyDrawer()}
    onViewHelp={() => navigateTo('help')}
  />
)}
```

### 4. Tour Guiado Opcional

**Arquivo:** `app/_components/OnboardingTour.jsx`

**Steps (filtrados por `canAccessDashboardTab`):**
1. Overview — resumo do que precisa atenção
2. Vagas — pipeline kanban + rubricas (some se Recrutamento estiver desligado)
3. Equipe — perfis + compatibilidade + PDI
4. Ajuda — guia completo

**Flow:**
1. Modal de boas-vindas (auto após 1s no primeiro acesso)
2. Não abre junto com o wizard "Primeiros passos" nem na mesma sessão do navegador em que o wizard foi concluído (`sessionStorage` `team30_onboarding_wizard_done`); aparece na próxima visita
3. Usuário escolhe "Fazer tour" ou "Pular"
4. Tour com navegação automática entre tabs; fica montado ao trocar de aba (o `onboardingProgress` só vem no payload do Overview)
5. Marca como completo em `localStorage`

## Wizard "Primeiros passos" (`OnboardingWizard.jsx`)

- Saudação usa `display_name`; se vazio, o primeiro nome do cadastro (`signup_metadata.fullName`); sem nenhum, título genérico
- Passo "Crie sua primeira vaga" só aparece se Recrutamento estiver na seleção de módulos e o papel puder gerir vagas; o CTA abre `?tab=vacancies&create=1`
- Card "Convide seu time" só para quem tem `users.manage`: admin e o **criador da empresa** (`companies.signup_creator_user_id`, flag `companyOwner` na sessão). Os demais gestores veem só o card de link público, que abre o Guia em `helpSection=links`
- Passos "Objetivo" e "Módulos" só para quem pode gerir módulos (`canManageCompanyModules`: admin ou criador). `POST /api/admin/onboarding/complete` ignora `modules` dos demais; `PUT /api/me/company-modules` responde `FORBIDDEN` e o `GET` devolve `canEdit: false` (Meu perfil esconde o editor)
- "Guia completo" no passo final abre `helpSection=setupPath`
- Concluir com módulos alterados recarrega o painel para o menu refletir a seleção

## Criador da empresa

- Sessão (`hydrateSessionPayload`) traz `companyOwner` na mesma query de users × companies; `resolveCapabilities` concede `users.manage` ao criador não-admin
- Aba **Usuários** para o criador: sem papel `admin`, sem seletor/coluna de empresa (APIs já forçam o `company_id` da sessão); Leads, Auditoria, Feedback de produto e Empresas continuam só super admin
- Senha só por convite: gestor não-admin (criador ou RH com `users.manage`) não define senha de ninguém. `createUser({ allowPassword: false })` e `updateUser({ isAdmin: false })` recusam `password` com `PASSWORD_INVITE_ONLY` (403); a criação sempre envia o e-mail de definição de senha (`issuePasswordSetupInvite`; sem SMTP → `SMTP_NOT_CONFIGURED` 503). Colaborador já era só convite (`/api/admin/candidates/[id]/employee-access`). Super admin mantém a senha manual (suporte / ambiente sem SMTP)
- E-mail só pela própria pessoa: gestor não-admin não altera o e-mail de outro usuário (`updateUser` com `isAdmin: false` e `actorUserId` diferente → `EMAIL_CHANGE_SELF_ONLY` 403), porque trocar o e-mail e usar "Esqueci a senha" entregaria a conta. Em Usuários o campo fica bloqueado com dica; o próprio usuário troca em Meu perfil (ou na própria linha). E-mail digitado errado: desativar e convidar de novo. Super admin mantém a troca para suporte
- Colaborador: quando o gestor troca o e-mail corporativo (`PATCH /api/admin/candidates/[id]`), `revokeEmployeeAccessForEmailChange` zera `password_hash` e o token de definição e incrementa `session_version` na mesma transação; depois do commit, `finishEmployeeEmailChange` atualiza o cache de sessão e, se a pessoa tinha acesso ao portal, envia o convite de senha ao e-mail novo. A resposta traz `portalAccessReset: { inviteSent }` e a auditoria `candidate.email_change` registra `portalAccessReset` / `inviteSent`. Assim, trocar o e-mail não reaproveita a senha antiga e derruba sessões abertas
- Origem (selo em Usuários / Leads, `resolveUserOrigin`): o fallback "empresa criada por signup" vale só para o próprio criador (`isCompanySignupCreator`); gestores que ele convida aparecem como **Painel**. Empresa sem `signup_creator_user_id` (legado) mantém o comportamento antigo
- Gestor não-admin nunca lista, edita, desativa nem reenvia convite de usuário `admin`, mesmo vinculado à própria empresa (`assertUserInScope` em `lib/identity/users-admin-scope.js` + filtro em `listUsers`)
- Outras rotas abertas por `users.manage`: recálculo do HR Score usa sempre o `company_id` da sessão para não-admin; métricas de cache do HR Score (`/api/admin/hr-score/cache-metrics`) só super admin; módulos via `/api/admin/company-modules` ficam na empresa da sessão (`withAdminApi`)
- Portal do colaborador (`/employee`, card de boas-vindas) usa sessão própria (`team30_employee_session`) e não passa por `resolveCapabilities`: a mudança não o afeta

## Visão geral sem Recrutamento

- `OverviewTab` usa `canOpenTab('vacancies')`: sem acesso, some o card de vagas, o CTA "Ver vagas" do estado vazio de Atenção (vira "Ver time") e itens de Atenção que apontam para vagas deixam de ser clicáveis

**Admin:** `resetTour()` para limpar estado (testing)

## Integração no Dashboard

**`app/dashboard/load-dashboard-data.js`:**
- Busca `onboardingProgress` quando `needOverview && !isAdmin && companyId`
- Adiciona ao retorno → `DashboardClient` → `OverviewTab`

**`app/dashboard/DashboardClient.jsx`:**
- Prop `onboardingProgress` passada para `OverviewTab`
- `<OnboardingTour />` renderizado no root quando progresso < 100%
- IDs `#overview-tab`, `#vagas-tab`, etc. adicionados aos `NavLink` para tour spotlight

**`app/dashboard/tabs/OverviewTab.jsx`:**
- `<OnboardingChecklist />` aparece antes do `TeamBehavioralIntelBlock` quando progresso < 100%

## Performance

- Checklist: 7 queries paralelas (EXISTS), rápidas (índices existentes)
- Tour: sem overhead, localStorage puro
- Tooltips: localStorage, zero network
- Onboarding progress é calculado **apenas** no SSR do Overview (não em toda tab)

## UX Guidelines

1. **Tooltips:** usar em CTAs críticos da primeira sessão (ex: "Criar primeira vaga", "Enviar convite")
2. **Checklist:** não esconder manualmente — apenas quando 100% completo
3. **Empty states:** substituir mensagens genéricas por CTAs claros
4. **Tour:** não forçar; sempre opcional; usuário pode refazer via Ajuda

## Métricas Esperadas

- ↓ Taxa de abandono early-stage (< 7 dias sem ação)
- ↑ Conclusão das 7 tarefas críticas
- ↑ Retenção D7 / D30
- ↓ Tickets de suporte "Como faço X?"

## Próximos Passos (Opcionais)

- [ ] A/B test: tour automático vs. opt-in
- [ ] Analytics: tracking de step do tour (onde param?)
- [ ] Gamification: badges ao completar checklist
- [ ] Tooltips com vídeos inline (embed Loom/YouTube)
