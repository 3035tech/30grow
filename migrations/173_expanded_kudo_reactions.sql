-- Expand the fixed emoji domain without changing identity, uniqueness, FKs or data.
-- Apply before deploying the expanded writers. Safe to reapply.
DO $$ BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  ALTER TABLE company_kudo_reactions DROP CONSTRAINT IF EXISTS company_kudo_reactions_emoji_check;
ALTER TABLE company_kudo_reactions ADD CONSTRAINT company_kudo_reactions_emoji_check
  CHECK (emoji IN ('👍','❤️','👏','🎉','🙌','😊','💪','🚀','⭐','🔥','💯','🤝','🏆','🙏','🤩','💡','🥳')) NOT VALID;
ALTER TABLE company_kudo_reactions VALIDATE CONSTRAINT company_kudo_reactions_emoji_check;
END $$;
