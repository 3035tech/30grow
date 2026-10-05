# Guia de Componentes — Epic B-1000

Componentes visuais criados para HR Score, Turnover Radar e Job Roles.

## HrScoreBadge

Badge compacto para mostrar score ou risco de turnover.

### Props

```jsx
{
  score: number,      // Score 0-100 (opcional)
  risk: string,       // 'low' | 'medium' | 'high' (opcional)
  size: string        // 'xs' | 'sm' | 'md' (default: 'sm')
}
```

### Uso

**Score numérico:**
```jsx
import { HrScoreBadge } from '../_components/HrScoreBadge';

<HrScoreBadge score={85} size="sm" />
// Resultado: Badge verde com "85"
```

**Risco de turnover:**
```jsx
<HrScoreBadge risk="high" size="sm" />    // ⚠ vermelho
<HrScoreBadge risk="medium" size="sm" />  // ⚡ amarelo
<HrScoreBadge risk="low" size="sm" />     // ✓ verde
```

### Cores

- **Score ≥ 80:** success (verde)
- **Score 60-79:** info (azul)
- **Score 40-59:** warning (amarelo)
- **Score < 40:** danger (vermelho)

### Exemplo: Lista da Equipe

```jsx
// app/dashboard/tabs/TeamTab.jsx
import { HrScoreBadge } from '../../_components/HrScoreBadge';

{people.map(person => (
  <div key={person.id} className="flex items-center gap-2">
    <span>{person.name}</span>
    
    {/* Score */}
    {person.hrScore && (
      <HrScoreBadge score={person.hrScore} size="sm" />
    )}
    
    {/* Risk */}
    {person.turnoverRisk && (
      <HrScoreBadge risk={person.turnoverRisk} size="sm" />
    )}
  </div>
))}
```

---

## RubricEditor

Editor visual de rubrica T1-T9 com sliders e validação.

### Props

```jsx
{
  value: object,      // { T1: 20, T2: 30, ... }
  onChange: function, // (newValue) => void
  locale: string,     // 'pt-BR' | 'en'
  compact: boolean    // Modo compacto (read-only)
}
```

### Uso

**Modo completo (edição):**
```jsx
import { RubricEditor } from '../_components/RubricEditor';
import { useState } from 'react';

const [rubric, setRubric] = useState({ T1: 20, T2: 30, T7: 50 });

<RubricEditor
  value={rubric}
  onChange={setRubric}
  locale={locale}
/>
```

**Modo compacto (visualização):**
```jsx
<RubricEditor
  value={rubric}
  compact
  locale={locale}
/>
// Resultado: Chips horizontais coloridos (T1 20%, T2 30%, T7 50%)
```

### Validação

- ✅ Total ≤ 100%: verde
- ⚠️ Total > 100%: vermelho + alerta

### Exemplo: Editar Cargo

```jsx
// app/dashboard/tabs/JobRolesAdminTab.jsx
import { RubricEditor } from '../../_components/RubricEditor';
import { AdminRichFormDrawer } from '../../_components/AdminRichFormDrawer';

const [editingRole, setEditingRole] = useState(null);
const [rubric, setRubric] = useState({});

<AdminRichFormDrawer
  open={!!editingRole}
  title="Editar Cargo"
  onClose={() => setEditingRole(null)}
  locale={locale}
>
  <div className="flex flex-col gap-4">
    <input
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="Nome do cargo"
    />
    
    <div>
      <label className="mb-2 block text-sm font-medium">
        Competências (T1-T9)
      </label>
      <RubricEditor
        value={rubric}
        onChange={setRubric}
        locale={locale}
      />
    </div>
  </div>
</AdminRichFormDrawer>
```

### Visualizar registro (`AdminRecordViewDrawer`)

A ação **Ver** (olho) das listagens admin abre `AdminRecordViewDrawer` (`app/_components/AdminRecordViewDrawer.jsx`), construído sobre `AdminRichFormDrawer`. Recebe `sections` (`[{ key, title?, fields: [{ key, label, value, kind?, full?, emptyText? }], content? }]`): rótulo acima do valor em grade de 2 colunas, campos vazios somem (ou mostram `emptyText`), `kind` `html` usa `RichTextView`, `link` usa `CopyableLink`, `longText` preserva quebras. `headerMeta` recebe chips de status; `onEdit` adiciona o CTA primário Editar (fecha a gaveta e abre o formulário); `secondaryActions` vai à esquerda do rodapé (ex.: Excluir em ghost `text-danger`). Usado em Empresas, Usuários, Cargos, Trilhas, Benefícios, Mural, Ciclos de avaliação e Desligamentos. `notice()` fica para avisos curtos, não para fichas de registro.

### Fechar modal (×)

Modais de cadastro, edição e visualização (`AdminRichFormDrawer`, `AdminRecordViewDrawer`, `PromptFormDialog`/`promptForm`, recorte de logo) têm o **×** no canto superior direito via `DialogCloseButton` (`app/_components/DialogCloseButton.jsx`, rótulo `panel.common.close`). Modal novo com formulário reutiliza esse componente. Confirmações e avisos (`ConfirmDialog`, `SystemNoticeModal`) ficam **sem ×**: pedem decisão explícita (Cancelar/Confirmar/OK). Em todos, Esc e clique fora continuam fechando.

---

## Integração nas APIs

### HR Score + Turnover Risk

Para exibir badges na Equipe, a API de listagem deve incluir os dados:

```javascript
// app/api/admin/people/route.js (exemplo)
const people = await db.query(`
  SELECT 
    c.id,
    c.full_name,
    hs.score AS "hrScore",
    hs.turnover_risk AS "turnoverRisk"
  FROM candidates c
  LEFT JOIN hr_scores hs ON hs.candidate_id = c.id
  WHERE c.company_id = $1
    AND c.employee = TRUE
`, [companyId]);
```

### Job Roles com Rubrica

```javascript
// app/api/admin/job-roles/[id]/route.js
const role = await getJobRole(id);

// role.rubric já está em formato JSON: { T1: 20, T2: 30, ... }
// Pronto para usar no RubricEditor
```

---

## Checklist de Integração

### TeamTab (Lista de Pessoas):

- [ ] Modificar API para incluir `hrScore` e `turnoverRisk`
- [ ] Importar `HrScoreBadge`
- [ ] Adicionar badges ao lado do nome na lista
- [ ] Testar responsivo (mobile/desktop)

### JobRolesAdminTab (Editar Cargo):

- [ ] Substituir `promptForm` por `AdminRichFormDrawer`
- [ ] Importar `RubricEditor`
- [ ] Estado local para `rubric`
- [ ] Salvar via `PATCH /api/admin/job-roles/:id`
- [ ] Modo compact na listagem

### Telas de erro (error boundaries)

`app/global-error.jsx`, `app/error.jsx` e `app/r/error.jsx` usam `AppErrorScreen` (`app/_components/AppErrorScreen.jsx`): bonequinho 3D animado em stop motion (analista de RH sobrecarregada: 8 quadros `public/illustrations/hr-toon-{busy,hangup,shock,grip,scream,droop,collapse,wake}.webp`, loop de ~6,4s controlado por timer no componente (`FRAMES` com duração por quadro: poses-chave ~1s, intermediárias ~0,5s; fade de 200ms com o quadro anterior opaco embaixo; tremor `app-err-jolt` só no grito). Com `prefers-reduced-motion` fica parado em `shock`), com camadas SVG por cima: notificações no monitor, badge 99+, telefone tocando, papéis voando, vapor do café; `illustrations/` fica fora do matcher do `proxy.js`), copy `panel.common.appError*`, "Tentar de novo" (`retry`/`reset`), link ao painel (`homeHref={null}` em fluxo público) e o `digest` como código de suporte. Envia ao Sentry. Animações `.app-err-*` em `globals.css`, desligadas com `prefers-reduced-motion`. Novo `error.jsx` de segmento reutiliza esse componente.

### VacanciesAdminTab (Criar/Editar Vaga):

Criar e editar usam o mesmo `VacancyFormFields` (`app/dashboard/vacancies/`): `mode="create"` + `layout="stack"` no drawer de criação; `mode="edit"` + `layout="split"` no editor em página cheia (conteúdo à esquerda: Essenciais, Contrato e remuneração, Descrição; configurações à direita: Situação e prazo, Cargo base, Página pública). Campo novo de vaga entra nesse componente, não na tab.

- [ ] Adicionar `RubricEditor` na seção de rubrica
- [ ] Pré-preencher com rubrica do cargo se `jobRoleId` selecionado
- [ ] Permitir override manual
- [ ] Salvar `rubric` no payload

---

## Troubleshooting

### Badge não aparece
- Verificar se `score` ou `risk` têm valor
- Checar console por erros de import

### RubricEditor não salva
- Garantir que `onChange` está sendo chamado
- Verificar payload no network tab
- Rubrica deve ser objeto `{ T1: number, T2: number, ... }`

### Cores não aparecem
- `TYPE_DATA` deve estar importado
- Tailwind deve compilar cores customizadas

---

## Próximos Passos

1. **TeamTab:** Integrar badges na lista principal
2. **JobRolesAdminTab:** Drawer com RubricEditor
3. **VacanciesAdminTab:** RubricEditor com pré-fill de cargo
4. **Storybook:** Documentar variações e estados

---

## Referências

- `app/_components/HrScoreBadge.jsx`
- `app/_components/RubricEditor.jsx`
- `lib/data.js` — TYPE_DATA
- `lib/theme.js` — cores semânticas
