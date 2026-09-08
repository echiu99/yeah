const SPOTIFY_CLIENT_ID = '9817b40c3aff418c9d0995bfe77885a1';
const SPOTIFY_REDIRECT_URI = 'https://echiu99.github.io/yeah/redirect.html';
const SPOTIFY_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-private',
  'user-read-email',
  'streaming',
  'user-modify-playback-state',
  'user-read-playback-state',
].join(' ');

const STORAGE_KEYS = {
  accessToken: 'spotifyAccessToken',
  refreshToken: 'spotifyRefreshToken',
  expiresAt: 'spotifyExpiresAt',
  codeVerifier: 'spotifyCodeVerifier',
  selectedPlaylistId: 'selectedPlaylistId',
  userProfile: 'spotifyUserProfile',
  tokenScopes: 'spotifyTokenScopes',
};

function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], '');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

function base64UrlEncode(input) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function storeTokenResponse(data) {
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || 'Failed to get access token');
  }

  localStorage.setItem(STORAGE_KEYS.accessToken, data.access_token);

  if (data.refresh_token) {
    localStorage.setItem(STORAGE_KEYS.refreshToken, data.refresh_token);
  }

  if (data.scope) {
    localStorage.setItem(STORAGE_KEYS.tokenScopes, data.scope);
  }

  const expiresInMs = (data.expires_in || 3600) * 1000;
  localStorage.setItem(STORAGE_KEYS.expiresAt, String(Date.now() + expiresInMs - 60000));
}

function hasScope(scope) {
  const scopes = (localStorage.getItem(STORAGE_KEYS.tokenScopes) || '').split(/\s+/).filter(Boolean);
  return scopes.includes(scope);
}

function hasAccountPlaybackScopes() {
  return hasScope('streaming') && hasScope('user-modify-playback-state');
}

function clearAuth() {
  localStorage.removeItem(STORAGE_KEYS.accessToken);
  localStorage.removeItem(STORAGE_KEYS.refreshToken);
  localStorage.removeItem(STORAGE_KEYS.expiresAt);
  localStorage.removeItem(STORAGE_KEYS.codeVerifier);
  localStorage.removeItem(STORAGE_KEYS.userProfile);
  localStorage.removeItem(STORAGE_KEYS.selectedPlaylistId);
  localStorage.removeItem(STORAGE_KEYS.tokenScopes);
}

function logout(options = {}) {
  const { switchAccount = false } = options;
  clearAuth();

  if (switchAccount) {
    redirectToSpotifyAuth({ forceDialog: true });
    return;
  }

  window.location.href = 'index.html';
}

function isAccessTokenExpired() {
  const expiresAt = Number(localStorage.getItem(STORAGE_KEYS.expiresAt) || 0);
  return !expiresAt || Date.now() >= expiresAt;
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
  if (!refreshToken) {
    return null;
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    clearAuth();
    return null;
  }

  storeTokenResponse(data);
  return data.access_token;
}

async function getValidAccessToken() {
  const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken);
  if (accessToken && !isAccessTokenExpired()) {
    return accessToken;
  }

  return refreshAccessToken();
}

async function redirectToSpotifyAuth(options = {}) {
  const { forceDialog = false } = options;
  const codeVerifier = generateRandomString(64);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(hashed);

  localStorage.setItem(STORAGE_KEYS.codeVerifier, codeVerifier);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
  });

  if (forceDialog) {
    params.set('show_dialog', 'true');
  }

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const codeVerifier = localStorage.getItem(STORAGE_KEYS.codeVerifier);
  if (!codeVerifier) {
    throw new Error('Missing PKCE code verifier. Please authorize again.');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Token exchange failed');
  }

  storeTokenResponse(data);
  localStorage.removeItem(STORAGE_KEYS.codeVerifier);
  return data.access_token;
}

async function spotifyFetch(url, options = {}) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Not authorized');
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      throw new Error('Not authorized');
    }

    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${refreshed}`,
      },
    });
  }

  return response;
}

async function readSpotifyError(response) {
  try {
    const data = await response.json();
    return data.error?.message || data.error_description || data.error || null;
  } catch (error) {
    return null;
  }
}

async function fetchAllPages(initialUrl) {
  const items = [];
  let url = initialUrl;

  while (url) {
    const response = await spotifyFetch(url);
    if (!response.ok) {
      const details = await readSpotifyError(response);
      throw new Error(details || `Spotify API error (${response.status})`);
    }

    const data = await response.json();
    items.push(...(data.items || []));
    url = data.next;
  }

  return items;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchCurrentUser() {
  const response = await spotifyFetch('https://api.spotify.com/v1/me');
  if (!response.ok) {
    const details = await readSpotifyError(response);
    throw new Error(details || `Spotify API error (${response.status})`);
  }

  const profile = await response.json();
  localStorage.setItem(STORAGE_KEYS.userProfile, JSON.stringify({
    id: profile.id,
    displayName: profile.display_name,
    email: profile.email || null,
    imageUrl: profile.images?.[0]?.url || null,
    product: profile.product || null,
  }));
  return profile;
}

function isPremiumProfile(profile) {
  return String(profile?.product || '').toLowerCase() === 'premium';
}

function getCachedUserProfile() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.userProfile) || 'null');
  } catch (error) {
    return null;
  }
}

async function renderUserBar(container) {
  if (!container) {
    return null;
  }

  container.innerHTML = '<div class="user-bar">Checking Spotify profile…</div>';

  try {
    const profile = await fetchCurrentUser();
    const name = profile.display_name || profile.id || 'Spotify user';
    const imageUrl = profile.images?.[0]?.url;
    const email = profile.email ? `<span class="user-email">${escapeHtml(profile.email)}</span>` : '';
    const plan = isPremiumProfile(profile) ? 'Premium' : 'Free';
    const avatar = imageUrl
      ? `<img class="user-avatar" src="${escapeHtml(imageUrl)}" alt="" width="36" height="36">`
      : '<div class="user-avatar user-avatar-fallback" aria-hidden="true"></div>';

    container.innerHTML = `
      <div class="user-bar">
        <div class="user-info">
          ${avatar}
          <div class="user-text">
            <strong>${escapeHtml(name)}</strong>
            ${email}
            <span class="user-id">@${escapeHtml(profile.id)} · ${plan}</span>
          </div>
        </div>
        <div class="user-actions">
          <button type="button" class="button button-secondary" id="switch-account-button">Switch account</button>
          <button type="button" class="button button-secondary" id="logout-button">Log out</button>
        </div>
      </div>
    `;

    document.getElementById('logout-button')?.addEventListener('click', () => logout());
    document.getElementById('switch-account-button')?.addEventListener('click', () => {
      logout({ switchAccount: true });
    });

    return profile;
  } catch (error) {
    console.error('Error loading Spotify profile:', error);
    const cached = getCachedUserProfile();
    const cachedLabel = cached?.displayName || cached?.id;

    container.innerHTML = `
      <div class="user-bar user-bar-error">
        <div class="user-text">
          <strong>${cachedLabel ? escapeHtml(cachedLabel) : 'Spotify session problem'}</strong>
          <span>${escapeHtml(error.message || 'Could not load profile')}</span>
        </div>
        <div class="user-actions">
          <button type="button" class="button button-secondary" id="switch-account-button">Switch account</button>
          <button type="button" class="button button-secondary" id="logout-button">Log out</button>
        </div>
      </div>
    `;

    document.getElementById('logout-button')?.addEventListener('click', () => logout());
    document.getElementById('switch-account-button')?.addEventListener('click', () => {
      logout({ switchAccount: true });
    });

    throw error;
  }
}

function ensureUserBarStyles() {
  if (document.getElementById('user-bar-styles')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'user-bar-styles';
  style.textContent = `
    .user-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 20px;
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      background: #fafafa;
    }
    .user-bar-error {
      border-color: #f5c2c7;
      background: #fff5f5;
    }
    .user-info {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .user-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
    }
    .user-avatar-fallback {
      background: #c8e6c9;
    }
    .user-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .user-text strong,
    .user-text span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .user-email,
    .user-id {
      color: #555;
      font-size: 0.9em;
    }
    .user-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .button-secondary {
      width: auto;
      margin-top: 0;
      padding: 8px 12px;
      background: #fff;
      color: #333;
      border: 1px solid #bbb;
    }
    .button-secondary:hover:not(:disabled) {
      background: #f0f0f0;
    }
  `;
  document.head.appendChild(style);
}
