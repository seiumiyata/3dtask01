import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// モジュールスコープの関数をグローバル(window)に公開して、他のスクリプトから使えるようにします
window.fbDoc = doc;
window.fbGetDoc = getDoc;
window.fbSetDoc = setDoc;

window.db = null;
window.auth = null;
window.user = null;
window.appId = typeof __app_id !== 'undefined' ? __app_id : '3d-task-app';

const initPersistence = async () => {
    if (typeof __firebase_config === 'undefined') {
        console.warn("Persistence config not found. Running in local-only mode.");
        // Firebaseがない場合は、即座にローカルロードを開始するイベントを発火
        window.dispatchEvent(new CustomEvent('auth-ready'));
        return;
    }

    try {
        const firebaseConfig = JSON.parse(__firebase_config);
        const app = initializeApp(firebaseConfig);
        window.auth = getAuth(app);
        window.db = getFirestore(app);

        // Authentication
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(window.auth, __initial_auth_token);
        } else {
            await signInAnonymously(window.auth);
        }

        onAuthStateChanged(window.auth, (u) => {
            window.user = u;
            if (u) {
                window.dispatchEvent(new CustomEvent('auth-ready'));
            }
        });
    } catch (err) {
        console.error("Persistence init failed:", err);
    }
};

initPersistence();
