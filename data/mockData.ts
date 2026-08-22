export type LetterStatus = 'draft' | 'sealed' | 'dispatched' | 'delivered';

export interface MockLetter {
  id: string;
  recipient: string;
  date: string;
  status: LetterStatus;
  excerpt: string;
  subject: string;
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
    'Morning light through the kitchen window. The kettle is whistling and I am thinking of you. There is so much I want to say, but the pen feels heavy today. Perhaps it is the season changing, or perhaps it is simply that some words need more time to find their shape. I have been walking the same route each evening — past the postbox, past the bookshop, past the bench where we used to sit...',
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

export const mockTrackingEvents: TrackingEvent[] = [
  {
    id: '1',
    status: 'Dispatched',
    note: 'Collected from the pillar box on Tuesday morning. The postman smiled.',
    date: 'Aug 20',
    time: '07:42',
    done: true,
  },
  {
    id: '2',
    status: 'Sorted',
    note: 'Sorted at the central depot. Your words are moving.',
    date: 'Aug 20',
    time: '14:15',
    done: true,
  },
  {
    id: '3',
    status: 'In Transit',
    note: 'On the scenic route. Passing through countryside and coast.',
    date: 'Aug 21',
    time: '09:30',
    done: true,
  },
  {
    id: '4',
    status: 'Out for Delivery',
    note: 'Out for delivery. Almost there.',
    date: 'Aug 22',
    time: '06:00',
    done: false,
    current: true,
  },
  {
    id: '5',
    status: 'Delivered',
    note: 'Awaiting arrival at the destination.',
    date: 'Expected',
    time: '3–5 days',
    done: false,
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
