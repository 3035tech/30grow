# Proposta — convite de boas-vindas ao colaborador

Proposta de conteúdo de 26/10/2026; ainda sem alteração do template de envio. Aplicável ao convite criado pela opção Enviar convite de acesso no cadastro do colaborador. A recuperação de senha permanece uma mensagem própria.

## Conteúdo proposto

**Assunto:** Bem-vindo(a) ao 30 Grow — seu acesso na {empresa}

Olá, {primeiro_nome}!

A {empresa} liberou seu acesso ao **30 Grow**, o seu Espaço do Colaborador.

Por aqui, você pode acompanhar comunicados, documentos e atividades da sua empresa. Os recursos disponíveis dependem do que a empresa habilitou para você.

**Seu e-mail de acesso:** {email_corporativo}

Para começar, crie sua senha pelo botão abaixo:

**[Criar minha senha]** → {link_individual_de_cadastro_de_senha}

Esse link é válido por **72 horas**. Não enviamos sua senha por e-mail.

Depois de criar sua senha, use este endereço nos próximos acessos:

**[Acessar o Espaço do Colaborador]** → {url_canonica_do_ambiente}/employee/login

Se precisar de ajuda ou não reconhecer este convite, fale com o RH da sua empresa.

Equipe 30 Grow
Mensagem automática.

## Ajuste técnico sugerido

- Hoje issueEmployeePasswordInvite reutiliza buildUserPasswordInviteMail, que fala em acesso ao painel; apenas o assunto recebe uma substituição específica para colaborador.
- Manter o emissor, o modelo visual e a infraestrutura transacional existentes, com conteúdo específico para convite de colaborador.
- Gerar o endereço do portal com a URL canônica do ambiente, sem hardcode ou link para o login de gestores.
- Preservar geração, prazo e uso único do token, destinatário corporativo, expiração e revogação existentes. Conferir que o prazo anunciado corresponde à constante de 72 horas em uso.
- Não alterar o conteúdo de recuperação de senha ou o convite de gestores. Boas-vindas ao sistema também servem a colaboradores antigos; não presumir primeiro dia na empresa.
- Escapar nome/empresa/e-mail no HTML e manter alternativa em texto. Não incluir senha, links de lojas ainda não disponíveis ou promessa de ponto oficial regularizado.
- Provar o novo convite e a preservação dos outros fluxos com SMTP simulado; nenhum envio real foi realizado nesta proposta.
