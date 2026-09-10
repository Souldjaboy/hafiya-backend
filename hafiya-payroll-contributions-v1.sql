BEGIN;

ALTER TABLE hafiya_salary_profiles
  ADD COLUMN IF NOT EXISTS social_contributions_amount NUMERIC(14,2);

UPDATE hafiya_salary_profiles
SET social_contributions_amount = GREATEST(
  COALESCE(gross_monthly,0) - COALESCE(reference_net,0) - COALESCE(other_fixed_deductions,0),
  0
)
WHERE social_contributions_amount IS NULL;

ALTER TABLE hafiya_salary_profiles
  ALTER COLUMN social_contributions_amount SET DEFAULT 0;

UPDATE hafiya_salary_profiles
SET social_contributions_amount = 0
WHERE social_contributions_amount IS NULL;

ALTER TABLE hafiya_salary_profiles
  ALTER COLUMN social_contributions_amount SET NOT NULL;

COMMIT;
