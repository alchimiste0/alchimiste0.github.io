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

// --- CONFIGURATION FIREBASE (REMETS TES CLÉS ICI) ---
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

let currentUser = null;
let currentChatType = null;
let currentChatId = null;
let currentUnsubscribeChat = null;
let userDataCache = {};
let currentLang = 'fr';
let friendListeners = [];
let videoStream = null;

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

// --- AUTH ---
function generateCode(prefix = "") { return prefix + Math.random().toString(36).substring(2, 6).toUpperCase(); }

async function syncUserToFirestore(user) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    let data = { uid: user.uid, displayName: user.displayName || user.email.split('@')[0], email: user.email, photoURL: user.photoURL || DEFAULT_AVATAR, lastSeen: serverTimestamp() };
    if (!userSnap.exists()) {
        data.friendCode = generateCode();
        data.friends = []; data.friendRequestsSent = []; data.friendRequestsReceived = [];
    }
    await setDoc(userRef, data, { merge: true });
    return userSnap.exists() ? userSnap.data() : data;
}

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

document.getElementById('google-btn').onclick = () => signInWithPopup(auth, provider);
document.getElementById('logout-btn').onclick = () => signOut(auth);
document.getElementById('signin-btn').onclick = () => signInWithEmailAndPassword(auth, document.getElementById('email-input').value, document.getElementById('password-input').value).catch(e=>alert(e.message));
document.getElementById('signup-btn').onclick = () => createUserWithEmailAndPassword(auth, document.getElementById('email-input').value, document.getElementById('password-input').value).then(c=>syncUserToFirestore(c.user)).catch(e=>alert(e.message));

// --- UI ---
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
document.querySelectorAll('.close-modal').forEach(b => b.onclick = () => {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    stopCamera(); // Stop la caméra si on ferme la modale
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

// --- LOGIQUE AMIS + NOTIFS MESSAGES ---
function initFriendsSystem() {
    onSnapshot(doc(db, "users", currentUser.uid), async (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        currentUser.fullData = data;
        const badge = document.getElementById('notif-friends');
        const reqCount = data.friendRequestsReceived?.length || 0;
        if(reqCount > 0) { badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); }

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

        const friendsList = document.getElementById('friends-list');
        friendsList.innerHTML = "";
        friendListeners.forEach(unsub => unsub());
        friendListeners = [];

        if (data.friends?.length > 0) {
            for (const fid of data.friends) {
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

                    const convoId = getConversationId(currentUser.uid, fid);
                    const qLastMsg = query(collection(db, "messages"), where("conversationId", "==", convoId), orderBy("createdAt", "desc"), limit(1));

                    const unsubMsg = onSnapshot(qLastMsg, (snapshot) => {
                        if (!snapshot.empty) {
                            const msg = snapshot.docs[0].data();
                            const msgEl = document.getElementById(`msg-${fid}`);
                            const dotEl = document.getElementById(`dot-${fid}`);
                            
                            let content = "Photo/Vidéo";
                            if(msg.text) content = msg.text;
                            
                            const prefix = msg.uid === currentUser.uid ? "Moi : " : `${fData.displayName.split(' ')[0]} : `;
                            if (msgEl) msgEl.textContent = prefix + content;
                            if (msg.uid !== currentUser.uid && currentChatId !== convoId) {
                                if (dotEl) dotEl.classList.remove('hidden');
                            } else {
                                if (dotEl) dotEl.classList.add('hidden');
                            }
                        }
                    }, (error) => console.error("Index manquant dernier msg", error));
                    friendListeners.push(unsubMsg);
                }
            }
        } else { friendsList.innerHTML = "<div style='padding:10px;opacity:0.5;font-size:0.9rem'>Aucun ami.</div>"; }
    });
}

document.getElementById('add-friend-btn').onclick = async () => {
    const code = document.getElementById('add-friend-input').value.trim().toUpperCase();
    if (!code || code === currentUser.fullData.friendCode) return;
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

// --- TCHAT ---
function getConversationId(u1, u2) { return [u1, u2].sort().join('_'); }

function scrollToBottom() {
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
        setTimeout(() => { chatContainer.scrollTop = chatContainer.scrollHeight; }, 100);
    }
}

// --- GESTION DES PIÈCES JOINTES & MENU ---
const attachBtn = document.getElementById('attach-btn');
const attachMenu = document.getElementById('attachment-menu');

attachBtn.onclick = (e) => {
    e.stopPropagation();
    attachMenu.classList.toggle('hidden');
};

document.onclick = (e) => {
    if (!attachMenu.classList.contains('hidden') && !e.target.closest('#attach-btn') && !e.target.closest('#attachment-menu')) {
        attachMenu.classList.add('hidden');
    }
};

document.getElementById('btn-gallery').onclick = () => {
    attachMenu.classList.add('hidden');
    document.getElementById('input-gallery').click();
};

// MODIFICATION DU BOUTON CAMÉRA (Mobile vs PC)
document.getElementById('btn-camera').onclick = () => {
    attachMenu.classList.add('hidden');
    
    // Détection si Mobile ou PC
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        // Mobile : On utilise l'input capture natif
        document.getElementById('input-camera-mobile').click();
    } else {
        // PC : On ouvre la modale Webcam
        openWebcam();
    }
};

document.getElementById('btn-document').onclick = () => {
    attachMenu.classList.add('hidden');
    document.getElementById('input-document').click();
};

// Gestion des changements de fichiers (Upload)
['input-gallery', 'input-camera-mobile', 'input-document'].forEach(id => {
    document.getElementById(id).onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            if(id === 'input-document' && file.size > 800 * 1024) {
                alert("Document trop lourd (Max 800Ko).");
                return;
            }
            if (file.type.startsWith('image/')) {
                compressImage(file);
            } else {
                sendFile(file);
            }
        }
        e.target.value = "";
    };
});

// --- LOGIQUE WEBCAM (PC) ---
function openWebcam() {
    const modal = document.getElementById('modal-webcam');
    const video = document.getElementById('webcam-video');
    modal.classList.remove('hidden');

    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            videoStream = stream;
            video.srcObject = stream;
        })
        .catch(err => {
            alert("Impossible d'accéder à la caméra : " + err.message);
            modal.classList.add('hidden');
        });
}

// Bouton "Prendre photo" dans la modale
document.getElementById('snap-btn').onclick = () => {
    const video = document.getElementById('webcam-video');
    const canvas = document.getElementById('webcam-canvas');
    const context = canvas.getContext('2d');

    // Définir la taille du canvas comme la vidéo
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Dessiner l'image
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convertir en Base64 (Qualité 0.7 pour réduire la taille)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    
    sendDataMessage(dataUrl, 'image');
    stopCamera();
    document.getElementById('modal-webcam').classList.add('hidden');
};

function stopCamera() {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
}

// FONCTION COMPRESSION
function compressImage(file) {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            const scaleSize = MAX_WIDTH / img.width;
            canvas.width = (scaleSize < 1) ? MAX_WIDTH : img.width;
            canvas.height = (scaleSize < 1) ? img.height * scaleSize : img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            if(dataUrl.length > 800000) { alert("Image trop lourde."); } else { sendDataMessage(dataUrl, 'image'); }
        }
    }
}

function sendFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;
        const type = file.type.startsWith('image') ? 'image' : (file.type.startsWith('video') ? 'video' : 'doc');
        sendDataMessage(base64, type);
    };
    reader.readAsDataURL(file);
}

async function sendDataMessage(data, type) {
    const d = { 
        text: "", fileData: data, fileType: type,
        uid: currentUser.uid, displayName: currentUser.displayName, createdAt: serverTimestamp() 
    };
    if(currentChatType === 'EVENT') d.eventId = currentChatId; else d.conversationId = currentChatId;
    await addDoc(collection(db, "messages"), d);
    scrollToBottom();
}

function loadEventChat(eid, edata) {
    currentChatType = 'EVENT'; currentChatId = eid;
    document.getElementById('chat-messages').innerHTML = ""; 
    updateChatViewUI(edata.title, edata.date);
    document.getElementById('invite-code-btn').classList.remove('hidden');
    document.getElementById('members-list-btn').classList.remove('hidden');
    document.getElementById('invite-code-btn').onclick = async () => {
        let code = edata.inviteCode;
        if (!code) {
            code = generateCode("EVT-");
            await updateDoc(doc(db, "events", eid), { inviteCode: code });
        }
        if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(code).then(() => alert("Code copié : " + code)); } else { prompt("Copie ce code :", code); }
    };
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
    if(edata.createdBy === currentUser.uid) {
        btnDel.classList.remove('hidden');
        btnDel.onclick = async () => { if(confirm("Supprimer ?")) { await deleteDoc(doc(db, "events", eid)); resetChatUI(); } };
    } else btnDel.classList.add('hidden');
    subscribeMessages(eid, 'eventId');
}

function loadDirectChat(fdata) {
    currentChatType = 'DM'; currentChatId = getConversationId(currentUser.uid, fdata.uid);
    document.getElementById('chat-messages').innerHTML = "";
    
    const dot = document.getElementById(`dot-${fdata.uid}`);
    if(dot) dot.classList.add('hidden');

    updateChatViewUI(fdata.displayName, "Privé");
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
function subscribeMessages(val, field) {
    if(currentUnsubscribeChat) currentUnsubscribeChat();
    const q = query(collection(db, "messages"), where(field, "==", val), orderBy("createdAt", "asc"));
    currentUnsubscribeChat = onSnapshot(q, (sn) => {
        const div = document.getElementById('chat-messages');
        div.innerHTML = "";
        sn.forEach(d => {
            const m = d.data();
            const isMe = m.uid === currentUser.uid;
            const msgDiv = document.createElement('div');
            msgDiv.className = `message ${isMe ? 'my-msg' : 'other-msg'}`;
            
            let contentHtml = "";
            if (m.fileData) {
                if (m.fileType === 'image') {
                    contentHtml = `<img src="${m.fileData}" class="msg-attachment" onclick="window.open('${m.fileData}')" style="cursor:pointer">`;
                } else if(m.fileType === 'video') {
                    contentHtml = `<video src="${m.fileData}" controls class="msg-attachment"></video>`;
                } else {
                    contentHtml = `<a href="${m.fileData}" download="document" style="color:white;text-decoration:underline">📄 Télécharger Document</a>`;
                }
            } else {
                contentHtml = m.text;
            }

            msgDiv.innerHTML = `${!isMe ? `<span class="msg-author">${m.displayName.split(' ')[0]}</span>` : ''}${contentHtml}`;
            div.appendChild(msgDiv);
        });
        scrollToBottom();
    });
}

document.getElementById('chat-form').onsubmit = async (e) => {
    e.preventDefault();
    const txt = document.getElementById('chat-input').value.trim();
    if(txt && currentChatId) {
        const d = { text: txt, uid: currentUser.uid, displayName: currentUser.displayName, createdAt: serverTimestamp() };
        if(currentChatType === 'EVENT') d.eventId = currentChatId; else d.conversationId = currentChatId;
        await addDoc(collection(db, "messages"), d);
        document.getElementById('chat-input').value = "";
        scrollToBottom();
    }
};