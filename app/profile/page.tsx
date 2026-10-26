'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Copy, LogIn, LogOut, Share2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DropPushNotificationSettings } from '@/components/DropPushNotificationSettings';
import { disableDropPushForCurrentAccount } from '@/lib/dropPushNotifications';
import { getRemoteProfileState, saveRemoteProfile, type SaveRemoteProfileResult } from '@/lib/letterBackend';
import { normalizeDropRecipient } from '@/lib/dropValidation';
import { getSupabaseBrowserClient, isSupabaseAuthConfigured } from '@/lib/supabaseBrowser';
import { getLocalAccountId } from '@/lib/localAccountScope';
import { safeInternalPath } from '@/lib/safeInternalPath';
import { authCallbackRoute, canEditInviteProfile, claimReturnAfterProfileSync, isClaimReturnPath, profileRoute } from '@/lib/inviteOnboarding';
import { emailLinkErrorMessage } from '@/lib/emailLinkErrorMessage';
import { copyProfileSharePayload, createProfileSharePayload } from '@/lib/profileInviteShare';
import { shareInviteLink } from '@/lib/shareInvite';
import { clearPendingRemoteProfile, defaultUserProfile, getFirstUseProfile, getPendingRemoteProfileSnapshot, getUserProfile, getUserProfileForAccount, getUserProfileOwnerId, hasCustomizedUserIdentity, hasUnmatchedLocalProfile, markPendingRemoteProfileSynced, preserveUserProfileForAccount, profileUrl, savePendingRemoteProfile, saveUserProfile, type UserProfile } from '@/lib/userStore';

type AccountStatus = 'checking' | 'signed-out' | 'signed-in' | 'unavailable' | 'error';

function ProfileLoading() {
  return (
    <main className="page-shell">
      <div className="page-container max-w-[1080px]">
        <p className="meta" role="status" aria-live="polite">Loading your profile…</p>
      </div>
    </main>
  );
}

function ProfileContent() {
  const [profile, setProfile] = useState<UserProfile>(defaultUserProfile);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [profileError, setProfileError] = useState('');
  const [accountNotice, setAccountNotice] = useState('');
  const [accountNoticeIsError, setAccountNoticeIsError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteShareNotice, setInviteShareNotice] = useState('');
  const [manualInviteCopy, setManualInviteCopy] = useState('');
  const [copyingInvite, setCopyingInvite] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailLinkSent, setEmailLinkSent] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState('');
  const [remoteProfileAvailable, setRemoteProfileAvailable] = useState(false);
  const [remoteProfileMissing, setRemoteProfileMissing] = useState(false);
  const [remoteProfileBase, setRemoteProfileBase] = useState<UserProfile | null>(null);
  const [remoteUserId, setRemoteUserId] = useState('');
  const [canRestorePendingProfile, setCanRestorePendingProfile] = useState(false);
  const [legacyPendingConflict, setLegacyPendingConflict] = useState(false);
  const [localProfileConflict, setLocalProfileConflict] = useState(false);
  const [identityUnverified, setIdentityUnverified] = useState(false);
  const [pendingRevisionToReplace, setPendingRevisionToReplace] = useState<string | null>(null);
  const [profileLookupFailed, setProfileLookupFailed] = useState(false);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('checking');
  const router = useRouter();
  const searchParams = useSearchParams();
  const authError = searchParams.get('authError');
  const inviteContext = searchParams.get('invite') === '1';
  const nextPath = safeInternalPath(searchParams.get('next'), typeof window === 'undefined' ? 'https://drop.invalid' : window.location.origin);
  const claimReturn = isClaimReturnPath(nextPath);
  const canEditProfile = canEditInviteProfile(inviteContext, accountStatus, profileLookupFailed, identityUnverified);
  const supabaseAuthConfigured = isSupabaseAuthConfigured();

  useEffect(() => {
    let active = true;

    const loadProfile = async () => {
      const state = await getRemoteProfileState();
      if (!active) return;
      let localProfile = getUserProfile();
      let localOwnerId = getUserProfileOwnerId();
      let preservedPreviousAccountProfile = false;
      const stateUserId = ('userId' in state ? state.userId : '') || '';
      const addPreviousAccountNotice = (message: string) => [
        message,
        preservedPreviousAccountProfile ? 'Your previous account’s profile edits are saved separately on this device.' : '',
      ].filter(Boolean).join(' ');

      if ((state.status === 'found' || state.status === 'missing' || state.status === 'error')
        && stateUserId && localOwnerId && localOwnerId !== stateUserId) {
        if (hasCustomizedUserIdentity(localProfile) && !preserveUserProfileForAccount(localOwnerId, localProfile)) {
          setProfile(defaultUserProfile);
          setProfileLookupFailed(true);
          setRemoteUserId('');
          setAccountStatus('error');
          setIdentityUnverified(true);
          setRemoteProfileAvailable(false);
          setAccountNotice('This device could not preserve the profile from your previous account, so it has not switched profiles. Check device storage and try again.');
          setAccountNoticeIsError(true);
          setProfileLoaded(true);
          return;
        }
        preservedPreviousAccountProfile = hasCustomizedUserIdentity(localProfile);
        const accountProfile = getUserProfileForAccount(stateUserId);
        if (accountProfile) {
          localProfile = accountProfile;
          localOwnerId = stateUserId;
        } else {
          localProfile = defaultUserProfile;
          localOwnerId = '';
        }
      }

      if (state.status === 'found') {
        setRemoteProfileBase(state.profile);
        const pendingSnapshot = getPendingRemoteProfileSnapshot(state.userId);
        const pendingProfile = pendingSnapshot?.profile ?? null;
        const pendingConflict = Boolean(pendingSnapshot?.legacyConflict || (pendingProfile && (
          pendingProfile.displayName !== state.profile.displayName
          || pendingProfile.username !== state.profile.username
          || pendingProfile.bio !== state.profile.bio
        )));
        const hasLocalConflict = hasUnmatchedLocalProfile(localProfile, localOwnerId, state.userId, state.profile, pendingProfile || undefined);
        if (pendingSnapshot && !pendingConflict) {
          markPendingRemoteProfileSynced(state.userId, pendingSnapshot.revision);
          await clearPendingRemoteProfile(state.userId, pendingSnapshot.revision);
        }
        setPendingRevisionToReplace(null);
        const profileToShow = hasLocalConflict ? localProfile : state.profile;
        saveUserProfile(profileToShow, state.userId);
        setProfile(profileToShow);
        setSignedInEmail(state.email);
        setRemoteUserId(state.userId);
        setIdentityUnverified(false);
        setCanRestorePendingProfile(Boolean(pendingConflict && pendingSnapshot));
        setLegacyPendingConflict(Boolean(pendingSnapshot?.legacyConflict));
        setLocalProfileConflict(hasLocalConflict);
        setRemoteProfileMissing(false);
        setAccountStatus('signed-in');
        setRemoteProfileAvailable(!hasLocalConflict);
        if (pendingConflict) {
          setAccountNotice(addPreviousAccountNotice(hasLocalConflict
            ? 'A signed-out edit and a saved account edit are both on this device. Choose which copy to keep before saving.'
            : pendingSnapshot?.legacyConflict
            ? 'Different profile edits are saved in another open tab. Choose which saved copy to keep before saving.'
            : pendingSnapshot?.synced
              ? 'Your account profile has changed since this device last synced. The fields below show the current account version; restore your saved edits to review this device’s copy.'
              : 'Your saved edits differ from the profile on your account. Review it below, or restore your saved edits before choosing Save.'));
          setAccountNoticeIsError(false);
        } else if (hasLocalConflict) {
          setAccountNotice(addPreviousAccountNotice('A profile saved while signed out is ready on this device. Save identity to use it on this account, or choose the account version.'));
          setAccountNoticeIsError(false);
        } else {
          setAccountNotice(addPreviousAccountNotice(''));
          setAccountNoticeIsError(false);
        }
      } else if (state.status === 'missing') {
        setRemoteProfileBase(null);
        const pendingSnapshot = getPendingRemoteProfileSnapshot(state.userId);
        const pendingProfile = pendingSnapshot?.profile ?? null;
        const hasSavedGuestIdentity = (!localOwnerId || localOwnerId === state.userId) && hasCustomizedUserIdentity(localProfile);
        const hasLocalConflict = Boolean(pendingProfile
          && hasUnmatchedLocalProfile(localProfile, localOwnerId, state.userId, undefined, pendingProfile));
        const nextProfile = hasLocalConflict
          ? localProfile
          : pendingProfile || getFirstUseProfile(state.userId, state.displayName, localProfile, localOwnerId);
        if (pendingProfile && !hasLocalConflict) saveUserProfile(pendingProfile, state.userId);
        setPendingRevisionToReplace(pendingSnapshot?.legacyConflict || hasLocalConflict ? null : pendingSnapshot?.revision ?? null);
        setProfile(nextProfile);
        setSignedInEmail(state.email);
        setRemoteUserId(state.userId);
        setIdentityUnverified(false);
        setCanRestorePendingProfile(Boolean(pendingSnapshot && (pendingSnapshot.legacyConflict || hasLocalConflict)));
        setLegacyPendingConflict(Boolean(pendingSnapshot?.legacyConflict));
        setLocalProfileConflict(hasLocalConflict);
        setRemoteProfileMissing(true);
        setAccountStatus('signed-in');
        setRemoteProfileAvailable(false);
        const firstUseNotice = hasLocalConflict
          ? 'A newer profile edit and an account edit are both saved on this device. Choose which copy to keep before creating your account profile.'
          : pendingSnapshot?.legacyConflict
            ? 'Different profile edits are saved in another open tab. Choose which saved copy to keep before saving.'
          : pendingProfile
            ? 'A profile change saved on this device is waiting to sync. Review it before saving to your account.'
          : hasSavedGuestIdentity
            ? 'A saved profile from this device is ready to use. Review it before linking it to your account.'
            : 'No profile is linked to this account yet. Review your editable handle, then save to create it.';
        setAccountNotice(addPreviousAccountNotice(firstUseNotice));
        setAccountNoticeIsError(false);
      } else if (state.status === 'signed-out' || state.status === 'unavailable') {
        setRemoteProfileBase(null);
        setProfile(localOwnerId ? defaultUserProfile : getUserProfile());
        setPendingRevisionToReplace(null);
        setCanRestorePendingProfile(false);
        setLegacyPendingConflict(false);
        setLocalProfileConflict(false);
        setSignedInEmail('');
        setRemoteUserId('');
        setRemoteProfileMissing(false);
        setIdentityUnverified(false);
        setAccountStatus(state.status === 'unavailable' ? 'unavailable' : 'signed-out');
        setRemoteProfileAvailable(false);
      } else {
        setRemoteProfileBase(null);
        const pendingSnapshot = state.userId ? getPendingRemoteProfileSnapshot(state.userId) : null;
        const pendingProfile = pendingSnapshot?.profile ?? null;
        const unidentifiedOwnedProfile = !stateUserId && Boolean(localOwnerId);
        if (unidentifiedOwnedProfile) localProfile = defaultUserProfile;
        const hasLocalConflict = Boolean(pendingProfile
          && hasUnmatchedLocalProfile(localProfile, localOwnerId, state.userId || '', undefined, pendingProfile));
        if (pendingProfile && !hasLocalConflict && state.userId) saveUserProfile(pendingProfile, state.userId);
        setPendingRevisionToReplace(pendingSnapshot?.legacyConflict || hasLocalConflict ? null : pendingSnapshot?.revision ?? null);
        setProfile(hasLocalConflict ? localProfile : pendingProfile || localProfile);
        setProfileLookupFailed(true);
        setRemoteUserId(state.userId || '');
        setCanRestorePendingProfile(Boolean(pendingSnapshot && (pendingSnapshot.legacyConflict || hasLocalConflict)));
        setLegacyPendingConflict(Boolean(pendingSnapshot?.legacyConflict));
        setLocalProfileConflict(hasLocalConflict);
        setIdentityUnverified(unidentifiedOwnedProfile);
        setAccountStatus('error');
        setRemoteProfileAvailable(false);
        setAccountNotice(unidentifiedOwnedProfile
          ? 'We could not verify which account is connected. Profile editing is paused so this device does not change the wrong account. Refresh to try again.'
          : addPreviousAccountNotice('We could not check your account profile. Your edits can stay on this device; account sync is paused to protect your profile. Refresh to try again.'));
        setAccountNoticeIsError(true);
      }
      setProfileLoaded(true);
    };

    void loadProfile().catch(() => {
      if (!active) return;
      const ownedProfile = Boolean(getUserProfileOwnerId());
      setProfile(ownedProfile ? defaultUserProfile : getUserProfile());
      setRemoteProfileBase(null);
      setPendingRevisionToReplace(null);
      setCanRestorePendingProfile(false);
      setLegacyPendingConflict(false);
      setLocalProfileConflict(false);
      setProfileLookupFailed(true);
      setRemoteUserId('');
      setIdentityUnverified(ownedProfile);
      setAccountStatus('error');
      setRemoteProfileAvailable(false);
      setAccountNotice(ownedProfile
        ? 'We could not verify which account is connected. Profile editing is paused so this device does not change the wrong account. Refresh to try again.'
        : 'We could not check your account profile. Your edits can stay on this device; account sync is paused to protect your profile. Refresh to try again.');
      setAccountNoticeIsError(true);
      setProfileLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authError) return;
    setAccountStatus('error');
    setAccountNotice(`Sign-in could not finish: ${authError}`);
    setAccountNoticeIsError(true);
    router.replace(profileRoute(inviteContext, nextPath), { scroll: false });
  }, [authError, inviteContext, nextPath, router]);

  const update = (field: keyof Pick<UserProfile, 'displayName' | 'username' | 'bio'>, value: string) => {
    const nextValue = field === 'username'
      ? value.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24)
      : value;
    setProfile((current) => ({ ...current, [field]: nextValue }));
    setSaved(false);
    setRemoteProfileAvailable(false);
    setNotice('');
    setProfileError('');
    setInviteShareNotice('');
    setManualInviteCopy('');
  };

  const save = async () => {
    if (!canEditProfile) return;
    const username = normalizeDropRecipient(profile.username);
    if (!username) {
      setProfileError('Use 2–24 letters, numbers, periods, underscores, or hyphens.');
      return;
    }
    if (identityUnverified) {
      setAccountNotice('We could not verify which account is connected. Refresh before editing your profile.');
      setAccountNoticeIsError(true);
      return;
    }

    setSaving(true);
    setSaved(false);
    setProfileError('');
    setNotice('');
    const nextProfile = { ...profile, username };
    let pendingRevision: string | null = null;
    if (remoteUserId) {
      const pendingResult = await savePendingRemoteProfile(remoteUserId, nextProfile, pendingRevisionToReplace || undefined);
      if (pendingResult.ok) {
        pendingRevision = pendingResult.revision;
      } else if (pendingResult.reason === 'conflict') {
        setProfile(nextProfile);
        setSaving(false);
        setCanRestorePendingProfile(Boolean(getPendingRemoteProfileSnapshot(remoteUserId)));
        setLegacyPendingConflict(Boolean(getPendingRemoteProfileSnapshot(remoteUserId)?.legacyConflict));
        setAccountNotice(typeof navigator !== 'undefined' && !navigator.locks
          ? 'This browser cannot safely replace a saved profile edit across tabs. Your current form has not been saved; open Drop in a browser with Web Locks to resolve the saved copy.'
          : 'A different saved profile edit needs review before it can be replaced. Restore one of the saved copies first. Your current form has not been saved.');
        setAccountNoticeIsError(false);
        setNotice('Your current form is still here, but it has not been saved.');
        return;
      }
    }
    const savedProfile = saveUserProfile(nextProfile, remoteUserId || null);
    setProfile(savedProfile);

    let syncResult: SaveRemoteProfileResult = { ok: false, reason: 'signed-out' };
    if (profileLookupFailed || accountStatus === 'error') {
      syncResult = { ok: false, reason: 'sync-failed' };
    } else if (accountStatus === 'signed-in') {
      try {
        syncResult = await saveRemoteProfile(nextProfile, remoteUserId, remoteProfileMissing, pendingRevision || undefined, remoteProfileBase || undefined);
      } catch {
        syncResult = { ok: false, reason: 'sync-failed' };
      }
    }

    if (syncResult.ok && remoteUserId && pendingRevision) {
      markPendingRemoteProfileSynced(remoteUserId, pendingRevision);
      await clearPendingRemoteProfile(remoteUserId, pendingRevision);
      setPendingRevisionToReplace(null);
      setCanRestorePendingProfile(false);
      setLegacyPendingConflict(false);
      setLocalProfileConflict(false);
    } else if (remoteUserId && pendingRevision) {
      setPendingRevisionToReplace(pendingRevision);
      setCanRestorePendingProfile(false);
      setLegacyPendingConflict(false);
      setLocalProfileConflict(false);
    }
    if (syncResult.ok) {
      setRemoteProfileBase(nextProfile);
      setRemoteProfileMissing(false);
      setAccountNotice('');
      setAccountNoticeIsError(false);
    }
    setSaved(true);
    setSaving(false);
    setRemoteProfileAvailable(syncResult.ok);
    setProfileError(syncResult.ok ? '' : syncResult.reason === 'username-taken' ? 'That handle is already taken. Try another.' : '');
    let saveNotice = 'Saved on this device. Sign in to send private drops and sync across devices.';
    if (syncResult.ok) {
      saveNotice = 'Saved on this device and synced to your account.';
    } else if (syncResult.reason === 'username-taken') {
      saveNotice = 'Saved on this device only. Choose a different handle to make your profile available to friends.';
    } else if (syncResult.reason === 'profile-exists') {
      saveNotice = 'Saved on this device only. A profile appeared on your account while you were editing; reload to review the account version and choose which to keep.';
    } else if (syncResult.reason === 'account-changed') {
      saveNotice = 'Saved on this device only. Your sign-in changed; reload this page before syncing to the new account.';
    } else if (syncResult.reason === 'profile-changed') {
      saveNotice = 'Saved on this device only. Your account profile changed since this page loaded; reload to review the current version before syncing again.';
      setAccountNotice(saveNotice);
      setAccountNoticeIsError(false);
      setCanRestorePendingProfile(Boolean(pendingRevision));
    } else if (profileLookupFailed || accountStatus === 'error') {
      saveNotice = 'Saved on this device only. Your account profile could not be checked, so this change was not synced.';
    } else if (signedInEmail) {
      saveNotice = 'Saved on this device only. Account sync did not finish; your profile link is not live yet.';
    }
    setNotice(saveNotice);
    const syncedClaimReturn = claimReturnAfterProfileSync(syncResult.ok, nextPath);
    if (syncedClaimReturn) router.replace(syncedClaimReturn);
  };

  const connectGoogle = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !supabaseAuthConfigured) {
      setAccountNotice('Google sign-in is optional. Add the Supabase values to enable the real sign-in flow.');
      setAccountNoticeIsError(false);
      setAccountStatus('unavailable');
      return;
    }

    setGoogleLoading(true);
    setAccountNotice('Opening Google sign-in…');
    setAccountNoticeIsError(false);
    try {
      window.sessionStorage.removeItem('dear-exe:auth-return');
      if (nextPath) window.sessionStorage.setItem('dear-exe:auth-return', nextPath);
    } catch { /* Sign-in can continue without a return path when storage is disabled. */ }
    try {
      const redirectTo = new URL(authCallbackRoute(inviteContext, nextPath), window.location.origin);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectTo.toString() },
      });
      if (error) {
        window.sessionStorage.removeItem('dear-exe:auth-return');
        setGoogleLoading(false);
        setAccountStatus('error');
        setAccountNotice(error.message || 'Google sign-in could not start.');
        setAccountNoticeIsError(true);
      }
    } catch {
      window.sessionStorage.removeItem('dear-exe:auth-return');
      setGoogleLoading(false);
      setAccountStatus('error');
      setAccountNotice('Google sign-in could not start. Please try again.');
      setAccountNoticeIsError(true);
    }
  };

  const sendEmailSignInLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    const email = emailAddress.trim().toLowerCase();
    if (!supabase || !supabaseAuthConfigured || !email || accountConnected || emailLoading) return;

    setEmailLoading(true);
    setEmailLinkSent(false);
    setEmailError('');
    try {
      try {
        window.sessionStorage.removeItem('dear-exe:auth-return');
        if (nextPath) window.sessionStorage.setItem('dear-exe:auth-return', nextPath);
      } catch { /* Sign-in can continue without a return path when storage is disabled. */ }

      const redirectTo = new URL(authCallbackRoute(inviteContext, nextPath), window.location.origin);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo.toString() },
      });
      if (error) throw error;
      setEmailLinkSent(true);
    } catch (error) {
      try { window.sessionStorage.removeItem('dear-exe:auth-return'); } catch { /* Ignore blocked storage. */ }
      setEmailError(emailLinkErrorMessage(error));
    } finally {
      setEmailLoading(false);
    }
  };

  const signOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setSignOutLoading(true);
    setAccountNotice('Signing out…');
    setAccountNoticeIsError(false);
    try {
      const pushDisabled = await disableDropPushForCurrentAccount();
      if (!pushDisabled.ok) {
        setAccountNotice('Could not turn off alerts on this device. You’re still signed in; please try again before signing out.');
        setAccountNoticeIsError(true);
        setSignOutLoading(false);
        return;
      }

      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setAccountStatus('signed-out');
      setSignedInEmail('');
      setRemoteUserId('');
      setAccountNotice('Signed out. This account’s saved drops stay separate on this device.');
      setSignOutLoading(false);
    } catch {
      setSignOutLoading(false);
      setAccountNotice('Could not sign out. Please try again.');
      setAccountNoticeIsError(true);
    }
  };

  const copyProfileLink = async () => {
    const username = normalizeDropRecipient(profile.username);
    if (!username) {
      setProfileError('Choose a valid Drop handle before copying your profile link.');
      return;
    }
    const link = `${window.location.origin}${profileUrl(username)}`;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setNotice('Public profile link copied.');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice(`Copy is unavailable here. Your profile link is ${link}`);
    }
  };

  const shareProfileBack = async () => {
    const payload = createProfileSharePayload(profile.username, window.location.origin);
    if (!payload) {
      setProfileError('Choose a valid Drop handle before sharing your profile.');
      return;
    }
    const result = await shareInviteLink(
      payload.url,
      typeof navigator.share === 'function' ? navigator.share.bind(navigator) : undefined,
      async () => {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(payload.copyText);
      },
      { title: payload.title, text: payload.text },
    );
    setManualInviteCopy(result === 'unavailable' ? payload.copyText : '');
    setInviteShareNotice(result === 'shared'
      ? `Shared @${normalizeDropRecipient(profile.username)} and your public profile link.`
      : result === 'copied'
        ? `Copied @${normalizeDropRecipient(profile.username)} and your public profile link.`
        : result === 'cancelled'
          ? 'Share cancelled. Nothing was copied.'
          : 'Sharing and copying are unavailable. Select the handle and profile link below to copy them manually.');
  };

  const copyProfileInvite = async () => {
    const payload = createProfileSharePayload(profile.username, window.location.origin);
    if (!payload) {
      setProfileError('Choose a valid Drop handle before copying your invite details.');
      return;
    }

    setCopyingInvite(true);
    const result = await copyProfileSharePayload(payload, (text) => {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      return navigator.clipboard.writeText(text);
    });
    setManualInviteCopy(result === 'unavailable' ? payload.copyText : '');
    setInviteShareNotice(result === 'copied'
      ? `Copied @${normalizeDropRecipient(profile.username)} and your public profile link.`
      : 'Copy is unavailable. Select the handle and profile link below to copy them manually.');
    setCopyingInvite(false);
  };

  const username = normalizeDropRecipient(profile.username);
  const publicPath = username ? profileUrl(username) : null;
  const initials = profile.displayName.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'DE';
  const accountConnected = accountStatus === 'signed-in' || Boolean(getLocalAccountId());
  const accountStatusText = signedInEmail
    ? `Connected as ${signedInEmail}.`
    : accountStatus === 'checking'
      ? 'Checking your account connection…'
      : accountStatus === 'unavailable' || !supabaseAuthConfigured
        ? 'Sign-in is not available in this preview.'
        : accountStatus === 'error'
          ? 'Account status needs attention.'
          : 'Not connected. Your profile still works on this device.';
  const inviteProgress = (() => {
    if (accountStatus === 'checking') {
      return claimReturn ? 'Checking your account before we return you to the private drop.' : 'Checking your account before we save an invite handle.';
    }
    if (accountStatus === 'unavailable' || !supabaseAuthConfigured) {
      return claimReturn ? 'Account sign-in is unavailable in this preview, so this drop cannot be claimed yet.' : 'Account sign-in is unavailable in this preview, so this invite cannot be completed yet.';
    }
    if (accountStatus === 'error') {
      return claimReturn ? 'We could not verify your account. Refresh before returning to this drop.' : 'We could not verify your account. Refresh before continuing with this invite.';
    }
    if (accountStatus === 'signed-out') {
      return claimReturn
        ? 'Step 1 of 3: sign in. We’ll bring you back to this private drop after you confirm your email.'
        : 'Step 1 of 3: connect your account. A profile saved only on this device will not reach your friend.';
    }
    if (remoteProfileAvailable) {
      return claimReturn
        ? 'Step 3 of 3: your handle is synced. Continue to your private drop to review and claim it.'
        : 'Step 3 of 3: your handle is synced. Send it back to your friend below.';
    }
    return claimReturn
      ? 'Step 2 of 3: save and sync your handle. Then return here to claim the drop.'
      : 'Step 2 of 3: save and sync your handle. Then you can share it back.';
  })();
  const canRefreshInviteAccount = inviteContext && accountStatus === 'error';
  const saveButtonLabel = (() => {
    if (saving) return 'Saving…';
    if (inviteContext && !canEditProfile) {
      if (accountStatus === 'checking') return 'Checking account…';
      return accountStatus === 'error' ? 'Refresh account status' : 'Connect account first';
    }
    if (saved && remoteProfileAvailable) return claimReturn ? 'Profile ready' : 'Saved & synced';
    if (inviteContext) return 'Save & sync handle';
    return saved ? 'Saved on this device' : 'Save identity';
  })();

  const restorePendingProfile = (source: 'current' | 'legacy' = 'current') => {
    const pendingSnapshot = remoteUserId ? getPendingRemoteProfileSnapshot(remoteUserId) : null;
    const selectedSnapshot = source === 'legacy' ? pendingSnapshot?.legacyConflict : pendingSnapshot;
    if (!selectedSnapshot) return;
    setProfile(selectedSnapshot.profile);
    setPendingRevisionToReplace(selectedSnapshot.revision);
    setCanRestorePendingProfile(false);
    setLegacyPendingConflict(false);
    setLocalProfileConflict(false);
    setRemoteProfileAvailable(false);
    setAccountNotice('Saved edits are restored. Save to replace the current account profile.');
    setAccountNoticeIsError(false);
    setNotice('Saving these edits will replace the profile currently on your account.');
  };

  const useAccountProfile = () => {
    if (!remoteProfileBase) return;
    const pendingSnapshot = remoteUserId ? getPendingRemoteProfileSnapshot(remoteUserId) : null;
    setPendingRevisionToReplace(pendingSnapshot?.revision ?? null);
    const nextProfile = saveUserProfile(remoteProfileBase, remoteUserId || undefined);
    setProfile(nextProfile);
    setLocalProfileConflict(false);
    setRemoteProfileAvailable(true);
    setAccountNotice(pendingSnapshot
      ? 'Your account profile is shown. Saved device edits remain available to restore until you save this choice.'
      : 'Your account profile is shown. Save only if you make another change.');
    setAccountNoticeIsError(false);
    setNotice('Account profile restored.');
  };

  const keepDeviceProfile = () => {
    const pendingSnapshot = remoteUserId ? getPendingRemoteProfileSnapshot(remoteUserId) : null;
    setPendingRevisionToReplace(pendingSnapshot?.revision ?? null);
    setRemoteProfileAvailable(false);
    setAccountNotice('Device edits selected. Save identity to replace the saved account edit with this version.');
    setAccountNoticeIsError(false);
    setNotice('Saving will keep these device edits and replace the other saved copy.');
  };

  if (!profileLoaded) return <ProfileLoading />;

  return (
    <main className="page-shell page-enter">
      <div className="page-container max-w-[1080px]">
        <header className="page-header flex-col gap-5 sm:flex-row sm:items-center">
          <Link
            href="/"
            className="button-quiet -ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to desk
          </Link>
          <div className="sm:text-right">
            <p className="eyebrow">Correspondent profile</p>
            <p className="meta mt-1">Local-first identity</p>
          </div>
        </header>

        <section className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
          <article className="paper-card p-6 sm:p-9">
            <div className="flex items-center gap-4 border-b border-[rgba(16,42,67,0.13)] pb-6">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center border border-ink-navy bg-ink-navy font-headline-md text-xl text-white" aria-hidden="true">
                {initials}
              </span>
              <div>
                <p className="eyebrow">Your Drop profile</p>
                <p className="mt-1 font-literata text-lg text-ink-navy">{profile.displayName || 'Correspondent'}</p>
              </div>
            </div>

            <div className="mt-8">
              <p className="eyebrow">{claimReturn ? 'One quick setup' : 'Make it yours'}</p>
              <h1 className="display-title mt-4 max-w-[11ch]">{claimReturn ? 'Set your handle, then claim.' : 'Pick your Drop handle.'}</h1>
              <p className="body-copy mt-5 max-w-2xl text-lg">
                {claimReturn ? 'Choose how you’ll show up on Drop. Your friend’s contents stay private until you claim them.' : 'Make it easy for friends to find you and send a little something your way.'}
              </p>
            </div>

            {inviteContext && (
              <div className="notice mt-6" role="status" aria-live="polite">
                <p className="eyebrow">{claimReturn ? 'Claim your drop' : 'Finish your invite'}</p>
                <p className="mt-2">{inviteProgress}</p>
                {accountStatus === 'signed-out' && (
                  <a href="#account" className="mt-3 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Connect your account</a>
                )}
              </div>
            )}

            <form
              className="mt-8 space-y-6"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <div>
                <label htmlFor="display-name" className="field-label">Display name</label>
                <input
                  id="display-name"
                  value={profile.displayName}
                  onChange={(event) => update('displayName', event.target.value)}
                  className="input-field mt-2"
                  placeholder="Eleanor Vance"
                  autoComplete="name"
                  disabled={saving || accountStatus === 'checking' || identityUnverified || !canEditProfile}
                />
              </div>

              <div>
                <label htmlFor="username" className="field-label">Drop handle</label>
                <input
                  id="username"
                  value={profile.username}
                  onChange={(event) => update('username', event.target.value)}
                  className="input-field mt-2"
                  placeholder="eleanor"
                  autoComplete="username"
                  spellCheck={false}
                  disabled={saving || accountStatus === 'checking' || identityUnverified || !canEditProfile}
                  aria-describedby={profileError ? 'username-help username-error' : 'username-help'}
                  aria-invalid={Boolean(profileError)}
                />
                <p id="username-help" className="field-help mt-2">Your handle is editable. Use lowercase letters, numbers, periods, underscores, or hyphens; 2–24 characters.</p>
                {profileError && <p id="username-error" className="error-notice mt-2" role="alert">{profileError}</p>}
              </div>

              <div>
                <label htmlFor="bio" className="field-label">One-line bio</label>
                <textarea
                  id="bio"
                  value={profile.bio}
                  onChange={(event) => update('bio', event.target.value)}
                  className="textarea-field mt-2"
                  placeholder="Collecting small moments and sending them forward."
                  rows={4}
                  disabled={saving || accountStatus === 'checking' || identityUnverified || !canEditProfile}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-[rgba(16,42,67,0.1)] pt-6">
                <button
                  type={canRefreshInviteAccount ? 'button' : 'submit'}
                  onClick={canRefreshInviteAccount ? () => window.location.reload() : undefined}
                  disabled={saving || accountStatus === 'checking' || (!canRefreshInviteAccount && (identityUnverified || !canEditProfile))}
                  className="button-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6] disabled:opacity-60"
                >
                  {saved ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                  {saveButtonLabel}
                </button>
                {canRestorePendingProfile && (
                  <button
                    type="button"
                    onClick={() => restorePendingProfile()}
                    disabled={saving}
                    className="button-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                  >
                    Restore saved edits
                  </button>
                )}
                {legacyPendingConflict && (
                  <button
                    type="button"
                    onClick={() => restorePendingProfile('legacy')}
                    disabled={saving}
                    className="button-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                  >
                    Restore edits from another tab
                  </button>
                )}
                {localProfileConflict && canRestorePendingProfile && (
                  <button
                    type="button"
                    onClick={keepDeviceProfile}
                    disabled={saving}
                    className="button-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                  >
                    Keep device edits
                  </button>
                )}
                {localProfileConflict && remoteProfileBase && (
                  <button
                    type="button"
                    onClick={useAccountProfile}
                    disabled={saving}
                    className="button-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                  >
                    Use account profile
                  </button>
                )}
                {(!inviteContext || remoteProfileAvailable) && (
                  <button
                    type="button"
                    onClick={() => void copyProfileLink()}
                    disabled={!remoteProfileAvailable}
                    className="button-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fcfaf6]"
                  >
                    {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                    {copied ? 'Link copied' : 'Copy public link'}
                  </button>
                )}
              </div>
            </form>

            {notice && <p className="notice mt-5" role="status" aria-live="polite">{notice}</p>}

            {claimReturn && nextPath && accountStatus === 'signed-in' && remoteProfileAvailable && (
              <section className="panel mt-6 p-6" aria-labelledby="claim-return-title">
                <p className="eyebrow">Profile ready</p>
                <h2 id="claim-return-title" className="section-title mt-3 text-2xl">Your private drop is next.</h2>
                <p className="body-copy mt-3 text-sm">Your profile is synced. Continue when you’re ready; the contents stay sealed until you choose to claim.</p>
                <Link href={nextPath} className="button-primary mt-5 min-h-12 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white">Continue to claim this drop <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              </section>
            )}

            {inviteContext && !claimReturn && accountStatus === 'signed-in' && remoteProfileAvailable && publicPath && (
              <section className="panel mt-6 p-6" aria-labelledby="invite-share-title">
                <p className="eyebrow">Your invite · step 3</p>
                <h2 id="invite-share-title" className="section-title mt-3 text-2xl">Send your handle back.</h2>
                <p className="body-copy mt-3 text-sm">Share only your public @handle and profile link so your friend can send your Drop.</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void shareProfileBack()}
                    className="button-primary min-h-12 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                  >
                    <Share2 className="h-4 w-4" aria-hidden="true" />
                    Share @{username}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyProfileInvite()}
                    disabled={copyingInvite}
                    className="button-secondary min-h-12 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60"
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    {copyingInvite ? 'Copying…' : 'Copy handle + link'}
                  </button>
                </div>
                {inviteShareNotice && <p className="notice mt-4" role="status" aria-live="polite">{inviteShareNotice}</p>}
                {manualInviteCopy && (
                  <div className="mt-3">
                    <label htmlFor="manual-invite-copy" className="sr-only">Your public handle and profile link</label>
                    <textarea
                      id="manual-invite-copy"
                      readOnly
                      rows={2}
                      value={manualInviteCopy}
                      onFocus={(event) => event.currentTarget.select()}
                      className="mt-2 block min-h-20 w-full resize-none rounded-xl border border-[rgba(16,42,67,0.16)] bg-white px-3 py-3 text-sm leading-relaxed text-ink-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a]"
                    />
                    <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">Tap the text to select it, then choose Copy.</p>
                  </div>
                )}
              </section>
            )}
          </article>

          <aside className="space-y-6">
            <section className="panel p-6">
              <p className="eyebrow">Public profile</p>
              <h2 className="section-title mt-3 text-2xl">A simple address for people who know you.</h2>
              <p className="body-copy mt-3 text-sm">Share your profile so friends can send a private drop to your handle.</p>
              {publicPath && remoteProfileAvailable ? (
                <>
                  <Link
                    href={publicPath}
                    className="meta mt-5 block break-all border-y border-[rgba(16,42,67,0.1)] py-4 text-ink-navy underline decoration-[#b84b3a] underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a]"
                  >
                    drop{publicPath}
                  </Link>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void copyProfileLink()}
                      className="button-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    >
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      Copy link
                    </button>
                    <Link
                      href={publicPath}
                      className="button-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    >
                      View page
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </>
              ) : publicPath ? (
                <div className="mt-5 border-y border-[rgba(16,42,67,0.1)] py-4">
                  <p className="meta break-all text-ink-navy">drop{publicPath}</p>
                  <p className="field-help mt-2">Preview link · only available on this device until your profile syncs.</p>
                </div>
              ) : (
                <p className="field-help mt-5">Choose a valid 2–24 character handle to create your profile link.</p>
              )}
            </section>

            <section id="account" className="panel-muted scroll-mt-5 p-6">
              <div className="flex items-start gap-3">
                <LogIn className="mt-0.5 h-5 w-5 shrink-0 text-[#4f9d7a]" aria-hidden="true" />
                <div>
                  <p className="eyebrow">Your account</p>
                  <h2 className="section-title mt-3 text-2xl">Keep your drops with you.</h2>
                </div>
              </div>
              <p className="body-copy mt-4 text-sm">
                Drafts save on this device. Sign in with Google or email to send and receive private drops and keep your profile across devices.
              </p>
              {accountStatus === 'signed-in' && remoteUserId && (
                <DropPushNotificationSettings userId={remoteUserId} />
              )}
              <p className="meta mt-5" role="status" aria-live="polite">{accountStatusText}</p>
              {supabaseAuthConfigured && accountStatus !== 'unavailable' ? (
                <>
                  <button
                    type="button"
                    onClick={() => void connectGoogle()}
                    disabled={googleLoading || emailLoading || accountConnected || signOutLoading}
                    className="button-secondary mt-5 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f9d7a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f4ee] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {!accountConnected && <span aria-hidden="true" className="font-sans text-base font-bold">G</span>}
                    {googleLoading ? 'Opening Google…' : accountConnected ? 'Account connected' : 'Continue with Google'}
                  </button>
                  {!accountConnected && <>
                    <p className="meta mt-4 text-center">or use email</p>
                    <form className="mt-3 space-y-3" onSubmit={(event) => void sendEmailSignInLink(event)}>
                      <div>
                        <label htmlFor="account-email" className="field-label">Email address</label>
                        <input
                          id="account-email"
                          type="email"
                          value={emailAddress}
                          aria-invalid={emailError ? 'true' : undefined}
                          aria-describedby={emailError ? 'account-email-help account-email-error' : 'account-email-help'}
                          onChange={(event) => {
                            setEmailAddress(event.target.value);
                            setEmailLinkSent(false);
                            setEmailError('');
                          }}
                          autoComplete="email"
                          autoCapitalize="none"
                          required
                          disabled={emailLoading}
                          className="input-field mt-2 !min-h-12"
                          placeholder="you@example.com"
                        />
                        {emailError && <p id="account-email-error" className="error-notice mt-2" role="alert">{emailError}</p>}
                      </div>
                      <button
                        type="submit"
                        disabled={emailLoading || googleLoading || !emailAddress.trim()}
                        className="button-secondary !min-h-12 w-full disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {emailLoading ? 'Sending link…' : 'Continue with email'}
                      </button>
                      {emailLinkSent && <p className="field-help" role="status" aria-live="polite">Sign-in link sent. Check your inbox to continue.</p>}
                      <p id="account-email-help" className="field-help">No password needed. If this is your first time, we’ll create your account after you confirm the link.</p>
                    </form>
                  </>}
                  {accountConnected && (
                    <button
                      type="button"
                      onClick={() => void signOut()}
                      disabled={signOutLoading}
                      className="button-quiet mt-2 w-full disabled:opacity-60"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      {signOutLoading ? 'Signing out…' : 'Sign out'}
                    </button>
                  )}
                </>
              ) : (
                <p className="notice mt-5" role="status">Sign-in isn’t available in this preview. Drafts stay on this device.</p>
              )}
              {nextPath && <Link href={nextPath} className="button-secondary mt-3 w-full">{claimReturn ? 'Continue to claim this drop' : nextPath.startsWith('/letter/') ? 'Back to this drop' : 'Back to your draft'}</Link>}
              {accountNotice && (
                <p className={`notice mt-4 ${accountNoticeIsError ? 'error-notice' : ''}`} role={accountNoticeIsError ? 'alert' : 'status'} aria-live="polite">
                  {accountNotice}
                </p>
              )}
            </section>

          </aside>
        </section>
      </div>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<ProfileLoading />}>
      <ProfileContent />
    </Suspense>
  );
}
