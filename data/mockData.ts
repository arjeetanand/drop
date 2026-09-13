export type LetterStatus = 'draft' | 'sealed' | 'dispatched' | 'delivered';

export interface MockLetter {
  id: string;
  recipient: string;
  sender?: string;
  direction?: 'sent' | 'received';
  date: string;
  status: LetterStatus;
  excerpt: string;
  subject: string;
  teaser?: string[];
}

export interface MockSeal {
  id: string;
  name: string;
  description: string;
  emoji: string;
}

export interface TrackingEvent {
  id: string;
  status: string;
  note: string;
  date: string;
  time: string;
  done: boolean;
  current?: boolean;
}

export const mockLetters: MockLetter[] = [
  {
    id: 'incoming-1',
    recipient: 'sunny.stories',
    sender: 'Mina Vale',
    direction: 'received',
    date: 'Just now',
    status: 'delivered',
    excerpt: 'I kept the blue hour for you. It was hiding between the rain and the first streetlight, exactly where we left it.',
    subject: 'The blue hour',
    teaser: ['I kept the blue hour for you.', 'It was hiding between the rain…', 'Open when you want a small secret.'],
  },
  {
    id: '1',
    recipient: 'Eleanor Hartwell',
    date: 'Aug 20, 2026',
    status: 'delivered',
    excerpt: 'The garden has been overgrown since you left. I keep finding your notes in the margins of books I thought I had finished reading...',
    subject: 'The Garden in August',
  },
  {
    id: '2',
    recipient: 'Marcus Chen',
    date: 'Aug 18, 2026',
    status: 'dispatched',
    excerpt: 'I have been thinking about what you said about the sea. How it remembers everything and nothing at once. I think I understand now...',
    subject: 'On the Sea and Memory',
  },
  {
    id: '3',
    recipient: 'E.H.',
    date: 'Aug 22, 2026',
    status: 'draft',
    excerpt: 'Morning light through the kitchen window. The kettle is whistling and I am thinking of you. There is so much I want to say, but the pen feels heavy today...',
    subject: 'Morning Light',
  },
  {
    id: '4',
    recipient: 'Iris Vance',
    date: 'Aug 14, 2026',
    status: 'sealed',
    excerpt: 'Thank you for the photograph. The one from the pier. I had forgotten how young we looked, how certain we were that everything would stay...',
    subject: 'The Pier Photograph',
  },
  {
    id: '5',
    recipient: 'Theo Ashford',
    date: 'Aug 10, 2026',
    status: 'delivered',
    excerpt: 'Your last letter arrived on a Tuesday. I read it three times before breakfast. The part about the clock shop made me laugh, and then it made me cry...',
    subject: 'Tuesday Letters',
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

export const mockSeals: MockSeal[] = [
  {
    id: 'heart',
    name: 'Heart',
    description: 'A classic symbol of affection',
    emoji: '♥',
  },
  {
    id: 'monogram',
    name: 'Monogram',
    description: 'Your initials, pressed in wax',
    emoji: 'M',
  },
  {
    id: 'crest',
    name: 'Crest',
    description: 'A family crest, elegant and formal',
    emoji: '✦',
  },
  {
    id: 'rose',
    name: 'Rose',
    description: 'A single rose, delicate and quiet',
    emoji: '✿',
  },
];

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
