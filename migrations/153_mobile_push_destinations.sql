-- 153: B-2721 — destino de push declarado pelo aparelho (Ponto / Campo no app).
--
-- Decisões de modelagem:
-- * O app mobile não está neste repositório e versões antigas não têm as telas novas.
--   Em vez de comparar versão no servidor, cada aparelho declara as telas opcionais que
--   sabe abrir (`push_destinations`). Push para tela não declarada cai em `today`.
-- * TEXT[] com CHECK de subconjunto: domínio fixo pequeno (espelho de
--   MOBILE_PUSH_OPT_IN_DESTINATIONS em lib/mobile-employee-push.js), lido junto com o token
--   (sem join extra no envio). Cardinalidade mínima, sem histórico: tabela própria seria excesso.
-- * app_version só para suporte/diagnóstico; não decide nada (formato curto validado).

ALTER TABLE mobile_employee_push_tokens
  ADD COLUMN IF NOT EXISTS app_version TEXT;

ALTER TABLE mobile_employee_push_tokens
  ADD COLUMN IF NOT EXISTS push_destinations TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE mobile_employee_push_tokens
  DROP CONSTRAINT IF EXISTS mobile_employee_push_tokens_app_version_chk;
ALTER TABLE mobile_employee_push_tokens
  ADD CONSTRAINT mobile_employee_push_tokens_app_version_chk
  CHECK (app_version IS NULL OR char_length(app_version) <= 32);

ALTER TABLE mobile_employee_push_tokens
  DROP CONSTRAINT IF EXISTS mobile_employee_push_tokens_destinations_chk;
ALTER TABLE mobile_employee_push_tokens
  ADD CONSTRAINT mobile_employee_push_tokens_destinations_chk
  CHECK (push_destinations <@ ARRAY['time_clock', 'field']::TEXT[]);

INSERT INTO schema_migrations (name) VALUES ('153_mobile_push_destinations.sql')
ON CONFLICT (name) DO NOTHING;
