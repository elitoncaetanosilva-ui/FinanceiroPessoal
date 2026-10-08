-- 0003 — orçamento pode ser negativo (ex.: resgates previstos numa categoria de saída, como na planilha CAIXA 2026)
alter table budget_items drop constraint if exists budget_items_amount_cents_check;
