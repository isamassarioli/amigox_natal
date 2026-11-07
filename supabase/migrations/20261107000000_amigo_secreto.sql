-- Amigo secreto da Família Santos
-- Guarda todo o estado do app numa única linha JSON. A função "amigo" lê e grava
-- por conexão direta, dentro de uma transação, então dois nomes nunca são escolhidos ao mesmo tempo.

create table if not exists public.app_estado (
  id int primary key check (id = 1),
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);

-- Segurança: com RLS ligado e sem nenhuma policy, a chave pública (anon) não lê nem grava nada.
alter table public.app_estado enable row level security;
revoke all on public.app_estado from anon, authenticated;

insert into public.app_estado (id, dados)
values (
  1,
  jsonb_build_object(
    'versao', 1,
    'familia', 'Santos',
    'ano', 2026,
    'evento', jsonb_build_object('data', '2026-12-24T20:00', 'local', '', 'valorSugerido', 80),
    'participantes', '[]'::jsonb,
    'exclusoes', '[]'::jsonb,
    'sorteio', jsonb_build_object('realizado', false, 'realizadoEm', null, 'pares', '{}'::jsonb),
    'erros', '[]'::jsonb,
    'segredo', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  )
)
on conflict (id) do nothing;
