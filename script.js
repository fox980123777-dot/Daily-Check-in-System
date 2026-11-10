// ===== 版本號 =====
// 要跟 index.html 裡的 ?v= 數字一樣；設定頁最下面會顯示，用來確認手機是不是已經更新到新版
const APP_VERSION = 17;

// ===== 第一次使用時的預設習慣 =====
// id：電腦用來分辨習慣的代號；icon：Lucide 圖示的名字（https://lucide.dev/icons）
// 短期目標也放在同一個清單裡，只是多了 type: "goal"、start（開始日期）、end（結束日期）
const DEFAULT_HABITS = [
    { id: "read",   name: "閱讀 30 分鐘",     note: "每日學習",     icon: "book-open" },
    { id: "sport",  name: "運動 20 分鐘",     note: "保持健康",     icon: "dumbbell" },
    { id: "eng",    name: "學習英文",         note: "每天 10 個單字", icon: "languages" },
    { id: "water",  name: "喝水 2000 ml",     note: "健康生活",     icon: "droplet" },
    { id: "sleep",  name: "晚上 11 點前睡覺", note: "規律作息",     icon: "moon" }
];

// 舊版圖示名字 → Lucide 的名字（已經存在手機裡的舊資料才能顯示正確圖示）
const OLD_ICON_NAMES = { book: "book-open", language: "languages", drop: "droplet" };

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

// ===== 讀取、儲存資料 =====
// habits：習慣 + 短期目標清單（陣列）
// records：每天完成了哪些項目，例如 { "2026-11-08": ["read", "sport"] }
function loadHabits() {
    const saved = localStorage.getItem("habits");
    if (saved === null) {
        return DEFAULT_HABITS;
    }
    return JSON.parse(saved);
}

function saveHabits(habits) {
    localStorage.setItem("habits", JSON.stringify(habits));
    uploadToCloud();
}

function loadRecords() {
    const saved = localStorage.getItem("records");
    if (saved === null) {
        return {};
    }
    return JSON.parse(saved);
}

function saveRecords(records) {
    localStorage.setItem("records", JSON.stringify(records));
    uploadToCloud();
}

// 有登入的話，順便把資料傳到雲端（cloudSave 是 firebase.js 提供的，沒登入時不存在）
function uploadToCloud() {
    if (window.cloudSave) {
        window.cloudSave();
    }
}

// ===== 日期小工具 =====

// 把日期轉成 "2026-11-08" 這種文字，方便存起來和比較
function toDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0"); // 月份從 0 開始，所以要 +1
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
}

// 反過來：把 "2026-11-08" 變回日期（時間是當天 00:00）
function fromDateKey(key) {
    const parts = key.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

// 兩個日期相差幾天
function daysBetween(a, b) {
    return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

// 「11 月 8 日，星期日」
function formatDate(date) {
    return (date.getMonth() + 1) + " 月 " + date.getDate() + " 日，星期" + WEEKDAYS[date.getDay()];
}

// 某一天有沒有打卡成功：那天要做的項目「全部完成（100%）」才算
function hasCheckin(records, date) {
    const key = toDateKey(date);
    const doneIds = records[key] || [];

    // 舊版（第 4 階段）的紀錄只知道「有打卡」，照樣算成功，連續天數才不會斷掉
    if (doneIds.includes("old-checkin")) {
        return true;
    }

    // 那天需要做的項目（習慣 + 期間內的短期目標）
    const items = loadHabits().filter(function(h) { return isActiveOn(h, key); });
    if (items.length === 0) {
        return false;
    }
    // every：每一個都符合才會是 true
    return items.every(function(h) { return doneIds.includes(h.id); });
}

// 計算連續打卡天數
function countStreak(records) {
    const day = new Date();

    // 今天還沒打卡的話，從昨天開始往回算（今天還有機會打，連續紀錄不算斷）
    if (!hasCheckin(records, day)) {
        day.setDate(day.getDate() - 1);
    }

    let count = 0;
    while (hasCheckin(records, day)) {
        count = count + 1;
        day.setDate(day.getDate() - 1);
    }
    return count;
}

// ===== 短期目標 =====

function isGoal(item) {
    return item.type === "goal";
}

// 短期目標可以只在每週某幾天做：days 是星期的數字（0 = 日、1 = 一 … 6 = 六）
// 舊資料沒有 days，就當作每天都要做
function isGoalDay(goal, key) {
    return !goal.days || goal.days.includes(fromDateKey(key).getDay());
}

// 「每週一、三、五」；每天都要做的話回傳空字串（不用特別顯示）
function goalDaysText(goal) {
    if (!goal.days || goal.days.length === 7) {
        return "";
    }
    return "每週" + goal.days.map(function(d) { return WEEKDAYS[d]; }).join("、");
}

// ===== 待辦事項 =====
// 跟短期目標一樣有開始日期、期限（start、end）和進度條
// 不一樣的地方：打勾後記在 item.done（那天的日期），到了隔天就從今日頁消失
// 待辦事項不算進「今日完成進度」、打卡成功和統計
function isTodo(item) {
    return item.type === "todo";
}

// 每天都要做的長期習慣（不是短期目標、也不是待辦事項）
function isDailyHabit(item) {
    return !isGoal(item) && !isTodo(item);
}

// 今日頁要不要顯示：還沒完成，或是今天才完成的（今天還可以取消打勾）
function isTodoVisible(todo) {
    return !todo.done || todo.done === toDateKey(new Date());
}

// 算出待辦事項的時間進度，格式跟 goalInfo 一樣
function todoInfo(todo) {
    const info = goalInfo(todo);
    const today = fromDateKey(toDateKey(new Date()));
    const late = daysBetween(fromDateKey(todo.end), today); // 超過期限幾天

    if (late > 0) {
        // 過了期限還是可以打勾，只是提醒已經超過
        return { active: true, percent: 100, text: "已超過期限 " + late + " 天" };
    }
    if (info.active) {
        info.text = info.text.replace("今天是最後一天！", "今天是期限！");
    }
    return info;
}

// 待辦事項打勾 / 取消
function toggleTodo(id) {
    const habits = loadHabits();
    const todo = habits.find(function(h) { return h.id === id; });
    const today = toDateKey(new Date());

    if (todo.done === today) {
        delete todo.done; // 今天按錯了，可以反悔
    } else {
        todo.done = today;
    }

    saveHabits(habits);
    render();
}

// 算出短期目標的時間進度
// 回傳：active（今天在期間內嗎）、percent（進度條要多長）、text（顯示的文字）
function goalInfo(goal) {
    const today = fromDateKey(toDateKey(new Date()));
    const start = fromDateKey(goal.start);
    const end = fromDateKey(goal.end);
    const total = daysBetween(start, end) + 1; // 頭尾都算，所以 +1
    const dayNumber = daysBetween(start, today) + 1; // 今天是第幾天

    if (dayNumber < 1) {
        return { active: false, percent: 0, text: "還有 " + (1 - dayNumber) + " 天開始 · 共 " + total + " 天" };
    }
    if (dayNumber > total) {
        return { active: false, percent: 100, text: "已結束 · 共 " + total + " 天" };
    }

    const left = total - dayNumber;
    let text = "第 " + dayNumber + " / " + total + " 天 · ";
    text = text + (left === 0 ? "今天是最後一天！" : "剩 " + left + " 天");

    // 有選每週幾的話，前面加上「每週一、三」；今天不是要做的日子 → 休息，不能打卡
    const daysText = goalDaysText(goal);
    if (daysText !== "") {
        text = daysText + " · " + text;
    }
    if (!isGoalDay(goal, toDateKey(new Date()))) {
        return { active: false, percent: dayNumber / total * 100, text: "今天休息 · " + text };
    }
    return { active: true, percent: dayNumber / total * 100, text: text };
}

// 舊版（第 4 階段）只存「哪幾天有打卡」，把它搬到新的格式，連續天數才不會歸零
function migrateOldData() {
    const old = localStorage.getItem("checkins");
    if (old === null) {
        return;
    }
    const records = loadRecords();
    JSON.parse(old).forEach(function(date) {
        if (records[date] === undefined) {
            records[date] = ["old-checkin"];
        }
    });
    saveRecords(records);
    localStorage.removeItem("checkins");
    localStorage.removeItem("lastCheckinTime");
    localStorage.removeItem("checkedIn");
}

// ===== 做出畫面上的小零件 =====

// 做出一個小圖示，例如 makeIcon("book-open")
// 先放一個 <i data-lucide="...">，等 render() 最後呼叫 lucide.createIcons() 才會變成真的圖示
function makeIcon(name) {
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", OLD_ICON_NAMES[name] || name);
    return icon;
}

// 做出名稱 + 小字說明
function makeHabitText(name, note) {
    const box = document.createElement("span");
    box.className = "habit-text";

    const nameEl = document.createElement("span");
    nameEl.className = "habit-name";
    nameEl.textContent = name; // 用 textContent，使用者打什麼字都會原樣顯示，不會被當成程式
    box.appendChild(nameEl);

    if (note) {
        const noteEl = document.createElement("span");
        noteEl.className = "habit-note";
        noteEl.textContent = note;
        box.appendChild(noteEl);
    }
    return box;
}

// 做出一個進度條，percent 是 0 ~ 100
function makeBar(percent, extraClass) {
    const bar = document.createElement("span");
    bar.className = "bar " + extraClass;
    bar.style.display = "block";
    const fill = document.createElement("span");
    fill.className = "bar-fill";
    fill.style.display = "block";
    fill.style.width = percent + "%";
    bar.appendChild(fill);
    return bar;
}

// 做出一列可以點的項目（習慣、短期目標都用這個）
function makeRow(item, isDone) {
    const button = document.createElement("button");
    button.className = "habit";
    button.appendChild(makeIcon(item.icon));

    if (isGoal(item) || isTodo(item)) {
        const info = isTodo(item) ? todoInfo(item) : goalInfo(item);
        // 有寫說明的話：「說明 · 第 7 / 21 天 · 剩 14 天」
        const text = makeHabitText(item.name, item.note ? item.note + " · " + info.text : info.text);
        text.appendChild(makeBar(info.percent, "goal-bar"));
        button.appendChild(text);
        button.disabled = !info.active; // 還沒開始或已結束，就不能打卡
    } else {
        button.appendChild(makeHabitText(item.name, item.note));
    }

    // 右邊：完成 → 打勾圖示；沒完成 → 灰色圓點
    if (isDone) {
        button.appendChild(makeIcon("circle-check"));
    } else {
        const dot = document.createElement("span");
        dot.className = "dot";
        button.appendChild(dot);
    }

    button.addEventListener("click", function() {
        if (isTodo(item)) {
            toggleTodo(item.id);
        } else {
            toggleHabit(item.id);
        }
    });

    const li = document.createElement("li");
    li.appendChild(button);
    return li;
}

function makeEmpty(text) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = text;
    return li;
}

// ===== 畫出每一頁 =====

function renderToday() {
    const now = new Date();
    const habits = loadHabits();
    const records = loadRecords();
    const doneToday = records[toDateKey(now)] || [];

    const dailyHabits = habits.filter(isDailyHabit);
    const goals = habits.filter(isGoal);
    const todos = habits.filter(function(h) { return isTodo(h) && isTodoVisible(h); });

    document.getElementById("date").textContent = formatDate(now);

    // 今日進度：每天的習慣 + 今天在期間內的短期目標
    const todayItems = dailyHabits.concat(goals.filter(function(g) {
        return goalInfo(g).active;
    }));
    const doneCount = todayItems.filter(function(h) {
        return doneToday.includes(h.id);
    }).length;
    const total = todayItems.length;

    document.getElementById("progress-count").textContent = doneCount + " / " + total;
    document.getElementById("bar-fill").style.width =
        (total === 0 ? 0 : doneCount / total * 100) + "%";
    document.getElementById("streak").textContent = "已連續打卡 " + countStreak(records) + " 天";

    document.getElementById("greeting").textContent =
        (total > 0 && doneCount === total) ? "今天全部完成了，太棒了！🎉" : "今天也要繼續加油！";

    // 我的習慣
    const habitList = document.getElementById("habit-list");
    habitList.innerHTML = ""; // 先清空，再一個一個加回去
    if (dailyHabits.length === 0) {
        habitList.appendChild(makeEmpty("還沒有習慣，按右邊 ⊕ 新增一個吧"));
    }
    dailyHabits.forEach(function(habit) {
        habitList.appendChild(makeRow(habit, doneToday.includes(habit.id)));
    });

    // 短期進度
    const goalList = document.getElementById("goal-list");
    goalList.innerHTML = "";
    if (goals.length === 0) {
        goalList.appendChild(makeEmpty("還沒有短期目標，按右邊 ⊕ 新增一個吧"));
    }
    goals.forEach(function(goal) {
        goalList.appendChild(makeRow(goal, doneToday.includes(goal.id)));
    });

    // 待辦事項
    const todoList = document.getElementById("todo-list");
    todoList.innerHTML = "";
    if (todos.length === 0) {
        todoList.appendChild(makeEmpty("沒有待辦事項，按右邊 ⊕ 新增一個吧"));
    }
    todos.forEach(function(todo) {
        todoList.appendChild(makeRow(todo, todo.done !== undefined));
    });
}

// 日曆現在顯示哪個月、點選了哪一天
const calendarMonth = new Date();
calendarMonth.setDate(1);
let selectedDay = toDateKey(new Date());

function renderCalendar() {
    const records = loadRecords();
    const habits = loadHabits();
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const todayKey = toDateKey(new Date());

    document.getElementById("cal-title").textContent = year + " 年 " + (month + 1) + " 月";

    const grid = document.getElementById("cal-days");
    grid.innerHTML = "";

    // 1 號之前的空格（例如 1 號是星期三，前面就要空 3 格）
    const firstWeekday = new Date(year, month, 1).getDay();
    for (let i = 0; i < firstWeekday; i++) {
        grid.appendChild(document.createElement("span"));
    }

    // 這個月有幾天：下個月的第 0 天 = 這個月的最後一天
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let checkinDays = 0;

    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month, d);
        const key = toDateKey(date);

        const cell = document.createElement("button");
        cell.className = "cal-day";
        cell.textContent = d;

        if (hasCheckin(records, date)) {
            cell.classList.add("done");
            checkinDays = checkinDays + 1;
        } else if (records[key] !== undefined) {
            cell.classList.add("partial"); // 有做一些，但還沒 100%
        }
        if (key === todayKey) {
            cell.classList.add("today");
        }
        if (key > todayKey) {
            cell.classList.add("future"); // "2026-11-09" > "2026-11-08"，日期文字可以直接比大小
        }
        if (key === selectedDay) {
            cell.classList.add("selected");
        }

        cell.addEventListener("click", function() {
            selectedDay = key;
            render();
        });
        grid.appendChild(cell);
    }

    document.getElementById("cal-summary").textContent = "這個月打卡 " + checkinDays + " 天";

    // 下面列出點選那天完成了什麼
    document.getElementById("day-title").textContent = formatDate(fromDateKey(selectedDay));
    const list = document.getElementById("day-list");
    list.innerHTML = "";
    const doneIds = records[selectedDay] || [];

    if (doneIds.length === 0) {
        list.appendChild(makeEmpty("這天沒有打卡"));
    }
    doneIds.forEach(function(id) {
        const item = habits.find(function(h) { return h.id === id; });
        const row = document.createElement("li");
        row.className = "setting-row";
        if (item) {
            row.appendChild(makeIcon(item.icon));
            row.appendChild(makeHabitText(item.name, isGoal(item) ? "短期目標" : item.note));
        } else {
            // 舊版的打卡，或已經被刪掉的習慣
            row.appendChild(makeIcon("circle-check"));
            row.appendChild(makeHabitText(id === "old-checkin" ? "有打卡" : "已刪除的項目", id === "old-checkin" ? "舊版紀錄" : ""));
        }
        list.appendChild(row);
    });
}

function renderSettings() {
    const habits = loadHabits();
    const list = document.getElementById("manage-list");
    list.innerHTML = "";

    if (habits.length === 0) {
        list.appendChild(makeEmpty("沒有任何項目"));
    }

    habits.forEach(function(item) {
        const row = document.createElement("li");
        row.className = "setting-row";
        row.appendChild(makeIcon(item.icon));

        let note = item.note;
        if (isGoal(item)) {
            note = "短期目標 · " + item.start.slice(5).replace("-", "/") + " ~ " + item.end.slice(5).replace("-", "/");
            if (goalDaysText(item) !== "") {
                note = note + " · " + goalDaysText(item);
            }
        }
        if (isTodo(item)) {
            note = item.done
                ? "待辦事項 · " + item.done.slice(5).replace("-", "/") + " 已完成"
                : "待辦事項 · 期限 " + item.end.slice(5).replace("-", "/");
        }
        row.appendChild(makeHabitText(item.name, note));

        const edit = document.createElement("button");
        edit.className = "edit-btn";
        edit.textContent = "編輯";
        edit.addEventListener("click", function() {
            openAddDialog(item.type || "habit", item);
        });
        row.appendChild(edit);

        const del = document.createElement("button");
        del.className = "delete-btn";
        del.textContent = "刪除";
        del.addEventListener("click", function() {
            deleteHabit(item);
        });
        row.appendChild(del);

        list.appendChild(row);
    });
}

// ===== 統計頁 =====
let statsRange = "week"; // "week" = 本週、"month" = 本月

// 某個項目在那一天要不要做？習慣每天都要；短期目標只有在期間內才要
function isActiveOn(item, key) {
    if (isTodo(item)) {
        return false; // 待辦事項不算進打卡和統計
    }
    if (!isGoal(item)) {
        // 建立之前的日子不用做（沒有 created 的話就當作一直都有）
        return !item.created || key >= item.created;
    }
    // 日期文字可以直接比大小；還要是有選的星期幾
    return key >= item.start && key <= item.end && isGoalDay(item, key);
}

// 「2026/11/2」
function slashDate(key) {
    const date = fromDateKey(key);
    return date.getFullYear() + "/" + (date.getMonth() + 1) + "/" + date.getDate();
}

// 算出一個習慣從開始到現在的紀錄
function habitHistory(habit, records) {
    const today = fromDateKey(toDateKey(new Date()));

    // 某一天有沒有做這個習慣
    function doneOn(date) {
        return (records[toDateKey(date)] || []).includes(habit.id);
    }

    // 第幾天：開始那天算第 1 天
    const dayNumber = daysBetween(fromDateKey(habit.created), today) + 1;

    // 累計完成：所有紀錄裡有這個習慣的天數
    let totalDone = 0;
    Object.keys(records).forEach(function(key) {
        if (records[key].includes(habit.id)) {
            totalDone = totalDone + 1;
        }
    });

    // 目前連續：跟首頁的連續天數一樣，今天還沒做就從昨天開始往回數
    let streak = 0;
    const day = new Date(today);
    if (!doneOn(day)) {
        day.setDate(day.getDate() - 1);
    }
    while (doneOn(day)) {
        streak = streak + 1;
        day.setDate(day.getDate() - 1);
    }

    // 停滯：今天還沒做的話，從昨天往回數「連續幾天沒做」（不算開始之前的日子）
    let stalled = 0;
    if (!doneOn(today)) {
        const d = new Date(today);
        d.setDate(d.getDate() - 1);
        while (toDateKey(d) >= habit.created && !doneOn(d)) {
            stalled = stalled + 1;
            d.setDate(d.getDate() - 1);
        }
    }

    return { dayNumber: dayNumber, totalDone: totalDone, streak: streak, stalled: stalled };
}

// 小數字 + 下面的說明文字
function makeNumber(value, name, warn) {
    const box = document.createElement("div");
    const num = document.createElement("span");
    num.className = "stats-num";
    if (warn) {
        num.classList.add("warn");
    }
    num.textContent = value;
    const label = document.createElement("span");
    label.className = "stats-name";
    label.textContent = name;
    box.appendChild(num);
    box.appendChild(label);
    return box;
}

function renderHistory(habits, records) {
    const list = document.getElementById("history-list");
    list.innerHTML = "";
    const dailyHabits = habits.filter(isDailyHabit);

    if (dailyHabits.length === 0) {
        list.appendChild(makeEmpty("還沒有長期習慣"));
    }

    dailyHabits.forEach(function(habit) {
        const info = habitHistory(habit, records);

        const card = document.createElement("li");
        card.className = "history-card";

        const head = document.createElement("div");
        head.className = "history-head";
        head.appendChild(makeIcon(habit.icon));
        head.appendChild(makeHabitText(habit.name, "從 " + slashDate(habit.created) + " 開始 · 第 " + info.dayNumber + " 天"));
        card.appendChild(head);

        const numbers = document.createElement("div");
        numbers.className = "stats-numbers";
        numbers.appendChild(makeNumber(info.streak + " 天", "目前連續", false));
        numbers.appendChild(makeNumber(info.totalDone + " 天", "累計完成", false));
        numbers.appendChild(makeNumber(info.stalled + " 天", "停滯", info.stalled >= 3)); // 停 3 天以上變橘色
        card.appendChild(numbers);

        list.appendChild(card);
    });
}

// 本週（星期一 ~ 星期日）或本月（1 號 ~ 月底）的每一天
function getStatsDays(range) {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const days = [];

    if (range === "week") {
        // getDay()：星期日 = 0、星期一 = 1 …，算出今天離星期一幾天
        const fromMonday = (today.getDay() + 6) % 7;
        for (let i = 0; i < 7; i++) {
            // new Date 的日期超過月底或小於 1，會自動換到隔壁的月份
            days.push(new Date(year, month, today.getDate() - fromMonday + i));
        }
    } else {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
            days.push(new Date(year, month, d));
        }
    }
    return days;
}

// 「11/9（一）」
function shortDate(date) {
    return (date.getMonth() + 1) + "/" + date.getDate() + "（" + WEEKDAYS[date.getDay()] + "）";
}

// 長條圖的一欄
function makeChartColumn(label, percent, isToday, isFuture) {
    const col = document.createElement("div");
    col.className = "chart-col";
    if (isToday) {
        col.classList.add("today");
    }
    if (isFuture) {
        col.classList.add("future");
    }

    const track = document.createElement("div");
    track.className = "chart-track";
    const fill = document.createElement("div");
    fill.className = "chart-fill";
    fill.style.height = percent + "%";
    track.appendChild(fill);
    col.appendChild(track);

    const text = document.createElement("span");
    text.className = "chart-label";
    text.textContent = label;
    col.appendChild(text);
    return col;
}

function renderStats() {
    const habits = loadHabits();
    const records = loadRecords();
    const todayKey = toDateKey(new Date());
    const days = getStatsDays(statsRange);

    // 上方的日期範圍
    const first = days[0];
    const last = days[days.length - 1];
    let rangeText;
    if (statsRange === "week") {
        rangeText = shortDate(first) + " ~ " + shortDate(last);
    } else {
        rangeText = first.getFullYear() + " 年 " + (first.getMonth() + 1) + " 月";
    }
    document.getElementById("stats-range").textContent = rangeText + " · 統計到今天";

    // 一天一天看：那天要做幾項、做到幾項
    const chart = document.getElementById("stats-chart");
    chart.innerHTML = "";
    chart.classList.toggle("month", statsRange === "month");

    let doneTotal = 0;     // 總共完成幾次
    let needTotal = 0;     // 總共應該做幾次
    let checkinDays = 0;   // 打卡成功（100%）的天數
    let run = 0;           // 數到目前為止連續成功幾天
    let bestRun = 0;       // 這段時間最長連續成功幾天

    days.forEach(function(date) {
        const key = toDateKey(date);
        const isFuture = key > todayKey;
        const items = habits.filter(function(h) { return isActiveOn(h, key); });
        const doneIds = records[key] || [];
        const done = items.filter(function(h) { return doneIds.includes(h.id); }).length;

        if (!isFuture) {
            doneTotal = doneTotal + done;
            needTotal = needTotal + items.length;
            if (hasCheckin(records, date)) {
                checkinDays = checkinDays + 1;
                run = run + 1;
                bestRun = Math.max(bestRun, run);
            } else if (key !== todayKey) {
                run = 0; // 中斷了，重新數（今天還沒完成不算中斷）
            }
        }

        // 本週顯示星期幾；本月只標 1、5、10、15… 號，不然字會擠在一起
        let label = "";
        if (statsRange === "week") {
            label = WEEKDAYS[date.getDay()];
        } else if (date.getDate() === 1 || date.getDate() % 5 === 0) {
            label = date.getDate();
        }

        const percent = (isFuture || items.length === 0) ? 0 : done / items.length * 100;
        chart.appendChild(makeChartColumn(label, percent, key === todayKey, isFuture));
    });

    const rate = needTotal === 0 ? 0 : Math.round(doneTotal / needTotal * 100);
    const pastDays = days.filter(function(d) { return toDateKey(d) <= todayKey; }).length;

    document.getElementById("stats-rate").textContent = rate + "%";
    document.getElementById("stats-bar").style.width = rate + "%";
    document.getElementById("stats-done").textContent = doneTotal;
    document.getElementById("stats-days").textContent = checkinDays + " / " + pastDays;
    document.getElementById("stats-best").textContent = bestRun + " 天";

    // 各項目完成率：只算到今天為止、而且那天需要做的日子
    const pastKeys = days.map(toDateKey).filter(function(k) { return k <= todayKey; });
    const list = document.getElementById("stats-list");
    list.innerHTML = "";

    habits.forEach(function(item) {
        const needKeys = pastKeys.filter(function(k) { return isActiveOn(item, k); });
        if (needKeys.length === 0) {
            return; // 短期目標在這段時間還沒開始，就不列出來
        }
        const doneDays = needKeys.filter(function(k) {
            return (records[k] || []).includes(item.id);
        }).length;
        const percent = Math.round(doneDays / needKeys.length * 100);

        const row = document.createElement("li");
        row.className = "setting-row";
        row.appendChild(makeIcon(item.icon));

        const text = makeHabitText(item.name, "完成 " + doneDays + " / " + needKeys.length + " 天");
        text.appendChild(makeBar(percent, "goal-bar"));
        row.appendChild(text);

        const percentEl = document.createElement("span");
        percentEl.className = "stats-percent";
        percentEl.textContent = percent + "%";
        row.appendChild(percentEl);

        list.appendChild(row);
    });

    if (list.children.length === 0) {
        list.appendChild(makeEmpty("還沒有習慣，先到今日頁新增一個吧"));
    }

    renderHistory(habits, records);
}

function render() {
    renderToday();
    renderCalendar();
    renderStats();
    renderSettings();
    if (recordDialog.open) {
        renderRecord(); // 紀錄視窗開著的話也要更新（例如其他裝置同步過來）
    }
    renderNotices();
    drawIcons();
}

// ===== 通知（右上角小鈴鐺） =====
// 通知不用存起來：每次畫面更新時，從習慣和打卡紀錄「算出」現在該提醒什麼
// 每則通知有一個 id，看過的 id 存在 localStorage 的 "readNotices"，沒看過的就顯示紅點
const noticeDialog = document.getElementById("notice-dialog");
const STREAK_MILESTONES = [3, 7, 14, 21, 30, 50, 100, 150, 200, 365];
let unreadWhenOpened = []; // 打開視窗那一刻還沒看過的通知，用來在列表上標紅點

function loadReadNotices() {
    const saved = localStorage.getItem("readNotices");
    return saved === null ? [] : JSON.parse(saved);
}

// 回傳現在所有的通知：[{ id, icon, text, note }]
function getNotices() {
    const habits = loadHabits();
    const records = loadRecords();
    const now = new Date();
    const todayKey = toDateKey(now);
    const today = fromDateKey(todayKey);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = toDateKey(yesterday);
    const notices = [];

    // 待辦事項：明天到期、今天到期、已經過期（還沒完成的才提醒）
    habits.filter(function(h) { return isTodo(h) && !h.done; }).forEach(function(todo) {
        const left = daysBetween(today, fromDateKey(todo.end));
        if (left === 1) {
            notices.push({ id: "todo-tomorrow-" + todo.id + "-" + todayKey, icon: "clock",
                text: "「" + todo.name + "」明天到期", note: "待辦事項" });
        } else if (left === 0) {
            notices.push({ id: "todo-today-" + todo.id + "-" + todayKey, icon: "alarm-clock",
                text: "「" + todo.name + "」今天到期", note: "待辦事項" });
        } else if (left < 0) {
            notices.push({ id: "todo-late-" + todo.id + "-" + todayKey, icon: "triangle-alert",
                text: "「" + todo.name + "」已超過期限 " + (-left) + " 天", note: "待辦事項" });
        }
    });

    // 短期目標：今天開始、今天是最後一天
    habits.filter(isGoal).forEach(function(goal) {
        if (goal.start === todayKey) {
            notices.push({ id: "goal-start-" + goal.id, icon: "flag",
                text: "「" + goal.name + "」今天開始", note: "短期目標" });
        }
        if (goal.end === todayKey) {
            notices.push({ id: "goal-end-" + goal.id, icon: "flag",
                text: "「" + goal.name + "」今天是最後一天，加油！", note: "短期目標" });
        }
    });

    // 昨天沒有全部完成
    const yesterdayItems = habits.filter(function(h) { return isActiveOn(h, yesterdayKey); });
    if (yesterdayItems.length > 0 && !hasCheckin(records, yesterday)) {
        const doneIds = records[yesterdayKey] || [];
        const done = yesterdayItems.filter(function(h) { return doneIds.includes(h.id); }).length;
        notices.push({ id: "missed-" + yesterdayKey, icon: "calendar-x",
            text: "昨天沒有全部完成（" + done + " / " + yesterdayItems.length + "）",
            note: "可以按左上角選單查看昨天的紀錄" });
    }

    // 晚上 8 點以後，今天還沒全部完成
    const todayItems = habits.filter(function(h) { return isActiveOn(h, todayKey); });
    if (now.getHours() >= 20 && todayItems.length > 0 && !hasCheckin(records, today)) {
        const doneIds = records[todayKey] || [];
        const left = todayItems.filter(function(h) { return !doneIds.includes(h.id); }).length;
        notices.push({ id: "evening-" + todayKey, icon: "moon",
            text: "今天還有 " + left + " 項沒完成", note: "睡前記得打卡喔" });
    }

    // 連續打卡里程碑：3、7、14、21、30… 天
    const streak = countStreak(records);
    if (STREAK_MILESTONES.includes(streak)) {
        // 連續紀錄的最後一天（今天打完了就是今天，不然是昨天），同一段連續紀錄只通知一次
        const lastDay = hasCheckin(records, today) ? todayKey : yesterdayKey;
        notices.push({ id: "streak-" + streak + "-" + lastDay, icon: "flame",
            text: "已經連續打卡 " + streak + " 天了，太厲害了！🎉", note: "連續打卡" });
    }

    return notices;
}

function renderNotices() {
    const notices = getNotices();
    const read = loadReadNotices();
    const hasUnread = notices.some(function(n) { return !read.includes(n.id); });
    document.getElementById("bell-badge").hidden = !hasUnread;

    if (!noticeDialog.open) {
        return;
    }
    const list = document.getElementById("notice-list");
    list.innerHTML = "";
    if (notices.length === 0) {
        list.appendChild(makeEmpty("目前沒有通知"));
    }
    notices.forEach(function(notice) {
        const row = document.createElement("li");
        row.className = "setting-row";
        row.appendChild(makeIcon(notice.icon));
        row.appendChild(makeHabitText(notice.text, notice.note));
        if (unreadWhenOpened.includes(notice.id)) {
            const dot = document.createElement("span");
            dot.className = "notice-dot"; // 這次才第一次看到的通知，右邊有小紅點
            row.appendChild(dot);
        }
        list.appendChild(row);
    });
}

// 按小鈴鐺：打開通知，並把現在的通知全部標成「看過了」
document.getElementById("bell-btn").addEventListener("click", function() {
    const notices = getNotices();
    const read = loadReadNotices();
    const ids = notices.map(function(n) { return n.id; });
    unreadWhenOpened = ids.filter(function(id) { return !read.includes(id); });

    // 只留下現在還存在的通知 id，舊的就不用記了，才不會越存越多
    localStorage.setItem("readNotices", JSON.stringify(ids));

    noticeDialog.showModal();
    render();
});

document.getElementById("notice-close").addEventListener("click", function() {
    noticeDialog.close();
});

// ===== 以前的打卡紀錄（左上角選單） =====
const recordDialog = document.getElementById("record-dialog");
let recordDay = ""; // 正在看哪一天，例如 "2026-11-08"

// 「昨天」「前天」或「3 天前」
function daysAgoText(key) {
    const ago = daysBetween(fromDateKey(key), fromDateKey(toDateKey(new Date())));
    if (ago === 0) return "今天";
    if (ago === 1) return "昨天";
    if (ago === 2) return "前天";
    return ago + " 天前";
}

function renderRecord() {
    const records = loadRecords();
    const habits = loadHabits();
    const todayKey = toDateKey(new Date());
    const doneIds = records[recordDay] || [];

    document.getElementById("record-title").textContent = daysAgoText(recordDay);
    document.getElementById("record-pick").value = recordDay;
    document.getElementById("record-pick").max = todayKey; // 不能選未來
    document.getElementById("record-next").disabled = (recordDay >= todayKey);

    // 那天要做的項目（習慣 + 期間內的短期目標）
    const items = habits.filter(function(h) { return isActiveOn(h, recordDay); });
    const doneCount = items.filter(function(h) { return doneIds.includes(h.id); }).length;

    const summary = document.getElementById("record-summary");
    let text = formatDate(fromDateKey(recordDay));
    if (items.length > 0) {
        text = text + " · 完成 " + doneCount + " / " + items.length;
    }
    if (hasCheckin(records, fromDateKey(recordDay))) {
        text = text + " · 打卡成功";
    }
    summary.textContent = text;
    summary.classList.toggle("success", hasCheckin(records, fromDateKey(recordDay)));

    const list = document.getElementById("record-list");
    list.innerHTML = "";

    if (items.length === 0 && doneIds.length === 0) {
        list.appendChild(makeEmpty("這天還沒有任何習慣"));
    }

    // 每個項目：完成 → 打勾；沒完成 → 灰色圓點（只能看，不能改）
    items.forEach(function(item) {
        const row = document.createElement("li");
        row.className = "setting-row";
        row.appendChild(makeIcon(item.icon));
        row.appendChild(makeHabitText(item.name, isGoal(item) ? "短期目標" : item.note));
        if (doneIds.includes(item.id)) {
            row.appendChild(makeIcon("circle-check"));
        } else {
            const dot = document.createElement("span");
            dot.className = "dot";
            row.appendChild(dot);
        }
        list.appendChild(row);
    });

    // 有完成、但現在已經不在清單裡的（舊版紀錄、已刪除的項目）
    doneIds.forEach(function(id) {
        if (items.some(function(h) { return h.id === id; })) {
            return;
        }
        const row = document.createElement("li");
        row.className = "setting-row";
        row.appendChild(makeIcon("circle-check"));
        row.appendChild(makeHabitText(id === "old-checkin" ? "有打卡" : "已刪除的項目", id === "old-checkin" ? "舊版紀錄" : ""));
        list.appendChild(row);
    });

    drawIcons();
}

// 往前或往後移動幾天
function moveRecordDay(step) {
    const date = fromDateKey(recordDay);
    date.setDate(date.getDate() + step);
    recordDay = toDateKey(date);
    renderRecord();
}

// 按左上角選單 → 打開視窗，先顯示昨天
document.getElementById("menu-btn").addEventListener("click", function() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    recordDay = toDateKey(yesterday);
    renderRecord();
    recordDialog.showModal();
});

document.getElementById("record-prev").addEventListener("click", function() {
    moveRecordDay(-1);
});

document.getElementById("record-next").addEventListener("click", function() {
    moveRecordDay(1);
});

// 用日期選擇器直接跳到某一天
document.getElementById("record-pick").addEventListener("change", function(event) {
    const key = event.target.value;
    if (key && key <= toDateKey(new Date())) {
        recordDay = key;
        renderRecord();
    }
});

document.getElementById("record-close").addEventListener("click", function() {
    recordDialog.close();
});

// 把畫面上所有 <i data-lucide="..."> 換成 Lucide 圖示
// （如果沒有網路、圖示庫載不到，就跳過，App 還是能用）
function drawIcons() {
    if (window.lucide) {
        lucide.createIcons();
    }
}

// ===== 動作 =====

// 點一下：沒完成 → 完成；已完成 → 取消（按錯可以反悔）
function toggleHabit(id) {
    const records = loadRecords();
    const today = toDateKey(new Date());
    const doneToday = records[today] || [];

    if (doneToday.includes(id)) {
        records[today] = doneToday.filter(function(x) { return x !== id; });
    } else {
        doneToday.push(id);
        records[today] = doneToday;
    }

    if (records[today].length === 0) {
        delete records[today]; // 一個都沒完成，就把這天刪掉，不算打卡
    }

    saveRecords(records);
    render();
}

function deleteHabit(item) {
    if (!confirm("確定要刪除「" + item.name + "」嗎？")) {
        return;
    }
    const habits = loadHabits().filter(function(h) {
        return h.id !== item.id;
    });
    saveHabits(habits);
    render();
}

// ===== 圖示下拉選單 =====
// 可以選的圖示：name 是 Lucide 的名字，label 是顯示的中文
// 想加更多圖示：到 https://lucide.dev/icons 找名字，照格式加一行就好
const ICON_OPTIONS = [
    { name: "star",           label: "星星" },
    { name: "target",         label: "目標" },
    { name: "list-todo",      label: "待辦" },
    { name: "book-open",      label: "閱讀" },
    { name: "pencil",         label: "寫字" },
    { name: "graduation-cap", label: "學習" },
    { name: "languages",      label: "語言" },
    { name: "code",           label: "程式" },
    { name: "brain",          label: "思考" },
    { name: "dumbbell",       label: "健身" },
    { name: "footprints",     label: "走路" },
    { name: "bike",           label: "騎車" },
    { name: "heart",          label: "健康" },
    { name: "droplet",        label: "喝水" },
    { name: "apple",          label: "水果" },
    { name: "salad",          label: "飲食" },
    { name: "coffee",         label: "咖啡" },
    { name: "pill",           label: "吃藥" },
    { name: "moon",           label: "睡覺" },
    { name: "bed",            label: "休息" },
    { name: "sun",            label: "早起" },
    { name: "smile",          label: "心情" },
    { name: "music",          label: "音樂" },
    { name: "guitar",         label: "樂器" },
    { name: "camera",         label: "拍照" },
    { name: "sprout",         label: "成長" },
    { name: "flower-2",       label: "植物" },
    { name: "dog",            label: "寵物" },
    { name: "piggy-bank",     label: "存錢" },
    { name: "briefcase",      label: "工作" }
];

const iconSelect = document.getElementById("icon-select");
const iconMenu = document.getElementById("icon-menu");
let selectedIcon = "star"; // 目前選的圖示

// 選一個圖示：更新按鈕上的圖示和名字、標出選中的格子
function chooseIcon(name) {
    selectedIcon = name;
    const option = ICON_OPTIONS.find(function(o) { return o.name === name; });

    const iconBox = document.getElementById("icon-select-icon");
    iconBox.innerHTML = "";
    iconBox.appendChild(makeIcon(name));
    document.getElementById("icon-select-name").textContent = option ? option.label : name;

    iconMenu.querySelectorAll(".icon-option").forEach(function(btn) {
        btn.classList.toggle("selected", btn.dataset.icon === name);
    });
    drawIcons();
}

function toggleIconMenu(open) {
    iconMenu.hidden = !open;
    iconSelect.setAttribute("aria-expanded", open ? "true" : "false");
}

// 一開始就把所有圖示格子做好
ICON_OPTIONS.forEach(function(option) {
    const btn = document.createElement("button");
    btn.type = "button"; // 不寫的話，在 form 裡按下去會被當成「送出」
    btn.className = "icon-option";
    btn.dataset.icon = option.name;
    btn.appendChild(makeIcon(option.name));
    btn.appendChild(document.createTextNode(option.label));
    btn.addEventListener("click", function() {
        chooseIcon(option.name);
        toggleIconMenu(false); // 選好就收起來
    });
    iconMenu.appendChild(btn);
});

iconSelect.addEventListener("click", function() {
    toggleIconMenu(iconMenu.hidden); // 關著就打開，開著就關掉
});

// ===== 新增 / 編輯視窗（共用同一個視窗） =====
const dialog = document.getElementById("add-dialog");
let addingType = "habit"; // 現在要新增的是 "habit"（習慣）、"goal"（短期目標）還是 "todo"（待辦事項）
let editingId = null;     // 正在編輯哪一個項目的 id；null 代表是「新增」

// 「每週幾」的 7 個勾選框（Array.from 把它變成陣列，才能用 filter、map）
function dayChecks() {
    return Array.from(document.querySelectorAll("#day-picks input"));
}

// 全部都勾了 → 按鈕顯示「全部取消」；還有沒勾的 → 顯示「全選」
function updateSelectAllText() {
    const allChecked = dayChecks().every(function(box) { return box.checked; });
    document.getElementById("select-all-days").textContent = allChecked ? "全部取消" : "全選";
}

// 按「全選」：全部勾起來；已經全選了再按一次就全部取消
document.getElementById("select-all-days").addEventListener("click", function() {
    const allChecked = dayChecks().every(function(box) { return box.checked; });
    dayChecks().forEach(function(box) {
        box.checked = !allChecked;
    });
    updateSelectAllText();
});

// 自己一個一個按的時候，也要更新按鈕上的字
document.getElementById("day-picks").addEventListener("change", updateSelectAllText);

// type："habit" 或 "goal"
// item：要編輯的項目；不給的話就是「新增」
function openAddDialog(type, item) {
    addingType = type;
    editingId = item ? item.id : null;
    const isEdit = (item !== undefined);
    const typeName = { habit: "習慣", goal: "短期目標", todo: "待辦事項" }[type];
    const hasDates = (type === "goal" || type === "todo");

    document.getElementById("add-form").reset(); // 清空上次打的字
    toggleIconMenu(false);
    document.getElementById("dialog-title").textContent = (isEdit ? "編輯" : "新增") + typeName;
    document.getElementById("submit-btn").textContent = isEdit ? "儲存" : "新增";
    document.getElementById("date-fields").hidden = !hasDates;
    document.getElementById("end-label").textContent = (type === "todo") ? "期限" : "結束日期";
    document.getElementById("weekday-field").hidden = (type !== "goal"); // 只有短期目標可以選每週幾

    if (isEdit) {
        // 編輯：把原本的內容填進去
        document.getElementById("input-name").value = item.name;
        document.getElementById("input-note").value = item.note || "";
        chooseIcon(OLD_ICON_NAMES[item.icon] || item.icon);
        if (hasDates) {
            document.getElementById("input-start").value = item.start;
            document.getElementById("input-end").value = item.end;
        }
        if (type === "goal") {
            // 把原本選的星期幾勾回去（沒有 days 的舊資料 = 全部勾選）
            dayChecks().forEach(function(box) {
                box.checked = !item.days || item.days.includes(Number(box.value));
            });
        }
    } else {
        // 新增：用預設值
        chooseIcon({ habit: "star", goal: "target", todo: "list-todo" }[type]);

        // 預設今天開始：短期目標 21 天、待辦事項 7 天
        const start = new Date();
        const end = new Date();
        end.setDate(end.getDate() + (type === "todo" ? 6 : 20));
        document.getElementById("input-start").value = toDateKey(start);
        document.getElementById("input-end").value = toDateKey(end);
    }

    updateSelectAllText(); // 依照現在勾了幾天，顯示「全選」或「全部取消」
    dialog.showModal();
}

document.getElementById("add-form").addEventListener("submit", function(event) {
    event.preventDefault(); // 不要讓表單重新整理頁面

    const name = document.getElementById("input-name").value.trim();
    const note = document.getElementById("input-note").value.trim();
    if (name === "") {
        return;
    }

    const newItem = {
        id: "h" + Date.now(), // 用現在的時間當代號，保證不會重複
        name: name,
        note: note,
        icon: selectedIcon, // 下拉選單選的圖示
        created: toDateKey(new Date()) // 建立日期：今天
    };

    if (addingType === "goal" || addingType === "todo") {
        const start = document.getElementById("input-start").value;
        const end = document.getElementById("input-end").value;
        if (start === "" || end === "") {
            alert("請選擇開始和結束日期");
            return;
        }
        if (end < start) {
            alert("結束日期不能比開始日期早");
            return;
        }
        newItem.type = addingType;
        newItem.start = start;
        newItem.end = end;
    }

    if (addingType === "goal") {
        // 收集有勾選的星期幾，例如 [1, 3, 5]
        const days = dayChecks()
            .filter(function(box) { return box.checked; })
            .map(function(box) { return Number(box.value); });
        if (days.length === 0) {
            alert("每週至少要選一天");
            return;
        }
        newItem.days = days;
    }

    const habits = loadHabits();

    if (editingId === null) {
        habits.push(newItem); // 新增：加到清單最後面
    } else {
        // 編輯：找到原本那一個，換掉內容（id 不變，所以以前的打卡紀錄都還在）
        const index = habits.findIndex(function(h) { return h.id === editingId; });
        newItem.id = editingId;
        newItem.created = habits[index].created; // 建立日期也要保留，不然會變成今天
        if (habits[index].done) {
            newItem.done = habits[index].done; // 待辦事項的完成日期也要保留
        }
        habits[index] = newItem;
    }

    saveHabits(habits);
    dialog.close();
    render();
});

document.getElementById("cancel-btn").addEventListener("click", function() {
    dialog.close();
});

document.getElementById("add-habit-btn").addEventListener("click", function() {
    openAddDialog("habit");
});

document.getElementById("add-goal-btn").addEventListener("click", function() {
    openAddDialog("goal");
});

document.getElementById("add-todo-btn").addEventListener("click", function() {
    openAddDialog("todo");
});

// ===== 日曆：上個月、下個月 =====
document.getElementById("prev-month").addEventListener("click", function() {
    calendarMonth.setMonth(calendarMonth.getMonth() - 1);
    render();
});

document.getElementById("next-month").addEventListener("click", function() {
    calendarMonth.setMonth(calendarMonth.getMonth() + 1);
    render();
});

// ===== 底部選單：切換頁面 =====
const PAGE_TITLES = { today: "今日", calendar: "日曆", stats: "統計", settings: "設定" };

document.querySelectorAll(".tab").forEach(function(tab) {
    tab.addEventListener("click", function() {
        const page = tab.dataset.page;

        document.querySelectorAll(".tab").forEach(function(t) {
            t.classList.toggle("active", t === tab);
        });
        Object.keys(PAGE_TITLES).forEach(function(name) {
            document.getElementById("page-" + name).hidden = (name !== page);
        });
        document.getElementById("page-title").textContent = PAGE_TITLES[page];
        window.scrollTo(0, 0);
    });
});

// ===== 統計頁：本週 / 本月 切換 =====
document.querySelectorAll(".seg-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
        statsRange = btn.dataset.range;
        document.querySelectorAll(".seg-btn").forEach(function(b) {
            b.classList.toggle("active", b === btn);
        });
        render();
    });
});

document.getElementById("reset-btn").addEventListener("click", function() {
    if (confirm("確定要清除所有打卡紀錄嗎？（習慣清單會保留）")) {
        saveRecords({}); // 用 saveRecords 清空，雲端才會一起清掉
        render();
    }
});

// ===== 備份資料：匯出 =====
document.getElementById("export-btn").addEventListener("click", function() {
    // ① 把習慣和打卡紀錄打包成一個物件，再轉成文字（縮排 2 格比較好讀）
    const data = {
        habits: loadHabits(),
        records: loadRecords()
    };
    const text = JSON.stringify(data, null, 2);

    // ② 把文字變成「記憶體裡的檔案」（Blob），並產生一個暫時網址指向它
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    // ③ 做一個看不見的下載連結，假裝點它一下
    const a = document.createElement("a");
    a.href = url;
    a.download = "打卡備份-" + toDateKey(new Date()) + ".json";
    document.body.appendChild(a); // 有些手機瀏覽器要放進網頁裡才能點
    a.click();
    a.remove();
    URL.revokeObjectURL(url); // 用完就釋放暫時網址
});

// ===== 備份資料：匯入 =====
const importFile = document.getElementById("import-file");

// 按「匯入資料」→ 幫忙點藏起來的選擇檔案元件
document.getElementById("import-btn").addEventListener("click", function() {
    importFile.click();
});

// 選好檔案之後
importFile.addEventListener("change", function() {
    const file = importFile.files[0];
    if (!file) {
        return; // 使用者按了取消
    }

    // FileReader：用來讀取使用者選的檔案內容
    const reader = new FileReader();

    // 讀完之後會執行這裡（讀檔需要時間，所以不是馬上就有結果）
    reader.onload = function() {
        let data;
        try {
            data = JSON.parse(reader.result);
        } catch (error) {
            alert("這個檔案不是正確的備份檔，無法匯入。");
            return;
        }

        // 檢查內容是不是我們匯出的格式
        const ok = data !== null
            && Array.isArray(data.habits)
            && typeof data.records === "object" && data.records !== null
            && !Array.isArray(data.records);
        if (!ok) {
            alert("這個檔案不是打卡備份檔，無法匯入。");
            return;
        }

        if (confirm("匯入會覆蓋目前所有的習慣和打卡紀錄，確定要匯入嗎？")) {
            saveHabits(data.habits);
            saveRecords(data.records);
            render();
            alert("匯入完成！");
        }
    };

    reader.readAsText(file);

    // 清空選擇，這樣下次選同一個檔案也會觸發 change
    importFile.value = "";
});

// 手機上 App 常常一直開著不關，切回來時重新畫一次，跨過半夜就會自動變成新的一天
document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "visible") {
        render();
    }
});

// 以前新增的習慣沒有建立日期：用「第一次打卡那天」補上，從沒打過卡就用今天
function fillCreatedDates() {
    const habits = loadHabits();
    const records = loadRecords();
    const days = Object.keys(records).sort(); // 由舊到新排好
    let changed = false;

    habits.forEach(function(habit) {
        if (isGoal(habit) || habit.created) {
            return;
        }
        const firstDay = days.find(function(key) {
            return records[key].includes(habit.id);
        });
        habit.created = firstDay || toDateKey(new Date());
        changed = true;
    });

    if (changed) {
        saveHabits(habits);
    }
}

// ===== 開始 =====
migrateOldData();
fillCreatedDates();
render();
document.getElementById("app-version").textContent = "版本 v" + APP_VERSION;
