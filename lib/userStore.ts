import { getLocalAccountId } from './localAccountScope.ts';

export interface UserProfile {
  displayName: string;
  username: string;
  bio: string;
  lettersSent: number;
  lettersReceived: number;
}

const STORAGE_KEY = 'dear-exe:user-profile:v1';
const PROFILE_OWNER_KEY = 'dear-exe:user-profile-owner:v1';
const ACCOUNT_PROFILE_KEY = 'dear-exe:user-profile:v1:account:';
const PENDING_SYNC_KEY = 'dear-exe:pending-profile-sync:v1:';
const LEGACY_PENDING_SYNC_KEY = 'dear-exe:pending-profile-sync:v1';
const SYNCED_PENDING_KEY = 'dear-exe:synced-profile-revision:v1:';
const SYNCED_LEGACY_PENDING_KEY = 'dear-exe:synced-legacy-profile-revision:v1:';

export const defaultUserProfile: UserProfile = {
  displayName: 'Anya Mercer',
  username: 'sunny.stories',
  bio: 'Collecting small moments and sending them forward.',
  lettersSent: 12,
  lettersReceived: 5,
};

export function suggestedDropUsername(userId: string) {
  return `drop_${userId.replace(/-/g, '').slice(0, 19).toLowerCase()}`;
}

export function hasCustomizedUserIdentity(profile: UserProfile) {
  return profile.displayName !== defaultUserProfile.displayName
    || profile.username !== defaultUserProfile.username
    || profile.bio !== defaultUserProfile.bio;
}

export function getFirstUseProfile(userId: string, displayName: string, localProfile: UserProfile = defaultUserProfile, localOwnerId?: string): UserProfile {
  const hasLocalIdentity = (!localOwnerId || localOwnerId === userId)
    && typeof localProfile.displayName === 'string'
    && typeof localProfile.username === 'string'
    && typeof localProfile.bio === 'string'
    && hasCustomizedUserIdentity(localProfile);
  return {
    displayName: hasLocalIdentity ? localProfile.displayName : displayName || 'A correspondent',
    username: hasLocalIdentity ? localProfile.username : suggestedDropUsername(userId),
    bio: hasLocalIdentity ? localProfile.bio : '',
    lettersSent: 0,
    lettersReceived: 0,
  };
}

function isUserProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<UserProfile>;
  return typeof profile.displayName === 'string'
    && typeof profile.username === 'string'
    && typeof profile.bio === 'string'
    && Number.isInteger(profile.lettersSent) && (profile.lettersSent ?? -1) >= 0
    && Number.isInteger(profile.lettersReceived) && (profile.lettersReceived ?? -1) >= 0;
}

function pendingProfileKey(userId: string) {
  return `${PENDING_SYNC_KEY}${encodeURIComponent(userId)}`;
}

function syncedPendingProfileKey(userId: string) {
  return `${SYNCED_PENDING_KEY}${encodeURIComponent(userId)}`;
}

function syncedLegacyPendingProfileKey(userId: string) {
  return `${SYNCED_LEGACY_PENDING_KEY}${encodeURIComponent(userId)}`;
}

function accountProfileKey(userId: string) {
  return `${ACCOUNT_PROFILE_KEY}${encodeURIComponent(userId)}`;
}

interface StoredPendingRemoteProfileSnapshot {
  profile: UserProfile;
  revision: string;
}

export interface PendingRemoteProfileSnapshot extends StoredPendingRemoteProfileSnapshot {
  synced: boolean;
  legacyConflict?: { profile: UserProfile; revision: string };
}

export type SavePendingRemoteProfileResult =
  | { ok: true; revision: string }
  | { ok: false; reason: 'conflict' | 'unavailable' };

export function sameProfileIdentity(left: UserProfile, right: UserProfile) {
  return left.displayName === right.displayName && left.username === right.username && left.bio === right.bio;
}

export function hasUnmatchedLocalProfile(profile: UserProfile, ownerId: string, userId: string, remoteProfile?: UserProfile, savedProfile?: UserProfile) {
  return (!ownerId || ownerId === userId)
    && hasCustomizedUserIdentity(profile)
    && (!remoteProfile || !sameProfileIdentity(profile, remoteProfile))
    && (!savedProfile || !sameProfileIdentity(profile, savedProfile));
}

function readLegacyMapPendingProfile(userId: string): StoredPendingRemoteProfileSnapshot | null {
  try {
    const legacyMap: unknown = JSON.parse(window.localStorage.getItem(LEGACY_PENDING_SYNC_KEY) || 'null');
    if (!legacyMap || typeof legacyMap !== 'object') return null;
    const legacyEntry = (legacyMap as Record<string, unknown>)[userId];
    if (!legacyEntry || typeof legacyEntry !== 'object') return null;
    const legacyProfile = (legacyEntry as { profile?: unknown }).profile;
    return isUserProfile(legacyProfile)
      ? { profile: legacyProfile, revision: `legacy-map:${JSON.stringify(legacyProfile)}` }
      : null;
  } catch {
    return null;
  }
}

function readPendingRemoteProfile(userId: string): StoredPendingRemoteProfileSnapshot | null {
  if (!canUseStorage()) return null;
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(pendingProfileKey(userId)) || 'null');
    if (isUserProfile(stored)) return { profile: stored, revision: `legacy:${JSON.stringify(stored)}` };
    if (stored && typeof stored === 'object') {
      const snapshot = stored as Partial<StoredPendingRemoteProfileSnapshot>;
      if (isUserProfile(snapshot.profile) && typeof snapshot.revision === 'string') {
        return { profile: snapshot.profile, revision: snapshot.revision };
      }
    }

    // Keep the legacy map intact because an older open tab may still be writing it.
    return readLegacyMapPendingProfile(userId);
  } catch {
    return null;
  }
}

export function getPendingRemoteProfileSnapshot(userId: string): PendingRemoteProfileSnapshot | null {
  const snapshot = readPendingRemoteProfile(userId);
  if (!snapshot) return null;
  try {
    const synced = window.localStorage.getItem(syncedPendingProfileKey(userId)) === snapshot.revision
      || (snapshot.revision.startsWith('legacy') && window.localStorage.getItem(syncedLegacyPendingProfileKey(userId)) === snapshot.revision);
    const legacy = snapshot.revision.startsWith('legacy-map') ? null : readLegacyMapPendingProfile(userId);
    const legacyWasSynced = legacy && window.localStorage.getItem(syncedLegacyPendingProfileKey(userId)) === legacy.revision;
    const legacyConflict = legacy && !legacyWasSynced && !sameProfileIdentity(snapshot.profile, legacy.profile)
      ? { profile: legacy.profile, revision: legacy.revision }
      : undefined;
    return legacyConflict ? { ...snapshot, synced, legacyConflict } : { ...snapshot, synced };
  } catch {
    return { ...snapshot, synced: false };
  }
}

export async function withPendingRemoteProfileLock<T>(userId: string, update: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return update();
  let started = false;
  try {
    return await navigator.locks.request(pendingProfileKey(userId), () => {
      started = true;
      return update();
    });
  } catch (error) {
    if (started) throw error;
    return update();
  }
}

async function withPendingProfileLock(userId: string, update: (serialized: boolean) => void, fallback: boolean): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    let started = false;
    try {
      await navigator.locks.request(pendingProfileKey(userId), () => {
        started = true;
        update(true);
      });
      return;
    } catch {
      if (!started && fallback) update(false);
      return;
    }
  }
  // shortcut: Browsers without Web Locks cannot serialize cross-tab writes; upgrade to transactional storage if that support is needed.
  if (fallback) update(false);
}

export async function savePendingRemoteProfile(userId: string, profile: UserProfile, replaceRevision?: string): Promise<SavePendingRemoteProfileResult> {
  if (!canUseStorage()) return { ok: false, reason: 'unavailable' };
  let result: SavePendingRemoteProfileResult = { ok: false, reason: 'unavailable' };
  await withPendingProfileLock(userId, (serialized) => {
    try {
      const current = getPendingRemoteProfileSnapshot(userId);
      const legacyConflict = current?.legacyConflict;
      const choosesVisibleCopy = Boolean(replaceRevision && (replaceRevision === current?.revision || replaceRevision === legacyConflict?.revision));
      if (legacyConflict && (!choosesVisibleCopy || !serialized)) {
        result = { ok: false, reason: 'conflict' };
        return;
      }
      if (current && !current.synced) {
        const sameCurrentProfile = sameProfileIdentity(current.profile, profile);
        if (!sameCurrentProfile && current.revision !== replaceRevision && legacyConflict?.revision !== replaceRevision) {
          result = { ok: false, reason: 'conflict' };
          return;
        }
        if (!sameCurrentProfile && !serialized) {
          result = { ok: false, reason: 'conflict' };
          return;
        }
        if (sameCurrentProfile && !legacyConflict) {
          result = { ok: true, revision: current.revision };
          return;
        }
      }
      const revision = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      window.localStorage.setItem(pendingProfileKey(userId), JSON.stringify({ profile, revision }));
      const legacyRevisionToAcknowledge = legacyConflict?.revision
        || (current?.revision.startsWith('legacy') && current.revision !== revision ? current.revision : null);
      if (legacyRevisionToAcknowledge) {
        window.localStorage.setItem(syncedLegacyPendingProfileKey(userId), legacyRevisionToAcknowledge);
      }
      result = { ok: true, revision };
    } catch {
      // The local profile remains available for the current session.
    }
  }, true);
  return result;
}

export function markPendingRemoteProfileSynced(userId: string, revision: string) {
  if (!canUseStorage()) return;
  try {
    if (readPendingRemoteProfile(userId)?.revision === revision) {
      window.localStorage.setItem(syncedPendingProfileKey(userId), revision);
      if (revision.startsWith('legacy')) window.localStorage.setItem(syncedLegacyPendingProfileKey(userId), revision);
    }
  } catch {
    // A stale pending copy remains safe and available for review.
  }
}

export async function clearPendingRemoteProfile(userId: string, revision: string) {
  if (!canUseStorage()) return;
  await withPendingProfileLock(userId, () => {
    if (readPendingRemoteProfile(userId)?.revision !== revision) return;
    try {
      window.localStorage.removeItem(pendingProfileKey(userId));
    } catch {
      // A stale pending copy is safe and will remain available for review.
    }
  }, false);
}

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

export function getUserProfileOwnerId() {
  if (!canUseStorage()) return '';
  try {
    return window.localStorage.getItem(PROFILE_OWNER_KEY) || '';
  } catch {
    return '';
  }
}

export function getUserProfileForCurrentAccount() {
  return (getUserProfileOwnerId() || null) === getLocalAccountId() ? getUserProfile() : defaultUserProfile;
}

export function getUserProfileForAccount(userId: string): UserProfile | null {
  if (!canUseStorage()) return null;
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(accountProfileKey(userId)) || 'null');
    return isUserProfile(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function preserveUserProfileForAccount(userId: string, profile: UserProfile) {
  if (!canUseStorage()) return false;
  try {
    const serialized = JSON.stringify(profile);
    const key = accountProfileKey(userId);
    if (window.localStorage.getItem(key) !== serialized) window.localStorage.setItem(key, serialized);
    return window.localStorage.getItem(key) === serialized;
  } catch {
    return false;
  }
}

export function saveUserProfile(updates: Partial<UserProfile>, ownerId?: string | null) {
  const next = { ...getUserProfile(), ...updates };
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      if (ownerId !== undefined) {
        if (ownerId) window.localStorage.setItem(PROFILE_OWNER_KEY, ownerId);
        else window.localStorage.removeItem(PROFILE_OWNER_KEY);
      }
      const profileOwnerId = ownerId === undefined ? getUserProfileOwnerId() : ownerId;
      if (profileOwnerId) preserveUserProfileForAccount(profileOwnerId, next);
    } catch {
      // The profile remains usable for the current session.
    }
  }
  return next;
}

export function profileUrl(username = getUserProfile().username) {
  return `/u/${encodeURIComponent(username.replace(/^@/, ''))}`;
}
