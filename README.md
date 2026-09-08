# Spotify Tournament-Style Rating App

## Description
This project is a web application that allows users to select a Spotify playlist and engage in a tournament-style song rating game. Users compare songs two at a time, selecting their favorites, until a final winner is determined. The goal is to create a fun way to explore and rank songs from a personal playlist.

## Features
- **Spotify Authorization**: Log in with your Spotify account using Authorization Code + PKCE.
- **Playlist Selection**: Choose any playlist and optionally sample Random 16 / 32 / 64 songs, with an optional two-heats-plus-final format for big lists.
- **Tournament Rating**: Songs are displayed in pairs for users to compare and select their favorite. Odd songs get a bye into the next round until one winner remains.
- **Full Rankings**: Final rankings use Elo ratings from every head-to-head pick, so bracket path matters less than the match results.
- **Match History**: Review every matchup during and after the tournament, including Elo changes. Undo rewinds the last match.
- **Song Previews**: Free accounts use Spotify embed previews. Premium accounts can play ~30s clips through your Spotify account (no signup prompt) after authorizing playback scopes.
- **Restart**: Restarting reshuffles the full original playlist.
- **Back Button**: Allows users to return to the playlist selection page.

## How It Works
1. **Authorization**: Users log in through Spotify and the app exchanges an authorization code for an access token (PKCE).
2. **Playlist Selection**: After authorization, users select a playlist from their Spotify account.
3. **Tournament**: Songs from the selected playlist are paired up for comparison. The user picks their favorite song from each pair.
4. **Winner**: The app shows a full ranking once the tournament ends.

## How to Use
1. Clone or download this repository.
2. Host the files through GitHub Pages (or another HTTPS host). The Spotify redirect URI must match the one registered for the app:
   `https://echiu99.github.io/yeah/redirect.html`
3. Open `index.html` in a browser.
4. Log in to your Spotify account to authorize the app.
5. Select a playlist and start the tournament.

## Notes
- Spotify no longer supports the old Implicit Grant flow (`response_type=token`). This app uses Authorization Code with PKCE.
- Access tokens are refreshed automatically while a refresh token is available.
- Playlist and track requests paginate through the full Spotify API results.
