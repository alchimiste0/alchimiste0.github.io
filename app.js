import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, getDoc, setDoc, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAOrAlTFFpUn-3fm0M-nXd8-TEzdlhsJX8",
  authDomain: "roller-appel.firebaseapp.com",
  projectId: "roller-appel",
  storageBucket: "roller-appel.firebasestorage.app",
  messagingSenderId: "619454031109",
  appId: "1:619454031109:web:6213f59b5f88d51572436c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Activation du MODE HORS-LIGNE
enableIndexedDbPersistence(db).catch((err) => {
    console.warn("Mode hors-ligne indisponible :", err.code);
});

// Variables d'état globales
let currentYear = null, currentCategory = null, currentCourse = null;
let membersList = [], allCoursesInCategory = [];
let catChartInstance = null, adminChartInstance = null;
let editingCourseId = null, editingMemberId = null;

// Mémoire globale pour les filtres admin
window.adminCurrentMembers = [];
window.adminEncadrants = [];

const esc = str => str ? str.replace(/'/g, "\\'") : '';

function formatFrenchDate(dateStr) {
    const parts = dateStr.split('/');
    if (parts.length !== 3) return dateStr;
    const d = new Date(parts[2], parts[1] - 1, parts[0]);
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function getTodaySortDate() {
    const d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

// --- AUTHENTIFICATION ---
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const waitingScreen = document.getElementById('waiting-screen');

document.getElementById('btn-login').addEventListener('click', () => {
    signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value).catch(err => alert("Erreur : " + err.message));
});

document.getElementById('btn-google-login').addEventListener('click', async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (error) { alert("Erreur Google : " + error.message); }
});

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));
document.getElementById('btn-logout-waiting').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
    if (user) {
        loginScreen.classList.remove('active');
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
            await setDoc(userRef, { email: user.email, name: user.displayName || "Utilisateur", isApproved: false, createdAt: Date.now() });
            showWaitingScreen();
        } else {
            if (userSnap.data().isApproved === true) {
                appScreen.classList.add('active'); 
                waitingScreen.classList.remove('active'); 
                loadYears();
            } else {
                showWaitingScreen();
            }
        }
    } else {
        loginScreen.classList.add('active'); 
        appScreen.classList.remove('active'); 
        waitingScreen.classList.remove('active');
    }
});

function showWaitingScreen() { 
    appScreen.classList.remove('active'); 
    waitingScreen.classList.add('active'); 
}

function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
    updateBreadcrumb(sectionId);
}

function updateBreadcrumb(sectionId) {
    const bc = document.getElementById('breadcrumb');
    let html = `<span onclick="loadYears()">Accueil</span>`;
    if (sectionId === 'section-admin') {
        html += ` > <span>Administration</span>`;
    } else {
        if (currentYear && sectionId !== 'section-years') html += ` > <span onclick="loadCategories()">${currentYear.name}</span>`;
        if (currentCategory && (sectionId === 'section-courses' || sectionId === 'section-attendance')) html += ` > <span onclick="loadCourses()">${currentCategory.name}</span>`;
        if (currentCourse && sectionId === 'section-attendance') html += ` > <span>${formatFrenchDate(currentCourse.date)}</span>`;
    }
    bc.innerHTML = html;
}

// --- MODALES (Pop-ups) ---
window.closeModals = () => {
    document.querySelectorAll('.modal, .modal-overlay').forEach(el => el.classList.remove('active'));
};

window.openCourseModal = (id = null, date = '', time = '') => {
    editingCourseId = id;
    document.getElementById('modal-course-title').innerText = id ? "Modifier le cours" : "Créer un cours";
    if (date) {
        const parts = date.split('/');
        document.getElementById('course-date-input').value = `${parts[2]}-${parts[1]}-${parts[0]}`;
    } else {
        document.getElementById('course-date-input').value = new Date().toISOString().split('T')[0];
    }
    document.getElementById('course-time-input').value = time;
    document.getElementById('modal-overlay').classList.add('active');
    document.getElementById('modal-course').classList.add('active');
};

window.openMemberModal = (id = null, last = '', first = '', dob = '', role = 'eleve') => {
    editingMemberId = id;
    document.getElementById('modal-member-title').innerText = id ? "Modifier la personne" : "Ajouter une personne";
    document.getElementById('member-lastname').value = last;
    document.getElementById('member-firstname').value = first;
    
    if (dob) {
        const parts = dob.split('/');
        if (parts.length === 3) document.getElementById('member-dob').value = `${parts[2]}-${parts[1]}-${parts[0]}`;
    } else {
        document.getElementById('member-dob').value = '';
    }
    
    const roleRadio = document.querySelector(`input[name="member-role"][value="${role}"]`);
    if (roleRadio) roleRadio.checked = true;

    document.getElementById('modal-overlay').classList.add('active');
    document.getElementById('modal-member').classList.add('active');
};

function renderCategoryChart() {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    if (catChartInstance) catChartInstance.destroy();
    
    const sortedCourses = [...allCoursesInCategory].reverse();
    catChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: sortedCourses.map(c => formatFrenchDate(c.date)),
            datasets: [{
                label: 'Nombre de présences',
                data: sortedCourses.map(c => c.attendance ? Object.values(c.attendance).filter(v => v === true).length : 0),
                borderColor: '#007bff', backgroundColor: 'rgba(0, 123, 255, 0.2)', borderWidth: 2, fill: true, tension: 0.3
            }]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

// --- ACTUALISATION DU COMPTEUR DE PRESENCES ---
function updateAttendanceCounter() {
    const isPresentCount = membersList.filter(m => (currentCourse.attendance || {})[m.id] === true).length;
    const totalCount = membersList.length;
    document.getElementById('attendance-counter').innerText = `Présents : ${isPresentCount} / ${totalCount}`;
}

// --- ADMIN STATS ET FILTRES ---
window.loadAdminStats = async (yearId) => {
    if (!yearId) return;
    const catsSnap = await getDocs(collection(db, `years/${yearId}/categories`));
    
    let validMembersByMonth = {}; 
    const membersMap = {}; 
    const encadrantsMap = {};
    const allCatNames = [];
    
    catsSnap.forEach(cat => allCatNames.push(cat.data().name));

    for (let cat of catsSnap.docs) {
        const catName = cat.data().name;
        const membersSnap = await getDocs(collection(db, `years/${yearId}/categories/${cat.id}/members`));
        
        membersSnap.forEach(m => {
            const data = m.data();
            const key = `${data.lastName.toUpperCase()}_${data.firstName.toLowerCase()}`;
            
            // SEPARATION ELEVES ET ENCADRANTS
            if (data.role === 'encadrant') {
                if (!encadrantsMap[key]) {
                    encadrantsMap[key] = { lastName: data.lastName, firstName: data.firstName, dob: data.dob, categoriesForDisplay: [catName], isValidated: data.isValidated };
                } else {
                    if (!encadrantsMap[key].categoriesForDisplay.includes(catName)) encadrantsMap[key].categoriesForDisplay.push(catName);
                    if (data.isValidated) encadrantsMap[key].isValidated = true;
                }
                return; // Les encadrants s'arrêtent là
            }
            
            // ICI C'EST QUE LES ELEVES
            if (data.isValidated && data.addedDate && data.addedDate.length === 8) {
                const monthKey = `${data.addedDate.substring(0,4)}-${data.addedDate.substring(4,6)}`;
                validMembersByMonth[monthKey] = (validMembersByMonth[monthKey] || 0) + 1;
            }
            
            if (!membersMap[key]) {
                membersMap[key] = { lastName: data.lastName, firstName: data.firstName, dob: data.dob, categoriesForDisplay: [catName], rawCategories: [catName], isValidated: data.isValidated };
            } else {
                if (!membersMap[key].categoriesForDisplay.includes(catName)) {
                    membersMap[key].categoriesForDisplay.push(catName);
                    membersMap[key].rawCategories.push(catName);
                }
                if (data.isValidated) membersMap[key].isValidated = true; 
            }
        });
    }

    const sortedMonths = Object.keys(validMembersByMonth).sort();
    let cumulative = 0;
    const labels = []; const chartData = [];
    const monthNames = ["Janv", "Févr", "Mars", "Avril", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];

    sortedMonths.forEach(m => {
        cumulative += validMembersByMonth[m];
        const [year, monthNum] = m.split('-');
        labels.push(`${monthNames[parseInt(monthNum)-1]} ${year}`);
        chartData.push(cumulative);
    });

    const ctx = document.getElementById('adminChart').getContext('2d');
    if (adminChartInstance) adminChartInstance.destroy();
    adminChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'Licences Validées (Cumul par mois)', data: chartData, borderColor: '#28a745', backgroundColor: 'rgba(40, 167, 69, 0.2)', borderWidth: 2, fill: true, tension: 0.3 }] },
        options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });

    let totalValid = 0; let unpaidCount = 0;
    const validCatCounts = {};
    allCatNames.forEach(c => validCatCounts[c] = 0);
    window.adminCurrentMembers = []; 
    window.adminEncadrants = Object.values(encadrantsMap);

    Object.values(membersMap).forEach(m => {
        window.adminCurrentMembers.push(m);
        if (!m.isValidated) unpaidCount++;
        else {
            totalValid++;
            m.rawCategories.forEach(c => {
                if (validCatCounts[c] !== undefined) validCatCounts[c]++;
            });
        }
    });

    const badgesContainer = document.getElementById('admin-members-stats');
    badgesContainer.innerHTML = `
        <span class="badge total clickable" onclick="filterAdminMembers('valid')">Payés (Total) : ${totalValid}</span>
        <span class="badge unpaid clickable" onclick="filterAdminMembers('unpaid')">Impayés ⚠️ : ${unpaidCount}</span>
    `;
    
    allCatNames.forEach(cat => { 
        badgesContainer.innerHTML += `<span class="badge clickable" onclick="filterAdminMembers('cat', '${esc(cat)}')">${cat} (Payés) : ${validCatCounts[cat]}</span>`; 
    });

    filterAdminMembers('all', '', true);
};

window.filterAdminMembers = (type, val = '', isInitialLoad = false) => {
    let filtered = window.adminCurrentMembers || [];
    
    if (type === 'valid') filtered = filtered.filter(m => m.isValidated);
    else if (type === 'unpaid') filtered = filtered.filter(m => !m.isValidated);
    else if (type === 'cat') filtered = filtered.filter(m => m.isValidated && m.rawCategories.includes(val));

    const tbody = document.getElementById('admin-members-body');
    tbody.innerHTML = "";

    // Affichage des encadrants en haut s'il y en a et qu'on ne filtre pas que les élèves payés/impayés
    if(window.adminEncadrants.length > 0 && type !== 'valid' && type !== 'unpaid' && type !== 'cat') {
        const trSepEnc = document.createElement('tr');
        trSepEnc.innerHTML = `<td colspan="4" class="role-separator">🛡️ Liste des Encadrants</td>`;
        tbody.appendChild(trSepEnc);
        
        window.adminEncadrants.sort((a,b) => a.lastName.localeCompare(b.lastName)).forEach(m => {
            const statusHTML = m.isValidated ? '<strong style="color:#28a745;">Payé ✅</strong>' : '<strong style="color:#dc3545;">Impayé ❌</strong>';
            tbody.innerHTML += `<tr>
                <td><strong>${m.lastName}</strong> ${m.firstName}</td>
                <td>${m.dob || '-'}</td>
                <td>${m.categoriesForDisplay.join(' / ')}</td>
                <td>${statusHTML}</td>
            </tr>`;
        });
    }

    if (filtered.length > 0) {
        const trSepEleve = document.createElement('tr');
        trSepEleve.innerHTML = `<td colspan="4" class="role-separator">👤 Liste des Élèves</td>`;
        tbody.appendChild(trSepEleve);

        filtered.sort((a,b) => a.lastName.localeCompare(b.lastName)).forEach(m => {
            const statusHTML = m.isValidated ? '<strong style="color:#28a745;">Payé ✅</strong>' : '<strong style="color:#dc3545;">Impayé ❌</strong>';
            tbody.innerHTML += `<tr>
                <td><strong>${m.lastName}</strong> ${m.firstName}</td>
                <td>${m.dob || '-'}</td>
                <td>${m.categoriesForDisplay.join(' / ')}</td>
                <td>${statusHTML}</td>
            </tr>`;
        });
    }
    
    if (!isInitialLoad) {
        document.getElementById('admin-members-list-container').style.display = 'block';
    }
};

window.toggleAdminMembersList = () => {
    const c = document.getElementById('admin-members-list-container');
    c.style.display = c.style.display === 'none' ? 'block' : 'none';
};

// --- GESTION DES COMPTES (Admin App) ---
window.loadAdmin = async () => {
    showSection('section-admin');
    const snap = await getDocs(collection(db, 'users'));
    const activeContainer = document.getElementById('admin-active');
    const pendingContainer = document.getElementById('admin-pending');
    activeContainer.innerHTML = ''; pendingContainer.innerHTML = '';

    snap.forEach(d => {
        const u = {id: d.id, ...d.data()};
        const row = `<tr><td><strong>${u.name}</strong></td> <td>${u.email}</td><td class="actions-menu"><button class="btn-small" onclick="editUserName('${u.id}', '${esc(u.name)}')">✏️ Nom</button>${u.isApproved ? `<button class="btn-small btn-invalidate" onclick="toggleUserAccess('${u.id}', false)">Bloquer ❌</button>` : `<button class="btn-small btn-validate" onclick="toggleUserAccess('${u.id}', true)">Accepter ✅</button>`}</td></tr>`;
        if(u.isApproved) activeContainer.innerHTML += row; else pendingContainer.innerHTML += row;
    });

    const yearSnap = await getDocs(query(collection(db, "years"), orderBy("createdAt", "desc")));
    const select = document.getElementById('admin-year-select');
    select.innerHTML = '<option value="">-- Choisir une année --</option>';
    yearSnap.forEach(doc => { select.innerHTML += `<option value="${doc.id}">${doc.data().name}</option>`; });
    if (yearSnap.docs.length > 0) { 
        select.value = yearSnap.docs[0].id; 
        loadAdminStats(yearSnap.docs[0].id); 
    }
};

window.toggleUserAccess = async (id, state) => { await updateDoc(doc(db, 'users', id), { isApproved: state }); loadAdmin(); };

window.editUserName = async (id, oldName) => { 
    const newName = prompt("Modifier le Nom/Prénom :", oldName); 
    if (newName && newName !== oldName) { 
        await updateDoc(doc(db, 'users', id), { name: newName }); 
        loadAdmin(); 
    } 
};

// --- COURS ---
window.saveCourse = async () => {
    const dateInput = document.getElementById('course-date-input').value; 
    const time = document.getElementById('course-time-input').value;
    if (!dateInput || !time) return alert("Veuillez remplir la date et l'heure.");

    const parts = dateInput.split('-');
    const frDate = `${parts[2]}/${parts[1]}/${parts[0]}`; 
    const sortDate = parts[0] + parts[1] + parts[2]; 

    if (editingCourseId) {
        await updateDoc(doc(db, `years/${currentYear.id}/categories/${currentCategory.id}/courses/${editingCourseId}`), { date: frDate, time: time, sortDate: sortDate });
    } else {
        await addDoc(collection(db, `years/${currentYear.id}/categories/${currentCategory.id}/courses`), { date: frDate, time: time, sortDate: sortDate, attendance: {} });
    }
    closeModals(); loadCourses();
};

window.deleteCourse = async (id) => { 
    if(confirm("Supprimer ce cours ?")) { 
        await deleteDoc(doc(db, `years/${currentYear.id}/categories/${currentCategory.id}/courses/${id}`)); 
        loadCourses(); 
    } 
};

window.loadCourses = async () => { 
    currentCourse = null; 
    showSection('section-courses'); 
    const q = query(collection(db, `years/${currentYear.id}/categories/${currentCategory.id}/courses`), orderBy("sortDate", "desc")); 
    const snap = await getDocs(q); 
    allCoursesInCategory = snap.docs.map(d => ({id:d.id, ...d.data()})); 
    
    renderCategoryChart(); 
    
    const upContainer = document.getElementById('list-courses-upcoming'); 
    const pastContainer = document.getElementById('list-courses-past'); 
    upContainer.innerHTML = ""; pastContainer.innerHTML = ""; 
    
    const todayStr = getTodaySortDate();

    allCoursesInCategory.forEach(course => { 
        const d = document.createElement('div'); 
        d.className = 'card'; 
        d.onclick = () => { currentCourse = course; loadAttendance(); }; 
        d.innerHTML = `<div class="card-title">${formatFrenchDate(course.date)} à ${course.time}</div>
        <div class="card-actions">
            <button class="btn-small" onclick="event.stopPropagation(); openCourseModal('${course.id}', '${course.date}', '${course.time}')">✏️ Modifier</button>
            <button class="btn-small" onclick="event.stopPropagation(); deleteCourse('${course.id}')">🗑️ Suppr.</button>
        </div>`; 
        
        if (course.sortDate >= todayStr) upContainer.appendChild(d);
        else pastContainer.appendChild(d);
    }); 
};

// --- LICENCIÉS & LISTE D'APPEL ---
async function findExistingMemberInYear(lastName, firstName) {
    const catsSnap = await getDocs(collection(db, `years/${currentYear.id}/categories`));
    for (let cat of catsSnap.docs) {
        if (cat.id === currentCategory.id) continue; 
        const membersSnap = await getDocs(collection(db, `years/${currentYear.id}/categories/${cat.id}/members`));
        for (let mDoc of membersSnap.docs) {
            const m = mDoc.data();
            if (m.lastName === lastName && m.firstName.toLowerCase() === firstName.toLowerCase()) {
                return { categoryName: cat.data().name, data: m };
            }
        }
    }
    return null;
}

window.saveMember = async () => {
    const lastName = document.getElementById('member-lastname').value.trim().toUpperCase();
    const firstName = document.getElementById('member-firstname').value.trim();
    const dobInput = document.getElementById('member-dob').value;
    const roleElement = document.querySelector('input[name="member-role"]:checked');
    const role = roleElement ? roleElement.value : 'eleve';
    
    if (!lastName || !firstName) return alert("Le nom et le prénom sont obligatoires.");

    // Anti-doublon dans la même catégorie
    const currentCatMembersSnap = await getDocs(collection(db, `years/${currentYear.id}/categories/${currentCategory.id}/members`));
    let isDuplicate = false;
    currentCatMembersSnap.forEach(docSnap => {
        const m = docSnap.data();
        if (m.lastName === lastName && m.firstName.toLowerCase() === firstName.toLowerCase() && docSnap.id !== editingMemberId) isDuplicate = true;
    });
    if (isDuplicate) return alert("Action impossible : Cette personne est déjà inscrite dans cette catégorie.");

    let dob = ""; 
    if (dobInput) { 
        const parts = dobInput.split('-'); 
        dob = `${parts[2]}/${parts[1]}/${parts[0]}`; 
    }

    if (editingMemberId) {
        await updateDoc(doc(db, `years/${currentYear.id}/categories/${currentCategory.id}/members/${editingMemberId}`), { lastName, firstName, dob, role });
    } else {
        const existing = await findExistingMemberInYear(lastName, firstName);
        let isValidated = false;
        if (existing) {
            if (confirm(`Cette personne existe déjà dans la catégorie "${existing.categoryName}".\nVoulez-vous importer ses données de naissance et de validation ?`)) {
                dob = existing.data.dob; 
                isValidated = existing.data.isValidated;
            }
        }
        await addDoc(collection(db, `years/${currentYear.id}/categories/${currentCategory.id}/members`), { 
            lastName, firstName, dob, isValidated: isValidated, addedDate: currentCourse.sortDate, role: role 
        });
    }
    closeModals(); 
    loadAttendance();
};

window.toggleValidation = async (memberId, currentState, lastName, firstName) => {
    const newState = !currentState;
    await updateDoc(doc(db, `years/${currentYear.id}/categories/${currentCategory.id}/members/${memberId}`), { isValidated: newState });
    
    const catsSnap = await getDocs(collection(db, `years/${currentYear.id}/categories`));
    for (let cat of catsSnap.docs) {
        if (cat.id === currentCategory.id) continue;
        const q = query(collection(db, `years/${currentYear.id}/categories/${cat.id}/members`), where("lastName", "==", lastName), where("firstName", "==", firstName));
        const matchSnap = await getDocs(q);
        for (let mDoc of matchSnap.docs) { 
            await updateDoc(doc(db, `years/${currentYear.id}/categories/${cat.id}/members/${mDoc.id}`), { isValidated: newState }); 
        }
    }
    loadAttendance(); 
};

window.deleteMember = async (memberId) => { 
    if(confirm("Supprimer cette personne de cette catégorie ?")) { 
        await deleteDoc(doc(db, `years/${currentYear.id}/categories/${currentCategory.id}/members/${memberId}`)); 
        loadAttendance(); 
    } 
};

window.loadAttendance = async () => { 
    showSection('section-attendance'); 
    document.getElementById('search-bar').value = ""; 
    
    const snapMembers = await getDocs(collection(db, `years/${currentYear.id}/categories/${currentCategory.id}/members`)); 
    membersList = []; 
    snapMembers.forEach(d => { 
        const m = { id: d.id, ...d.data() }; 
        if(m.addedDate <= currentCourse.sortDate) membersList.push(m); 
    }); 
    
    membersList.sort((a, b) => a.lastName.localeCompare(b.lastName)); 
    
    // Met à jour le compteur global et la table
    updateAttendanceCounter();
    renderTable(membersList); 
};

function renderTable(list) {
    const tbody = document.getElementById('attendance-body'); 
    tbody.innerHTML = "";
    
    const encadrants = list.filter(m => m.role === 'encadrant');
    const eleves = list.filter(m => m.role !== 'encadrant');

    if (encadrants.length > 0) {
        const trSep = document.createElement('tr');
        trSep.innerHTML = `<td colspan="4" class="role-separator">🛡️ Encadrants</td>`;
        tbody.appendChild(trSep);
        encadrants.forEach(m => appendMemberRow(m, tbody));
    }

    if (eleves.length > 0) {
        const trSep = document.createElement('tr');
        trSep.innerHTML = `<td colspan="4" class="role-separator">👤 Élèves</td>`;
        tbody.appendChild(trSep);
        eleves.forEach(m => appendMemberRow(m, tbody));
    }
}

function appendMemberRow(m, tbody) {
    const isPresent = (currentCourse.attendance || {})[m.id] || false;
    const roleHtml = m.role === 'encadrant' ? '<span class="role-badge">🛡️ Encadrant</span>' : '';

    let tP = 0; 
    allCoursesInCategory.forEach(c => { if (c.attendance && c.attendance[m.id]) tP++; });
    
    let cls = 'row-new'; 
    if (m.isValidated) cls = 'row-valid'; 
    else if (tP >= 3) cls = 'row-alert';
    
    const tr = document.createElement('tr'); 
    tr.className = cls;
    tr.innerHTML = `
        <td><input type="checkbox" ${isPresent ? 'checked' : ''} onchange="togglePresence('${m.id}', this)"></td>
        <td><strong>${m.lastName}</strong> ${m.firstName} ${roleHtml}</td> 
        <td>${m.dob || '-'}</td>
        <td class="actions-menu">
            <button class="btn-small ${m.isValidated ? 'btn-invalidate' : 'btn-validate'}" onclick="toggleValidation('${m.id}', ${m.isValidated}, '${esc(m.lastName)}', '${esc(m.firstName)}')">
                ${m.isValidated ? 'Invalider ❌' : 'Valider ✅'}
            </button>
            <button class="btn-small" onclick="openMemberModal('${m.id}', '${esc(m.lastName)}', '${esc(m.firstName)}', '${m.dob || ''}', '${m.role || 'eleve'}')">✏️ Modifier</button>
            <button class="btn-small" onclick="deleteMember('${m.id}')">🗑️ Suppr.</button>
        </td>`;
    tbody.appendChild(tr);
}

window.togglePresence = async (memberId, checkbox) => {
    const isPresent = checkbox.checked;
    if (!currentCourse.attendance) currentCourse.attendance = {}; 
    currentCourse.attendance[memberId] = isPresent;
    
    const cIndex = allCoursesInCategory.findIndex(c => c.id === currentCourse.id);
    if(cIndex > -1) { 
        if (!allCoursesInCategory[cIndex].attendance) allCoursesInCategory[cIndex].attendance = {}; 
        allCoursesInCategory[cIndex].attendance[memberId] = isPresent; 
    }
    
    await updateDoc(doc(db, `years/${currentYear.id}/categories/${currentCategory.id}/courses/${currentCourse.id}`), { attendance: currentCourse.attendance });
    
    updateAttendanceCounter();
    renderTable(membersList); 
    renderCategoryChart();
};

document.getElementById('search-bar').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    renderTable(membersList.filter(m => m.lastName.toLowerCase().includes(term) || m.firstName.toLowerCase().includes(term)));
});

// --- BASES (Années, Catégories) ---
window.createYear = async () => { 
    const name = prompt("Année (ex: 2024-2025):"); 
    if (name) { 
        await addDoc(collection(db, "years"), { name, createdAt: Date.now() }); 
        loadYears(); 
    }
};

window.loadYears = async () => { 
    currentYear = null; currentCategory = null; currentCourse = null; 
    showSection('section-years'); 
    const q = query(collection(db, "years"), orderBy("createdAt", "desc")); 
    const snap = await getDocs(q); 
    const c = document.getElementById('list-years'); 
    c.innerHTML = ""; 
    snap.forEach(doc => { 
        const d = document.createElement('div'); 
        d.className = 'card'; 
        d.innerHTML = `<div class="card-title">${doc.data().name}</div>`; 
        d.onclick = () => { currentYear = {id: doc.id, ...doc.data()}; loadCategories(); }; 
        c.appendChild(d); 
    }); 
};

window.createCategory = async () => { 
    const name = prompt("Catégorie:"); 
    if (name) { 
        await addDoc(collection(db, `years/${currentYear.id}/categories`), { name, createdAt: Date.now() }); 
        loadCategories(); 
    }
};

window.editCategory = async (id, oldName) => { 
    const newName = prompt("Nouveau nom :", oldName); 
    if (newName && newName !== oldName) { 
        await updateDoc(doc(db, `years/${currentYear.id}/categories/${id}`), { name: newName }); 
        loadCategories(); 
    }
};

window.deleteCategory = async (id) => { 
    if (confirm("Voulez-vous vraiment supprimer cette catégorie ?")) { 
        await deleteDoc(doc(db, `years/${currentYear.id}/categories/${id}`)); 
        loadCategories(); 
    }
};

window.loadCategories = async () => { 
    currentCategory = null; currentCourse = null; 
    showSection('section-categories'); 
    const q = query(collection(db, `years/${currentYear.id}/categories`), orderBy("createdAt", "asc")); 
    const snap = await getDocs(q); 
    const c = document.getElementById('list-categories'); 
    c.innerHTML = ""; 
    snap.forEach(doc => { 
        const d = document.createElement('div'); 
        d.className = 'card'; 
        d.onclick = () => { currentCategory = {id: doc.id, ...doc.data()}; loadCourses(); }; 
        d.innerHTML = `<div class="card-title">${doc.data().name}</div>
        <div class="card-actions">
            <button class="btn-small" onclick="event.stopPropagation(); editCategory('${doc.id}', '${esc(doc.data().name)}')">✏️ Modifier</button>
            <button class="btn-small" onclick="event.stopPropagation(); deleteCategory('${doc.id}')">🗑️ Suppr.</button>
        </div>`; 
        c.appendChild(d); 
    }); 
};