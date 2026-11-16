# Auditoria de mensagens e confirmações da interface

Data: 05/11/2026  
Escopo: interface web em `app/` e utilitários de interface em `lib/`. Auditoria estática, sem execução de testes.

## Resultado

- **Confirmações e avisos:** a aplicação possui componentes próprios (`ConfirmDialog`, `SystemNoticeModal`, `PromptFormDialog`) centralizados em `AppFeedbackProvider`. Não encontrei chamadas executáveis a `window.alert`, `window.confirm`, `window.prompt` ou equivalentes no código de produto. As ocorrências textuais encontradas estão apenas em comentários que descrevem a substituição dos diálogos nativos.
- **Sucesso e erro:** o padrão predominante também é próprio da aplicação: `toast()` ou mensagens inline renderizadas pela interface. O levantamento encontrou 895 referências a APIs de feedback em 119 arquivos e 348 referências a setters de mensagens/estado; esses números são ocorrências estáticas, não eventos únicos em produção.
- **Exceção confirmada na auditoria inicial:** 13 formulários em 9 arquivos tinham validação HTML que podia exibir mensagens padrão. Os 13 foram ajustados nesta entrega: agora usam `noValidate` e validam os controles no handler, retornando texto localizado pela interface do app. A validação compartilhada está em `lib/form-validation.js`.
- **Sinalização de obrigatoriedade:** campos com `required`/`aria-required` agora exibem `*` junto ao rótulo. `FormField` faz isso automaticamente; rótulos nativos e campos customizados também têm cobertura.
- **Máscaras:** telefone já era formatado durante a digitação nos formulários de candidatura e perfil; CPF/CEP/telefone/moeda já usam os controles/máscaras compartilhados. Os campos CPF/CNPJ do REP agora também formatam durante a digitação e enviam os valores normalizados. A máscara de CNPJ preserva letras e números.
- **Escopo permanente:** a regra de obrigatoriedade visual e de máscaras aplica-se a todos os formulários do sistema, presentes e futuros, em qualquer módulo. Os 13 formulários acima identificam apenas a correção de validação HTML nativa desta auditoria; não limitam o padrão global.

## Formulários que podem exibir validação nativa

| Arquivo e linha | Fluxo | Evidência / comportamento observado |
|---|---|---|
| [`PublicVacancyPosting.jsx:477`](../app/_components/PublicVacancyPosting.jsx) | Candidatura pública | Nome, e-mail, formato de e-mail e currículo usam `required`/`type=email`; o handler já tem erros inline para parte das regras, mas a validação nativa pode interceptá-lo primeiro. |
| [`PublicVacancyPosting.jsx:894`](../app/_components/PublicVacancyPosting.jsx) | Alerta de vagas | E-mail obrigatório e `type=email`; o handler mantém estados de sucesso/erro, mas campo ausente ou formato inválido pode ser barrado pelo navegador. |
| [`RepAdminSettings.jsx:265`](../app/_components/RepAdminSettings.jsx) | Cadastrar estabelecimento do REP | Campos obrigatórios e padrões de CPF/CNO; agora usa `noValidate` e validação customizada antes de salvar. |
| [`RepAdminSettings.jsx:280`](../app/_components/RepAdminSettings.jsx) | Vincular colaborador ao REP | Campos obrigatórios e padrões de CPF/identificador; agora usa `noValidate` e validação customizada antes de salvar. |
| [`RepAdminSettings.jsx:295`](../app/_components/RepAdminSettings.jsx) | Exportação de arquivos do REP | Estabelecimento e período obrigatórios; agora usa `noValidate` e validação customizada antes de exportar. |
| [`TimeClockReadiness.jsx:137`](../app/_components/TimeClockReadiness.jsx) | Consulta de fechamento de ponto | Período inicial/final obrigatórios; o formulário não apresenta mensagem customizada de validação desses campos. |
| [`CandidateTags.jsx:323`](../app/dashboard/CandidateTags.jsx) | Criar/editar etiqueta de candidato | Nome obrigatório; o handler tem erro inline para falha de API, sem validação customizada explícita de campo vazio. |
| [`OrgHeadcountBlock.jsx:597`](../app/dashboard/OrgHeadcountBlock.jsx) | Criar/editar posição e movimentação | Há campos obrigatórios em diferentes modos; falhas de API aparecem inline, mas a validação do navegador pode impedir o handler. |
| [`DigitalCertificateAdminTab.jsx:188`](../app/dashboard/tabs/DigitalCertificateAdminTab.jsx) | Salvar/testar certificado digital | O handler já valida arquivo e exibe toast próprio; `required` pode impedir que esse retorno customizado apareça quando o arquivo falta. |
| [`EmployeeLoginClient.jsx:419`](../app/employee/login/EmployeeLoginClient.jsx) | Login de colaborador | E-mail/senha obrigatórios e e-mail validado pelo navegador; há estado de erro customizado, mas a validação nativa pode interceptar o envio. |
| [`EmployeeProfileClient.jsx:290`](../app/employee/profile/EmployeeProfileClient.jsx) | Atualizar perfil | Nome obrigatório; sucesso e erro são toasts customizados, mas campo vazio pode gerar balão nativo. |
| [`EmployeeProfileClient.jsx:398`](../app/employee/profile/EmployeeProfileClient.jsx) | Alterar senha | Campos obrigatórios; comprimento e divergência de senha têm toasts próprios, porém campos vazios podem ser barrados pelo navegador antes. |
| [`signup/page.jsx:144`](../app/signup/page.jsx) | Cadastro público | Nome, e-mail, empresa e outro cargo obrigatório; além de `required`, e-mail usa validação nativa de formato. |

## Padrões observados

- Confirmações são solicitadas por `useAppFeedback().confirm()` e exibidas em `ConfirmDialog`; a API de confirmação não invoca a função nativa do browser.
- Avisos que exigem leitura usam `notice()`/`SystemNoticeModal`; formulários simples usam `promptForm()`/`PromptFormDialog`.
- Retornos breves usam `toast()`; alguns fluxos usam estado inline próprio (`setError`, `setMsg`, `setSuccess`, entre outros). Ambos são UI customizada, mas há variação de duração, localização e semântica entre telas.
- Os formulários da tabela eram o desvio verificável em relação ao requisito de não exibir mensagens HTML/browser padrão. A correção transfere as validações dos controles ao handler compartilhado e mantém as mensagens nos canais próprios de cada tela (toast, alerta inline ou erro do formulário). Não foi apenas desligada a validação nativa.
- Campos obrigatórios mostram o asterisco no rótulo além da indicação semântica do controle; isso permanece visível antes de qualquer tentativa de envio.

## Método e limites

Busca estática por diálogos nativos, validação programática, tags `<form>`, atributos de validação, uso de feedback compartilhado e estados de mensagem. Após a correção, o scanner encontrou 21 formulários no app e nenhum formulário remanescente com `required`, `type=email/url/number` ou `pattern` sem `noValidate`. A auditoria não executou a interface nem percorreu todos os fluxos de CRUD manualmente; não certifica que cada botão destrutivo tenha confirmação ou que cada ramo de erro de API tenha mensagem específica. Isso requer revisão comportamental por módulo.
