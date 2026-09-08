const ACCOUNT_PREVIEW_MS = 30000;

let webPlayer = null;
let webDeviceId = null;
let webPlayerReadyPromise = null;
let accountStopTimer = null;
let accountPlayingTrackId = null;

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

async function pauseAccountPlayback() {
  clearAccountPreviewTimer();
  accountPlayingTrackId = null;

  if (webPlayer) {
    try {
      await webPlayer.pause();
    } catch (error) {
      console.warn('Could not pause Spotify player', error);
    }
  }
}

async function playAccountTrackPreview(trackId, options = {}) {
  const { durationMs = ACCOUNT_PREVIEW_MS, onStopped } = options;
  const { deviceId } = await ensureWebPlayer();
  const token = await getValidAccessToken();

  if (!token) {
    throw new Error('Not authorized');
  }

  clearAccountPreviewTimer();

  const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uris: [`spotify:track:${trackId}`],
      position_ms: 0,
    }),
  });

  if (!response.ok && response.status !== 204) {
    const details = await readSpotifyError(response);
    throw new Error(details || `Could not start account playback (${response.status})`);
  }

  accountPlayingTrackId = trackId;
  accountStopTimer = setTimeout(async () => {
    await pauseAccountPlayback();
    if (typeof onStopped === 'function') {
      onStopped();
    }
  }, durationMs);

  return true;
}

function getAccountPlayingTrackId() {
  return accountPlayingTrackId;
}

function isAccountPlaybackAvailable(profile) {
  return isPremiumProfile(profile) && hasAccountPlaybackScopes();
}
