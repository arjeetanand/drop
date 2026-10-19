import assert from 'node:assert/strict';
import test from 'node:test';
import { emailLinkErrorMessage } from '../lib/emailLinkErrorMessage.ts';

test('shows a retry hint for opaque response parsing errors', () => {
  assert.equal(
    emailLinkErrorMessage(new SyntaxError('Unexpected non-whitespace character after JSON at position 4')),
    'A sign-in link could not be sent. Check your connection and try again.',
  );
});

test('preserves actionable Supabase auth API errors', () => {
  const error = new Error('Email rate limit exceeded');
  error.name = 'AuthApiError';

  assert.equal(emailLinkErrorMessage(error), 'Email rate limit exceeded');
});

test('uses the retry hint for unknown and empty errors', () => {
  assert.equal(emailLinkErrorMessage(new Error('')), 'A sign-in link could not be sent. Check your connection and try again.');
  assert.equal(emailLinkErrorMessage(null), 'A sign-in link could not be sent. Check your connection and try again.');
});
