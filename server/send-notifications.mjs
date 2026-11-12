// ===== 後端：定時發推播 =====
// 這支程式不是在手機上跑的，是 GitHub Actions 每天在雲端的電腦上執行（見 .github/workflows/notify.yml）
// 它用「服務帳戶金鑰」登入 Firebase，可以讀所有使用者的資料，所以金鑰一定要保密
//
// MODE（模式）：
//   auto：   定時執行用。看「現在台灣幾點」決定要不要發：
//            早上 8:00～11:59 → 發早安提醒；晚上 8:00～11:59 → 發晚上提醒；其他時間什麼都不做
//            同一天同一種提醒只發一次（發過的記在 Firestore 的 pushLog）
//   morning：手動執行用，馬上發早安提醒（提醒今天、明天到期和已過期的待辦事項）
//   evening：手動執行用，馬上發晚上提醒（今天還沒全部完成的話提醒）
//   test：   馬上發一則測試推播給所有裝置
//
// 為什麼要 auto：GitHub 的定時排程常常延遲好幾個小時（曾經 8 點的排程拖到凌晨 3 點才跑），
// 所以改成在提醒時段裡跑好幾次，第一次跑到的那次負責發，之後的看到「發過了」就跳過；
// 太晚才跑到（過了時段）就不發，不會半夜收到錯天的提醒

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const MODE = process.env.MODE || "test";

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error("找不到 FIREBASE_SERVICE_ACCOUNT，請到 GitHub 的 Settings → Secrets 設定");
    process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const messaging = getMessaging();

// ===== 日期小工具（一律用台灣時間） =====
// GitHub 的電腦用的是世界標準時間，台灣快 8 小時
function taiwanNow() {
    return new Date(Date.now() + 8 * 60 * 60 * 1000); // 用 getUTC… 系列讀出來就是台灣的時間
}

function taiwanToday() {
    return taiwanNow().toISOString().slice(0, 10); // "2026-11-09"
}

// 台灣現在幾點（0～23）
function taiwanHour() {
    return taiwanNow().getUTCHours();
}

function daysBetween(fromKey, toKey) {
    return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / (24 * 60 * 60 * 1000));
}

// ===== 跟網頁 script.js 一樣的判斷 =====
function isGoal(item) { return item.type === "goal"; }
function isTodo(item) { return item.type === "todo"; }

// 某個項目在那一天要不要做（待辦事項不算）
function isActiveOn(item, key) {
    if (isTodo(item)) return false;
    if (!isGoal(item)) return !item.created || key >= item.created;
    if (key < item.start || key > item.end) return false;
    // 短期目標只在有選的星期幾要做（沒有 days 的舊資料 = 每天）
    const parts = key.split("-").map(Number);
    const weekday = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    return !item.days || item.days.includes(weekday);
}

// ===== 算出要推播的內容 =====
// 回傳 { title, body }；不用推播的話回傳 null
function morningMessage(habits, records, today) {
    const lines = [];

    habits.filter(function(h) { return isTodo(h) && !h.done; }).forEach(function(todo) {
        const left = daysBetween(today, todo.end);
        if (left === 0) lines.push("⏰「" + todo.name + "」今天到期");
        else if (left === 1) lines.push("🕐「" + todo.name + "」明天到期");
        else if (left < 0) lines.push("⚠️「" + todo.name + "」已超過期限 " + (-left) + " 天");
    });

    habits.filter(isGoal).forEach(function(goal) {
        if (goal.start === today) lines.push("🚩 短期目標「" + goal.name + "」今天開始");
        if (goal.end === today) lines.push("🚩 短期目標「" + goal.name + "」今天是最後一天");
    });

    const count = habits.filter(function(h) { return isActiveOn(h, today); }).length;
    if (count === 0 && lines.length === 0) {
        return null;
    }
    return {
        title: "早安！今天有 " + count + " 項要完成 ☀️",
        body: lines.length > 0 ? lines.join("\n") : "今天也要繼續加油！"
    };
}

function eveningMessage(habits, records, today) {
    const doneIds = records[today] || [];
    const left = habits.filter(function(h) {
        return isActiveOn(h, today) && !doneIds.includes(h.id);
    });
    if (left.length === 0) {
        return null; // 全部完成了，不用吵你
    }
    const names = left.slice(0, 3).map(function(h) { return h.name; }).join("、");
    return {
        title: "今天還有 " + left.length + " 項沒完成 🌙",
        body: names + (left.length > 3 ? " 等" : "") + "，睡前記得打卡喔"
    };
}

// ===== 發推播給一個使用者的所有裝置 =====
async function sendToUser(userDoc, message) {
    const tokenDocs = (await userDoc.ref.collection("tokens").get()).docs;
    if (tokenDocs.length === 0) {
        console.log("使用者 " + userDoc.id.slice(0, 6) + "…：沒有任何裝置開啟推播，跳過");
        return;
    }

    const result = await messaging.sendEachForMulticast({
        tokens: tokenDocs.map(function(d) { return d.id; }),
        data: { title: message.title, body: message.body }, // 手機上的 Service Worker 會讀這兩個欄位
        webpush: { headers: { Urgency: "high" } }
    });
    console.log("使用者 " + userDoc.id.slice(0, 6) + "…：成功 " + result.successCount + "、失敗 " + result.failureCount);

    // 已經失效的推播代號（例如 App 被刪掉了）就從 Firestore 刪掉
    const deletes = [];
    result.responses.forEach(function(res, i) {
        const code = res.error && res.error.code;
        if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
            deletes.push(tokenDocs[i].ref.delete());
        } else if (res.error) {
            console.error("發送失敗：", code, res.error.message);
        }
    });
    await Promise.all(deletes);
}

// ===== 主程式 =====
const today = taiwanToday();
const hour = taiwanHour();
console.log("模式：" + MODE + "，台灣時間：" + today + " " + hour + " 點多");

// auto：依照現在台灣幾點，決定這次要發哪一種
let mode = MODE;
if (MODE === "auto") {
    if (hour >= 8 && hour < 12) {
        mode = "morning";
    } else if (hour >= 20) {
        mode = "evening";
    } else {
        console.log("現在不是提醒時段（早上 8～12 點、晚上 8～12 點），這次不發");
        process.exit(0);
    }

    // 今天這種提醒發過了嗎？用 create()：文件已經存在就會失敗，
    // 就算兩次排程剛好同時在跑，也只有一次能建立成功，不會重複發
    try {
        await db.collection("pushLog").doc(today + "-" + mode).create({
            mode: mode,
            sentAt: new Date()
        });
    } catch (error) {
        if (error.code === 6) { // 6 = ALREADY_EXISTS
            console.log("今天的 " + mode + " 提醒已經發過了，這次跳過");
            process.exit(0);
        }
        throw error;
    }
    console.log("今天第一次跑到 " + mode + " 時段，開始發送");
}

const users = await db.collection("users").get();
for (const userDoc of users.docs) {
    const data = userDoc.data();
    const habits = (data.habits || []).filter(function(h) { return !h.deleted; }); // 已刪除的不推播
    const records = data.records || {};

    let message = null;
    if (mode === "morning") message = morningMessage(habits, records, today);
    else if (mode === "evening") message = eveningMessage(habits, records, today);
    else message = { title: "測試推播 🎉", body: "後端推播成功！網頁關著也收得到了" };

    if (message) {
        await sendToUser(userDoc, message);
    }
}
console.log("完成");
