export interface UserProfile {
  displayName: string;
  username: string;
  bio: string;
  lettersSent: number;
  lettersReceived: number;
}

const STORAGE_KEY = 'dear-exe:user-profile:v1';

export const defaultUserProfile: UserProfile = {
  displayName: 'Anya Mercer',
  username: 'sunny.stories',
  bio: 'Collecting small moments and sending them forward.',
  lettersSent: 12,
  lettersReceived: 5,
};

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getUserProfile(): UserProfile {
  if (!canUseStorage()) return defaultUserProfile;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Partial<UserProfile>;
    return { ...defaultUserProfile, ...parsed };
  } catch {
    return defaultUserProfile;
  }
}

export function saveUserProfile(updates: Partial<UserProfile>) {
  const next = { ...getUserProfile(), ...updates };
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The profile remains usable for the current session.
    }
  }
  return next;
}

export function profileUrl(username = getUserProfile().username) {
  return `/u/${encodeURIComponent(username.replace(/^@/, ''))}`;
}
