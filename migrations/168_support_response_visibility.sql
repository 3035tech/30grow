-- Separate internal activity from an answer actually visible to the requester.
-- Keep legacy first_response_at unchanged: it previously measured triage.
ALTER TABLE product_feedback
  ADD COLUMN IF NOT EXISTS first_triaged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_response TEXT;
UPDATE product_feedback SET first_triaged_at=first_response_at
 WHERE first_triaged_at IS NULL AND first_response_at IS NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='product_feedback_public_response_length' AND conrelid='product_feedback'::regclass) THEN
   ALTER TABLE product_feedback ADD CONSTRAINT product_feedback_public_response_length
     CHECK (public_response IS NULL OR char_length(public_response)<=4000);
 END IF;
END $$;
COMMENT ON COLUMN product_feedback.public_response IS 'Plain-text answer visible to the requester in the in-app support history. Internal notes stay private.';
