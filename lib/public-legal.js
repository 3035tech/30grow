import { PRODUCT_LANDING_CONTACT_EMAIL, productLandingAbsoluteUrl } from './product-landing-seo.js';
import { contentLocale } from './i18n.js';

export const PUBLIC_LEGAL_VERSION = '2026.10';
export const PUBLIC_LEGAL_EFFECTIVE_DATE = '7 de outubro de 2026';
export const PUBLIC_LEGAL_EFFECTIVE_DATE_EN = 'October 7, 2026';
export const PRIVACY_CONTACT_EMAIL = PRODUCT_LANDING_CONTACT_EMAIL;

const DOCUMENTS = {
  'pt-BR': {
    common: {
      back: 'Voltar para o 30Grow',
      privacy: 'Política de Privacidade',
      terms: 'Termos de Uso',
      version: `Versão ${PUBLIC_LEGAL_VERSION} · vigente a partir de ${PUBLIC_LEGAL_EFFECTIVE_DATE}`,
      contactLabel: 'Canal de privacidade',
      contactHint: 'Use o assunto “Privacidade 30Grow” e informe sua relação com a empresa que utiliza a plataforma.',
      related: 'Documento relacionado',
    },
    privacy: {
      title: 'Política de Privacidade',
      description: 'Como o 30Grow trata dados pessoais em recrutamento, avaliações de perfil de trabalho e gestão de pessoas.',
      intro:
        'Esta política explica como a 3035Tech trata dados pessoais no 30Grow. Ela se aplica ao site público, ao cadastro de gestores, aos links de recrutamento e pesquisa e aos espaços de colaboradores.',
      sections: [
        {
          title: '1. Quem participa do tratamento',
          paragraphs: [
            'A 3035Tech opera o 30Grow. Em muitos fluxos de recrutamento e gestão, a empresa cliente define a finalidade e os dados utilizados e atua como controladora; a 3035Tech trata esses dados para prestar a plataforma, conforme as instruções e o contrato com essa empresa.',
            'Em dados do próprio site, cadastro comercial, segurança e administração da conta 30Grow, a 3035Tech pode atuar como controladora. Dúvidas sobre um processo seletivo ou vínculo de trabalho também podem precisar ser direcionadas à empresa responsável por esse processo.',
          ],
        },
        {
          title: '2. Dados que podemos tratar',
          bullets: [
            'Identificação e contato: nome, e-mail, telefone e dados profissionais.',
            'Recrutamento: candidatura, vaga, histórico do funil, currículo, anotações e decisões registradas por gestores autorizados.',
            'Avaliações: respostas, resultados T1–T9 e Motivadores. São hipóteses de estilo de trabalho e não diagnóstico clínico.',
            'Gestão de pessoas: 1:1, PDI, objetivos, desempenho, clima, aprendizagem, onboarding e sinais operacionais habilitados pela empresa.',
            'Dados sensíveis de RH quando o módulo estiver habilitado: remuneração interna, documentos e solicitações de DP e conteúdo de relatos de ouvidoria.',
            'Dados técnicos e de segurança: endereço IP, navegador, sessão, eventos de autenticação, auditoria e prevenção de abuso.',
          ],
        },
        {
          title: '3. Por que usamos os dados',
          bullets: [
            'Prestar, proteger e manter a plataforma e suas contas.',
            'Executar processos de recrutamento e gestão configurados pela empresa cliente.',
            'Gerar resultados, comparações e indicadores auxiliares para conversas e decisões humanas.',
            'Enviar convites, alertas operacionais e comunicações solicitadas.',
            'Cumprir obrigações legais, contratuais, de auditoria e de segurança.',
            'Melhorar o produto com métricas agregadas ou minimizadas, sem usar o texto de relatos de ouvidoria em analytics.',
          ],
          paragraphs: [
            'A base legal depende do fluxo e da relação entre o titular, a empresa cliente e a 3035Tech. Pode envolver execução de contrato, cumprimento de obrigação legal ou regulatória, exercício regular de direitos, legítimo interesse ou consentimento quando aplicável. A empresa cliente é responsável por definir e comunicar a base adequada nos tratamentos sob seu controle.',
          ],
        },
        {
          title: '4. Decisões e avaliações',
          paragraphs: [
            'O 30Grow oferece rankings, aderência, alertas e sínteses para apoiar pessoas responsáveis pelo processo. Esses recursos não devem produzir decisão exclusivamente automatizada sobre contratação, promoção, desligamento ou outro efeito relevante. O resultado deve ser revisado por uma pessoa e combinado com contexto, entrevista e critérios técnicos.',
          ],
        },
        {
          title: '5. Compartilhamento e operadores',
          paragraphs: [
            'Os dados podem ser processados por fornecedores necessários à hospedagem, banco de dados, armazenamento, e-mail, proteção contra abuso e operação técnica. Limitamos o acesso ao necessário e aplicamos contratos e controles compatíveis com a finalidade. Não vendemos dados pessoais.',
            'Quando um fornecedor processar dados fora do Brasil, a transferência deve observar os mecanismos legais e contratuais aplicáveis.',
          ],
        },
        {
          title: '6. Retenção e exclusão',
          paragraphs: [
            'Mantemos dados enquanto a conta ou o processo estiver ativo e pelo período necessário para cumprir contrato, obrigação legal, auditoria, segurança ou exercício de direitos. A empresa cliente pode definir períodos adicionais compatíveis com sua responsabilidade legal.',
            'Convites e sessões expiram ou podem ser revogados. Avaliações antigas elegíveis podem ser removidas em lotes conforme a política configurada. Registros com obrigação de preservação, como determinados documentos de DP, remuneração, auditoria e relatos, não são apagados automaticamente sem validação do controlador. Backups seguem o ciclo técnico do provedor e deixam de conter o dado ao serem sobrescritos.',
          ],
        },
        {
          title: '7. Segurança e isolamento entre empresas',
          paragraphs: [
            'Aplicamos autenticação, autorização por função e módulo, escopo por empresa, trilhas de auditoria, criptografia de transporte e controles operacionais. Nenhum método elimina todo risco; por isso mantemos procedimentos de resposta e revisão.',
            'Gestores de uma empresa não devem acessar dados de outra. O superadministrador técnico pode acessar empresas para suporte e operação autorizada, com escopo explícito e auditoria.',
          ],
        },
        {
          title: '8. Seus direitos',
          paragraphs: [
            'Nos limites da legislação aplicável, você pode solicitar confirmação e acesso, correção, informação sobre compartilhamento, anonimização, bloqueio, portabilidade ou eliminação quando cabível, revogação de consentimento e revisão de decisões automatizadas. Alguns pedidos podem depender de validação de identidade ou ser atendidos pela empresa cliente controladora.',
            'Para solicitar, escreva ao canal abaixo. Informe nome, e-mail utilizado, empresa relacionada e o pedido. Não envie senha, token, documento completo nem relato sensível no primeiro contato.',
          ],
        },
        {
          title: '9. Cookies e tecnologias locais',
          links: [{ href: 'https://policies.google.com/technologies/partner-sites', label: 'Como o Google usa informações de sites ou apps que usam seus serviços' }],
          paragraphs: [
            'Usamos cookies e armazenamento local necessários para sessão, idioma, tema, segurança e funcionamento. Métricas públicas, quando habilitadas, devem evitar conteúdo de avaliações, documentos, remuneração ou relatos. O bloqueio de cookies essenciais pode impedir o login. Na landing page, o Google Analytics só é carregado após aceitar métricas; a escolha pode ser alterada em Cookies. Medimos visitas e cliques nos botões, sem enviar nomes, e-mails, conteúdo de formulários ou parâmetros da URL.',
          ],
        },
        {
          title: '10. Alterações e contato',
          paragraphs: [
            'Podemos atualizar esta política para refletir mudanças legais, técnicas ou do produto. A versão e a data vigentes aparecem no início desta página. Mudanças relevantes serão comunicadas pelos meios adequados.',
          ],
        },
      ],
    },
    terms: {
      title: 'Termos de Uso',
      description: 'Regras para utilizar o 30Grow em recrutamento, avaliações de perfil de trabalho e gestão de pessoas.',
      intro:
        'Estes termos regulam o uso do 30Grow por empresas, gestores, candidatos e colaboradores. Ao criar uma conta ou continuar um fluxo público, você concorda com as condições aplicáveis ao seu papel.',
      sections: [
        {
          title: '1. Serviço e escopo',
          paragraphs: [
            'O 30Grow é uma plataforma de recrutamento, perfil de trabalho e gestão de pessoas. Os módulos disponíveis dependem da contratação e da configuração da empresa. Funcionalidades identificadas como piloto ou early access podem mudar antes da versão comercial definitiva.',
          ],
        },
        {
          title: '2. Contas e acesso',
          bullets: [
            'Gestores devem fornecer dados corretos, proteger senha e autenticação em duas etapas e usar apenas empresas às quais estejam vinculados.',
            'Candidatos acessam avaliações por links ou convites; colaboradores podem usar link ou conta própria, sem acesso ao painel gerencial.',
            'A empresa cliente é responsável por cadastrar pessoas autorizadas, revisar permissões e revogar acessos quando necessário.',
            'Não é permitido compartilhar credenciais, contornar autorização, testar vulnerabilidades sem permissão ou coletar dados em massa.',
          ],
        },
        {
          title: '3. Responsabilidades da empresa cliente',
          paragraphs: [
            'A empresa cliente define seus processos, critérios, bases legais, avisos aos titulares e períodos de retenção. Também deve garantir que notas, documentos, remuneração, avaliações e relatos sejam acessados apenas por pessoas que realmente precisam deles.',
            'Links públicos e convites devem ser enviados somente a destinatários legítimos e revogados quando deixarem de ser necessários.',
          ],
        },
        {
          title: '4. Uso responsável de avaliações',
          paragraphs: [
            'T1–T9 e Motivadores descrevem tendências e hipóteses de trabalho. Não são diagnóstico clínico, prova de competência técnica nem fundamento isolado para contratar, promover, punir ou desligar. O usuário deve realizar revisão humana e considerar entrevista, experiência, resultados e contexto.',
          ],
        },
        {
          title: '5. Conteúdo e dados',
          paragraphs: [
            'A empresa cliente e os titulares preservam os direitos sobre os dados inseridos. A empresa concede à 3035Tech autorização limitada para processá-los e prestar o serviço. O usuário não deve inserir conteúdo ilegal, discriminatório, abusivo ou sem autorização.',
            'Relatos de ouvidoria exigem tratamento restrito. O canal não deve ser usado para ameaça, denúncia deliberadamente falsa ou exposição desnecessária de terceiros.',
          ],
        },
        {
          title: '6. Propriedade intelectual',
          paragraphs: [
            'O software, a marca, a interface, os textos proprietários, os modelos e a documentação do 30Grow pertencem à 3035Tech ou a seus licenciadores. O uso da conta não transfere propriedade nem autoriza cópia, revenda, engenharia reversa ou criação de produto derivado, salvo permissão legal ou escrita.',
          ],
        },
        {
          title: '7. Disponibilidade e integrações',
          paragraphs: [
            'Buscamos manter o serviço disponível e seguro, mas manutenções, falhas de internet e fornecedores podem causar interrupções. Integrações de e-mail, armazenamento, vídeo e outros serviços também seguem as condições de seus provedores.',
          ],
        },
        {
          title: '8. Suspensão e encerramento',
          paragraphs: [
            'Podemos limitar ou suspender acesso em caso de risco de segurança, violação destes termos, ordem legal, inadimplência prevista em contrato ou uso que prejudique terceiros. No encerramento, exportação e exclusão seguem o contrato, a Política de Privacidade e as obrigações de retenção aplicáveis.',
          ],
        },
        {
          title: '9. Limites e responsabilidade',
          paragraphs: [
            'O 30Grow apoia decisões, mas não substitui julgamento profissional, assessoria jurídica, medicina, psicologia, contabilidade, folha de pagamento ou obrigações trabalhistas. Cada parte responde pelos atos sob seu controle, conforme a legislação e o contrato aplicáveis.',
          ],
        },
        {
          title: '10. Alterações e contato',
          paragraphs: [
            'Podemos atualizar estes termos. A versão vigente estará nesta página e mudanças relevantes serão comunicadas pelos meios adequados. Dúvidas podem ser enviadas ao contato abaixo.',
          ],
        },
      ],
    },
  },
};

DOCUMENTS.en = {
  common: {
    back: 'Back to 30Grow',
    privacy: 'Privacy Policy',
    terms: 'Terms of Use',
    version: `Version ${PUBLIC_LEGAL_VERSION} · effective ${PUBLIC_LEGAL_EFFECTIVE_DATE_EN}`,
    contactLabel: 'Privacy contact',
    contactHint: 'Use the subject “30Grow Privacy” and state your relationship with the company using the platform.',
    related: 'Related document',
  },
  privacy: {
    title: 'Privacy Policy',
    description: 'How 30Grow handles personal data in recruiting, work-profile assessments, and people management.',
    intro: 'This policy explains how 3035Tech handles personal data in 30Grow. It covers the public website, manager signup, recruiting and survey links, and employee spaces.',
    sections: [
      { title: '1. Who takes part in processing', paragraphs: ['3035Tech operates 30Grow. In many recruiting and people-management flows, the customer company determines purposes and data and acts as controller; 3035Tech processes that data to provide the platform under the customer’s instructions and contract.', 'For the public website, commercial signup, security, and 30Grow account administration, 3035Tech may act as controller. Requests about a hiring process or employment relationship may also need to be handled by the company responsible for that process.'] },
      { title: '2. Data we may process', bullets: ['Identity and contact details, including name, email, phone, and professional information.', 'Recruiting data, including applications, jobs, pipeline history, resumes, notes, and decisions recorded by authorized managers.', 'Assessment answers and T1–T9 and Motivators results. These are work-style hypotheses, not clinical diagnoses.', 'People-management data, such as 1:1s, development plans, goals, performance, climate, learning, onboarding, and enabled operational signals.', 'Sensitive HR data when the module is enabled, including internal compensation, HR-operation documents and requests, and whistleblowing report content.', 'Technical and security data, including IP address, browser, session, authentication events, audit trails, and abuse prevention.'] },
      { title: '3. Why we use data', bullets: ['Provide, secure, and maintain the platform and its accounts.', 'Run recruiting and people-management processes configured by the customer.', 'Create results, comparisons, and auxiliary indicators for human conversations and decisions.', 'Send requested invitations, operational alerts, and communications.', 'Meet legal, contractual, audit, and security obligations.', 'Improve the product with aggregated or minimized metrics, without using whistleblowing report text in analytics.'], paragraphs: ['The legal basis depends on the flow and the relationship between the person, the customer, and 3035Tech. It may include contract performance, legal obligations, legal claims, legitimate interests, or consent where applicable. The customer is responsible for defining and communicating the proper basis for processing under its control.'] },
      { title: '4. Decisions and assessments', paragraphs: ['30Grow provides rankings, fit indicators, alerts, and summaries to support responsible people. These features should not make solely automated decisions about hiring, promotion, termination, or another significant effect. A person must review the output together with context, interviews, and technical criteria.'] },
      { title: '5. Sharing and service providers', paragraphs: ['Data may be processed by providers needed for hosting, databases, storage, email, abuse protection, and technical operations. We limit access to what is necessary and apply contractual and operational safeguards. We do not sell personal data.', 'When a provider processes data outside Brazil, the transfer must use applicable legal and contractual mechanisms.'] },
      { title: '6. Retention and deletion', paragraphs: ['We keep data while the account or process is active and for as long as needed for contracts, legal obligations, audits, security, or legal claims. The customer may set additional periods compatible with its legal responsibilities.', 'Invitations and sessions expire or can be revoked. Eligible old assessments may be removed in batches under configured policy. Records subject to preservation duties, including some HR documents, compensation, audit, and reports, are not automatically deleted without controller validation. Backups follow the provider’s technical cycle and cease to contain the data as they are overwritten.'] },
      { title: '7. Security and tenant isolation', paragraphs: ['We use authentication, role and module authorization, company scoping, audit trails, transport encryption, and operational controls. No method removes all risk, so we maintain response and review procedures.', 'Managers from one company must not access another company’s data. A technical super administrator may access companies for authorized support and operations, with explicit scope and auditing.'] },
      { title: '8. Your rights', paragraphs: ['Subject to applicable law, you may request confirmation and access, correction, information about sharing, anonymization, blocking, portability or deletion where applicable, withdrawal of consent, and review of automated decisions. Some requests require identity verification or must be handled by the customer acting as controller.', 'To submit a request, email the channel below with your name, email used, related company, and request. Do not send passwords, tokens, full identity documents, or sensitive report content in the first message.'] },
      { title: '9. Cookies and local technologies', links: [{ href: 'https://policies.google.com/technologies/partner-sites', label: 'How Google uses information from sites or apps that use its services' }], paragraphs: ['We use cookies and local storage required for sessions, language, theme, security, and operation. Public metrics, when enabled, must avoid assessment content, documents, compensation, or report content. Blocking essential cookies may prevent login. On the landing page, Google Analytics loads only after you accept analytics; you can change this choice in Cookies. We measure visits and button clicks without sending names, emails, form contents, or URL parameters.'] },
      { title: '10. Changes and contact', paragraphs: ['We may update this policy to reflect legal, technical, or product changes. The current version and date appear at the top of this page. Material changes will be communicated through appropriate channels.'] },
    ],
  },
  terms: {
    title: 'Terms of Use',
    description: 'Rules for using 30Grow for recruiting, work-profile assessments, and people management.',
    intro: 'These terms govern 30Grow use by companies, managers, candidates, and employees. By creating an account or continuing a public flow, you agree to the terms that apply to your role.',
    sections: [
      { title: '1. Service and scope', paragraphs: ['30Grow is a recruiting, work-profile, and people-management platform. Available modules depend on the customer agreement and company configuration. Features identified as pilot or early access may change before the final commercial release.'] },
      { title: '2. Accounts and access', bullets: ['Managers must provide accurate data, protect passwords and two-factor authentication, and use only companies to which they are linked.', 'Candidates access assessments through links or invitations; employees may use a link or their own account without access to the management dashboard.', 'The customer is responsible for registering authorized people, reviewing permissions, and revoking access when needed.', 'Sharing credentials, bypassing authorization, testing vulnerabilities without permission, or bulk collection is prohibited.'] },
      { title: '3. Customer responsibilities', paragraphs: ['The customer defines its processes, criteria, legal bases, notices to people, and retention periods. It must ensure that notes, documents, compensation, assessments, and reports are accessed only by people who need them.', 'Public links and invitations must be sent only to legitimate recipients and revoked when no longer needed.'] },
      { title: '4. Responsible assessment use', paragraphs: ['T1–T9 and Motivators describe work tendencies and hypotheses. They are not clinical diagnoses, proof of technical competence, or a sole basis to hire, promote, discipline, or terminate. Users must apply human review and consider interviews, experience, results, and context.'] },
      { title: '5. Content and data', paragraphs: ['The customer and individuals retain rights in submitted data. The customer grants 3035Tech limited permission to process it and provide the service. Users must not submit illegal, discriminatory, abusive, or unauthorized content.', 'Whistleblowing reports require restricted handling. The channel must not be used for threats, knowingly false reports, or unnecessary exposure of third parties.'] },
      { title: '6. Intellectual property', paragraphs: ['30Grow software, brand, interface, proprietary text, models, and documentation belong to 3035Tech or its licensors. Account access does not transfer ownership or permit copying, resale, reverse engineering, or derivative products except where allowed by law or written permission.'] },
      { title: '7. Availability and integrations', paragraphs: ['We aim to keep the service available and secure, but maintenance, internet failures, and providers may cause interruptions. Email, storage, video, and other integrations are also subject to their providers’ terms.'] },
      { title: '8. Suspension and termination', paragraphs: ['We may limit or suspend access for security risks, violations of these terms, legal orders, contractual non-payment, or use that harms others. On termination, exports and deletion follow the contract, Privacy Policy, and applicable retention duties.'] },
      { title: '9. Limits and responsibility', paragraphs: ['30Grow supports decisions but does not replace professional judgment, legal advice, medicine, psychology, accounting, payroll, or employment-law obligations. Each party is responsible for acts under its control, subject to applicable law and contract.'] },
      { title: '10. Changes and contact', paragraphs: ['We may update these terms. The current version will be available on this page, and material changes will be communicated through appropriate channels. Questions may be sent to the contact below.'] },
    ],
  },
};

export function getPublicLegalDocument(kind, locale = 'pt-BR') {
  const loc = contentLocale(locale);
  const safeKind = kind === 'terms' ? 'terms' : 'privacy';
  return { ...DOCUMENTS[loc], document: DOCUMENTS[loc][safeKind], kind: safeKind, locale: loc };
}

export function buildPublicLegalMetadata(kind, locale = 'pt-BR') {
  const copy = getPublicLegalDocument(kind, locale);
  const path = copy.kind === 'terms' ? '/terms' : '/privacy';
  return {
    title: { absolute: `${copy.document.title} | 30Grow` },
    description: copy.document.description,
    alternates: { canonical: productLandingAbsoluteUrl(path) },
    robots: { index: true, follow: true },
  };
}
