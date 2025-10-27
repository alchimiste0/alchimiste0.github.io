// --- CONFIGURATION ---
const CLIENT_ID = "5bc17dabfc0945b7b6ba5ee2989a25f1";
const IS_LOCALHOST = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
const REDIRECT_URI = IS_LOCALHOST 
    ? "http://127.0.0.1:5500/index.html"
    : "https://alchimiste0.github.io/index.html";
const SCOPES = [
    "user-read-private", "playlist-read-private", 
    "user-read-playback-state", "user-modify-playback-state"
];

// --- GESTION DES FAVORIS ---
const FAVORIS_KEY = "spotify_favoris";
let favoris_playlists = new Set(JSON.parse(localStorage.getItem(FAVORIS_KEY) || "[]"));
function sauvegarder_favoris() {
    localStorage.setItem(FAVORIS_KEY, JSON.stringify(Array.from(favoris_playlists)));
}

// --- ÉLÉMENTS DE LA PAGE ---
const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const playlistsGrid = document.getElementById("playlists-grid");
const tracksContainer = document.getElementById("tracks-container");
const loginButton = document.getElementById("login-button");
const appFooter = document.getElementById("app-footer");

// --- VARIABLES D'ÉTAT ---
let currentTrackUri = null;
let currentPlaylistUri = null;
let activePlaylistData = null; 
let filtre_actif = 'tous';
let fullPlaylistsCache = [];
let currentUser = null;

// --- LOGIQUE DE NAVIGATION ---
function showView(viewId) {
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    const activeView = document.getElementById(viewId);
    if (activeView) activeView.classList.add('active');
}

// --- LOGIQUE D'AUTHENTIFICATION ---
function generateRandomString(length) { let t = ''; const p = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < length; i++) { t += p.charAt(Math.floor(Math.random() * p.length)); } return t; }
async function generateCodeChallenge(v) { const d = new TextEncoder().encode(v); const h = await window.crypto.subtle.digest('SHA-256', d); return btoa(String.fromCharCode.apply(null, new Uint8Array(h))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function redirectToAuthCodeFlow() { const v = generateRandomString(128); const c = await generateCodeChallenge(v); localStorage.setItem("verifier", v); const p = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPES.join(' '), code_challenge_method: 'S256', code_challenge: c }); document.location = `https://accounts.spotify.com/authorize?${p.toString()}`; }
async function getAccessToken(c) { const v = localStorage.getItem("verifier"); const p = new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'authorization_code', code: c, redirect_uri: REDIRECT_URI, code_verifier: v }); const r = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: p }); const { access_token, refresh_token } = await r.json(); return { access_token, refresh_token }; }
async function refreshAccessToken() { const r = localStorage.getItem('refresh_token'); const p = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: r, client_id: CLIENT_ID }); const res = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: p }); const { access_token, refresh_token: n } = await res.json(); if (n) { localStorage.setItem('refresh_token', n); } localStorage.setItem('access_token', access_token); return access_token; }

// --- FONCTIONS DE L'API SPOTIFY ---
async function fetchWebApi(endpoint, method = 'GET', body = null) {
    let accessToken = localStorage.getItem('access_token');
    if (!endpoint.startsWith('v1/')) { endpoint = `v1/${endpoint}`; }
    const res = await fetch(`https://api.spotify.com/${endpoint}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        method,
        body: body ? JSON.stringify(body) : null
    });
    if (res.status === 401) { accessToken = await refreshAccessToken(); return await fetchWebApi(endpoint, method, body); }
    if (!res.ok) throw new Error(`Erreur API ${res.status}: ${res.statusText}`);
    if (res.status === 204 || res.status === 202) return null;
    return await res.json();
}
async function getPlaylists() { try { return (await fetchWebApi("me/playlists?limit=50")).items; } catch (e) { console.error("Erreur getPlaylists:", e); return []; } }
async function getTracks(pId) { try { return (await fetchWebApi(`playlists/${pId}/tracks`)).items; } catch (e) { console.error("Erreur getTracks:", e); return []; } }
async function play(contextUri, trackUri = null) {
    try {
        const body = { context_uri: contextUri };
        if (trackUri) { body.offset = { uri: trackUri }; }
        await fetchWebApi("me/player/play", 'PUT', body);
    } catch (e) { console.error("Erreur de lecture:", e); alert("Aucun appareil actif détecté."); }
}
async function controlPlayback(action) { 
    const method = (action === 'play' || action === 'pause') ? 'PUT' : 'POST';
    try { await fetchWebApi(`me/player/${action}`, method); } catch (e) { console.error(`Erreur ${action}:`, e); } 
}
async function setVolume(value) { try { await fetchWebApi(`me/player/volume?volume_percent=${value}`, 'PUT'); } catch (e) { console.error("Erreur volume:", e); } }
async function transferPlayback(dId) { try { await fetchWebApi('me/player', 'PUT', { device_ids: [dId], play: true }); } catch (e) { console.error("Erreur de transfert:", e); } }

// --- FONCTIONS D'AFFICHAGE ---
function displayPlaylists(playlists) {
    playlistsGrid.innerHTML = "";
    if (!playlists || playlists.length === 0) return;
    for (const playlist of playlists) {
        const item = document.createElement("div");
        item.className = "playlist-item";
        item.dataset.uri = playlist.uri;

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = favoris_playlists.has(playlist.uri);
        check.style.position = 'absolute';
        check.style.top = '10px';
        check.style.left = '10px';
        check.style.zIndex = '10';
        check.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle_favori(playlist.uri, e.target.checked);
        });

        const imgUrl = (playlist.images && playlist.images.length > 0) ? playlist.images[0].url : 'https://placehold.co/150';
        const img = document.createElement('img');
        img.src = imgUrl;
        img.addEventListener('click', async () => {
            activePlaylistData = playlist;
            const tracks = await getTracks(playlist.id);
            displayTracks(tracks, playlist);
        });
        const title = document.createElement('p');
        title.textContent = playlist.name;
        if (playlist.uri === currentPlaylistUri) title.classList.add('active');
        title.addEventListener('click', async () => {
            activePlaylistData = playlist;
            const tracks = await getTracks(playlist.id);
            displayTracks(tracks, playlist);
        });
        const playButton = document.createElement('button');
        playButton.className = 'play-button';
        playButton.innerHTML = '&#9654;';
        playButton.addEventListener('click', (e) => {
            e.stopPropagation();
            play(playlist.uri);
        });
        item.appendChild(check);
        item.appendChild(img);
        item.appendChild(title);
        item.appendChild(playButton);
        playlistsGrid.appendChild(item);
    }
}
function displayTracks(tracks, playlist) {
    tracksContainer.innerHTML = "";
    const header = document.createElement('div');
    header.className = 'playlist-header';
    const imgUrl = (playlist.images && playlist.images.length > 0) ? playlist.images[0].url : 'https://placehold.co/150';
    const titleText = document.createElement('h2');
    titleText.textContent = playlist.name;
    if (playlist.uri === currentPlaylistUri) titleText.classList.add('active');
    header.innerHTML = `<img src="${imgUrl}" alt="${playlist.name}">`;
    header.appendChild(titleText);
    tracksContainer.appendChild(header);
    if (!tracks || tracks.length === 0) {
        tracksContainer.innerHTML += "<p>Cette playlist est vide.</p>";
        return;
    }
    let tracksWithData = [];
    for (const item of tracks) {
        const track = item.track;
        if (!track) continue;
        const trackItem = document.createElement("div");
        trackItem.className = "track-item";
        trackItem.dataset.uri = track.uri;
        const trackImgUrl = track.album?.images[2]?.url || 'https://placehold.co/40';
        const trackInfo = document.createElement('div');
        trackInfo.className = 'track-info';
        const trackTitle = document.createElement('h3');
        trackTitle.textContent = track.name;
        if (track.uri === currentTrackUri) trackTitle.classList.add('active');
        const trackArtists = document.createElement('p');
        trackArtists.textContent = track.artists.map(a => a.name).join(', ');
        trackInfo.appendChild(trackTitle);
        trackInfo.appendChild(trackArtists);
        trackItem.innerHTML = `<img src="${trackImgUrl}">`;
        trackItem.appendChild(trackInfo);
        if (track.is_local) {
            trackItem.style.cursor = 'not-allowed';
            trackItem.title = 'Les pistes locales ne peuvent pas être jouées via le web';
        } else {
            trackItem.addEventListener("click", () => play(playlist.uri, track.uri));
        }
        tracksContainer.appendChild(trackItem);
        tracksWithData.push({ element: trackTitle, uri: track.uri });
    }
    activePlaylistData = { ...playlist, trackElements: tracksWithData };
}
function buildPlayer() {
    appFooter.innerHTML = `
        <div id="now-playing"><img src="https://placehold.co/56" /><div id="now-playing-info"><span id="now-playing-title"></span><span id="now-playing-artist"></span></div></div>
        <div id="player-controls">
            <div id="player-buttons">
                <button id="prev-btn">⏮</button>
                <button id="play-pause-btn" class="play-pause">▶</button>
                <button id="next-btn">⏭</button>
            </div>
            <div id="progress-bar-container">
                <span id="current-time" class="time-label">0:00</span>
                <input type="range" id="progress-bar" value="0" max="100" style="pointer-events: none;">
                <span id="total-time" class="time-label">0:00</span>
            </div>
        </div>
        <div id="right-controls">
            <button id="devices-button">💻</button>
            <input type="range" id="volume-slider" value="100" max="100" class="volume-slider">
        </div>
    `;
    document.getElementById('prev-btn').addEventListener('click', () => controlPlayback('previous'));
    document.getElementById('play-pause-btn').addEventListener('click', async () => {
        const state = await fetchWebApi('v1/me/player');
        if (state && state.is_playing) { controlPlayback('pause'); } else { controlPlayback('play'); }
    });
    document.getElementById('next-btn').addEventListener('click', () => controlPlayback('next'));
    document.getElementById('volume-slider').addEventListener('change', (e) => setVolume(e.target.value));
    document.getElementById('devices-button').addEventListener('click', openDevicesMenu);
}
function updatePlayerUI(state) {
    if (!state || !state.item) { appFooter.style.visibility = 'hidden'; return; };
    appFooter.style.visibility = 'visible';
    document.getElementById('now-playing-title').textContent = state.item.name;
    document.getElementById('now-playing-artist').textContent = state.item.artists.map(a => a.name).join(', ');
    const imageUrl = state.item.album?.images[0]?.url;
    document.getElementById('now-playing').querySelector('img').src = imageUrl || 'https://placehold.co/56';
    document.getElementById('play-pause-btn').textContent = state.is_playing ? '⏸' : '▶';
    const formatTime = ms => new Date(ms).toISOString().substr(14, 5);
    document.getElementById('current-time').textContent = formatTime(state.progress_ms);
    document.getElementById('total-time').textContent = formatTime(state.item.duration_ms);
    const progress = document.getElementById('progress-bar');
    progress.max = state.item.duration_ms;
    progress.value = state.progress_ms;
    const volumeSlider = document.getElementById('volume-slider');
    if (state.device) {
        volumeSlider.value = state.device.volume_percent;
    }
}
async function openDevicesMenu() {
    try {
        const { devices } = await fetchWebApi('v1/me/player/devices');
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        if (devices && devices.length > 0) {
            devices.forEach(device => {
                const item = document.createElement('div');
                item.className = 'context-menu-item';
                item.textContent = `${device.is_active ? '✔ ' : ''}${device.name}`;
                item.onclick = () => {
                    transferPlayback(device.id);
                    document.body.removeChild(menu);
                };
                menu.appendChild(item);
            });
        } else {
            menu.innerHTML = `<div class="context-menu-item">Aucun appareil trouvé</div>`;
        }
        document.body.appendChild(menu);
        const btn = document.getElementById('devices-button');
        const rect = btn.getBoundingClientRect();
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.top - menu.offsetHeight - 10}px`;
        setTimeout(() => document.addEventListener('click', () => document.body.removeChild(menu), { once: true }), 0);
    } catch(e) { console.error("Erreur ouverture menu appareils:", e); }
}

// --- LOGIQUE DE MISE À JOUR EN TEMPS RÉEL ---
async function updateActiveHighlights() {
    try {
        const state = await fetchWebApi('v1/me/player');
        const oldTrackUri = currentTrackUri;
        const oldPlaylistUri = currentPlaylistUri;
        if (!state || !state.item) {
            currentTrackUri = null;
            currentPlaylistUri = null;
        } else {
            currentTrackUri = state.item.uri;
            currentPlaylistUri = state.context?.uri;
        }
        if (oldTrackUri !== currentTrackUri || oldPlaylistUri !== currentPlaylistUri) {
            document.querySelectorAll('#playlists-grid .playlist-item p').forEach(p => {
                p.classList.toggle('active', p.closest('.playlist-item').dataset.uri === currentPlaylistUri);
            });
            if (activePlaylistData) {
                const headerTitle = tracksContainer.querySelector('.playlist-header h2');
                if (headerTitle) {
                    headerTitle.classList.toggle('active', activePlaylistData.uri === currentPlaylistUri);
                }
                if (activePlaylistData.trackElements) {
                    activePlaylistData.trackElements.forEach(({ element, uri }) => {
                        element.classList.toggle('active', uri === currentTrackUri);
                    });
                }
            }
        }
    } catch (e) { console.error("Erreur de mise à jour UI:", e); }
}

// --- FONCTIONS DES MENUS ---
function buildMenus() {
    const settingsMenu = document.getElementById('settings-menu');
    const filterMenu = document.getElementById('filter-menu');
    settingsMenu.innerHTML = `<a href="#" id="logout-btn">Déconnecter</a><hr><a href="#" id="quit-btn">Quitter</a>`;
    filterMenu.innerHTML = `<a href="#" data-filter="tous">Tous</a><hr><a href="#" data-filter="utilisateur">Par vous</a><a href="#" data-filter="telecharges">Téléchargé(s)</a>`;
    document.getElementById('logout-btn').addEventListener('click', (e) => { e.preventDefault(); deconnecterEtRecharger(); });
    document.getElementById('quit-btn').addEventListener('click', (e) => { e.preventDefault(); window.close(); });
    filterMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            appliquerFiltre(e.target.dataset.filter);
        });
    });
}
function deconnecterEtRecharger() {
    localStorage.clear();
    window.location.reload();
}
async function appliquerFiltre(type_filtre) {
    filtre_actif = type_filtre;
    let playlists_a_afficher = fullPlaylistsCache;
    if (filtre_actif === 'utilisateur') {
        if (!currentUser) currentUser = await fetchWebApi('v1/me');
        playlists_a_afficher = fullPlaylistsCache.filter(p => p.owner.id === currentUser.id);
    } else if (filtre_actif === 'telecharges') {
        playlists_a_afficher = fullPlaylistsCache.filter(p => favoris_playlists.has(p.uri));
    }
    displayPlaylists(playlists_a_afficher);
}
function toggle_favori(playlist_uri, isChecked) {
    if (isChecked) {
        favoris_playlists.add(playlist_uri);
    } else {
        favoris_playlists.delete(playlist_uri);
    }
    sauvegarder_favoris();
    if (filtre_actif === 'telecharges') {
        appliquerFiltre('telecharges');
    }
}

// --- LOGIQUE PRINCIPALE ---
async function main() {
    showView('app-view');
    loginView.style.display = 'none'; // Force la disparition
    buildMenus();
    buildPlayer();
    fullPlaylistsCache = await getPlaylists();
    displayPlaylists(fullPlaylistsCache);
    setInterval(updateActiveHighlights, 2000);
    setInterval(async () => {
        try {
            const state = await fetchWebApi('v1/me/player');
            updatePlayerUI(state);
        } catch (e) {}
    }, 1000);
}

window.addEventListener('load', async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
        try {
            const { access_token, refresh_token } = await getAccessToken(code);
            localStorage.setItem('access_token', access_token);
            localStorage.setItem('refresh_token', refresh_token);
            window.history.pushState({}, '', REDIRECT_URI);
            main();
        } catch (error) { showView('login-view'); }
    } else if (localStorage.getItem('refresh_token')) {
        try {
            await refreshAccessToken();
            main();
        } catch (error) { deconnecterEtRecharger(); }
    } else {
        showView('login-view');
    }
});

loginButton.addEventListener("click", redirectToAuthCodeFlow);
window.addEventListener('click', function(event) {
    if (!event.target.matches('.menubtn')) {
        document.querySelectorAll(".dropdown-content").forEach(content => content.classList.remove('show'));
    }
});
document.querySelectorAll('.menubtn').forEach(button => {
    button.addEventListener('click', function() {
        const currentMenu = this.nextElementSibling;
        document.querySelectorAll(".dropdown-content").forEach(c => {
            if (c !== currentMenu) c.classList.remove('show');
        });
        currentMenu.classList.toggle("show");
    });
});