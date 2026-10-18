import type { MockLetter, TrackingEvent } from '@/data/mockData';
import type { DropDeliveryMode, DropPayloadKind } from '@/data/mockData';
import type { JourneyNote, LetterDraftState } from '@/lib/letterStore';
import type { UserProfile } from '@/lib/userStore';
import { defaultUserProfile } from '@/lib/userStore';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import { normalizeDropRecipient, validateDropMedia } from '@/lib/dropValidation';

type LetterRow = {
  id: string;
  sender_id: string;
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

export async function getRemoteProfile(): Promise<UserProfile | null> {
  const context = await getAuthenticatedClient();
  if (!context) return null;

  const { data, error } = await context.supabase
    .from('profiles')
    .select('id, username, display_name, bio, letters_sent, letters_received')
    .eq('id', context.user.id)
    .maybeSingle<ProfileRow>();

  if (error || !data) return null;
  return {
    displayName: data.display_name,
    username: data.username,
    bio: data.bio,
    lettersSent: data.letters_sent,
    lettersReceived: data.letters_received,
  };
}

export async function saveRemoteProfile(profile: UserProfile) {
  const context = await getAuthenticatedClient();
  if (!context) return false;

  const { error } = await context.supabase.from('profiles').upsert({
    id: context.user.id,
    username: profile.username,
    display_name: profile.displayName,
    bio: profile.bio,
  });
  return !error;
}

function rowToLetter(row: LetterRow, userId: string, revealContent = false): MockLetter {
  const content = row.content?.trim() || '';
  const teaser = row.teaser?.filter(Boolean).join(' ') || content.slice(0, 150);
  const mediaFallback = row.payload_kind === 'gif' ? 'A GIF is waiting behind the seal.' : row.payload_kind === 'image' ? 'A photo is waiting behind the seal.' : 'A sealed letter waiting to be opened.';
  return {
    id: row.id,
    recipient: row.recipient_name || row.recipient_username || 'your correspondent',
    sender: row.sender_display_name || undefined,
    direction: row.sender_id === userId ? 'sent' : 'received',
    date: row.dispatched_at
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(row.dispatched_at))
      : 'Saved just now',
    status: row.status,
    // Mailbox cards get a teaser only. Full content is fetched on the detail route after reveal.
    excerpt: revealContent
      ? content || (row.payload_kind === 'text' || !row.payload_kind ? 'An empty letter, waiting for your words.' : '')
      : teaser ? `${teaser}${content.length > 150 ? '…' : ''}` : mediaFallback,
    subject: row.subject || 'Untitled Letter',
    teaser: row.teaser || undefined,
    payloadKind: row.payload_kind || 'text',
    deliveryMode: row.delivery_mode || 'instant',
    mediaPath: row.media_path || undefined,
    mediaMimeType: row.media_mime_type || undefined,
    mediaSizeBytes: row.media_size_bytes || undefined,
  };
}

const MAILBOX_SELECT = 'id, sender_id, recipient_id, sender_display_name, recipient_username, recipient_name, subject, teaser, status, seal_id, dispatched_at, delivered_at, created_at, payload_kind, delivery_mode, media_path, media_mime_type, media_size_bytes';
const LETTER_SELECT = `${MAILBOX_SELECT}, content`;

export async function getRemoteLetters(): Promise<MockLetter[] | null> {
  const context = await getAuthenticatedClient();
  if (!context) return null;

  const { data, error } = await context.supabase
    .from('letters')
    .select(MAILBOX_SELECT)
    .order('created_at', { ascending: false })
    .returns<LetterRow[]>();

  if (error || !data) return null;
  return data.map((row) => rowToLetter(row, context.user.id));
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
  const letter = rowToLetter(data, context.user.id, true);
  if (data.media_path) {
    const { data: signed } = await context.supabase.storage.from('drop-media').createSignedUrl(data.media_path, 60);
    letter.mediaUrl = signed?.signedUrl;
  }
  const { data: reaction } = await context.supabase.from('letter_reactions').select('emoji').eq('letter_id', letterId).maybeSingle<{ emoji: string }>();
  letter.reaction = reaction?.emoji;
  return letter;
}

function eventsForDraft(draft: LetterDraftState): TrackingEvent[] {
  const now = new Date(draft.dispatchedAt || draft.updatedAt);
  const stages = [
    ['written', 'Written', 'The words are saved and ready to travel.'],
    ['sealed', 'Sealed', 'The message is locked. Carriers can move it without reading it.'],
    ['first-handoff', 'First handoff', 'Someone agreed to become the next link in the route.'],
    ['in-relay', 'In the relay', 'Your letter is moving hand to hand.'],
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

export async function syncDropToBackend(draft: LetterDraftState, mediaFile?: File): Promise<{ ok: boolean; error?: string; mediaPath?: string }> {
  const context = await getAuthenticatedClient();
  if (!context) return { ok: false, error: 'Connect an account in Your profile before sending a private drop.' };

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

  let profile = await getRemoteProfile();
  if (!profile) {
    const metadataName = context.user.user_metadata?.full_name || context.user.email?.split('@')[0] || defaultUserProfile.displayName;
    const generatedProfile: UserProfile = {
      ...defaultUserProfile,
      displayName: metadataName,
      username: `user_${context.user.id.slice(0, 8)}`,
    };
    const created = await saveRemoteProfile(generatedProfile);
    if (!created) return { ok: false, error: 'Your profile could not be set up. Check the account settings and try again.' };
    profile = await getRemoteProfile();
  }
  const { data: recipientProfile, error: recipientError } = await context.supabase
    .from('profiles')
    .select('id, display_name')
    .eq('username', recipientUsername)
    .maybeSingle<{ id: string; display_name: string }>();
  if (recipientError || !recipientProfile) return { ok: false, error: `No Drop account found for @${recipientUsername}. Check the username and try again.` };

  let mediaPath: string | null = null;
  if (mediaFile) {
    const safeDraftId = draft.id.replace(/[^a-z0-9._-]/gi, '-');
    mediaPath = `${context.user.id}/${safeDraftId}/${crypto.randomUUID()}`;
    const { error } = await context.supabase.storage.from('drop-media').upload(mediaPath, mediaFile, {
      contentType: mediaFile.type,
      upsert: false,
    });
    if (error) return { ok: false, error: 'The image did not finish uploading. Your draft is still here—try again.' };
  }

  const sentAt = new Date().toISOString();
  const instant = draft.deliveryMode !== 'relay';
  const { error } = await context.supabase.from('letters').insert({
    id: draft.id,
    sender_id: context.user.id,
    sender_display_name: profile?.displayName || context.user.user_metadata?.full_name || context.user.email || 'A correspondent',
    recipient_id: recipientProfile.id,
    recipient_username: recipientUsername,
    recipient_name: recipientProfile.display_name,
    subject: draft.subject || (draft.payloadKind === 'text' ? 'Untitled Letter' : 'A little moment'),
    content: draft.content,
    teaser: draft.content
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 3),
    status: instant ? 'delivered' : 'dispatched',
    seal_id: draft.sealId,
    dispatched_at: sentAt,
    delivered_at: instant ? sentAt : null,
    payload_kind: draft.payloadKind,
    delivery_mode: instant ? 'instant' : 'relay',
    media_path: mediaPath,
    media_mime_type: mediaFile?.type || null,
    media_size_bytes: mediaFile?.size || null,
  });
  if (error) {
    if (mediaPath) await context.supabase.storage.from('drop-media').remove([mediaPath]);
    return error.code === '23505'
      ? { ok: false, error: 'A drop with this draft ID already exists. Check your sent drops before retrying.' }
      : { ok: false, error: 'Drop could not be saved. Your draft is still here—try again.' };
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
  return { ok: true, mediaPath: mediaPath || undefined };
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
