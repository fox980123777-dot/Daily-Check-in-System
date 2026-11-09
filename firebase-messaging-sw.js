// ===== Service Worker：在背景接收推播 =====
// 這個檔案跟網頁分開執行：就算網頁關掉了，手機收到推播時也會叫醒它
// 它看不到網頁上的畫面和變數，只能做「顯示通知」這種事

// 收到推播 → 顯示通知
// 後端傳來的內容放在 data 裡：{ data: { title: "標題", body: "內容" } }
self.addEventListener("push", function(event) {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (error) {
        payload = {};
    }
    const data = payload.data || {};

    // iPhone 規定：收到推播一定要顯示通知，不然之後會被停止推播
    event.waitUntil(
        self.registration.showNotification(data.title || "每日打卡", {
            body: data.body || "",
            icon: "icon-192.png",
            badge: "icon-192.png"
        })
    );
});

// 點通知 → 打開 App（已經開著的話就切過去）
self.addEventListener("notificationclick", function(event) {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(windows) {
            if (windows.length > 0) {
                return windows[0].focus();
            }
            return clients.openWindow("./");
        })
    );
});
