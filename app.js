import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, deleteUser
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc, setDoc, getDoc, getDocs, where, serverTimestamp, updateDoc, arrayUnion, arrayRemove, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { 
    getStorage, ref, uploadBytes, getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// ==================================================================
// CONFIGURATION FIREBASE
// ==================================================================
const firebaseConfig = {
    apiKey: "AIzaSyDSmjGX7FMux4ACLxql_RVSCQDh9L99mNU",
    authDomain: "moneventplanner-1.firebaseapp.com",
    projectId: "moneventplanner-1",
    storageBucket: "moneventplanner-1.firebasestorage.app",
    messagingSenderId: "47840441468",
    appId: "1:47840441468:web:78581503b37dbadec6c5f9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const provider = new GoogleAuthProvider();

const DEFAULT_AVATAR = "https://cdn-icons-png.flaticon.com/512/149/149071.png";

// Variables Globales
let currentUser = null;
let currentChatType = null; // 'EVENT' ou 'DM'
let currentChatId = null;
let currentUnsubscribeChat = null;
let userDataCache = {};
let currentLang = 'fr';
let friendListeners = []; // Stocke les écouteurs pour les nettoyer et éviter les doublons
let videoStream = null; // Pour la webcam
let zoomLevel = 1; // Pour le lightbox

const translations = {
    fr: {
        welcome: "Bienvenue", login_subtitle: "Connecte-toi.", btn_login: "Se connecter", btn_signup: "Créer compte",
        tab_events: "Events", tab_friends: "Amis", my_events: "Mes Événements", placeholder_friend_code: "Code Ami...",
        requests_title: "Demandes reçues", friends_list_title: "Mes Amis", select_msg: "Sélectionne une conversation.",
        placeholder_msg: "Message...", new_event: "Nouvel Événement", event_title: "Titre", invite_friends: "Inviter :",
        btn_create: "Créer", my_profile: "Mon Profil", my_code: "Mon Code Ami : ", change_photo: "Changer la photo", display_name: "Nom d'affichage",
        btn_save: "Sauvegarder", btn_delete_acc: "Supprimer mon compte", join_event_title: "Rejoindre via Code"
    },
    en: {
        welcome: "Welcome", login_subtitle: "Login.", btn_login: "Login", btn_signup: "Sign Up",
        tab_events: "Events", tab_friends: "Friends", my_events: "My Events", placeholder_friend_code: "Friend Code...",
        requests_title: "Requests", friends_list_title: "My Friends", select_msg: "Select a chat.",
        placeholder_msg: "Message...", new_event: "New Event", event_title: "Title", invite_friends: "Invite:",
        btn_create: "Create", my_profile: "My Profile", my_code: "My Code: ", change_photo: "Change Photo", display_name: "Display Name",
        btn_save: "Save", btn_delete_acc: "Delete Account", join_event_title: "Join via Code"
    }
};

// --- GESTION AUTHENTIFICATION & PRÉSENCE ---

function generateCode(prefix = "") { 
    return prefix + Math.random().toString(36).substring(2, 6).toUpperCase(); 
}

async function syncUserToFirestore(user) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    let data = { 
        uid: user.uid, 
        displayName: user.displayName || user.email.split('@')[0], 
        email: user.email, 
        photoURL: user.photoURL || DEFAULT_AVATAR,
        lastSeen: serverTimestamp() 
    };
    
    if (!userSnap.exists()) {
        data.friendCode = generateCode();
        data.friends = []; 
        data.friendRequestsSent = []; 
        data.friendRequestsReceived = [];
    }
    
    await setDoc(userRef, data, { merge: true });
    updatePresence(); 
    return userSnap.exists() ? userSnap.data() : data;
}

// Système de "Heartbeat" pour le statut En Ligne
function updatePresence() {
    if (currentUser) {
        updateDoc(doc(db, "users", currentUser.uid), { lastSeen: serverTimestamp() });
    }
}
setInterval(updatePresence, 60000); // Mise à jour toutes les minutes
document.addEventListener('click', updatePresence); // Et à chaque clic

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        const syncedData = await syncUserToFirestore(user);
        currentUser.fullData = syncedData;
        updateHeaderUI(user);
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        initEventsList();
        initFriendsSystem();
    } else {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
        currentChatId = null;
    }
});

// Boutons Login/Logout
document.getElementById('google-btn').onclick = () => signInWithPopup(auth, provider);
document.getElementById('logout-btn').onclick = () => signOut(auth);
document.getElementById('signin-btn').onclick = () => signInWithEmailAndPassword(auth, document.getElementById('email-input').value, document.getElementById('password-input').value).catch(e=>alert(e.message));
document.getElementById('signup-btn').onclick = () => createUserWithEmailAndPassword(auth, document.getElementById('email-input').value, document.getElementById('password-input').value).then(c=>syncUserToFirestore(c.user)).catch(e=>alert(e.message));

// --- UI GÉNÉRALE ---

function updateHeaderUI(user) {
    document.getElementById('header-name').textContent = user.displayName || "User";
    document.getElementById('header-avatar').src = user.photoURL || DEFAULT_AVATAR;
    document.getElementById('profile-friend-code').textContent = currentUser.fullData.friendCode || "...";
}

document.getElementById('mobile-back-btn').onclick = () => {
    document.getElementById('main-container').classList.remove('mobile-chat-active');
    currentChatId = null;
    document.querySelectorAll('.list-item').forEach(e => e.classList.remove('active'));
    document.getElementById('chat-view').classList.add('hidden');
    document.getElementById('no-event-selected').classList.remove('hidden');
};

document.getElementById('lang-toggle').onclick = () => {
    currentLang = currentLang === 'fr' ? 'en' : 'fr';
    document.getElementById('lang-toggle').textContent = currentLang.toUpperCase();
    const t = translations[currentLang];
    document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = t[el.getAttribute('data-i18n')]);
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => el.placeholder = t[el.getAttribute('data-i18n-placeholder')]);
};

document.getElementById('theme-toggle').onclick = () => {
    const html = document.documentElement;
    html.setAttribute('data-theme', html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
};

// Gestion des Onglets
const tabEvents = document.getElementById('tab-btn-events');
const tabFriends = document.getElementById('tab-btn-friends');
tabEvents.onclick = () => switchTab('events');
tabFriends.onclick = () => switchTab('friends');

function switchTab(tab) {
    if(tab === 'events') {
        tabEvents.classList.add('active'); tabFriends.classList.remove('active');
        document.getElementById('tab-content-events').classList.remove('hidden');
        document.getElementById('tab-content-friends').classList.add('hidden');
    } else {
        tabFriends.classList.add('active'); tabEvents.classList.remove('active');
        document.getElementById('tab-content-friends').classList.remove('hidden');
        document.getElementById('tab-content-events').classList.add('hidden');
    }
}

// Modales
document.querySelectorAll('.close-modal').forEach(b => b.onclick = () => {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    stopCamera();
});

// Profil
document.getElementById('open-profile-btn').onclick = () => {
    document.getElementById('modal-profile').classList.remove('hidden');
    document.getElementById('edit-name').value = currentUser.displayName || "";
    document.getElementById('preview-avatar').src = currentUser.photoURL || DEFAULT_AVATAR;
};
document.getElementById('save-profile-btn').onclick = async () => {
    const newName = document.getElementById('edit-name').value;
    const file = document.getElementById('file-photo').files[0];
    let photoURL = currentUser.photoURL;
    if (file) {
        const sRef = ref(storage, `users/${currentUser.uid}/profile_${Date.now()}`);
        await uploadBytes(sRef, file);
        photoURL = await getDownloadURL(sRef);
    }
    await updateProfile(currentUser, { displayName: newName, photoURL });
    await syncUserToFirestore(currentUser);
    window.location.reload();
};

// --- SYSTÈME D'AMIS (ANTI-DOUBLON TOTAL) ---

function initFriendsSystem() {
    onSnapshot(doc(db, "users", currentUser.uid), async (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        currentUser.fullData = data;
        
        // Badge notif
        const badge = document.getElementById('notif-friends');
        const reqCount = data.friendRequestsReceived?.length || 0;
        if(reqCount > 0) { badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); }

        // Demandes
        const reqList = document.getElementById('friend-requests-list');
        reqList.innerHTML = "";
        const reqContainer = document.getElementById('friend-requests-container');
        if (reqCount > 0) {
            reqContainer.classList.remove('hidden');
            for (const rid of data.friendRequestsReceived) {
                const rSnap = await getDoc(doc(db, "users", rid));
                if (rSnap.exists()) {
                    const rData = rSnap.data();
                    const div = document.createElement('div');
                    div.className = 'request-card';
                    div.innerHTML = `<span>${rData.displayName}</span><div><button class="req-btn btn-accept"><i class="fas fa-check"></i></button><button class="req-btn btn-reject"><i class="fas fa-times"></i></button></div>`;
                    div.querySelector('.btn-accept').onclick = () => acceptFriend(rid);
                    div.querySelector('.btn-reject').onclick = () => rejectFriend(rid);
                    reqList.appendChild(div);
                }
            }
        } else { reqContainer.classList.add('hidden'); }

        // Liste des amis - NETTOYAGE COMPLET POUR ÉVITER DOUBLONS
        const friendsList = document.getElementById('friends-list');
        friendsList.innerHTML = ""; // On vide visuellement
        
        // On détruit les anciens écouteurs de messages pour ne pas les empiler
        friendListeners.forEach(unsub => unsub());
        friendListeners = [];

        // On utilise un Set pour s'assurer qu'il n'y a pas d'ID en double dans les données brutes
        const uniqueFriends = [...new Set(data.friends || [])];

        if (uniqueFriends.length > 0) {
            for (const fid of uniqueFriends) {
                const fSnap = await getDoc(doc(db, "users", fid));
                if (fSnap.exists()) {
                    const fData = fSnap.data();
                    userDataCache[fid] = fData;
                    
                    const div = document.createElement('div');
                    div.className = 'list-item';
                    if (currentChatId === getConversationId(currentUser.uid, fid)) div.classList.add('active');
                    
                    div.innerHTML = `
                        <div class="avatar-container">
                            <img src="${fData.photoURL}" class="item-img">
                            <div class="friend-notif-dot hidden" id="dot-${fid}"></div>
                        </div>
                        <div class="item-content">
                            <div class="item-title">${fData.displayName}</div>
                            <div class="last-message" id="msg-${fid}">Aucun message</div>
                        </div>
                        <button class="remove-friend-btn"><i class="fas fa-user-times"></i></button>
                    `;

                    div.onclick = (e) => { 
                        if(!e.target.closest('.remove-friend-btn')) {
                            loadDirectChat(fData);
                            document.getElementById(`dot-${fid}`).classList.add('hidden');
                        }
                    };
                    div.querySelector('.remove-friend-btn').onclick = (e) => { e.stopPropagation(); removeFriend(fid, fData.displayName); };
                    
                    friendsList.appendChild(div);

                    // Écouteur pour le dernier message
                    const convoId = getConversationId(currentUser.uid, fid);
                    const qLastMsg = query(
                        collection(db, "messages"), 
                        where("conversationId", "==", convoId), 
                        orderBy("createdAt", "desc"), 
                        limit(1)
                    );

                    const unsubMsg = onSnapshot(qLastMsg, (snapshot) => {
                        if (!snapshot.empty) {
                            const msg = snapshot.docs[0].data();
                            const msgEl = document.getElementById(`msg-${fid}`);
                            const dotEl = document.getElementById(`dot-${fid}`);
                            
                            if (msgEl) {
                                if(msg.deletedFor && msg.deletedFor.includes(currentUser.uid)) {
                                    msgEl.textContent = "Message supprimé";
                                    return;
                                }

                                let content = "Média";
                                if(msg.text) content = msg.text;
                                else if(msg.fileType === 'image') content = "📷 Photo";
                                else if(msg.fileType === 'video') content = "🎥 Vidéo";
                                else if(msg.fileType === 'doc') content = "📄 Document";

                                const prefix = msg.uid === currentUser.uid ? "Moi : " : `${fData.displayName.split(' ')[0]} : `;
                                msgEl.textContent = prefix + content;

                                if (msg.uid !== currentUser.uid && currentChatId !== convoId && msg.status !== 'read') {
                                    if(dotEl) dotEl.classList.remove('hidden');
                                } else {
                                    if(dotEl) dotEl.classList.add('hidden');
                                }
                            }
                        }
                    }, (error) => console.log("Index manquant (voir console)"));
                    
                    friendListeners.push(unsubMsg);
                }
            }
        } else { friendsList.innerHTML = "<div style='padding:10px;opacity:0.5;font-size:0.9rem'>Aucun ami.</div>"; }
    });
}

document.getElementById('add-friend-btn').onclick = async () => {
    const code = document.getElementById('add-friend-input').value.trim().toUpperCase();
    if (!code) return;
    const q = query(collection(db, "users"), where("friendCode", "==", code));
    const qs = await getDocs(q);
    if (qs.empty) return alert("Code introuvable.");
    const target = qs.docs[0].data();
    if (currentUser.fullData.friends.includes(target.uid)) return alert("Déjà amis.");
    await updateDoc(doc(db, "users", target.uid), { friendRequestsReceived: arrayUnion(currentUser.uid) });
    await updateDoc(doc(db, "users", currentUser.uid), { friendRequestsSent: arrayUnion(target.uid) });
    alert("Demande envoyée.");
    document.getElementById('add-friend-input').value = "";
};

async function acceptFriend(rid) { await updateDoc(doc(db, "users", currentUser.uid), { friends: arrayUnion(rid), friendRequestsReceived: arrayRemove(rid) }); await updateDoc(doc(db, "users", rid), { friends: arrayUnion(currentUser.uid), friendRequestsSent: arrayRemove(currentUser.uid) }); }
async function rejectFriend(rid) { await updateDoc(doc(db, "users", currentUser.uid), { friendRequestsReceived: arrayRemove(rid) }); }
async function removeFriend(fid, name) { if(confirm("Supprimer " + name + " ?")) { await updateDoc(doc(db, "users", currentUser.uid), { friends: arrayRemove(fid) }); await updateDoc(doc(db, "users", fid), { friends: arrayRemove(currentUser.uid) }); } }

// --- EVENTS ---
document.getElementById('open-create-event-btn').onclick = () => {
    document.getElementById('modal-create').classList.remove('hidden');
    const list = document.getElementById('users-checkbox-list');
    list.innerHTML = "";
    (currentUser.fullData.friends || []).forEach(fid => {
        const f = userDataCache[fid];
        if(f) {
            const div = document.createElement('div');
            div.className = 'user-checkbox-item';
            div.innerHTML = `<input type="checkbox" value="${f.uid}" id="inv-${f.uid}"><img src="${f.photoURL}" class="user-mini-pic"><label for="inv-${f.uid}">${f.displayName}</label>`;
            list.appendChild(div);
        }
    });
};
document.getElementById('create-event-form').onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById('new-event-title').value;
    const date = document.getElementById('new-event-date').value;
    const att = [currentUser.uid];
    document.querySelectorAll('#users-checkbox-list input:checked').forEach(c => att.push(c.value));
    const inviteCode = generateCode("EVT-");
    await addDoc(collection(db, "events"), { title, date, createdBy: currentUser.uid, attendees: att, inviteCode: inviteCode, createdAt: serverTimestamp() });
    document.getElementById('modal-create').classList.add('hidden');
    document.getElementById('create-event-form').reset();
};
document.getElementById('open-join-event-btn').onclick = () => document.getElementById('modal-join').classList.remove('hidden');
document.getElementById('confirm-join-btn').onclick = async () => {
    const code = document.getElementById('join-event-code').value.trim().toUpperCase();
    if(!code) return;
    const q = query(collection(db, "events"), where("inviteCode", "==", code));
    const snaps = await getDocs(q);
    if(snaps.empty) return alert("Code invalide.");
    const evtDoc = snaps.docs[0];
    if(evtDoc.data().attendees.includes(currentUser.uid)) { alert("Déjà membre !"); } else { await updateDoc(evtDoc.ref, { attendees: arrayUnion(currentUser.uid) }); alert("Rejoint !"); document.getElementById('modal-join').classList.add('hidden'); }
};
function initEventsList() {
    const q = query(collection(db, "events"), where("attendees", "array-contains", currentUser.uid));
    onSnapshot(q, (sn) => {
        const list = document.getElementById('events-list');
        list.innerHTML = "";
        sn.forEach(d => {
            const ev = d.data();
            const div = document.createElement('div');
            div.className = `list-item ${currentChatId === d.id ? 'active' : ''}`;
            div.innerHTML = `<div class="item-content"><div class="item-title">${ev.title}</div><div class="item-subtitle">${ev.date}</div></div>`;
            div.onclick = () => loadEventChat(d.id, ev);
            list.appendChild(div);
        });
    });
}

// --- TCHAT (MESSAGERIE, STATUT, UPLOAD) ---

function getConversationId(u1, u2) { return [u1, u2].sort().join('_'); }

function scrollToBottom() {
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
        setTimeout(() => { chatContainer.scrollTop = chatContainer.scrollHeight; }, 100);
    }
}

function getStatusText(lastSeenTimestamp) {
    if (!lastSeenTimestamp) return "Hors ligne";
    const lastSeen = lastSeenTimestamp.toDate();
    const diff = (new Date() - lastSeen) / 1000 / 60; // Minutes
    if (diff < 2) return "En ligne"; 
    return "Vu à " + lastSeen.getHours().toString().padStart(2,'0') + ":" + lastSeen.getMinutes().toString().padStart(2,'0');
}

function markMessagesAsRead(snapshot) {
    snapshot.docs.forEach(docSnap => {
        const msg = docSnap.data();
        if (msg.uid !== currentUser.uid && msg.status !== 'read') {
            updateDoc(docSnap.ref, { status: 'read', readAt: serverTimestamp() });
        }
    });
}

// --- GESTION MENU PIÈCES JOINTES ---
const attachBtn = document.getElementById('attach-btn');
const attachMenu = document.getElementById('attachment-menu');

attachBtn.onclick = (e) => { e.stopPropagation(); attachMenu.classList.toggle('hidden'); };
document.onclick = (e) => {
    if (!attachMenu.classList.contains('hidden') && !e.target.closest('#attach-btn') && !e.target.closest('#attachment-menu')) {
        attachMenu.classList.add('hidden');
    }
};

document.getElementById('btn-gallery').onclick = () => { attachMenu.classList.add('hidden'); document.getElementById('input-gallery').click(); };
document.getElementById('btn-camera').onclick = () => { 
    attachMenu.classList.add('hidden'); 
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) document.getElementById('input-camera-mobile').click(); 
    else openWebcam(); 
};
document.getElementById('btn-document').onclick = () => { attachMenu.classList.add('hidden'); document.getElementById('input-document').click(); };

['input-gallery', 'input-camera-mobile', 'input-document'].forEach(id => {
    document.getElementById(id).onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            if(id === 'input-document' && file.size > 800 * 1024) return alert("Fichier trop lourd (Max 800Ko)");
            if (file.type.startsWith('image/')) compressImage(file); else sendFile(file);
        }
        e.target.value = "";
    };
});

// --- WEBCAM (PC) ---
function openWebcam() {
    const modal = document.getElementById('modal-webcam');
    const video = document.getElementById('webcam-video');
    modal.classList.remove('hidden');
    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => { videoStream = stream; video.srcObject = stream; })
        .catch(err => { alert("Erreur caméra: " + err.message); modal.classList.add('hidden'); });
}
document.getElementById('snap-btn').onclick = () => {
    const video = document.getElementById('webcam-video');
    const canvas = document.getElementById('webcam-canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    sendDataMessage(dataUrl, 'image');
    stopCamera();
    document.getElementById('modal-webcam').classList.add('hidden');
};
function stopCamera() { if (videoStream) { videoStream.getTracks().forEach(t => t.stop()); videoStream = null; } }

// --- COMPRESSION ET ENVOI ---
function compressImage(file) {
    const reader = new FileReader(); reader.readAsDataURL(file);
    reader.onload = (ev) => {
        const img = new Image(); img.src = ev.target.result;
        img.onload = () => {
            const cvs = document.createElement('canvas');
            const sc = 800/img.width;
            cvs.width = (sc<1)?800:img.width; cvs.height = (sc<1)?img.height*sc:img.height;
            cvs.getContext('2d').drawImage(img,0,0,cvs.width,cvs.height);
            const d = cvs.toDataURL('image/jpeg',0.6);
            if(d.length>800000) alert("Image trop lourde"); else sendDataMessage(d, 'image');
        }
    }
}
function sendFile(f) { 
    const r = new FileReader(); 
    r.onload=(e)=>sendDataMessage(e.target.result, f.type.startsWith('video')?'video':'doc'); 
    r.readAsDataURL(f); 
}
async function sendDataMessage(d,t) {
    const msg = { text:"", fileData:d, fileType:t, uid:currentUser.uid, displayName:currentUser.displayName, createdAt:serverTimestamp(), status:'sent' };
    if(currentChatType === 'EVENT') msg.eventId = currentChatId; else msg.conversationId = currentChatId;
    await addDoc(collection(db,"messages"), msg);
    scrollToBottom();
}

// --- LIGHTBOX (VISIONNEUSE PHOTO) ---
window.openLightbox = (src) => {
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    img.src = src;
    lb.classList.remove('hidden');
    zoomLevel = 1;
    img.style.transform = `scale(${zoomLevel})`;
    
    document.getElementById('download-img').onclick = () => {
        const a = document.createElement('a'); a.href = src; a.download = `img_${Date.now()}.jpg`; a.click();
    };
};
document.querySelector('.close-lightbox').onclick = () => document.getElementById('lightbox').classList.add('hidden');
document.getElementById('zoom-in').onclick = () => { zoomLevel += 0.2; document.getElementById('lightbox-img').style.transform = `scale(${zoomLevel})`; };
document.getElementById('zoom-out').onclick = () => { if(zoomLevel > 0.4) zoomLevel -= 0.2; document.getElementById('lightbox-img').style.transform = `scale(${zoomLevel})`; };

// --- MENU CONTEXTUEL (POSITION, COPIER, TELECHARGER) ---
const ctxMenu = document.getElementById('msg-context-menu');
let longPressTimer;

function addContextMenuListeners(element, msgId, msgData) {
    element.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(e.pageX, e.pageY, msgId, msgData); });
    element.addEventListener('touchstart', (e) => { longPressTimer = setTimeout(() => showContextMenu(e.touches[0].pageX, e.touches[0].pageY, msgId, msgData), 800); });
    element.addEventListener('touchend', () => clearTimeout(longPressTimer));
}

function showContextMenu(x, y, msgId, msgData) {
    const menuWidth = 220; const menuHeight = 220;
    
    // Garder le menu dans l'écran
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;

    ctxMenu.style.left = `${x}px`; 
    ctxMenu.style.top = `${y}px`; 
    ctxMenu.classList.remove('hidden');

    const isMe = msgData.uid === currentUser.uid;
    const readInfo = document.getElementById('ctx-read-row');
    const sentTime = document.getElementById('ctx-sent-time');
    const readTime = document.getElementById('ctx-read-time');
    const deleteMe = document.getElementById('ctx-delete-me');
    const deleteAll = document.getElementById('ctx-delete-all');
    const btnCopy = document.getElementById('ctx-copy-text');
    const btnDownload = document.getElementById('ctx-download-media');

    // Heures
    if (msgData.createdAt) {
        const sd = msgData.createdAt.toDate();
        sentTime.textContent = sd.getHours().toString().padStart(2,'0')+':'+sd.getMinutes().toString().padStart(2,'0');
    }

    if (isMe && msgData.status === 'read' && msgData.readAt) {
        readInfo.style.display = 'flex';
        const rd = msgData.readAt.toDate();
        readTime.textContent = rd.getHours().toString().padStart(2,'0')+':'+rd.getMinutes().toString().padStart(2,'0');
    } else { readInfo.style.display = 'none'; }

    // Copier vs Télécharger
    if (msgData.fileData && (msgData.fileType === 'image' || msgData.fileType === 'video')) {
        btnCopy.style.display = 'none';
        btnDownload.style.display = 'flex';
        btnDownload.onclick = () => {
            const a = document.createElement('a'); a.href = msgData.fileData; a.download = `file_${Date.now()}`; a.click();
            ctxMenu.classList.add('hidden');
        };
    } else {
        btnCopy.style.display = 'flex';
        btnDownload.style.display = 'none';
        btnCopy.onclick = () => {
            if (navigator.clipboard) navigator.clipboard.writeText(msgData.text);
            ctxMenu.classList.add('hidden');
        };
    }

    // Suppression
    deleteMe.onclick = async () => { 
        await updateDoc(doc(db, "messages", msgId), { deletedFor: arrayUnion(currentUser.uid) }); 
        ctxMenu.classList.add('hidden'); 
    };
    
    if (isMe) {
        deleteAll.style.display = 'block';
        deleteAll.onclick = async () => { 
            if(confirm("Supprimer pour tout le monde ?")) { await deleteDoc(doc(db, "messages", msgId)); ctxMenu.classList.add('hidden'); }
        };
    } else { deleteAll.style.display = 'none'; }
}
document.addEventListener('click', () => ctxMenu.classList.add('hidden'));

// --- LOAD CHAT & STATUT ---

function loadEventChat(eid, edata) {
    currentChatType = 'EVENT'; currentChatId = eid;
    document.getElementById('chat-messages').innerHTML = ""; 
    updateChatViewUI(edata.title, edata.date);
    document.getElementById('invite-code-btn').classList.remove('hidden');
    document.getElementById('members-list-btn').classList.remove('hidden');
    document.getElementById('chat-online-status').classList.add('hidden'); 

    document.getElementById('invite-code-btn').onclick = async () => {
        let code = edata.inviteCode;
        if (!code) { code = generateCode("EVT-"); await updateDoc(doc(db, "events", eid), { inviteCode: code }); }
        if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(code).then(() => alert("Code copié : " + code)); } else { prompt("Copie ce code :", code); }
    };
    
    // Boutons membres
    document.getElementById('members-list-btn').onclick = async () => {
        document.getElementById('modal-members').classList.remove('hidden');
        const cont = document.getElementById('members-list-container');
        cont.innerHTML = "Chargement...";
        let html = "";
        for(const uid of edata.attendees) {
            const uSnap = await getDoc(doc(db, "users", uid));
            if(uSnap.exists()) {
                const u = uSnap.data();
                html += `<div style="display:flex;align-items:center;gap:10px;padding:10px;border-bottom:1px solid #444;"><img src="${u.photoURL}" style="width:30px;height:30px;border-radius:50%"><span>${u.displayName}</span></div>`;
            }
        }
        cont.innerHTML = html;
    };

    const btnDel = document.getElementById('delete-event-btn');
    if(edata.createdBy === currentUser.uid) { btnDel.classList.remove('hidden'); btnDel.onclick = async () => { if(confirm("Supprimer ?")) { await deleteDoc(doc(db, "events", eid)); resetChatUI(); } }; } else btnDel.classList.add('hidden');
    
    subscribeMessages(eid, 'eventId');
}

function loadDirectChat(fdata) {
    currentChatType = 'DM'; currentChatId = getConversationId(currentUser.uid, fdata.uid);
    document.getElementById('chat-messages').innerHTML = "";
    
    updateChatViewUI(fdata.displayName, "Privé");
    const dot = document.getElementById(`dot-${fdata.uid}`);
    if(dot) dot.classList.add('hidden');

    const statusEl = document.getElementById('chat-online-status');
    statusEl.classList.remove('hidden');
    onSnapshot(doc(db, "users", fdata.uid), (d) => { if(d.exists()) statusEl.textContent = getStatusText(d.data().lastSeen); });

    document.getElementById('invite-code-btn').classList.add('hidden');
    document.getElementById('members-list-btn').classList.add('hidden');
    document.getElementById('delete-event-btn').classList.add('hidden');
    
    subscribeMessages(currentChatId, 'conversationId');
}

function updateChatViewUI(t, s) {
    document.getElementById('no-event-selected').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');
    document.getElementById('chat-title').textContent = t;
    document.getElementById('chat-subtitle').textContent = s;
    document.getElementById('main-container').classList.add('mobile-chat-active');
    document.querySelectorAll('.list-item').forEach(e=>e.classList.remove('active'));
}

function resetChatUI() {
    document.getElementById('main-container').classList.remove('mobile-chat-active');
    document.getElementById('no-event-selected').classList.remove('hidden');
    document.getElementById('chat-view').classList.add('hidden');
    currentChatId = null;
}

// --- SOUSCRIPTION MESSAGES ---
function subscribeMessages(val, field) {
    if(currentUnsubscribeChat) currentUnsubscribeChat();
    const q = query(collection(db, "messages"), where(field, "==", val), orderBy("createdAt", "asc"));
    
    currentUnsubscribeChat = onSnapshot(q, (sn) => {
        const div = document.getElementById('chat-messages');
        div.innerHTML = "";
        
        if(document.visibilityState === 'visible') markMessagesAsRead(sn);

        sn.forEach(docSnap => {
            const m = docSnap.data();
            
            if (m.deletedFor && m.deletedFor.includes(currentUser.uid)) return;

            const isMe = m.uid === currentUser.uid;
            const msgDiv = document.createElement('div');
            msgDiv.className = `message ${isMe ? 'my-msg' : 'other-msg'}`;
            msgDiv.setAttribute('data-id', docSnap.id);
            
            let contentHtml = "";
            if (m.fileData) {
                if (m.fileType === 'image') contentHtml = `<img src="${m.fileData}" class="msg-attachment" onclick="openLightbox('${m.fileData}')">`;
                else if(m.fileType === 'video') contentHtml = `<video src="${m.fileData}" controls class="msg-attachment"></video>`;
                else contentHtml = `<a href="${m.fileData}" download="Fichier" style="color:white;text-decoration:underline">📄 Document</a>`;
            } else { contentHtml = m.text; }

            let statusIcon = "";
            if (isMe) {
                if (m.status === 'read') statusIcon = `<i class="fas fa-check-double msg-status read"></i>`;
                else statusIcon = `<i class="fas fa-check msg-status"></i>`;
            }

            const time = m.createdAt ? m.createdAt.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : "...";

            msgDiv.innerHTML = `
                ${!isMe ? `<span class="msg-author">${m.displayName.split(' ')[0]}</span>` : ''}
                ${contentHtml}
                <div class="msg-info">
                    <span class="msg-time">${time}</span>
                    ${statusIcon}
                </div>
            `;
            
            addContextMenuListeners(msgDiv, docSnap.id, m);
            div.appendChild(msgDiv);
        });
        scrollToBottom();
    });
}

document.getElementById('chat-form').onsubmit = async (e) => {
    e.preventDefault();
    const txt = document.getElementById('chat-input').value.trim();
    if(txt && currentChatId) {
        const msg = { text: txt, uid: currentUser.uid, displayName: currentUser.displayName, createdAt: serverTimestamp(), status: 'sent' };
        if(currentChatType === 'EVENT') msg.eventId = currentChatId; else msg.conversationId = currentChatId;
        await addDoc(collection(db, "messages"), msg);
        document.getElementById('chat-input').value = "";
        scrollToBottom();
    }
};