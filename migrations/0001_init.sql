-- =====================================================================
-- 0001 — Modelo inicial
-- Convenções:
--   * dinheiro em centavos (bigint), com sinal do ponto de vista do portador
--     (conta: + entra, − sai | cartão: − compra/aumenta a dívida, + pagamento/estorno)
--   * datas de negócio em DATE (sem fuso); datas técnicas em timestamptz
--   * toda tabela de negócio tem user_id
-- =====================================================================

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id text primary key,                -- sha256(token) em hex; o token puro só existe no cookie
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text
);
create index sessions_user on sessions(user_id);

create table login_attempts (
  id bigserial primary key,
  email text not null,
  ip text,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_recent on login_attempts(email, created_at);

-- ---------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------
create table institutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  code text,                          -- código COMPE (341 Itaú, 748 Sicredi, 260 Nubank...)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  institution_id uuid references institutions(id),
  name text not null,
  type text not null check (type in ('CHECKING','SAVINGS','DIGITAL','INVESTMENT','WALLET','CASH','OTHER')),
  branch text,
  number text,
  opening_balance_cents bigint not null default 0,
  opening_balance_date date not null,  -- saldo no FIM deste dia; movimentos até esta data não afetam o saldo
  in_available_balance boolean not null default true,
  is_active boolean not null default true,
  color text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index accounts_user on accounts(user_id);

create table credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  institution_id uuid references institutions(id),
  name text not null,
  brand text,
  last4 text,
  extra_last4 text[] not null default '{}',      -- cartões virtuais/adicionais da mesma fatura
  limit_cents bigint not null default 0,
  closing_day int not null check (closing_day between 1 and 31),
  due_day int not null check (due_day between 1 and 31),
  payment_account_id uuid references accounts(id),
  payment_patterns text[] not null default '{}', -- trechos que identificam o pagamento desta fatura no extrato
  is_active boolean not null default true,
  color text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index credit_cards_user on credit_cards(user_id);

create table card_statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  card_id uuid not null references credit_cards(id),
  due_month date not null check (extract(day from due_month) = 1),
  closing_date date not null,
  due_date date not null,
  reported_total_cents bigint,          -- total informado pelo banco no último arquivo importado
  settled_manually boolean not null default false, -- quitada fora do app (ex.: histórico migrado)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (card_id, due_month)
);

create table people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  parent_id uuid references categories(id),
  name text not null,
  -- natureza econômica: vale na subcategoria; na categoria é o padrão para novas subcategorias
  nature text not null check (nature in ('INCOME','EXPENSE','TRANSFER','INVESTMENT','FINANCING','ADJUSTMENT')),
  section text not null check (section in ('IN','OUT')),   -- agrupador visual: TOTAL DE ENTRADAS / SAÍDAS
  financial_income boolean not null default false,          -- receita financeira (ex.: Rendimento)
  system_key text,                                          -- categorias de sistema (pagamento de fatura, transferência...)
  is_hidden boolean not null default false,                 -- não aparece nos seletores
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_unique_name on categories(user_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create unique index categories_system_key on categories(user_id, system_key) where system_key is not null;
create index categories_parent on categories(parent_id);

-- ---------------------------------------------------------------------
-- Importação (definida antes de movements por causa das FKs)
-- ---------------------------------------------------------------------
create table import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  file_name text not null,
  file_sha256 text not null,
  file_size int not null,
  importer_id text not null,
  institution_name text,
  account_id uuid references accounts(id),
  card_id uuid references credit_cards(id),
  statement_due_date date,
  period_start date,
  period_end date,
  status text not null default 'DRAFT' check (status in ('DRAFT','COMMITTED','DISCARDED','REVERTED')),
  stats jsonb not null default '{}',
  info jsonb not null default '{}',     -- metadados do arquivo: saldos informados, total da fatura, avisos
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  reverted_at timestamptz
);
create index import_batches_user on import_batches(user_id, created_at desc);

create table installment_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  account_id uuid references accounts(id),
  card_id uuid references credit_cards(id),
  description text not null,
  purchase_date date,
  installment_count int not null check (installment_count >= 1),
  installment_amount_cents bigint not null,
  total_amount_cents bigint not null,
  group_key text,                        -- identidade da compra parcelada vinda de arquivo
  created_at timestamptz not null default now(),
  check ((account_id is null) <> (card_id is null))
);
create unique index installment_groups_key on installment_groups(user_id, coalesce(card_id, account_id), group_key) where group_key is not null;

create table recurring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  description text not null,
  amount_cents bigint not null,          -- com sinal (+ receita, − despesa)
  account_id uuid references accounts(id),
  card_id uuid references credit_cards(id),
  category_id uuid references categories(id),
  frequency text not null check (frequency in ('WEEKLY','BIWEEKLY','MONTHLY','YEARLY','CUSTOM')),
  interval_count int not null default 1 check (interval_count >= 1),
  interval_unit text not null default 'MONTH' check (interval_unit in ('DAY','WEEK','MONTH','YEAR')),
  start_date date not null,
  end_date date,
  day_of_month int check (day_of_month between 1 and 31),
  match_pattern text,                    -- trecho da descrição para casar com o realizado importado
  amount_tolerance_pct int not null default 10,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((account_id is null) <> (card_id is null))
);

create table movement_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('TRANSFER','CARD_PAYMENT')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Movimentos (lançamentos)
-- ---------------------------------------------------------------------
create table movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  account_id uuid references accounts(id),
  card_id uuid references credit_cards(id),
  statement_id uuid references card_statements(id),
  kind text not null default 'NORMAL' check (kind in ('NORMAL','TRANSFER','CARD_PAYMENT','ADJUSTMENT')),
  amount_cents bigint not null,
  date date not null,                    -- data da movimentação (compra/lançamento); para previsto, data esperada
  competence date not null check (extract(day from competence) = 1),
  due_date date,                         -- vencimento (contas a pagar/receber previstas)
  paid_date date,                        -- data de liquidação
  description text not null,
  normalized_description text not null default '',
  notes text,
  status text not null default 'REALIZED' check (status in ('PLANNED','REALIZED','CANCELLED')),
  source text not null default 'MANUAL' check (source in ('MANUAL','IMPORT','RECURRING','INSTALLMENT','MIGRATION','SYSTEM','OPEN_FINANCE')),
  import_batch_id uuid references import_batches(id),
  external_id text,
  dedup_key text,
  installment_group_id uuid references installment_groups(id),
  installment_number int,
  installment_total int,
  recurring_rule_id uuid references recurring_rules(id),
  link_id uuid references movement_links(id),
  pays_card_id uuid references credit_cards(id),          -- lado conta de um pagamento de fatura
  settles_statement_id uuid references card_statements(id), -- fatura quitada por este pagamento
  suggested_category_id uuid references categories(id),
  suggestion_confidence numeric(4,3),
  suggestion_source text,
  adjustment_reason text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((account_id is null) <> (card_id is null)),
  check ((card_id is null) = (statement_id is null)),
  check ((installment_group_id is null) = (installment_number is null))
);
-- Regra crítica: o banco recusa duplicata (mesmo portador + mesma chave) entre os não excluídos.
create unique index movements_dedup on movements(coalesce(account_id, card_id), dedup_key)
  where dedup_key is not null and deleted_at is null;
create index movements_user_date on movements(user_id, date desc, id) where deleted_at is null;
create index movements_user_comp on movements(user_id, competence) where deleted_at is null;
create index movements_account on movements(account_id, date) where deleted_at is null;
create index movements_card on movements(card_id, statement_id) where deleted_at is null;
create index movements_statement on movements(statement_id) where deleted_at is null;
create index movements_settles on movements(settles_statement_id) where settles_statement_id is not null;
create index movements_group on movements(installment_group_id) where installment_group_id is not null;
create index movements_rule on movements(recurring_rule_id) where recurring_rule_id is not null;
create index movements_link on movements(link_id) where link_id is not null;
create index movements_batch on movements(import_batch_id) where import_batch_id is not null;
create index movements_planned on movements(user_id, status, date) where status = 'PLANNED' and deleted_at is null;

create table movement_splits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  movement_id uuid not null references movements(id) on delete cascade,
  category_id uuid references categories(id),   -- nulo = pendente de classificação
  amount_cents bigint not null,
  person_id uuid references people(id),         -- dimensão Pessoa/Responsável (futuro)
  notes text,
  sort_order int not null default 0
);
create index splits_movement on movement_splits(movement_id);
create index splits_category on movement_splits(category_id);
create index splits_pending on movement_splits(user_id) where category_id is null;

create table import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references import_batches(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  row_index int not null,
  raw jsonb not null,
  date date,
  description text,
  amount_cents bigint,                   -- já no sinal do portador
  installment_number int,
  installment_total int,
  purchase_date date,
  external_id text,
  dedup_key text,
  row_kind text not null default 'NORMAL' check (row_kind in ('NORMAL','CARD_PAYMENT','TRANSFER')),
  status text not null check (status in ('NEW','DUPLICATE','MATCHED','POSSIBLE_DUPLICATE','IGNORED','ERROR')),
  action text not null check (action in ('IMPORT','SKIP','LINK')),
  matched_movement_id uuid references movements(id),
  created_movement_id uuid references movements(id),
  category_id uuid references categories(id),
  confidence numeric(4,3),
  rule_id uuid,
  classification_source text,
  message text
);
create index import_rows_batch on import_rows(batch_id, row_index);

create table classification_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  pattern text not null,
  match_type text not null default 'CONTAINS' check (match_type in ('CONTAINS','STARTS_WITH','EXACT','REGEX')),
  direction text check (direction in ('IN','OUT')),
  account_id uuid references accounts(id),
  card_id uuid references credit_cards(id),
  min_amount_cents bigint,
  max_amount_cents bigint,
  category_id uuid not null references categories(id),
  priority int not null default 0,
  origin text not null default 'USER' check (origin in ('SYSTEM','USER','LEARNED')),
  hits int not null default 0,
  last_hit_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index classification_rules_user on classification_rules(user_id) where is_active;

create table budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  year int not null,
  created_at timestamptz not null default now(),
  unique (user_id, year)
);

create table budget_items (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references budgets(id) on delete cascade,
  category_id uuid not null references categories(id),
  month int not null check (month between 1 and 12),
  amount_cents bigint not null check (amount_cents >= 0),
  unique (budget_id, category_id, month)
);

create table balance_checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  account_id uuid not null references accounts(id),
  date date not null,
  balance_cents bigint not null,
  source text not null default 'IMPORT' check (source in ('IMPORT','MANUAL')),
  import_batch_id uuid references import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (account_id, date)
);

create table audit_events (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  entity text not null,
  entity_id uuid,
  action text not null,
  field text,
  old_value text,
  new_value text,
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_entity on audit_events(entity, entity_id, created_at desc);

-- ---------------------------------------------------------------------
-- Integridade do rateio: soma dos rateios = valor do movimento.
-- Trigger de constraint DIFERIDO: é verificado no COMMIT, então o movimento e
-- seus rateios podem ser gravados em qualquer ordem dentro da mesma transação.
-- ---------------------------------------------------------------------
create function check_movement_splits(mid uuid) returns void language plpgsql as $$
declare
  mv record;
  total bigint;
  n int;
begin
  select amount_cents, deleted_at into mv from movements where id = mid;
  if not found or mv.deleted_at is not null then return; end if;
  select coalesce(sum(amount_cents), 0), count(*) into total, n from movement_splits where movement_id = mid;
  if n = 0 then
    raise exception 'Movimento % sem rateio (classificação)', mid using errcode = 'check_violation';
  end if;
  if total <> mv.amount_cents then
    raise exception 'Rateio do movimento % soma % mas o movimento vale %', mid, total, mv.amount_cents using errcode = 'check_violation';
  end if;
end $$;

create function trg_splits_check() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform check_movement_splits(old.movement_id); end if;
  if tg_op in ('INSERT','UPDATE') then perform check_movement_splits(new.movement_id); end if;
  return null;
end $$;

create function trg_movement_check() returns trigger language plpgsql as $$
begin
  perform check_movement_splits(new.id);
  return null;
end $$;

create constraint trigger movement_splits_sum
  after insert or update or delete on movement_splits
  deferrable initially deferred
  for each row execute function trg_splits_check();

create constraint trigger movements_splits_sum
  after insert or update of amount_cents, deleted_at on movements
  deferrable initially deferred
  for each row execute function trg_movement_check();
