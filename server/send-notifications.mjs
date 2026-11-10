// ===== 後端：定時發推播 =====
// 這支程式不是在手機上跑的，是 GitHub Actions 每天在雲端的電腦上執行（見 .github/workflows/notify.yml）
// 它用「服務帳戶金鑰」登入 Firebase，可以讀所有使用者的資料，所以金鑰一定要保密
//
// MODE（模式）：
//   morning：早上 8 點，提醒今天、明天到期和已過期的待辦事項
//   evening：晚上 8 點，今天還沒全部完成的話提醒
//   test：   馬上發一則測試推播給所有裝置

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
function taiwanToday() {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); // "2026-11-09"
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
console.log("模式：" + MODE + "，台灣日期：" + today);

const users = await db.collection("users").get();
for (const userDoc of users.docs) {
    const data = userDoc.data();
    const habits = (data.habits || []).filter(function(h) { return !h.deleted; }); // 已刪除的不推播
    const records = data.records || {};

    let message = null;
    if (MODE === "morning") message = morningMessage(habits, records, today);
    else if (MODE === "evening") message = eveningMessage(habits, records, today);
    else message = { title: "測試推播 🎉", body: "後端推播成功！網頁關著也收得到了" };

    if (message) {
        await sendToUser(userDoc, message);
    }
}
console.log("完成");
