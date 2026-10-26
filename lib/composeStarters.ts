import type { DropPayloadKind } from '@/data/mockData';

export const COMPOSE_STARTERS: Record<DropPayloadKind, readonly string[]> = {
  text: [
    'I thought you might like this.',
    'One thing I appreciate about you is…',
    'Just wanted to check in and say hello.',
  ],
  image: [
    'This made me think of you.',
    'A small moment from today.',
    'I wanted you to see this.',
  ],
  gif: [
    'This made me think of you.',
    'A little laugh for your day.',
    'Sending a smile your way.',
  ],
};

export function getComposeStarterValue(currentText: string, starter: string): string {
  return currentText.trim() ? currentText : starter;
}
