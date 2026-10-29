-- A rejected document keeps its attachment for review until the employee replaces it.
-- The reason belongs to the current document state, separate from general RH notes.
ALTER TABLE employee_dp_documents
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE employee_dp_documents
  DROP CONSTRAINT IF EXISTS employee_dp_documents_status_chk;
ALTER TABLE employee_dp_documents
  ADD CONSTRAINT employee_dp_documents_status_chk
  CHECK (status IN ('pending', 'received', 'waived', 'rejected'));

ALTER TABLE employee_dp_documents
  DROP CONSTRAINT IF EXISTS employee_dp_documents_rejection_reason_chk;
ALTER TABLE employee_dp_documents
  ADD CONSTRAINT employee_dp_documents_rejection_reason_chk
  CHECK (char_length(rejection_reason) <= 2000
    AND (status <> 'rejected' OR char_length(btrim(rejection_reason)) > 0));

COMMENT ON COLUMN employee_dp_documents.rejection_reason IS
  'Visible to the employee while a document is rejected; cleared on replacement or status change.';
