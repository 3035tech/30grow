# Lembrar de mim no login web

A opção aparece desmarcada nos acessos de gestor e colaborador. Sem marcar, são mantidas as sessões atuais: 8 horas para gestor e 12 horas para colaborador, com a renovação por atividade já existente. Marcando, o cookie e o JWT expiram em até 30 dias a partir do login. Atividade, edição de perfil e mudança de idioma não reiniciam esse prazo.

A escolha é transportada no desafio assinado de 2FA; o segundo fator continua obrigatório para quem o habilitou. Na seleção de empresa do colaborador, o formulário preserva a escolha. O aplicativo móvel mantém sua política própria de tokens.

O cookie continua HttpOnly, SameSite=Lax e Secure em HTTPS. Nenhuma senha é armazenada no navegador pela funcionalidade. Sair, revogação da sessão, desativação do usuário e encerramento do vínculo continuam sujeitos às verificações de estado e versão existentes. A tela orienta o uso apenas em dispositivo pessoal. O prazo não garante permanência se o navegador limpar os cookies.

Não há alteração de schema. O campo rememberUntil existe apenas no JWT assinado. O rollback exige invalidar as sessões longas, pois versões antigas renovam sessões sem reconhecer esse limite: antes de retornar ao código anterior, incrementar session_version dos usuários e colaboradores afetados ou aguardar a expiração de todas as sessões longas. Nunca reutilizar um cookie revogado.

Validação: contratos de JWT padrão e persistente, limite absoluto, reemissão, preferência assinada no 2FA, testes HTTP de cookie/perfil e testes de interface nos dois acessos. Os testes usam dados sintéticos e não alteram senhas de usuários reais.

## Código de verificação

Nos logins de gestor e colaborador, o código TOTP usa seis posições numéricas. Digitar avança o foco; Backspace e setas permitem corrigir; colar o código completo preenche as posições. O sexto dígito envia automaticamente uma única tentativa. Durante a verificação, os campos ficam bloqueados. Código inválido limpa as posições e retorna o foco ao início. As verificações de desafio, expiração, uso único e CAPTCHA no servidor continuam iguais.
