# Transferência de uma empresa pelo pgAdmin

Os utilitários desta entrega foram preparados para a transferência **team / empresa 2
(3035TECH)** para **grow30 / empresa 3**. Não são um importador genérico ou uma
sincronização contínua. O destino já possui a empresa Voren no ID 2.

## Arquivos de trabalho

- `scripts/company-transfer-preflight.sql`: inventário e contagens, sem escrita permanente.
- `scripts/company-transfer-export.sql`: snapshot consistente da empresa 2 e fechamento
  das relações por FK, incluindo chaves compostas, relações indiretas e os arrays
  explicitamente conhecidos. Aborta se uma dependência alcançar outra empresa.
- `scripts/prepare-company-transfer.py`: compara os CSVs da origem e do destino,
  prepara SQL transacional e recusa conflitos não tratados. Não acessa bancos.

No exportador, executar o arquivo inteiro no Query Tool, salvar **todos** os resultados
como CSV e depois executar `ROLLBACK;` na mesma aba. O CSV deve conter `kind`, `name`,
`payload`. O manifesto permite conferir se o download foi completo. O exportador
mantém a transação aberta até esse rollback para funcionar também via PgBouncer.

O snapshot do destino deve incluir os registros, metadados de colunas e constraints,
além de índices, funções e triggers para o ensaio local. O arquivo de reconstrução
`clone-destination-LOCAL-ONLY.sql` é exclusivamente para um banco descartável vazio;
nunca executá-lo em produção.

```sh
python3 scripts/prepare-company-transfer.py \
  --source /caminho/privado/source.csv \
  --destination /caminho/privado/destination-full.csv \
  --out /caminho/privado/prepared
```

Os artefatos contêm dados pessoais e hashes de senha; não versionar nem publicar.
O gerador os grava com permissão `0600`. O diretório deve ser privado. Conservar
os CSVs e seus SHA-256 (`provenance.json`) junto ao relatório da operação.

## Decisões desta transferência

- Preservar IDs de candidatos, vagas, avaliações, catálogos Motivadores e históricos.
  Esses IDs também aparecem em arrays, JSON e snapshots. Conflitos desconhecidos
  interrompem a preparação, em vez de serem ignorados com `ON CONFLICT DO NOTHING`.
- Mudar somente a identidade da empresa 2 para 3 nas relações e campos identificados.
- Reutilizar os três administradores já existentes, por igualdade do e-mail e do papel;
  remapear as referências aos autores. Não criar usuários nem ampliar permissões.
- Reutilizar áreas e rubricas globais quando os valores de negócio forem equivalentes.
  Preservar datas dos catálogos existentes no destino.
- Adicionar apenas as estruturas necessárias aos dados exportados que faltam no destino:
  `company_billing_terms`, `time_clock_person_history` e `employee_time_punches.rep_collector`.
  Usar tipos, defaults, PKs, CHECKs, unicidade e FKs do schema de origem. Não registrar
  como aplicadas migrations completas: a expansão mínima não substitui um upgrade
  posterior do schema/aplicativo.
- Não copiar eventos Stripe globais ou estatísticas globais de outras empresas.
  Os dados comerciais da empresa que efetivamente existem no snapshot são preservados.
- Por solicitação do usuário, **S3 fora do escopo**: preservar chaves e URLs originais.
  `files.json` é apenas um plano para uma cópia futura, não uma comprovação de cópia.
  Como a empresa muda de ID, o acesso aos dois objetos pelo aplicativo pode exigir
  posteriormente cópia e atualização das referências para o novo prefixo.

## Execução e prova

O `import.sql` deve ser ensaiado primeiro numa cópia descartável do destino com os
dados e constraints capturados. Ele ordena os registros por dependências reais,
mantendo os triggers e FKs ativos. Não usa `session_replication_role`, desativação
de triggers, exclusão, truncamento ou sobrescrita de dados de negócio existentes.

O SQL valida primeiro as identidades/papéis dos usuários e os valores de negócio
dos catálogos globais reutilizados. Sob bloqueio transacional, captura então o estado
atual das tabelas do destino e confere sua preservação por igualdade do JSON tipado
antes do commit. Assim, acessos e atualizações normais ocorridos desde o backup são
preservados. Novas colisões de IDs, unicidade ou referências abortam a transação.
Cada registro importado é comparado com sua representação tipada no destino antes
do commit. O bloqueio de escrita é limitado à duração da transação.

As sequences usadas são avançadas sem retrocesso. Em PostgreSQL, mudanças em
sequences não são transacionais: uma falha nesse trecho pode deixar lacunas, mas
não deve reutilizar IDs. Os valores de sequences da origem não são transferidos.

Reaplicar o mesmo importador depois do sucesso deve abortar pela presença dos dados;
nunca deve criar uma segunda cópia da empresa. Os scripts não são uma sincronização:
alterações feitas na origem depois do timestamp do manifesto ficam fora do snapshot.

## Senhas: etapa manual separada

`restore-origin-passwords-MANUAL.sql` substitui somente os hashes de senha das três
contas correspondentes e incrementa `session_version`, revogando sessões anteriores.
Não altera e-mails, papéis ou 2FA. O operador deve abrir e executar esse arquivo
pessoalmente no pgAdmin do destino; a automação de interface não realiza essa troca
de credenciais. O arquivo contém os hashes e não deve ser exibido em relatórios.

## Rollback

Antes do commit, um erro deve ser seguido por `ROLLBACK;` na mesma aba. Nenhuma linha
importada é confirmada parcialmente. Depois do commit, não executar um restore geral
sobre produção ativa: usar o snapshot anterior, o manifesto e o mapeamento para preparar
uma reversão específica, verificando novas dependências e alterações posteriores.
Uma reversão com exclusão definitiva exige aprovação própria. Preservar a origem
até o aceite dos dados e da etapa manual de credenciais.

## Operação de 22/10/2026

Importação confirmada em `grow30`: empresa 3, 2.370 inserções, 129 candidatos,
121 avaliações de perfil, 8 vagas, 13 tentativas Motivadores, 36 registros de
documentos e 15 registros do histórico de ponto. A empresa 2 (Voren) e os cinco
usuários existentes foram preservados. A conferência foi repetida por consulta
independente após o commit. Senhas da origem: arquivo manual preparado, ainda
não aplicado pela automação. S3 fora do escopo.

O ensaio local reconstruiu o destino a partir de 506 registros, índices, funções,
triggers e constraints reais, em PostgreSQL descartável. Também simulou registros
adicionais de analytics e atualização da versão de sessão de um usuário antes da
captura transacional. As duas tentativas anteriores bloqueadas pelas verificações
do snapshot antigo foram revertidas antes da tentativa bem-sucedida.

Os arquivos privados da operação estão em `test-results/company-transfer-20261022/`
(gitignored, diretório `0700`, arquivos `0600`), incluindo os snapshots, o SQL exato
executado, SHA-256, relatório, conferência e a etapa manual de senhas. Não publicar
esse diretório. O snapshot de origem é de 22/10/2026 às 13:11:36 UTC (10:11:36 BRT).
