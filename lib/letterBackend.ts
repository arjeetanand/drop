import type { MockLetter, TrackingEvent } from '@/data/mockData';
import type { DropDeliveryMode, DropPayloadKind } from '@/data/mockData';
import type { JourneyNote, LetterDraftState } from '@/lib/letterStore';
import type { UserProfile } from '@/lib/userStore';
import { getPendingRemoteProfileSnapshot, suggestedDropUsername, withPendingRemoteProfileLock } from '@/lib/userStore';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { isCurrentLocalAccount } from '@/lib/localAccountScope';
import { normalizeDropRecipient, validateDropMedia } from '@/lib/dropValidation';
import { createStagedDropMediaAttemptPath, isDropMediaFinalPath, resolveDropMediaPaths } from '@/lib/dropMediaStorage';
import { mergeDropReactions, type DropReactionRow } from '@/lib/mergeDropReactions';
import { matchesStoredDropMetadata, type DropSendIntent, type StoredDropSend } from '@/lib/dropSendRecovery';
import { fetchAllPages, fetchPagedMailbox } from '@/lib/fetchAllPages';
import { uniqueRecentDropRecipients, type RecentDropRecipient, type RecentDropRecipientRow } from '@/lib/recentDropRecipients';
import { subscribeToDropInbox } from '@/lib/dropInboxRealtime';
import { subscribeToDropReactions } from '@/lib/dropReactionRealtime';
import { isDropClaimToken, resolveDropClaimInviteResult } from '@/lib/dropClaim';
import { markSenderClaimedDrops } from '@/lib/claimInviteStatus';
import { withFallbackTimeout } from '@/lib/withFallbackTimeout';

const SENDER_CLAIM_STATUS_TIMEOUT_MS = 5_000;

type LetterRow = {
  id: string;
  sender_id: string;
  sender_profile?: { username: string } | null;
  recipient_id: string | null;
  sender_display_name: string | null;
  recipient_username: string | null;
  recipient_name: string | null;
  subject: string;
  content?: string;
  teaser: string[] | null;
  status: MockLetter['status'];
  seal_id: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  created_at: string;
  payload_kind: DropPayloadKind | null;
  delivery_mode: DropDeliveryMode | null;
  media_path: string | null;
  media_mime_type: string | null;
  media_size_bytes: number | null;
  media_claim_expires_at?: string | null;
};

type RecipientRelayDropRow = {
  id: string;
  sender_display_name: string | null;
  created_at: string;
  dispatched_at: string | null;
  handoff_count: number;
  latest_carrier: string | null;
  latest_neighborhood: string | null;
  latest_note: string | null;
  latest_handoff_at: string | null;
};

type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  letters_sent: number;
  letters_received: number;
};

async function getAuthenticatedClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { supabase, user: data.user };
}

type AuthenticatedContext = NonNullable<Awaited<ReturnType<typeof getAuthenticatedClient>>>;

type ExistingSendRow = {
  sender_id: string;
  recipient_id: string | null;
  recipient_username: string | null;
  subject: string;
  content: string | null;
  seal_id: string | null;
  payload_kind: DropPayloadKind | null;
  delivery_mode: DropDeliveryMode | null;
  media_path: string | null;
  media_mime_type: string | null;
  media_size_bytes: number | null;
  status: MockLetter['status'];
  dispatched_at: string | null;
};

type ExistingSendRead = { state: 'missing' } | { state: 'unavailable' } | { state: 'found'; row: ExistingSendRow };

async function readExistingDrop(context: AuthenticatedContext, draftId: string): Promise<ExistingSendRead> {
  try {
    const { data, error } = await context.supabase.from('letters')
      .select('sender_id, recipient_id, recipient_username, subject, content, seal_id, payload_kind, delivery_mode, media_path, media_mime_type, media_size_bytes, status, dispatched_at')
      .eq('id', draftId)
      .maybeSingle<ExistingSendRow>();
    if (error) return { state: 'unavailable' };
    return data ? { state: 'found', row: data } : { state: 'missing' };
  } catch {
    return { state: 'unavailable' };
  }
}

function toStoredDropSend(row: ExistingSendRow): StoredDropSend {
  return {
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    recipientUsername: row.recipient_username,
    subject: row.subject,
    content: row.content,
    sealId: row.seal_id,
    payloadKind: row.payload_kind,
    deliveryMode: row.delivery_mode,
    mediaPath: row.media_path,
    mediaMimeType: row.media_mime_type,
    mediaSizeBytes: row.media_size_bytes,
    status: row.status,
    dispatchedAt: row.dispatched_at,
  };
}

type DropRecipientProfile = { id: string; username: string; displayName: string };
export type DropRecipientLookup =
  | { status: 'found'; recipient: DropRecipientProfile }
  | { status: 'not-found' }
  | { status: 'error' };

async function resolveDropRecipient(context: AuthenticatedContext, username: string): Promise<DropRecipientLookup> {
  try {
    const { data, error } = await context.supabase
      .from('public_profiles')
      .select('id, username, display_name')
      .eq('username', username)
      .maybeSingle<{ id: string; username: string; display_name: string | null }>();
    if (error) return { status: 'error' };
    if (!data || data.username !== username) return { status: 'not-found' };
    return { status: 'found', recipient: { id: data.id, username: data.username, displayName: data.display_name || data.username } };
  } catch {
    return { status: 'error' };
  }
}

export async function lookupDropRecipient(value: string): Promise<DropRecipientLookup> {
  const username = normalizeDropRecipient(value);
  if (!username) return { status: 'not-found' };
  try {
    const context = await getAuthenticatedClient();
    return context ? resolveDropRecipient(context, username) : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

export async function getRemoteRecentDropRecipients(): Promise<RecentDropRecipient[] | null> {
  try {
    const context = await getAuthenticatedClient();
    if (!context) return null;

    const { data, error } = await context.supabase.from('letters')
      .select('recipient_username, recipient_name')
      .eq('sender_id', context.user.id)
      .in('status', ['dispatched', 'delivered'])
      .order('dispatched_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      // shortcut: scan the latest 100 sent drops; use a distinct-recipient query if high-volume accounts need older people.
      .limit(100)
      .returns<RecentDropRecipientRow[]>();
    if (error || !data) return null;
    return uniqueRecentDropRecipients(data);
  } catch {
    return null;
  }
}

export type RemoteProfileState =
  | { status: 'unavailable' }
  | { status: 'signed-out' }
  | { status: 'error'; userId?: string }
  | { status: 'missing'; userId: string; email: string; displayName: string }
  | { status: 'found'; userId: string; email: string; displayName: string; profile: UserProfile };

async function getRemoteProfileForContext(context: AuthenticatedContext): Promise<RemoteProfileState> {
  const identity = {
    userId: context.user.id,
    email: context.user.email || '',
    displayName: typeof context.user.user_metadata?.full_name === 'string'
      ? context.user.user_metadata.full_name
      : typeof context.user.user_metadata?.name === 'string'
        ? context.user.user_metadata.name
        : context.user.email?.split('@')[0] || '',
  };

  try {
    const { data, error } = await context.supabase
      .from('profiles')
      .select('id, username, display_name, bio, letters_sent, letters_received')
      .eq('id', context.user.id)
      .maybeSingle<ProfileRow>();

    if (error) return { status: 'error', userId: context.user.id };
    if (!data) return { status: 'missing', ...identity };
    return {
      status: 'found',
      ...identity,
      profile: {
        displayName: data.display_name,
        username: data.username,
        bio: data.bio,
        lettersSent: data.letters_sent,
        lettersReceived: data.letters_received,
      },
    };
  } catch {
    return { status: 'error', userId: context.user.id };
  }
}

export async function getRemoteProfileState(): Promise<RemoteProfileState> {
  try {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return { status: 'unavailable' };
    const { data, error } = await supabase.auth.getUser();
    if (error) return { status: error.name === 'AuthSessionMissingError' ? 'signed-out' : 'error' };
    if (!data.user) return { status: 'signed-out' };
    return getRemoteProfileForContext({ supabase, user: data.user });
  } catch {
    return { status: 'error' };
  }
}

export async function getRemoteProfile(): Promise<UserProfile | null> {
  const state = await getRemoteProfileState();
  return state.status === 'found' ? state.profile : null;
}

export type SaveRemoteProfileResult =
  | { ok: true }
  | { ok: false; reason: 'signed-out' | 'account-changed' | 'profile-changed' | 'username-taken' | 'profile-exists' | 'sync-failed' };

async function writeRemoteProfile(context: AuthenticatedContext, profile: UserProfile, createOnly = false, expectedProfile?: UserProfile): Promise<SaveRemoteProfileResult> {
  try {
    const row = {
      id: context.user.id,
      username: profile.username,
      display_name: profile.displayName,
      bio: profile.bio,
    };
    if (createOnly) {
      const { error } = await context.supabase.from('profiles').insert(row);
      if (!error) return { ok: true };
      if (error.code !== '23505') return { ok: false, reason: 'sync-failed' };
      const currentProfile = await getRemoteProfileForContext(context);
      if (currentProfile.status === 'found') return { ok: false, reason: 'profile-exists' };
      if (currentProfile.status === 'error') return { ok: false, reason: 'sync-failed' };
      return { ok: false, reason: 'username-taken' };
    }
    if (!expectedProfile) return { ok: false, reason: 'profile-changed' };
    const { data, error } = await context.supabase.from('profiles')
      .update({ username: row.username, display_name: row.display_name, bio: row.bio })
      .eq('id', context.user.id)
      .eq('username', expectedProfile.username)
      .eq('display_name', expectedProfile.displayName)
      .eq('bio', expectedProfile.bio)
      .select('id')
      .maybeSingle();
    if (!error && data) return { ok: true };
    if (!error) return { ok: false, reason: 'profile-changed' };
    if (error.code !== '23505') return { ok: false, reason: 'sync-failed' };
    return { ok: false, reason: 'username-taken' };
  } catch {
    return { ok: false, reason: 'sync-failed' };
  }
}

export async function saveRemoteProfile(profile: UserProfile, expectedUserId: string, createOnly = false, pendingRevision?: string, expectedProfile?: UserProfile): Promise<SaveRemoteProfileResult> {
  return withPendingRemoteProfileLock(expectedUserId, async () => {
    if (pendingRevision && getPendingRemoteProfileSnapshot(expectedUserId)?.revision !== pendingRevision) {
      return { ok: false, reason: 'profile-changed' };
    }
    const context = await getAuthenticatedClient();
    if (!context) return { ok: false, reason: 'signed-out' };
    if (context.user.id !== expectedUserId) return { ok: false, reason: 'account-changed' };
    return writeRemoteProfile(context, profile, createOnly, expectedProfile);
  });
}

function rowToLetter(row: LetterRow, userId: string, revealContent = false): MockLetter {
  const content = row.content?.trim() || '';
  const teaser = row.teaser?.filter(Boolean).join(' ') || content.slice(0, 150);
  const mediaFallback = row.payload_kind === 'gif' ? 'A GIF is waiting behind the seal.' : row.payload_kind === 'image' ? 'A photo is waiting behind the seal.' : 'A sealed drop waiting to be opened.';
  return {
    id: row.id,
    recipient: row.status === 'claim_pending' ? 'your invited friend' : row.recipient_name || row.recipient_username || 'your correspondent',
    sender: row.sender_display_name || undefined,
    senderUsername: row.sender_profile?.username || undefined,
    direction: row.sender_id === userId ? 'sent' : 'received',
    date: row.dispatched_at
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(row.dispatched_at))
      : 'Saved just now',
    activityAt: row.delivered_at ?? row.dispatched_at ?? row.created_at,
    status: row.status,
    // Mailbox cards get a teaser only. Full content is fetched on the detail route after reveal.
    excerpt: revealContent
      ? content || (row.payload_kind === 'text' || !row.payload_kind ? 'An empty drop, waiting for your words.' : '')
      : teaser ? `${teaser}${content.length > 150 ? '…' : ''}` : mediaFallback,
    subject: row.subject || 'Untitled drop',
    teaser: row.teaser || undefined,
    payloadKind: row.payload_kind || 'text',
    deliveryMode: row.delivery_mode || 'instant',
    mediaPath: row.media_path || undefined,
    mediaMimeType: row.media_mime_type || undefined,
    mediaSizeBytes: row.media_size_bytes || undefined,
    mediaExpiresAt: row.media_claim_expires_at || undefined,
  };
}

function rowToRecipientRelayDrop(row: RecipientRelayDropRow): MockLetter {
  const activityAt = row.latest_handoff_at || row.dispatched_at || row.created_at;
  return {
    id: row.id,
    recipient: 'you',
    sender: row.sender_display_name || 'Someone you know',
    direction: 'received',
    date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(activityAt)),
    activityAt,
    status: 'dispatched',
    excerpt: 'The private part stays sealed while this drop travels.',
    subject: 'A drop is on its way',
    deliveryMode: 'relay',
    relayProgress: {
      handoffCount: row.handoff_count,
      latestCarrier: row.latest_carrier,
      latestNeighborhood: row.latest_neighborhood,
      latestNote: row.latest_note,
      latestHandoffAt: row.latest_handoff_at,
    },
  };
}

const MAILBOX_SELECT = 'id, sender_id, sender_profile:public_profiles!letters_sender_id_fkey(username), recipient_id, sender_display_name, recipient_username, recipient_name, subject, teaser, status, seal_id, dispatched_at, delivered_at, created_at, payload_kind, delivery_mode, media_path, media_mime_type, media_size_bytes';
const LETTER_SELECT = `${MAILBOX_SELECT}, content, media_claim_expires_at`;

export interface RemoteMailboxSnapshot {
  letters: MockLetter[];
  reactionsHydrated: boolean;
  claimStatusHydrated: boolean;
}

type SenderClaimedDropRow = { letter_id: string };

async function readSenderClaimedDropIds(context: AuthenticatedContext): Promise<string[] | null> {
  try {
    const { data, error } = await context.supabase
      .rpc('get_sender_claimed_drop_ids')
      .returns<SenderClaimedDropRow[]>();
    if (error || !Array.isArray(data)) return null;
    return data.flatMap((row) => typeof row.letter_id === 'string' ? [row.letter_id] : []);
  } catch {
    return null;
  }
}

async function readSenderClaimedDropIdsWithTimeout(context: AuthenticatedContext): Promise<string[] | null> {
  return withFallbackTimeout(readSenderClaimedDropIds(context), SENDER_CLAIM_STATUS_TIMEOUT_MS, null);
}

export async function getRemoteSenderClaimStatusForDrop(letterId: string): Promise<boolean | null> {
  try {
    return await withFallbackTimeout((async () => {
      const context = await getAuthenticatedClient();
      if (!context) return null;
      const claimedDropIds = await readSenderClaimedDropIds(context);
      return claimedDropIds === null ? null : claimedDropIds.includes(letterId);
    })(), SENDER_CLAIM_STATUS_TIMEOUT_MS, null);
  } catch {
    return null;
  }
}

export type RemoteDropDirection = 'sent' | 'received' | 'signed-out' | 'unavailable';

/** Read only enough to decide whether this detail route should monitor sender reactions. */
export async function getRemoteDropDirection(letterId: string): Promise<RemoteDropDirection> {
  try {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return 'unavailable';
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) return authError.name === 'AuthSessionMissingError' ? 'signed-out' : 'unavailable';
    if (!authData.user) return 'signed-out';
    const { data, error } = await supabase.from('letters')
      .select('sender_id')
      .eq('id', letterId)
      .maybeSingle<{ sender_id: string }>();
    if (error || !data) return 'unavailable';
    return data.sender_id === authData.user.id ? 'sent' : 'received';
  } catch {
    return 'unavailable';
  }
}

export async function getRemoteLetters(): Promise<RemoteMailboxSnapshot | null> {
  const context = await getAuthenticatedClient();
  if (!context) return null;

  const mailbox = await fetchPagedMailbox<LetterRow, DropReactionRow>(
    async (from, to) => {
      const { data, error } = await context.supabase
        .from('letters')
        .select(MAILBOX_SELECT)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
        .returns<LetterRow[]>();

      return error || !data ? null : data;
    },
    async (letterIds) => {
      const { data, error } = await context.supabase
        .from('letter_reactions')
        .select('letter_id, emoji, updated_at')
        .in('letter_id', letterIds)
        .returns<DropReactionRow[]>();

      return error || !data ? null : data;
    },
  );

  if (!mailbox) return null;
  const letters = mailbox.letters.map((row) => rowToLetter(row, context.user.id));
  const [claimedDropIds, recipientRelayRead] = await Promise.all([
    readSenderClaimedDropIdsWithTimeout(context),
    context.supabase.rpc('get_recipient_relay_drops').returns<RecipientRelayDropRow[]>(),
  ]);
  const claimedLetters = markSenderClaimedDrops(letters, claimedDropIds);
  const { data: recipientRelayRows, error: recipientRelayError } = recipientRelayRead;
  const recipientRelayDrops = recipientRelayError || !Array.isArray(recipientRelayRows)
    ? []
    : recipientRelayRows.map((row) => rowToRecipientRelayDrop(row as RecipientRelayDropRow));
  const displayLetters = mailbox.reactions
    ? mergeDropReactions(claimedLetters, mailbox.reactions)
    : claimedLetters;
  return {
    letters: [...displayLetters, ...recipientRelayDrops],
    reactionsHydrated: mailbox.reactions !== null,
    claimStatusHydrated: claimedDropIds !== null,
  };
}

export async function collectRemoteRelayDrop(letterId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const context = await getAuthenticatedClient();
    if (!context) return { ok: false, error: 'Sign in as the drop recipient to collect it.' };
    const { error } = await context.supabase.rpc('collect_relay_drop', { p_letter_id: letterId });
    if (error) return { ok: false, error: 'This drop could not be collected. Check your connection and try again.' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'This drop could not be collected. Check your connection and try again.' };
  }
}

export async function subscribeToIncomingDropInbox(onDropSignal: (dropId?: string) => void): Promise<() => void> {
  try {
    const context = await getAuthenticatedClient();
    return context ? subscribeToDropInbox(context.supabase, context.user.id, onDropSignal) : () => {};
  } catch {
    return () => {};
  }
}

export async function subscribeToSenderDropReactions(onDropSignal: (dropId?: string) => void): Promise<() => void> {
  let active = true;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const setup = (async () => {
    try {
      const context = await getAuthenticatedClient();
      return context
        ? await subscribeToDropReactions(context.supabase, context.user.id, (dropId) => {
          if (active) onDropSignal(dropId);
        })
        : () => {};
    } catch {
      return () => {};
    }
  })();
  const timedOut = Symbol('reaction-subscription-timeout');
  try {
    const result = await Promise.race([
      setup,
      new Promise<typeof timedOut>((resolve) => {
        timeout = setTimeout(() => resolve(timedOut), 10_000);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    if (result === timedOut) {
      active = false;
      void setup.then((stop) => stop());
      return () => { active = false; };
    }
    return () => {
      if (!active) return;
      active = false;
      result();
    };
  } catch {
    if (timeout) clearTimeout(timeout);
    active = false;
    void setup.then((stop) => stop());
    return () => {};
  }
}

export async function getRemoteJourneyLetters(): Promise<MockLetter[] | null> {
  const context = await getAuthenticatedClient();
  if (!context) return null;

  const rows = await fetchAllPages<LetterRow>(async (from, to) => {
    const { data, error } = await context.supabase
      .from('letters')
      .select(MAILBOX_SELECT)
      .eq('sender_id', context.user.id)
      .in('status', ['dispatched', 'delivered'])
      .or('delivery_mode.eq.relay,status.eq.dispatched')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
      .returns<LetterRow[]>();

    return error || !data ? null : data;
  });
  return rows?.map((row) => rowToLetter(row, context.user.id)) ?? null;
}

export async function getRemoteJourneyLetter(letterId: string): Promise<MockLetter | null> {
  const context = await getAuthenticatedClient();
  if (!context) return null;

  const { data, error } = await context.supabase
    .from('letters')
    .select(MAILBOX_SELECT)
    .eq('id', letterId)
    .eq('sender_id', context.user.id)
    .maybeSingle<LetterRow>();

  return error || !data ? null : rowToLetter(data, context.user.id);
}

export async function getRemoteLetterById(letterId: string): Promise<MockLetter | null> {
  const context = await getAuthenticatedClient();
  if (!context) return null;

  const { data, error } = await context.supabase
    .from('letters')
    .select(LETTER_SELECT)
    .eq('id', letterId)
    .maybeSingle<LetterRow>();

  if (error || !data) return null;
  let letter = rowToLetter(data, context.user.id, true);
  if (letter.direction === 'sent'
    && letter.status === 'delivered'
    && letter.deliveryMode === 'instant'
    && letter.payloadKind === 'text') {
    letter = markSenderClaimedDrops([letter], await readSenderClaimedDropIdsWithTimeout(context))[0];
  }
  if (data.media_path) {
    const { data: signed } = await context.supabase.storage.from('drop-media').createSignedUrl(data.media_path, 60);
    letter.mediaUrl = signed?.signedUrl;
  }
  const reactionSnapshot = await readRemoteReaction(context, letterId);
  letter.reaction = reactionSnapshot.reaction ?? undefined;
  return letter;
}

export interface RemoteReactionSnapshot {
  available: boolean;
  reaction: string | null;
}

async function readRemoteReaction(context: AuthenticatedContext, letterId: string): Promise<RemoteReactionSnapshot> {
  try {
    const { data, error } = await context.supabase.from('letter_reactions')
      .select('emoji')
      .eq('letter_id', letterId)
      .maybeSingle<{ emoji: string }>();
    if (error) return { available: false, reaction: null };
    if (!data) return { available: true, reaction: null };
    return typeof data.emoji === 'string'
      ? { available: true, reaction: data.emoji }
      : { available: false, reaction: null };
  } catch {
    return { available: false, reaction: null };
  }
}

export async function getRemoteReactionSnapshot(letterId: string): Promise<RemoteReactionSnapshot | null> {
  try {
    const context = await getAuthenticatedClient();
    return context ? readRemoteReaction(context, letterId) : null;
  } catch {
    return null;
  }
}

function eventsForDraft(draft: LetterDraftState): TrackingEvent[] {
  const now = new Date(draft.dispatchedAt || draft.updatedAt);
  const stages = [
    ['written', 'Written', 'The words are saved and ready to travel.'],
    ['sealed', 'Sealed', 'The message is locked. Carriers can move it without reading it.'],
    ['first-handoff', 'First handoff', 'Someone agreed to become the next link in the route.'],
    ['in-relay', 'In the relay', 'Your drop is moving hand to hand.'],
    ['arriving-soon', draft.status === 'delivered' ? 'Delivered' : 'Waiting for a hand', draft.status === 'delivered' ? 'It reached the other side safely.' : 'The next person is still finding their way to it.'],
  ] as const;
  const activeIndex = draft.status === 'delivered' ? 4 : draft.status === 'dispatched' ? 3 : draft.status === 'sealed' ? 1 : 0;

  return stages.map(([id, status, note], index) => ({
    id,
    status,
    note,
    date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(now.getTime() + index * 60 * 60 * 1000)),
    time: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(now.getTime() + index * 60 * 60 * 1000)),
    done: index <= activeIndex,
    current: index === activeIndex,
  }));
}

export async function issueDropClaimInvite(draft: Pick<LetterDraftState, 'id' | 'subject' | 'content' | 'payloadKind' | 'deliveryMode'>, expectedAccountId: string | null, token: string): Promise<{ ok: boolean; error?: string; letterId?: string; dispatchedAt?: string }> {
  if (!expectedAccountId) return { ok: false, error: 'Connect a Drop account before sending a private note invite.' };
  if (draft.payloadKind !== 'text' || draft.deliveryMode !== 'instant' || !draft.content.trim()) {
    return { ok: false, error: 'Private claim links are available for instant text notes with content.' };
  }
  if (!isDropClaimToken(token)) return { ok: false, error: 'This private invite could not be prepared. Try again.' };
  const context = await getAuthenticatedClient();
  if (!context) return { ok: false, error: 'Connect a Drop account before sending a private note invite.' };
  if (context.user.id !== expectedAccountId || !isCurrentLocalAccount(expectedAccountId)) {
    return { ok: false, error: 'Your account changed while you were preparing this note. Review it and try again.' };
  }

  try {
    const { data, error } = await context.supabase.rpc('issue_drop_claim_invite', {
      p_letter_id: draft.id,
      p_subject: draft.subject.trim() || 'A note for you',
      p_content: draft.content,
      p_token: token,
    });
    if (error || data !== draft.id) {
      return { ok: false, error: 'The private note could not be saved. Your draft is still here—try again.' };
    }
    if (!isCurrentLocalAccount(expectedAccountId)) {
      return { ok: false, error: 'Your account changed while the note was being saved. Check Sent before retrying.' };
    }
    return { ok: true, letterId: data, dispatchedAt: new Date().toISOString() };
  } catch {
    return { ok: false, error: 'The private note could not be saved. Your draft is still here—try again.' };
  }
}

type DropMediaClaimReceipt = {
  ok: boolean;
  error?: string;
  letterId?: string;
  dispatchedAt?: string;
  mediaPath?: string;
  mediaMimeType?: string;
  mediaSizeBytes?: number;
  mediaExpiresAt?: string;
  cleanupQueued?: boolean;
  retryUploadId?: string;
};

type DropMediaClaimRow = {
  id: string;
  sender_id: string;
  recipient_id: string | null;
  status: MockLetter['status'];
  delivery_mode: DropDeliveryMode | null;
  payload_kind: DropPayloadKind | null;
  media_path: string | null;
  media_mime_type: string | null;
  media_size_bytes: number | null;
  media_claim_expires_at: string | null;
  dispatched_at: string | null;
};

const DROP_MEDIA_ISSUE_ERROR = 'The photo/GIF drop could not be saved. Your draft is still here—try again.';

async function removeStagedDropMedia(context: AuthenticatedContext, path: string) {
  try {
    await context.supabase.storage.from('drop-media').remove([path]);
  } catch {
    // A failed cleanup leaves only an inaccessible staging object.
  }
}

type UnlinkedDropMediaCleanupStatus = 'linked' | 'queued' | 'cleaning';

async function queueUnlinkedDropMediaCleanup(
  context: AuthenticatedContext,
  letterId: string,
  payloadKind: 'image' | 'gif',
  mediaPath: string,
): Promise<UnlinkedDropMediaCleanupStatus | null> {
  const rpcArgs = {
    p_letter_id: letterId,
    p_payload_kind: payloadKind,
    p_media_path: mediaPath,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await context.supabase.rpc('queue_unlinked_drop_media_cleanup_job', rpcArgs);
      if (!error && (data === 'linked' || data === 'queued' || data === 'cleaning')) return data;
    } catch {
      // The cleanup RPC is idempotent, so retry once after an ambiguous response.
    }
  }
  return null;
}

async function readIssuedDropMediaReceipt(
  context: AuthenticatedContext,
  letterId: string,
  payloadKind: 'image' | 'gif',
  mediaPath: string,
  expectedMimeType?: string,
  expectedSizeBytes?: number,
): Promise<DropMediaClaimReceipt | null> {
  try {
    const { data: row, error } = await context.supabase.from('letters')
      .select('id, sender_id, recipient_id, status, delivery_mode, payload_kind, media_path, media_mime_type, media_size_bytes, media_claim_expires_at, dispatched_at')
      .eq('id', letterId)
      .eq('sender_id', context.user.id)
      .maybeSingle<DropMediaClaimRow>();
    if (error || !row
      || row.sender_id !== context.user.id
      || row.recipient_id !== null
      || row.status !== 'claim_pending'
      || row.delivery_mode !== 'instant'
      || row.payload_kind !== payloadKind
      || row.media_path !== mediaPath
      || !row.media_mime_type
      || !row.media_size_bytes
      || !row.media_claim_expires_at
      || !Number.isFinite(Date.parse(row.media_claim_expires_at))
      || Date.parse(row.media_claim_expires_at) <= Date.now()
      || (expectedMimeType !== undefined && row.media_mime_type !== expectedMimeType)
      || (expectedSizeBytes !== undefined && row.media_size_bytes !== expectedSizeBytes)) return null;
    return {
      ok: true,
      letterId,
      dispatchedAt: row.dispatched_at || undefined,
      mediaPath,
      mediaMimeType: row.media_mime_type,
      mediaSizeBytes: row.media_size_bytes,
      mediaExpiresAt: row.media_claim_expires_at,
    };
  } catch {
    return null;
  }
}

async function recoverOrQueueFailedDropMedia(
  context: AuthenticatedContext,
  letterId: string,
  payloadKind: 'image' | 'gif',
  mediaPath: string,
  failureMessage = DROP_MEDIA_ISSUE_ERROR,
): Promise<DropMediaClaimReceipt> {
  const status = await queueUnlinkedDropMediaCleanup(context, letterId, payloadKind, mediaPath);
  if (status === 'queued' || status === 'cleaning') {
    return {
      ok: false,
      error: failureMessage,
      cleanupQueued: true,
      retryUploadId: crypto.randomUUID(),
    };
  }
  return { ok: false, error: failureMessage };
}

function validFinalizedDropMedia(kind: 'image' | 'gif', mimeType: string, sizeBytes: number) {
  const validMime = kind === 'gif'
    ? mimeType === 'image/gif'
    : ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType);
  return validMime && Number.isInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= 8_388_608;
}

export async function issueDropMediaClaimInvite(
  draft: Pick<LetterDraftState, 'id' | 'subject' | 'content' | 'payloadKind' | 'deliveryMode' | 'mediaUploadId'>,
  mediaFile: File,
  expectedAccountId: string | null,
  token: string,
): Promise<DropMediaClaimReceipt> {
  if (!expectedAccountId) return { ok: false, error: 'Connect a Drop account before sending a private photo/GIF invite.' };
  if ((draft.payloadKind !== 'image' && draft.payloadKind !== 'gif') || draft.deliveryMode !== 'instant') {
    return { ok: false, error: 'Private claim links are available for instant photo and GIF drops.' };
  }
  if (!isDropClaimToken(token)) return { ok: false, error: 'This private invite could not be prepared. Try again.' };
  const validationError = validateDropMedia(mediaFile);
  if (validationError) return { ok: false, error: validationError };
  if ((mediaFile.type === 'image/gif' ? 'gif' : 'image') !== draft.payloadKind) {
    return { ok: false, error: 'The selected file does not match this drop type.' };
  }

  const context = await getAuthenticatedClient();
  if (!context) return { ok: false, error: 'Connect a Drop account before sending a private photo/GIF invite.' };
  if (context.user.id !== expectedAccountId || !isCurrentLocalAccount(expectedAccountId)) {
    return { ok: false, error: 'Your account changed while you were preparing this drop. Review it and try again.' };
  }

  const stagedPath = createStagedDropMediaAttemptPath(context.user.id, draft.id, draft.mediaUploadId || crypto.randomUUID());
  if (!stagedPath) return { ok: false, error: 'This draft cannot accept an image attachment. Start a new draft and try again.' };
  const paths = resolveDropMediaPaths(stagedPath, context.user.id);
  if (!paths) return { ok: false, error: 'This draft cannot accept an image attachment. Start a new draft and try again.' };

  let finalizeStarted = false;
  let issueCommitted = false;
  let committedReceipt: Pick<DropMediaClaimReceipt, 'letterId' | 'mediaPath' | 'mediaMimeType' | 'mediaSizeBytes'> | null = null;
  try {
    const { error: stagedUploadError } = await context.supabase.storage.from('drop-media').upload(stagedPath, mediaFile, {
      contentType: mediaFile.type,
      upsert: false,
    });
    if (stagedUploadError) {
      const uploadErrorDetails = stagedUploadError as typeof stagedUploadError & {
        status?: number;
        statusCode?: string;
      };
      const duplicateStage = uploadErrorDetails.status === 409
        || uploadErrorDetails.statusCode === 'Duplicate'
        || /already exists|duplicate/i.test(stagedUploadError.message);
      if (!duplicateStage) {
        return { ok: false, error: 'The photo/GIF could not be uploaded. Your draft is still here—retry the upload.' };
      }
      // A collision is safe to continue only because the finalizer validates
      // the staged bytes before it returns a finalized media path.
    }
    const { data: { session } } = await context.supabase.auth.getSession();
    if (!session?.access_token) {
      await removeStagedDropMedia(context, stagedPath);
      return { ok: false, error: 'Sign in again before sending this photo/GIF drop.' };
    }

    finalizeStarted = true;
    const response = await fetch('/api/drop-media/finalize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stagedPath, payloadKind: draft.payloadKind }),
    });
    const finalized = await response.json().catch(() => null) as {
      error?: string;
      mediaPath?: string;
      mediaMimeType?: string;
      mediaSizeBytes?: number;
    } | null;
    if (!response.ok
      || !finalized
      || typeof finalized.mediaPath !== 'string'
      || !isDropMediaFinalPath(finalized.mediaPath, context.user.id, draft.id)
      || typeof finalized.mediaMimeType !== 'string'
      || typeof finalized.mediaSizeBytes !== 'number'
      || !validFinalizedDropMedia(draft.payloadKind, finalized.mediaMimeType, finalized.mediaSizeBytes)) {
      await removeStagedDropMedia(context, stagedPath);
      return recoverOrQueueFailedDropMedia(
        context,
        draft.id,
        draft.payloadKind,
        paths.finalPath,
        finalized?.error || 'The photo/GIF could not be validated. Your draft is still here—try again.',
      );
    }

    const mediaPath = finalized.mediaPath;
    const mediaMimeType = finalized.mediaMimeType;
    const mediaSizeBytes = finalized.mediaSizeBytes;
    const rpcArgs = {
      p_letter_id: draft.id,
      p_subject: draft.subject.trim() || (draft.payloadKind === 'gif' ? 'A GIF for you' : 'A photo for you'),
      p_content: draft.content,
      p_payload_kind: draft.payloadKind,
      p_media_path: mediaPath,
      p_media_mime_type: mediaMimeType,
      p_media_size_bytes: mediaSizeBytes,
      p_token: token,
    };
    committedReceipt = { letterId: draft.id, mediaPath, mediaMimeType, mediaSizeBytes };

    // Retrying the exact capability and payload is safe: the RPC is idempotent
    // for the same letter and does not extend the original media deadline.
    let issued: { data: unknown; error: unknown } | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        issued = await context.supabase.rpc('issue_drop_media_claim_invite', rpcArgs);
        if (!issued.error) break;
      } catch {
        // The server may have committed before the connection failed. Retry
        // with the same token and payload so RPC idempotency can resolve it.
      }
    }
    if (!issued || issued.error || issued.data !== draft.id) {
      await removeStagedDropMedia(context, stagedPath);
      return recoverOrQueueFailedDropMedia(
        context, draft.id, draft.payloadKind, mediaPath,
      );
    }
    issueCommitted = true;
    await removeStagedDropMedia(context, stagedPath);

    const receipt = await readIssuedDropMediaReceipt(
      context, draft.id, draft.payloadKind, mediaPath, mediaMimeType, mediaSizeBytes,
    );
    if (receipt) {
      if (!isCurrentLocalAccount(expectedAccountId)) {
        return { ...receipt, ok: false, error: 'Your account changed while the drop was being saved. Check Sent before retrying.' };
      }
      return receipt;
    }
    if (!isCurrentLocalAccount(expectedAccountId)) {
      return { ok: false, error: 'Your account changed while the drop was being saved. Check Sent before retrying.', letterId: draft.id, mediaPath, mediaMimeType, mediaSizeBytes };
    }
    // The RPC succeeded, so retain the object even if this receipt read timed out.
    return { ok: true, letterId: draft.id, mediaPath, mediaMimeType, mediaSizeBytes };
  } catch {
    await removeStagedDropMedia(context, stagedPath);
    if (issueCommitted && committedReceipt) {
      return isCurrentLocalAccount(expectedAccountId)
        ? { ok: true, ...committedReceipt }
        : { ok: false, error: 'Your account changed while the drop was being saved. Check Sent before retrying.', ...committedReceipt };
    }
    if (finalizeStarted) {
      return recoverOrQueueFailedDropMedia(
        context, draft.id, draft.payloadKind, paths.finalPath,
      );
    }
    return { ok: false, error: DROP_MEDIA_ISSUE_ERROR };
  }
}

export async function reissueDropClaimInvite(letterId: string, expectedAccountId: string | null, token: string): Promise<{ ok: boolean; error?: string; letterId?: string }> {
  if (!expectedAccountId) return { ok: false, error: 'Connect a Drop account before sharing a fresh private note link.' };
  if (!isDropClaimToken(token)) return { ok: false, error: 'This private invite could not be prepared. Try again.' };
  const context = await getAuthenticatedClient();
  if (!context) return { ok: false, error: 'Connect a Drop account before sharing a fresh private note link.' };
  if (context.user.id !== expectedAccountId || !isCurrentLocalAccount(expectedAccountId)) {
    return { ok: false, error: 'Your account changed while you were preparing this link. Try again.' };
  }

  try {
    const { data, error } = await context.supabase.rpc('reissue_drop_claim_invite', {
      p_letter_id: letterId,
      p_token: token,
    });
    if (error || data !== letterId) {
      return { ok: false, error: 'A fresh private link could not be saved. Try again.' };
    }
    if (!isCurrentLocalAccount(expectedAccountId)) {
      return { ok: false, error: 'Your account changed while the link was being saved. Try again.' };
    }
    return { ok: true, letterId: data };
  } catch {
    return { ok: false, error: 'A fresh private link could not be saved. Try again.' };
  }
}

export async function reissueDropMediaClaimInvite(
  letterId: string,
  expectedAccountId: string | null,
  token: string,
): Promise<DropMediaClaimReceipt> {
  if (!expectedAccountId) return { ok: false, error: 'Connect a Drop account before sharing a fresh private photo/GIF link.' };
  if (!isDropClaimToken(token)) return { ok: false, error: 'This private invite could not be prepared. Try again.' };
  const context = await getAuthenticatedClient();
  if (!context) return { ok: false, error: 'Connect a Drop account before sharing a fresh private photo/GIF link.' };
  if (context.user.id !== expectedAccountId || !isCurrentLocalAccount(expectedAccountId)) {
    return { ok: false, error: 'Your account changed while you were preparing this link. Try again.' };
  }

  try {
    const { data: row, error: readError } = await context.supabase.from('letters')
      .select('id, sender_id, recipient_id, status, delivery_mode, payload_kind, media_path, media_mime_type, media_size_bytes, media_claim_expires_at, dispatched_at')
      .eq('id', letterId)
      .eq('sender_id', context.user.id)
      .maybeSingle<DropMediaClaimRow>();
    if (readError || !row
      || row.sender_id !== context.user.id
      || row.recipient_id !== null
      || row.status !== 'claim_pending'
      || row.delivery_mode !== 'instant'
      || (row.payload_kind !== 'image' && row.payload_kind !== 'gif')
      || !row.media_path
      || !row.media_mime_type
      || !row.media_size_bytes
      || !row.media_claim_expires_at
      || !isDropMediaFinalPath(row.media_path, context.user.id, row.id)) {
      return { ok: false, error: 'This photo/GIF invite is no longer available.' };
    }
    if (!validFinalizedDropMedia(row.payload_kind, row.media_mime_type, row.media_size_bytes)) {
      return { ok: false, error: 'This photo/GIF invite is no longer available.' };
    }

    let reissued: { data: unknown; error: unknown } | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        reissued = await context.supabase.rpc('reissue_drop_claim_invite', {
          p_letter_id: letterId,
          p_token: token,
        });
        if (!reissued.error) break;
      } catch {
        // The same invite token makes a retry safe after an ambiguous response.
      }
    }
    if (!reissued || reissued.error || reissued.data !== letterId) {
      return { ok: false, error: 'A fresh private photo/GIF link could not be saved. Try again.' };
    }
    if (!isCurrentLocalAccount(expectedAccountId)) {
      return { ok: false, error: 'Your account changed while the link was being saved. Try again.' };
    }
    return {
      ok: true,
      letterId,
      dispatchedAt: row.dispatched_at || undefined,
      mediaPath: row.media_path,
      mediaMimeType: row.media_mime_type,
      mediaSizeBytes: row.media_size_bytes,
      mediaExpiresAt: row.media_claim_expires_at,
    };
  } catch {
    return { ok: false, error: 'A fresh private photo/GIF link could not be saved. Try again.' };
  }
}

export async function claimDropInvite(token: string): Promise<{ ok: boolean; error?: string; letterId?: string }> {
  if (!isDropClaimToken(token)) return { ok: false, error: 'This invite link is incomplete. Open the original link again.' };
  try {
    const context = await getAuthenticatedClient();
    if (!context) return { ok: false, error: 'Sign in and set up a Drop profile before claiming this note.' };
    const { data, error } = await context.supabase.rpc('claim_drop_invite', { p_token: token });
    return resolveDropClaimInviteResult({ data, error });
  } catch {
    return resolveDropClaimInviteResult({ data: null, error: true });
  }
}

export async function syncDropToBackend(draft: LetterDraftState, confirmedRecipientId: string, expectedAccountId: string | null, mediaFile?: File): Promise<{ ok: boolean; error?: string; mediaPath?: string; mediaMimeType?: string; mediaSizeBytes?: number; dispatchedAt?: string }> {
  if (!expectedAccountId) return { ok: false, error: 'Connect an account in Your profile before sending a private drop.' };
  const context = await getAuthenticatedClient();
  if (!context) return { ok: false, error: 'Connect an account in Your profile before sending a private drop.' };
  if (context.user.id !== expectedAccountId || !isCurrentLocalAccount(expectedAccountId)) {
    return { ok: false, error: 'Your account changed while you were preparing this drop. Review it and try again.' };
  }

  const recipientUsername = normalizeDropRecipient(draft.recipient);
  if (!recipientUsername) {
    return { ok: false, error: 'Add your friend’s exact @username to send this drop.' };
  }
  if (draft.payloadKind !== 'text' && !mediaFile) {
    return { ok: false, error: 'Attach the photo or GIF before sending.' };
  }
  if (mediaFile) {
    const validationError = validateDropMedia(mediaFile);
    if (validationError) return { ok: false, error: validationError };
    const expectedKind = mediaFile.type === 'image/gif' ? 'gif' : 'image';
    if (draft.payloadKind !== expectedKind) return { ok: false, error: 'The selected file does not match this drop type.' };
  }
  if (!confirmedRecipientId) return { ok: false, error: 'Check the recipient handle before sending this drop.' };
  if (!mediaFile) {
    const previous = await readExistingDrop(context, draft.id);
    if (previous.state === 'unavailable') {
      return { ok: false, error: 'I could not confirm whether this drop was already sent. Check Sent before retrying.' };
    }
    if (previous.state === 'found') {
      const retryIntent: DropSendIntent = {
        senderId: context.user.id,
        recipientId: confirmedRecipientId,
        recipientUsername,
        subject: draft.subject || 'Untitled drop',
        content: draft.content,
        sealId: draft.sealId,
        payloadKind: draft.payloadKind,
        deliveryMode: draft.deliveryMode === 'relay' ? 'relay' : 'instant',
        mediaMimeType: null,
        mediaSizeBytes: null,
        status: draft.deliveryMode === 'relay' ? 'dispatched' : 'delivered',
      };
      if (matchesStoredDropMetadata(toStoredDropSend(previous.row), retryIntent) && previous.row.dispatched_at) {
        return { ok: true, dispatchedAt: previous.row.dispatched_at };
      }
      return { ok: false, error: 'This draft ID is already tied to a different drop. Check Sent before sending this edit.' };
    }
  }
  const initialRecipient = await resolveDropRecipient(context, recipientUsername);
  if (initialRecipient.status === 'not-found') {
    return { ok: false, error: `No Drop account found for @${recipientUsername}. Check the username and try again.` };
  }
  if (initialRecipient.status === 'error') {
    return { ok: false, error: `I could not check @${recipientUsername}. Check the handle again before sending.` };
  }
  if (initialRecipient.recipient.id !== confirmedRecipientId) {
    return { ok: false, error: 'This handle now belongs to a different account. Check it again before sending.' };
  }

  const instant = draft.deliveryMode !== 'relay';
  let mediaPath: string | null = null;
  let stagedMediaPath: string | null = null;
  let mediaMimeType: string | null = mediaFile?.type || null;
  let mediaSizeBytes: number | null = mediaFile?.size || null;
  if (mediaFile) {
    const stagedPath = createStagedDropMediaAttemptPath(context.user.id, draft.id, draft.mediaUploadId || crypto.randomUUID());
    if (!stagedPath) return { ok: false, error: 'This draft cannot accept an image attachment. Start a new draft and try again.' };
    stagedMediaPath = stagedPath;
    const { error } = await context.supabase.storage.from('drop-media').upload(stagedPath, mediaFile, {
      contentType: mediaFile.type,
      upsert: false,
    });
    const removeStagedMedia = async () => {
      try {
        await context.supabase.storage.from('drop-media').remove([stagedPath]);
      } catch {
        // A failed cleanup leaves only an inaccessible staging object.
      }
    };

    try {
      const { data: { session } } = await context.supabase.auth.getSession();
      if (!session?.access_token) {
        await removeStagedMedia();
        return { ok: false, error: 'Sign in again before sending this image drop.' };
      }
      const response = await fetch('/api/drop-media/finalize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stagedPath, payloadKind: draft.payloadKind === 'gif' ? 'gif' : 'image' }),
      });
      const result = await response.json().catch(() => null) as {
        error?: string;
        mediaPath?: string;
        mediaMimeType?: string;
        mediaSizeBytes?: number;
      } | null;
      const expectedPath = resolveDropMediaPaths(stagedPath, context.user.id)?.finalPath;
      const validMediaPath = result?.mediaPath === expectedPath || isDropMediaFinalPath(result?.mediaPath, context.user.id, draft.id);
      if (!response.ok || !result || typeof result.mediaPath !== 'string' || !validMediaPath || typeof result.mediaMimeType !== 'string' || typeof result.mediaSizeBytes !== 'number') {
        await removeStagedMedia();
        return { ok: false, error: result?.error || (error ? 'The image did not finish uploading. Your draft is still here—try again.' : 'The image could not be validated. Your draft is still here—try again.') };
      }
      mediaPath = result.mediaPath;
      mediaMimeType = result.mediaMimeType;
      mediaSizeBytes = result.mediaSizeBytes;
    } catch {
      await removeStagedMedia();
      return { ok: false, error: 'The image could not be validated. Your draft is still here—try again.' };
    }
  }
  const cleanupUploadedMedia = async (removeFinal = true) => {
    const paths = [removeFinal ? mediaPath : null, stagedMediaPath].filter((path): path is string => Boolean(path));
    if (!paths.length) return;
    try {
      await context.supabase.storage.from('drop-media').remove(paths);
    } catch {
      // Cleanup is best effort; retrying remains safe because the final object is not linked yet.
    }
  };
  const intent: DropSendIntent = {
    senderId: context.user.id,
    recipientId: confirmedRecipientId,
    recipientUsername,
    subject: draft.subject || (draft.payloadKind === 'text' ? 'Untitled drop' : 'A little moment'),
    content: draft.content,
    sealId: draft.sealId,
    payloadKind: draft.payloadKind,
    deliveryMode: instant ? 'instant' : 'relay',
    mediaMimeType,
    mediaSizeBytes,
    status: instant ? 'delivered' : 'dispatched',
  };
  type ExistingSendCheck =
    | { state: 'missing' }
    | { state: 'unavailable' }
    | { state: 'conflict'; senderId: string; mediaPath: string | null }
    | { state: 'same'; mediaPath: string | null; dispatchedAt: string };
  const checkExistingSend = async (): Promise<ExistingSendCheck> => {
    const existing = await readExistingDrop(context, draft.id);
    if (existing.state === 'unavailable') return { state: 'unavailable' };
    if (existing.state === 'missing') return { state: 'missing' };
    const data = existing.row;
    const stored = toStoredDropSend(data);
    if (!matchesStoredDropMetadata(stored, intent)) {
      return { state: 'conflict', senderId: data.sender_id, mediaPath: data.media_path };
    }
    if (mediaFile) {
      if (!data.media_path || data.media_path !== mediaPath) return { state: 'conflict', senderId: data.sender_id, mediaPath: data.media_path };
    }
    if (!data.dispatched_at) return { state: 'conflict', senderId: data.sender_id, mediaPath: data.media_path };
    return { state: 'same', mediaPath: data.media_path, dispatchedAt: data.dispatched_at };
  };
  const existing = await checkExistingSend();
  if (existing.state === 'same') {
    await cleanupUploadedMedia(mediaPath !== existing.mediaPath);
    return { ok: true, mediaPath: existing.mediaPath || undefined, dispatchedAt: existing.dispatchedAt };
  }
  if (existing.state === 'conflict') {
    await cleanupUploadedMedia(mediaPath !== existing.mediaPath);
    return { ok: false, error: 'This draft ID is already tied to a different drop. Check Sent before sending this edit.' };
  }
  if (existing.state === 'unavailable') {
    await cleanupUploadedMedia();
    return { ok: false, error: 'I could not confirm whether this drop was already sent. Check Sent before retrying.' };
  }

  const profileState = await getRemoteProfileForContext(context);
  let profile: UserProfile | null = null;
  if (profileState.status === 'found') {
    profile = profileState.profile;
  } else if (profileState.status === 'missing') {
    const generatedProfile: UserProfile = {
      displayName: profileState.displayName || 'A correspondent',
      username: suggestedDropUsername(context.user.id),
      bio: '',
      lettersSent: 0,
      lettersReceived: 0,
    };
    const created = await writeRemoteProfile(context, generatedProfile, true);
    if (created.ok) {
      profile = generatedProfile;
    } else {
      const currentProfile = await getRemoteProfileForContext(context);
      if (currentProfile.status === 'found') {
        profile = currentProfile.profile;
      } else {
        await cleanupUploadedMedia();
        return {
          ok: false,
          error: created.reason === 'username-taken'
            ? 'Your suggested handle is already taken. Choose another in Your profile, then try again.'
            : 'Your profile could not be set up. Your draft is still here—try again.',
        };
      }
    }
  } else {
    await cleanupUploadedMedia();
    return { ok: false, error: 'I could not check your account profile. Your draft is still here—try again.' };
  }
  const recipientLookup = await resolveDropRecipient(context, recipientUsername);
  if (recipientLookup.status === 'not-found') {
    await cleanupUploadedMedia();
    return { ok: false, error: `No Drop account found for @${recipientUsername}. Check the username and try again.` };
  }
  if (recipientLookup.status === 'error') {
    await cleanupUploadedMedia();
    return { ok: false, error: `I could not check @${recipientUsername}. Your draft is still here—check the handle and try again.` };
  }
  if (recipientLookup.recipient.id !== confirmedRecipientId) {
    await cleanupUploadedMedia();
    return { ok: false, error: 'This handle now belongs to a different account. Check it again before sending.' };
  }
  if (!isCurrentLocalAccount(expectedAccountId)) {
    await cleanupUploadedMedia();
    return { ok: false, error: 'Your account changed while you were preparing this drop. Review it and try again.' };
  }
  const recipientProfile = recipientLookup.recipient;

  const sentAt = new Date().toISOString();
  let insertError: { code?: string } | null = null;
  let insertWasAmbiguous = false;
  try {
    const { error } = await context.supabase.from('letters').insert({
      id: draft.id,
      sender_id: context.user.id,
      sender_display_name: profile?.displayName || context.user.user_metadata?.full_name || context.user.email || 'A correspondent',
      recipient_id: recipientProfile.id,
      recipient_username: recipientUsername,
      recipient_name: recipientProfile.displayName,
      subject: intent.subject,
      content: draft.content,
      teaser: draft.content
        .split(/(?<=[.!?])\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 3),
      status: intent.status,
      seal_id: draft.sealId,
      dispatched_at: sentAt,
      delivered_at: instant ? sentAt : null,
      payload_kind: draft.payloadKind,
      delivery_mode: intent.deliveryMode,
      media_path: mediaPath,
      media_mime_type: mediaMimeType,
      media_size_bytes: mediaSizeBytes,
    });
    insertError = error;
  } catch {
    insertWasAmbiguous = true;
  }
  if (insertError || insertWasAmbiguous) {
    if (insertError?.code && insertError.code !== '23505') {
      await cleanupUploadedMedia();
      return { ok: false, error: 'Drop could not be saved. Your draft is still here—try again.' };
    }
    const recovery = await checkExistingSend();
    if (recovery.state === 'same') {
      await cleanupUploadedMedia(mediaPath !== recovery.mediaPath);
      return { ok: true, mediaPath: recovery.mediaPath || undefined, dispatchedAt: recovery.dispatchedAt };
    }
    if (recovery.state === 'conflict') {
      await cleanupUploadedMedia(mediaPath !== recovery.mediaPath && recovery.senderId === context.user.id);
      return { ok: false, error: 'This draft ID is already tied to a different drop. Check Sent before sending this edit.' };
    }
    await cleanupUploadedMedia(false);
    return {
      ok: false,
      error: recovery.state === 'missing'
        ? 'I could not confirm whether this drop was already sent. Check Sent before retrying.'
        : 'The send could not be confirmed yet. Your draft and attachment are still here—check Sent before retrying.',
    };
  }

  if (!instant) {
    const relayDraft = { ...draft, status: 'dispatched' as const, dispatchedAt: sentAt };
    const events = eventsForDraft(relayDraft).map((event, index) => ({
      letter_id: draft.id,
      event_key: event.id,
      status: event.status,
      note: event.note,
      is_done: event.done,
      is_current: Boolean(event.current),
      occurred_at: new Date(new Date(sentAt).getTime() + index * 60 * 60 * 1000).toISOString(),
    }));
    await context.supabase.from('letter_events').upsert(events, { onConflict: 'letter_id,event_key' });
  }
  await cleanupUploadedMedia(false);
  return { ok: true, mediaPath: mediaPath || undefined, mediaMimeType: mediaMimeType || undefined, mediaSizeBytes: mediaSizeBytes || undefined, dispatchedAt: sentAt };
}

export async function saveRemoteReaction(letterId: string, emoji: string) {
  const context = await getAuthenticatedClient();
  if (!context || !['💜', '🔥', '😂', '🥹', '🫶'].includes(emoji)) return false;
  const { error } = await context.supabase.from('letter_reactions').upsert({
    letter_id: letterId,
    recipient_id: context.user.id,
    emoji,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'letter_id' });
  return !error;
}

export async function getRemoteJourney(letterId: string): Promise<{ events: TrackingEvent[]; notes: JourneyNote[] } | null> {
  const context = await getAuthenticatedClient();
  if (!context) return null;

  const [{ data: eventRows, error: eventError }, { data: noteRows, error: noteError }] = await Promise.all([
    context.supabase.from('letter_events').select('event_key, status, note, is_done, is_current, occurred_at').eq('letter_id', letterId).order('occurred_at', { ascending: true }),
    context.supabase.from('journey_notes').select('id, body, created_at').eq('letter_id', letterId).order('created_at', { ascending: true }),
  ]);

  if (eventError || noteError) return null;
  return {
    events: (eventRows || []).map((event, index, all) => ({
      id: event.event_key,
      status: event.status,
      note: event.note,
      date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(event.occurred_at)),
      time: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(event.occurred_at)),
      done: event.is_done,
      current: event.is_current,
    })),
    notes: (noteRows || []).map((note) => ({
      id: note.id,
      date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(note.created_at)),
      text: note.body,
    })),
  };
}

export async function saveRemoteJourneyNote(letterId: string, text: string) {
  const context = await getAuthenticatedClient();
  if (!context) return false;
  const { error } = await context.supabase.from('journey_notes').insert({
    letter_id: letterId,
    author_id: context.user.id,
    body: text,
  });
  return !error;
}
