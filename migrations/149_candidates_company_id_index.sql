-- 149: B-2804.9: leituras "última avaliação por pessoa" guiadas por candidates.
--
-- Núcleo interno e inteligência comportamental passaram de DISTINCT ON sobre assessments
-- (merge com candidates_pkey: percorre a tabela de todas as empresas antes do LIMIT)
-- para candidates c + LATERAL (... LIMIT 1), usando idx_assessments_candidate_created
-- por pessoa. Este índice entrega os candidatos da empresa já em ordem de id, então
-- ORDER BY c.id LIMIT n para ao atingir o teto, sem tocar outras empresas.
-- Nenhum índice existente tinha id logo após company_id.
-- O mix de tipos da cultura (agrega a empresa inteira, sem LIMIT) continua DISTINCT ON:
-- lá uma ordenação única mediu 2–3× melhor que uma sonda por pessoa.
--
-- idx_assessments_candidate_created só existia no bootstrap (scripts/rds-bootstrap-completo.sql);
-- repetido aqui para bancos montados apenas por migrations (no-op onde já existe).

CREATE INDEX IF NOT EXISTS idx_candidates_company_id
  ON candidates (company_id, id);

CREATE INDEX IF NOT EXISTS idx_assessments_candidate_created
  ON assessments (candidate_id, created_at DESC);

COMMENT ON INDEX idx_candidates_company_id IS
  'Roster por empresa em ordem de id (LATERAL última avaliação com LIMIT; B-2804.9).';
