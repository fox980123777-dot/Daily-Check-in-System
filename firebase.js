// ===== 載入 Firebase 的功能 =====
// 這個檔案是「模組」（index.html 裡用 type="module" 載入），所以可以用 import
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

// ===== 專案設定（從 Firebase 網站複製的，這些是公開的，不是密碼） =====
const firebaseConfig = {
    apiKey: "AIzaSyB9vAIWB1ieQww68xXb2EIf4f9cwSwWL04",
    authDomain: "daily-checkin-6e644.firebaseapp.com",
    projectId: "daily-checkin-6e644",
    storageBucket: "daily-checkin-6e644.firebasestorage.app",
    messagingSenderId: "458942709043",
    appId: "1:458942709043:web:454b2c53dfb436b94d5246"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const userInfo = document.getElementById("user-info");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");

// ===== 登入 =====
// 登入要等使用者在彈出視窗選帳號，所以用 async / await「等它做完」
loginBtn.addEventListener("click", async function() {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        // 使用者自己把視窗關掉，不算錯誤，不用跳提示
        if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") {
            return;
        }
        console.error(error);
        alert("登入失敗：" + error.message);
    }
});

// ===== 登出 =====
logoutBtn.addEventListener("click", function() {
    signOut(auth);
});

// ===== 登入狀態改變時，更新畫面 =====
// 打開網頁、登入、登出的時候都會自動執行；user 是登入的人，沒登入就是 null
onAuthStateChanged(auth, function(user) {
    if (user) {
        userInfo.textContent = "已登入：" + user.displayName;
        loginBtn.hidden = true;
        logoutBtn.hidden = false;
    } else {
        userInfo.textContent = "尚未登入，資料只存在這台裝置";
        loginBtn.hidden = false;
        logoutBtn.hidden = true;
    }
});
