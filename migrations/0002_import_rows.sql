-- 0002 — campos de trabalho da importação (revisão e desfazer)
alter table import_rows add column suggested_category_id uuid references categories(id);
alter table import_rows add column target_card_id uuid references credit_cards(id);  -- pagamento de fatura: cartão quitado
alter table import_rows add column group_key text;                                    -- identidade da compra parcelada
alter table import_rows add column prev_state jsonb;                                  -- estado do previsto antes de ser realizado (para desfazer)
alter table import_rows add column learn_pattern text;                                -- regra a aprender ao confirmar
create index import_rows_matched on import_rows(matched_movement_id) where matched_movement_id is not null;
