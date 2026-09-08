const ACCOUNT_PREVIEW_MS = 30000;

let webPlayer = null;
let webDeviceId = null;
let webPlayerReadyPromise = null;
let accountStopTimer = null;
let accountPlayingTrackId = null;
let accountPreviewStartedAt = 0;
let accountPreviewStartPositionMs = 0;
let accountPreviewOnStopped = null;

function loadWebPlaybackSdk() {
  if (window.Spotify?.Player) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const previous = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (typeof previous === 'function') {
        previous();
      }
      resolve();
    };

    if (!document.getElementById('spotify-web-playback-sdk')) {
      const script = document.createElement('script');
      script.id = 'spotify-web-playback-sdk';
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      script.onerror = () => reject(new Error('Could not load Spotify Web Playback SDK'));
      document.body.appendChild(script);
    }
  });
}

function getPreviewStartMs(song) {
  const duration = Number(song?.durationMs) || 0;
  if (duration <= 0) {
    return 15000;
  }

  // Short tracks: nudge a little past the very start.
  if (duration < 40000) {
    return Math.floor(duration * 0.1);
  }

  // Prefer past the intro: at least 15s, or ~20% in, but leave room for a 30s listen.
  const preferred = Math.max(15000, Math.floor(duration * 0.2));
  return Math.min(preferred, Math.max(0, duration - ACCOUNT_PREVIEW_MS - 1000));
}

async function ensureWebPlayer() {
  if (webPlayer && webDeviceId) {
    return { player: webPlayer, deviceId: webDeviceId };
  }

  if (webPlayerReadyPromise) {
    return webPlayerReadyPromise;
  }

  webPlayerReadyPromise = (async () => {
    await loadWebPlaybackSdk();

    return new Promise((resolve, reject) => {
      let settled = false;

      const fail = (message) => {
        if (settled) {
          return;
        }
        settled = true;
        webPlayerReadyPromise = null;
        reject(new Error(message || 'Could not start Spotify account playback'));
      };

      const succeed = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ player: webPlayer, deviceId: webDeviceId });
      };

      webPlayer = new Spotify.Player({
        name: 'Yeah Song Ranker',
        getOAuthToken: async (callback) => {
          const token = await getValidAccessToken();
          if (!token) {
            fail('Not authorized');
            return;
          }
          callback(token);
        },
        volume: 0.85,
      });

      webPlayer.addListener('ready', ({ device_id }) => {
        webDeviceId = device_id;
        succeed();
      });

      webPlayer.addListener('not_ready', () => {
        webDeviceId = null;
      });

      webPlayer.addListener('initialization_error', ({ message }) => fail(message));
      webPlayer.addListener('authentication_error', ({ message }) => fail(message));
      webPlayer.addListener('account_error', ({ message }) => fail(message));

      webPlayer.connect().then((connected) => {
        if (!connected) {
          fail('Spotify player could not connect');
        }
      });

      setTimeout(() => fail('Timed out connecting Spotify player'), 15000);
    });
  })();

  return webPlayerReadyPromise;
}

function clearAccountPreviewTimer() {
  if (accountStopTimer) {
    clearTimeout(accountStopTimer);
    accountStopTimer = null;
  }
}

function scheduleAccountPreviewStop(durationMs) {
  clearAccountPreviewTimer();
  accountPreviewStartedAt = Date.now();
  accountStopTimer = setTimeout(async () => {
    const onStopped = accountPreviewOnStopped;
    await pauseAccountPlayback();
    if (typeof onStopped === 'function') {
      onStopped();
    }
  }, durationMs);
}

async function pauseAccountPlayback() {
  clearAccountPreviewTimer();
  accountPlayingTrackId = null;
  accountPreviewStartPositionMs = 0;
  accountPreviewStartedAt = 0;
  accountPreviewOnStopped = null;

  if (webPlayer) {
    try {
      await webPlayer.pause();
    } catch (error) {
      console.warn('Could not pause Spotify player', error);
    }
  }
}

async function playAccountTrackPreview(trackId, options = {}) {
  const {
    durationMs = ACCOUNT_PREVIEW_MS,
    positionMs = 0,
    onStopped,
  } = options;
  const { deviceId } = await ensureWebPlayer();
  const token = await getValidAccessToken();

  if (!token) {
    throw new Error('Not authorized');
  }

  const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uris: [`spotify:track:${trackId}`],
      position_ms: Math.max(0, Math.floor(positionMs)),
    }),
  });

  if (!response.ok && response.status !== 204) {
    const details = await readSpotifyError(response);
    throw new Error(details || `Could not start account playback (${response.status})`);
  }

  accountPlayingTrackId = trackId;
  accountPreviewStartPositionMs = Math.max(0, Math.floor(positionMs));
  accountPreviewOnStopped = typeof onStopped === 'function' ? onStopped : null;
  scheduleAccountPreviewStop(durationMs);
  return true;
}

async function skipAccountPlayback(seconds = 5) {
  if (!webPlayer || !accountPlayingTrackId) {
    return false;
  }

  const state = await webPlayer.getCurrentState();
  let nextPosition = null;

  if (state && typeof state.position === 'number') {
    nextPosition = state.position + (seconds * 1000);
  } else if (accountPreviewStartedAt) {
    const elapsed = Date.now() - accountPreviewStartedAt;
    nextPosition = accountPreviewStartPositionMs + elapsed + (seconds * 1000);
  }

  if (nextPosition === null) {
    return false;
  }

  await webPlayer.seek(Math.max(0, Math.floor(nextPosition)));

  // Keep roughly the same remaining preview window after a skip.
  if (accountPreviewStartedAt) {
    const elapsed = Date.now() - accountPreviewStartedAt;
    const remaining = Math.max(5000, ACCOUNT_PREVIEW_MS - elapsed);
    accountPreviewStartPositionMs = Math.max(0, Math.floor(nextPosition));
    scheduleAccountPreviewStop(remaining);
  }

  return true;
}

function getAccountPlayingTrackId() {
  return accountPlayingTrackId;
}

function isAccountPlaybackAvailable(profile) {
  return isPremiumProfile(profile) && hasAccountPlaybackScopes();
}
