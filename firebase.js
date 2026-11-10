// ===== 載入 Firebase 的功能 =====
// 這個檔案是「模組」（index.html 裡用 type="module" 載入），所以可以用 import
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-messaging.js";

// 推播用的公開金鑰（VAPID），從 Firebase「專案設定 → Cloud Messaging」拿的，可以公開
const VAPID_KEY = "BL-ipkuOkuvWa7ICwciDhWhdEEjoqWrTFIC8oZs15Df0FVxlgQ8PX_1c4yySToVJqFyAO0K-IqcxmNQv1mFAbn0";

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
const db = getFirestore(app);
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

// ===== 雲端同步 =====
// 每個使用者在 Firestore 裡有一份文件：users/{使用者的 uid}
// 內容是 { habits: [...], records: {...}, updatedAt: 時間 }
// localStorage 還是繼續用，當作「這台裝置的副本」，沒網路也能打卡

let cloudRef = null;        // 目前登入者的雲端文件位置，沒登入就是 null
let stopListening = null;   // 停止監聽雲端的函式（登出時要呼叫）
let uploadTimer = null;

// 讀出這台裝置的資料（loadAllHabits、loadRecords 是 script.js 裡的函式）
function getLocalData() {
    return { habits: loadAllHabits(), records: loadRecords() }; // 含已刪除的，雲端才留得住名字
}

// 把雲端的資料寫進這台裝置，再重畫畫面
// 這裡直接用 localStorage，不用 saveHabits，不然又會傳回雲端，變成來回傳個不停
function applyCloudData(data) {
    localStorage.setItem("habits", JSON.stringify(data.habits || []));
    localStorage.setItem("records", JSON.stringify(data.records || {}));
    removeUnknownRecords(); // 有清掉東西的話會自動再傳回雲端
    render();
}

// 把資料轉成文字來比較（先把 key 排好順序，不然順序不同會被當成不一樣）
function toSortedText(value) {
    if (Array.isArray(value)) {
        return "[" + value.map(toSortedText).join(",") + "]";
    }
    if (value !== null && typeof value === "object") {
        return "{" + Object.keys(value).sort().map(function(key) {
            return JSON.stringify(key) + ":" + toSortedText(value[key]);
        }).join(",") + "}";
    }
    return JSON.stringify(value);
}

function isSameData(a, b) {
    return toSortedText({ habits: a.habits, records: a.records })
        === toSortedText({ habits: b.habits, records: b.records });
}

// 上傳這台裝置的資料到雲端
function uploadNow() {
    const data = getLocalData();
    data.updatedAt = serverTimestamp();
    return setDoc(cloudRef, data);
}

// script.js 每次存檔都會呼叫這個
// 用 setTimeout 0：同一個動作裡同時存了 habits 和 records，只會上傳一次
window.cloudSave = function() {
    if (cloudRef === null) {
        return; // 沒登入，不用上傳
    }
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(function() {
        uploadNow().catch(function(error) {
            console.error("上傳到雲端失敗", error);
        });
    }, 0);
};

// 登入後開始同步
async function startSync(user) {
    const ref = doc(db, "users", user.uid);

    // 這台裝置第一次用這個帳號同步：先比較雲端和這台裝置的資料
    if (localStorage.getItem("syncedUid") !== user.uid) {
        const snapshot = await getDoc(ref);
        const local = getLocalData();

        if (!snapshot.exists()) {
            // 雲端還沒有資料 → 把這台裝置的資料傳上去
            cloudRef = ref;
            await uploadNow();
        } else if (localStorage.getItem("habits") === null && Object.keys(local.records).length === 0) {
            // 這台裝置是全新的（還沒新增過習慣、也沒打過卡）→ 直接用雲端的，不用問
            cloudRef = ref;
            applyCloudData(snapshot.data());
        } else if (!isSameData(snapshot.data(), local)) {
            // 兩邊都有資料，而且不一樣 → 問使用者要留哪一份
            const useCloud = confirm(
                "這個帳號在雲端已經有資料，跟這台裝置的不一樣。\n\n" +
                "按「確定」：使用雲端的資料（這台裝置的資料會被取代）\n" +
                "按「取消」：用這台裝置的資料覆蓋雲端"
            );
            cloudRef = ref;
            if (useCloud) {
                applyCloudData(snapshot.data());
            } else {
                await uploadNow();
            }
        }
        localStorage.setItem("syncedUid", user.uid);
    }

    cloudRef = ref;

    // 監聽雲端：其他裝置改了資料，這裡會馬上收到並更新畫面
    stopListening = onSnapshot(ref, function(snapshot) {
        // hasPendingWrites = 這是自己剛剛上傳的，不用再寫回來
        if (!snapshot.exists() || snapshot.metadata.hasPendingWrites) {
            return;
        }
        if (!isSameData(snapshot.data(), getLocalData())) {
            applyCloudData(snapshot.data());
        }
    }, function(error) {
        console.error("讀取雲端資料失敗", error);
    });
}

function stopSync() {
    cloudRef = null;
    if (stopListening) {
        stopListening();
        stopListening = null;
    }
    // 下次登入時重新比較一次（可能換了帳號）
    localStorage.removeItem("syncedUid");
}

// ===== 推播通知 =====
// 流程：問使用者要不要允許通知 → 註冊 Service Worker → 跟 Firebase 拿這台裝置的「推播代號」(token)
//      → 存到 Firestore 的 users/{uid}/tokens/{token}，後端就知道要推播給哪些裝置
const pushInfo = document.getElementById("push-info");
const pushBtn = document.getElementById("push-btn");
let currentUser = null;

// 這個瀏覽器能不能收推播？（iPhone 要從「主畫面」打開才可以）
async function canPush() {
    if (!("serviceWorker" in navigator) || !("Notification" in window)) {
        return false;
    }
    try {
        return await isSupported();
    } catch (error) {
        return false;
    }
}

// 拿到這台裝置的推播代號，存到 Firestore
async function saveDeviceToken(user) {
    // Service Worker 檔案放在網站資料夾裡，所以用相對路徑註冊（GitHub Pages 網址有 /Daily-Check-in-System/）
    const registration = await navigator.serviceWorker.register("firebase-messaging-sw.js");
    await navigator.serviceWorker.ready;

    const token = await getToken(getMessaging(app), {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration
    });

    await setDoc(doc(db, "users", user.uid, "tokens", token), {
        token: token,
        device: navigator.userAgent, // 看得出是哪一種裝置，方便之後整理
        updatedAt: serverTimestamp()
    });
    return registration;
}

// 依照現在的狀態，更新推播區塊的文字和按鈕
async function updatePushArea(user) {
    currentUser = user;
    pushBtn.hidden = true;

    if (!user) {
        pushInfo.textContent = "請先登入，才能開啟推播通知";
        return;
    }
    if (!(await canPush())) {
        pushInfo.textContent = "這裡不能收推播。iPhone 請用 Safari 的「分享 → 加入主畫面」，再從主畫面的圖示打開";
        return;
    }
    if (Notification.permission === "denied") {
        pushInfo.textContent = "通知被封鎖了。請到手機的「設定 → 通知 → 每日打卡」打開";
        return;
    }
    if (Notification.permission === "granted") {
        pushInfo.textContent = "已開啟：這台裝置會在早上 8 點、晚上 8 點收到提醒";
        // 推播代號偶爾會更換，每次打開都重新存一次，確保是最新的
        saveDeviceToken(user).catch(function(error) {
            console.error("更新推播代號失敗", error);
        });
        return;
    }
    pushInfo.textContent = "還沒開啟。開啟後，網頁關著也會收到提醒";
    pushBtn.hidden = false;
}

pushBtn.addEventListener("click", async function() {
    if (!currentUser) {
        return;
    }
    // 一定要在「按按鈕」的時候才問，iPhone 不允許自動跳出詢問
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
        updatePushArea(currentUser);
        return;
    }
    try {
        pushInfo.textContent = "設定中…";
        const registration = await saveDeviceToken(currentUser);
        // 馬上顯示一則通知，確認這台裝置真的可以顯示
        registration.showNotification("通知已開啟 🎉", {
            body: "之後會在早上 8 點、晚上 8 點提醒你打卡",
            icon: "icon-192.png"
        });
    } catch (error) {
        console.error(error);
        alert("開啟推播失敗：" + error.message);
    }
    updatePushArea(currentUser);
});

// ===== 登入狀態改變時，更新畫面 =====
// 打開網頁、登入、登出的時候都會自動執行；user 是登入的人，沒登入就是 null
onAuthStateChanged(auth, async function(user) {
    updatePushArea(user);
    if (user) {
        userInfo.textContent = "已登入：" + user.displayName + "（同步中…）";
        loginBtn.hidden = true;
        logoutBtn.hidden = false;
        try {
            await startSync(user);
            userInfo.textContent = "已登入：" + user.displayName + "（資料會自動同步）";
        } catch (error) {
            console.error(error);
            cloudRef = null; // 同步失敗就先不要上傳，避免一直出錯
            userInfo.textContent = "已登入：" + user.displayName + "（同步失敗，資料只存在這台裝置）";
        }
    } else {
        stopSync();
        userInfo.textContent = "尚未登入，資料只存在這台裝置";
        loginBtn.hidden = false;
        logoutBtn.hidden = true;
    }
});
