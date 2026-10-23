# Ajustes solicitados pelo RH — 23/10/2026

- Na Jornada da pessoa, check-ins de contratação e pós-contratação se recolhem quando todos os itens estão concluídos ou pulados. O cabeçalho mantém a contagem e permite reabrir. Itens pendentes continuam expandidos; não há mudança de status ou de histórico.
- O formulário de benefício mostra Tipo e deixa de pedir Categoria. O modelo relacional e os vínculos anteriores são preservados. A edição omite categoryId no PATCH, evitando limpar a classificação existente.
- A aba de remuneração da ficha passa a “Carreira e Remuneração”, mantendo a mesma URL e as permissões. Traduções atualizadas nos quatro idiomas.
- O convite de senha resolve a empresa a partir do colaborador dentro do escopo autorizado, mesmo para superadmin sem empresa selecionada. Um companyId informado que não corresponde ao registro é rejeitado. A tela também envia o contexto real da ficha. Contas de outras empresas continuam sem acesso.
- O superadmin é explicitamente reconhecido na troca de e-mail corporativo. Gestores de empresa continuam precisando de Equipe/DP e vínculo com a empresa da pessoa. A senha e os links antigos continuam revogados pela mesma transação da troca; não foram alterados e-mails de pessoas reais para testar.

Provas: três testes de UI cobrem recolhimento inicial, conclusão do último item e preservação de categoria na edição. A suíte HTTP cobre convite global sem empresa selecionada, bloqueio entre empresas e alteração de e-mail por RH autorizado, com SMTP simulado. Nenhum convite real foi enviado durante a investigação.
