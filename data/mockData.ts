export type LetterStatus = 'draft' | 'sealed' | 'dispatched' | 'delivered' | 'claim_pending';
export type DropPayloadKind = 'text' | 'image' | 'gif';
export type DropDeliveryMode = 'instant' | 'relay';
export type RecipientInviteProgressStatus = 'shared' | 'copied' | 'cancelled' | 'unavailable';

export interface RecipientInviteProgress {
  username: string;
  status: RecipientInviteProgressStatus;
  manualLinkAvailable?: boolean;
}

export interface RelayRecipientProgress {
  handoffCount: number;
  latestCarrier: string | null;
  latestNeighborhood: string | null;
  latestNote: string | null;
  latestHandoffAt: string | null;
}

export interface MockLetter {
  id: string;
  recipient: string;
  sender?: string;
  senderUsername?: string;
  direction?: 'sent' | 'received';
  date: string;
  activityAt?: string;
  status: LetterStatus;
  excerpt: string;
  subject: string;
  teaser?: string[];
  sealId?: string;
  sealColor?: string;
  sealMonogram?: string;
  payloadKind?: DropPayloadKind;
  deliveryMode?: DropDeliveryMode;
  mediaPath?: string;
  mediaMimeType?: string;
  mediaSizeBytes?: number;
  mediaUrl?: string;
  recipientInviteProgress?: RecipientInviteProgress;
  relayProgress?: RelayRecipientProgress;
  reaction?: string;
  reactionUpdatedAt?: string;
  localDemo?: boolean;
  sample?: boolean;
}

export const mockLetters: MockLetter[] = [
  {
    id: 'incoming-1',
    sample: true,
    recipient: 'sunny.stories',
    sender: 'Mina Vale',
    senderUsername: 'mina.vale',
    direction: 'received',
    date: 'Just now',
    status: 'delivered',
    excerpt: 'I kept the blue hour for you. It was hiding between the rain and the first streetlight, exactly where we left it.',
    subject: 'The blue hour',
    teaser: ['I kept the blue hour for you.', 'It was hiding between the rain…', 'Open when you want a small secret.'],
    sealId: 'celestial',
    sealColor: '#102a43',
    payloadKind: 'image',
    mediaUrl: '/demo-cat.png',
  },
  {
    id: 'incoming-gif',
    sample: true,
    recipient: 'sunny.stories',
    sender: 'Jo Park',
    senderUsername: 'jo.park',
    direction: 'received',
    date: 'Yesterday',
    status: 'delivered',
    excerpt: 'A tiny loop from the walk home. This made me think of you.',
    subject: 'The world doing its thing',
    payloadKind: 'gif',
    mediaUrl: '/demo-cat.gif',
  },
  {
    id: '1',
    sample: true,
    recipient: 'Eleanor Hartwell',
    date: 'Aug 20, 2026',
    status: 'delivered',
    excerpt: 'The garden has been overgrown since you left. I keep finding your notes in the margins of books I thought I had finished reading...',
    subject: 'The Garden in August',
    sealId: 'fern',
    sealColor: '#1e3a2b',
  },
  {
    id: '2',
    sample: true,
    recipient: 'Marcus Chen',
    date: 'Aug 18, 2026',
    status: 'dispatched',
    excerpt: 'I have been thinking about what you said about the sea. How it remembers everything and nothing at once. I think I understand now...',
    subject: 'On the Sea and Memory',
    sealId: 'compass',
    sealColor: '#b45309',
  },
  {
    id: '3',
    recipient: 'E.H.',
    date: 'Aug 22, 2026',
    status: 'draft',
    excerpt: 'Morning light through the kitchen window. The kettle is whistling and I am thinking of you. There is so much I want to say, but the pen feels heavy today...',
    subject: 'Morning Light',
    sealId: 'rose',
    sealColor: '#991b1b',
  },
  {
    id: '4',
    sample: true,
    recipient: 'Iris Vance',
    date: 'Aug 14, 2026',
    status: 'sealed',
    excerpt: 'Thank you for the photograph. The one from the pier. I had forgotten how young we looked, how certain we were that everything would stay...',
    subject: 'The Pier Photograph',
    sealId: 'monogram',
    sealColor: '#991b1b',
    sealMonogram: 'I',
  },
  {
    id: '5',
    sample: true,
    recipient: 'Theo Ashford',
    date: 'Aug 10, 2026',
    status: 'delivered',
    excerpt: 'Your last letter arrived on a Tuesday. I read it three times before breakfast. The part about the clock shop made me laugh, and then it made me cry...',
    subject: 'Tuesday Letters',
    sealId: 'quill',
    sealColor: '#991b1b',
  },
];

export const currentFocusDraft = {
  id: '3',
  recipient: 'E.H.',
  subject: 'Morning Light',
  excerpt:
    'Morning light through the kitchen window. The kettle is whistling and I am thinking of you. There is so much I want to say, but the pen feels heavy today. Perhaps it is the season changing, or perhaps it is simply that some words need more time to find their shape. I have been walking the same route each evening — past the bookshop, past the bench where we used to sit...',
  lastEdited: '2 hours ago',
  wordCount: 247,
};

export const writingPrompts = [
  'Describe a small kindness you still remember.',
  'What ordinary thing would you miss if it disappeared tomorrow?',
  'Tell someone about a place that makes you feel at home.',
  'Write about a moment you wish you could replay slowly.',
  'What is something you understand differently now?',
  'Share a little detail from today that made you smile.',
  'What would you like someone to know, with no need to reply?',
  'Describe a sound that brings back a person or place.',
];

export interface TrackingEvent {
  id: string;
  status: string;
  note: string;
  date: string;
  time: string;
  done: boolean;
  current?: boolean;
}

export interface MockSeal {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  mark: string;
  emoji: string; // backwards compatibility
  defaultWaxColor: string;
}

export interface WaxColorOption {
  id: string;
  name: string;
  hex: string;
}

export const waxColors: WaxColorOption[] = [
  { id: 'crimson', name: 'Crimson Scarlet', hex: '#991b1b' },
  { id: 'forest', name: 'Forest Moss', hex: '#1e3a2b' },
  { id: 'midnight', name: 'Midnight Navy', hex: '#102a43' },
  { id: 'amber', name: 'Antique Amber', hex: '#b45309' },
];

export const mockSeals: MockSeal[] = [
  {
    id: 'heart',
    name: 'Sacred Heart',
    subtitle: 'True Devotion',
    description: 'For unspoken closeness, enduring affection, and tender truth.',
    mark: '♥',
    emoji: '♥',
    defaultWaxColor: '#991b1b',
  },
  {
    id: 'monogram',
    name: 'Intaglio Monogram',
    subtitle: 'Personal Signet',
    description: 'A bespoke brass initial pressed in wax, made solely for them.',
    mark: 'M',
    emoji: 'M',
    defaultWaxColor: '#991b1b',
  },
  {
    id: 'crest',
    name: 'Guiding Crest',
    subtitle: 'Steadfast Light',
    description: 'For honor, safe journeys, and steadfast promises across miles.',
    mark: '✦',
    emoji: '✦',
    defaultWaxColor: '#102a43',
  },
  {
    id: 'blossom',
    name: 'Wild Blossom',
    subtitle: 'Quiet Grace',
    description: 'For words written without rush, gratitude, and tender memory.',
    mark: '✿',
    emoji: '✿',
    defaultWaxColor: '#991b1b',
  },
  {
    id: 'fern',
    name: 'Botanical Fern',
    subtitle: 'Quiet Growth',
    description: 'For patience, resilience, and quiet endurance.',
    mark: '🌿',
    emoji: '🌿',
    defaultWaxColor: '#1e3a2b',
  },
  {
    id: 'compass',
    name: "Wayfarer's Compass",
    subtitle: 'Human Relay',
    description: 'For letters crossing states and oceans through hands of strangers.',
    mark: '🧭',
    emoji: '🧭',
    defaultWaxColor: '#b45309',
  },
];

// Alias map for legacy IDs
const legacySealAliases: Record<string, string> = {
  celestial: 'crest',
  rose: 'blossom',
  quill: 'monogram',
};

export function getSealInfo(sealId?: string | null, monogram?: string | null, waxColor?: string | null) {
  const resolvedId = (sealId && legacySealAliases[sealId]) || sealId;
  const found = mockSeals.find((s) => s.id === resolvedId) || mockSeals[0];
  const displayMark = found.id === 'monogram' && monogram ? monogram.toUpperCase().slice(0, 2) : found.mark;
  const color = waxColor || found.defaultWaxColor;
  return {
    ...found,
    displayMark,
    color,
  };
}

export const mockAddress = {
  name: 'Eleanor Hartwell',
  street: '14 Willowbrook Lane',
  city: 'Cotswolds Village',
  postcode: 'GL54 1AB',
  country: 'United Kingdom',
};

export const mockFieldNotes = [
  {
    id: '1',
    date: 'Aug 20',
    text: 'I wrote this letter on a Sunday. The light was golden and I felt brave.',
  },
  {
    id: '2',
    date: 'Aug 21',
    text: 'Added a postscript about the garden. I hope she remembers it the way I do.',
  },
];
