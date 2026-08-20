-- migrate:up

ALTER TABLE local_position_pricing_completions
  DROP CONSTRAINT local_position_pricing_comple_pricing_id_tenant_id_user_id_fkey,
  ADD CONSTRAINT local_position_pricing_completions_pricing_position_fk
    FOREIGN KEY (pricing_id, tenant_id, user_id)
    REFERENCES pricing_positions(pricing_id, tenant_id, user_id)
    ON DELETE CASCADE;

-- migrate:down

ALTER TABLE local_position_pricing_completions
  DROP CONSTRAINT local_position_pricing_completions_pricing_position_fk,
  ADD CONSTRAINT local_position_pricing_comple_pricing_id_tenant_id_user_id_fkey
    FOREIGN KEY (pricing_id, tenant_id, user_id)
    REFERENCES pricing_positions(pricing_id, tenant_id, user_id);
