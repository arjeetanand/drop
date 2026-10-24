-- Let each authenticated sender restore claim status without exposing invite
-- tokens, recipient identifiers, or the private invite table itself.
create or replace function public.get_sender_claimed_drop_ids()
returns table(letter_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.letter_id
  from private.drop_claim_invites i
  join public.letters l on l.id = i.letter_id
  where i.sender_id = (select auth.uid())
    and l.sender_id = (select auth.uid())
    and i.claimed_by is not null
    and i.claimed_at is not null
    and i.revoked_at is null
    and i.replaced_at is null
    and l.status = 'delivered'
    and l.delivery_mode = 'instant'
    and l.payload_kind = 'text'
    and l.recipient_id = i.claimed_by
    and l.media_path is null
    and l.media_mime_type is null
    and l.media_size_bytes is null;
$$;

revoke all on function public.get_sender_claimed_drop_ids() from public, anon, authenticated;
grant execute on function public.get_sender_claimed_drop_ids() to authenticated;
