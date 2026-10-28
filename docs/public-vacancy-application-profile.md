# Candidatura pública: currículo, LinkedIn e confirmação

O formulário de `/jobs/[jobKey]` solicita currículo em PDF (até 5 MB) e oferece LinkedIn opcional. O PDF usa o armazenamento privado e os campos `cv_key`, `cv_url` e `cv_updated_at` já existentes em `candidates`; o LinkedIn usa `linkedin_url`. Não há migration adicional para este fluxo.

O endpoint continua aceitando JSON para consumidores existentes. O formulário web envia multipart e exige o PDF antes de registrar o vínculo à vaga. A aplicação valida assinatura PDF, tamanho, URL do LinkedIn e consentimento; impede que uma candidatura pública altere o perfil ou currículo de um colaborador. Em reaplicação da mesma vaga, preserva o currículo já recebido e não repete o e-mail.

Depois de registrar uma candidatura nova, a aplicação envia um e-mail de confirmação pelo SMTP transacional existente. Falhas de SMTP não desfazem a inscrição; a resposta só informa confirmação enviada quando o envio retorna sem erro. O envio não anexa nem expõe o PDF. O formulário mantém a mensagem de sucesso genérica quando o SMTP está indisponível.

Prova local DTOV: `test/integration/public-vacancy-apply-profile.test.js` cria empresa, vaga e candidato sintéticos; valida LinkedIn, entrega do PDF ao serviço de armazenamento, vínculo, consentimento, envio simulado e reaplicação sem duplicatas. O teste limpa todos os dados sintéticos ao terminar.
