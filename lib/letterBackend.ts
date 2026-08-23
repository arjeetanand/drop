import type { MockLetter, TrackingEvent } from '@/data/mockData';
import type { JourneyNote, LetterDraftState } from '@/lib/letterStore';
import type { UserProfile } from '@/lib/userStore';
import { defaultUserProfile } from '@/lib/userStore';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';

type LetterRow = {
  id: string;
  sender_id: string;
  recipient_id: string | null;
  sender_display_name: string | null;
  recipient_username: string | null;
  recipient_name: string | null;
  subject: string;
  content: string;
  teaser: string[] | null;
  status: MockLetter['status'];
  seal_id: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  letters_sent: number;
  letters_received: number;
};

export function isBackendReady() {
  return Boolean(getSupabaseBrowserClient());
}

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
    letters_sent: profile.lettersSent,
    letters_received: profile.lettersReceived,
  });
  return !error;
}

function rowToLetter(row: LetterRow, userId: string): MockLetter {
  return {
    id: row.id,
    recipient: row.recipient_name || row.recipient_username || 'your correspondent',
    sender: row.sender_display_name || undefined,
    direction: row.sender_id === userId ? 'sent' : 'received',
    date: row.dispatched_at
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(row.dispatched_at))
      : 'Saved just now',
    status: row.status,
    excerpt: row.content || 'An empty letter, waiting for your words.',
    subject: row.subject || 'Untitled Letter',
    teaser: row.teaser || undefined,
  };
}

export async function getRemoteLetters(): Promise<MockLetter[] | null> {
  const context = await getAuthenticatedClient();
  if (!context) return null;

  const { data, error } = await context.supabase
    .from('letters')
    .select('id, sender_id, recipient_id, sender_display_name, recipient_username, recipient_name, subject, content, teaser, status, seal_id, dispatched_at, delivered_at, created_at')
    .order('created_at', { ascending: false })
    .returns<LetterRow[]>();

  if (error || !data) return null;
  return data.map((row) => rowToLetter(row, context.user.id));
}

function eventsForDraft(draft: LetterDraftState): TrackingEvent[] {
  const now = new Date(draft.dispatchedAt || draft.updatedAt);
  const stages = [
    ['written', 'Written', 'The words are saved and ready to travel.'],
    ['sealed', 'Sealed', 'The envelope is closed with care.'],
    ['picked-up', 'Picked up', 'Collected from the pillar box and on the move.'],
    ['on-the-way', 'On the way', 'Your letter is crossing the distance.'],
    ['arriving-soon', draft.status === 'delivered' ? 'Delivered' : 'Arriving soon', draft.status === 'delivered' ? 'It reached the other side safely.' : 'Almost there. Keep an eye on the mailbox.'],
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

export async function syncLetterToBackend(draft: LetterDraftState) {
  const context = await getAuthenticatedClient();
  if (!context) return false;

  let profile = await getRemoteProfile();
  if (!profile) {
    const metadataName = context.user.user_metadata?.full_name || context.user.email?.split('@')[0] || defaultUserProfile.displayName;
    const generatedProfile: UserProfile = {
      ...defaultUserProfile,
      displayName: metadataName,
      username: `user_${context.user.id.slice(0, 8)}`,
    };
    await saveRemoteProfile(generatedProfile);
    profile = await getRemoteProfile();
  }
  const recipientUsername = draft.recipient.trim() || null;
  const { data: recipientProfile } = recipientUsername
    ? await context.supabase.from('profiles').select('id').eq('username', recipientUsername).maybeSingle<{ id: string }>()
    : { data: null };
  const { error } = await context.supabase.from('letters').upsert({
    id: draft.id,
    sender_id: context.user.id,
    sender_display_name: profile?.displayName || context.user.user_metadata?.full_name || context.user.email || 'A correspondent',
    recipient_id: recipientProfile?.id || null,
    recipient_username: recipientUsername,
    recipient_name: draft.address.name || null,
    subject: draft.subject || 'Untitled Letter',
    content: draft.content,
    status: draft.status,
    seal_id: draft.sealId,
    dispatched_at: draft.dispatchedAt || null,
  });
  if (error) return false;

  const events = eventsForDraft(draft).map((event) => ({
    letter_id: draft.id,
    event_key: event.id,
    status: event.status,
    note: event.note,
    is_done: event.done,
    is_current: Boolean(event.current),
    occurred_at: new Date(`${event.date} ${event.time}`).toISOString(),
  }));
  await context.supabase.from('letter_events').upsert(events, { onConflict: 'letter_id,event_key' });
  return true;
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
