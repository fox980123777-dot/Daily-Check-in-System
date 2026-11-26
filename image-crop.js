// ===== 自己的圖片：存在這台裝置 + 裁剪畫面 =====
// 這個檔案要在 script.js 之前載入（index.html 裡的順序）
//
// 圖片存在瀏覽器的 IndexedDB（localStorage 只有約 5MB，而且已經拿來存習慣資料了）
// 習慣資料裡只記圖片代號，例如 { id: "read", icon: "book-open", image: "img_1732600000000" }
// icon 一樣會留著：圖片找不到時（例如換了裝置）就顯示 icon
//
// 第一階段：圖片只存在這台裝置；之後會再加上雲端同步

const IMAGE_SIZE = 256;      // 裁好的圖片存成 256 × 256
const IMAGE_QUALITY = 0.8;   // JPEG 畫質（0～1），256px 大約 15～30KB

// ===== IndexedDB：存圖片 =====
let imageDBPromise = null;

function openImageDB() {
    if (imageDBPromise === null) {
        imageDBPromise = new Promise(function(resolve, reject) {
            const request = indexedDB.open("daily-checkin", 1);
            request.onupgradeneeded = function() {
                request.result.createObjectStore("images"); // key = 圖片代號，value = 圖片 (Blob)
            };
            request.onsuccess = function() { resolve(request.result); };
            request.onerror = function() { reject(request.error); };
        });
    }
    return imageDBPromise;
}

// 對 images 做一件事，做完回傳結果
function imageStore(mode, action) {
    return openImageDB().then(function(db) {
        return new Promise(function(resolve, reject) {
            const tx = db.transaction("images", mode);
            const request = action(tx.objectStore("images"));
            tx.oncomplete = function() { resolve(request ? request.result : undefined); };
            tx.onerror = function() { reject(tx.error); };
        });
    });
}

// 畫面要同步拿到圖片，所以一開始就把全部圖片讀進記憶體（每張只有幾十 KB）
// imageURLs：{ 圖片代號: 可以放進 <img src> 的網址 }
const imageURLs = {};

function rememberImage(id, blob) {
    if (imageURLs[id]) {
        URL.revokeObjectURL(imageURLs[id]);
    }
    imageURLs[id] = URL.createObjectURL(blob);
}

// 只存在這台裝置（從雲端下載回來的圖片用這個，不用再傳回雲端）
function storeImageLocally(id, blob) {
    rememberImage(id, blob);
    return imageStore("readwrite", function(store) { return store.put(blob, id); });
}

// 存圖片：這台裝置 + 雲端（有登入的話；cloudSaveImage 是 firebase.js 提供的）
function saveImage(id, blob) {
    if (window.cloudSaveImage) {
        window.cloudSaveImage(id, blob);
    }
    return storeImageLocally(id, blob);
}

// 刪圖片：這台裝置 + 雲端（有登入的話）
function deleteImage(id) {
    if (window.cloudDeleteImage) {
        window.cloudDeleteImage(id);
    }
    if (imageURLs[id]) {
        URL.revokeObjectURL(imageURLs[id]);
        delete imageURLs[id];
    }
    return imageStore("readwrite", function(store) { return store.delete(id); });
}

// 從記憶體拿出圖片本身（上傳雲端時用）
function getImageBlob(id) {
    if (!imageURLs[id]) {
        return Promise.resolve(null);
    }
    return fetch(imageURLs[id]).then(function(response) { return response.blob(); });
}

// 把這台裝置的圖片全部讀出來
function loadAllImages() {
    return openImageDB().then(function(db) {
        return new Promise(function(resolve) {
            const tx = db.transaction("images", "readonly");
            const request = tx.objectStore("images").openCursor();
            request.onsuccess = function() {
                const cursor = request.result;
                if (cursor) {
                    rememberImage(cursor.key, cursor.value);
                    cursor.continue();
                }
            };
            tx.oncomplete = function() { resolve(); };
            tx.onerror = function() { resolve(); }; // 讀不到就算了，會顯示預設圖示
        });
    }).catch(function(error) {
        console.error("讀取圖片失敗", error); // 例如無痕模式不能用 IndexedDB
    });
}

// 一載入就開始讀；script.js 讀完會重畫畫面，firebase.js 同步圖片前也要先等它讀完
const imagesLoaded = loadAllImages();

function newImageId() {
    return "img_" + Date.now();
}

// ===== 裁剪畫面（像 Instagram：框不動，拖動、縮放圖片） =====
// openCropper(檔案) → 按「完成」回傳裁好的圖片 (Blob)，按返回回傳 null
const cropDialog = document.getElementById("crop-dialog");
const cropStage = document.getElementById("crop-stage");
const cropImage = document.getElementById("crop-image");
const cropFrame = document.getElementById("crop-frame");

const crop = {
    width: 0, height: 0, // 圖片原本的大小
    frame: 0,            // 裁剪框的邊長（px）
    scale: 1,            // 放大倍率（1 = 原本大小）
    minScale: 1,         // 最小倍率：圖片剛好蓋滿裁剪框
    x: 0, y: 0,          // 圖片中心離裁剪框中心多遠（px）
    rotation: 0,         // 0、90、180、270 度
    pointers: new Map(), // 目前按在畫面上的手指 { id: { x, y } }
    resolve: null
};

// 轉了 90 或 270 度，寬高要對調
function rotatedSize() {
    const turned = crop.rotation % 180 !== 0;
    return {
        w: (turned ? crop.height : crop.width) * crop.scale,
        h: (turned ? crop.width : crop.height) * crop.scale
    };
}

// 不能縮得比裁剪框還小，也不能拖到露出空白
function clampCrop() {
    const turned = crop.rotation % 180 !== 0;
    const w = turned ? crop.height : crop.width;
    const h = turned ? crop.width : crop.height;
    crop.minScale = crop.frame / Math.min(w, h);
    crop.scale = Math.min(Math.max(crop.scale, crop.minScale), crop.minScale * 8); // 最多放大 8 倍
    const size = rotatedSize();
    const maxX = (size.w - crop.frame) / 2;
    const maxY = (size.h - crop.frame) / 2;
    crop.x = Math.min(Math.max(crop.x, -maxX), maxX);
    crop.y = Math.min(Math.max(crop.y, -maxY), maxY);
}

function drawCrop() {
    clampCrop();
    cropImage.style.width = crop.width + "px";
    cropImage.style.height = crop.height + "px";
    cropImage.style.transform =
        "translate(-50%, -50%) translate(" + crop.x + "px, " + crop.y + "px) " +
        "rotate(" + crop.rotation + "deg) scale(" + crop.scale + ")";
}

// 以畫面上某一點為中心縮放（兩指縮放、滑鼠滾輪用）
// centerX、centerY：離裁剪框中心多遠
function zoomCrop(newScale, centerX, centerY) {
    const oldScale = crop.scale;
    crop.scale = newScale;
    clampCrop();
    const ratio = crop.scale / oldScale;
    crop.x = centerX - (centerX - crop.x) * ratio;
    crop.y = centerY - (centerY - crop.y) * ratio;
    drawCrop();
}

// 手指位置換算成「離裁剪框中心多遠」
function fromFrameCenter(point) {
    const rect = cropFrame.getBoundingClientRect();
    return { x: point.x - (rect.left + rect.width / 2), y: point.y - (rect.top + rect.height / 2) };
}

cropStage.addEventListener("pointerdown", function(event) {
    cropStage.setPointerCapture(event.pointerId);
    crop.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
});

cropStage.addEventListener("pointermove", function(event) {
    const old = crop.pointers.get(event.pointerId);
    if (!old) {
        return;
    }
    const point = { x: event.clientX, y: event.clientY };

    if (crop.pointers.size === 1) {
        // 一根手指：拖動
        crop.x += point.x - old.x;
        crop.y += point.y - old.y;
        crop.pointers.set(event.pointerId, point);
        drawCrop();
        return;
    }

    // 兩根手指：縮放 + 拖動（看兩指距離變多少、中間點移動多少）
    const others = Array.from(crop.pointers.entries()).filter(function(e) { return e[0] !== event.pointerId; });
    const other = others[0][1];
    const oldDistance = Math.hypot(old.x - other.x, old.y - other.y);
    const newDistance = Math.hypot(point.x - other.x, point.y - other.y);
    const oldMid = { x: (old.x + other.x) / 2, y: (old.y + other.y) / 2 };
    const newMid = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
    crop.pointers.set(event.pointerId, point);

    crop.x += newMid.x - oldMid.x;
    crop.y += newMid.y - oldMid.y;
    if (oldDistance > 0) {
        const center = fromFrameCenter(newMid);
        zoomCrop(crop.scale * newDistance / oldDistance, center.x, center.y);
    } else {
        drawCrop();
    }
});

function releasePointer(event) {
    crop.pointers.delete(event.pointerId);
}
cropStage.addEventListener("pointerup", releasePointer);
cropStage.addEventListener("pointercancel", releasePointer);

// 電腦上用滑鼠滾輪縮放
cropStage.addEventListener("wheel", function(event) {
    event.preventDefault();
    const center = fromFrameCenter({ x: event.clientX, y: event.clientY });
    zoomCrop(crop.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1), center.x, center.y);
}, { passive: false });

document.getElementById("crop-rotate").addEventListener("click", function() {
    crop.rotation = (crop.rotation + 90) % 360;
    crop.x = 0;
    crop.y = 0;
    crop.scale = 0; // 轉完先縮回剛好蓋滿（clampCrop 會調到最小倍率）
    drawCrop();
});

function finishCrop(result) {
    const resolve = crop.resolve;
    crop.resolve = null;
    crop.pointers.clear();
    cropDialog.close();
    if (cropImage.src) {
        URL.revokeObjectURL(cropImage.src);
        cropImage.removeAttribute("src");
    }
    if (resolve) {
        resolve(result);
    }
}

document.getElementById("crop-cancel").addEventListener("click", function() {
    finishCrop(null);
});

// 按 Esc 或手機的返回手勢關掉視窗，也當作取消
cropDialog.addEventListener("cancel", function(event) {
    event.preventDefault();
    finishCrop(null);
});

// 按「完成」：把裁剪框裡看到的畫面畫到 256 × 256 的畫布上，存成 JPEG
document.getElementById("crop-done").addEventListener("click", function() {
    const canvas = document.createElement("canvas");
    canvas.width = IMAGE_SIZE;
    canvas.height = IMAGE_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // 透明的 PNG 墊白底，不然存成 JPEG 會變黑
    ctx.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
    ctx.imageSmoothingQuality = "high";

    // 跟畫面上的 transform 一樣的順序：移到中心 → 拖動 → 旋轉 → 縮放
    const k = IMAGE_SIZE / crop.frame;
    ctx.translate(IMAGE_SIZE / 2, IMAGE_SIZE / 2);
    ctx.scale(k, k);
    ctx.translate(crop.x, crop.y);
    ctx.rotate(crop.rotation * Math.PI / 180);
    ctx.scale(crop.scale, crop.scale);
    ctx.drawImage(cropImage, -crop.width / 2, -crop.height / 2, crop.width, crop.height);

    canvas.toBlob(function(blob) {
        if (!blob) {
            alert("圖片處理失敗，請換一張試試看");
            finishCrop(null);
            return;
        }
        finishCrop(blob);
    }, "image/jpeg", IMAGE_QUALITY);
});

function openCropper(file) {
    return new Promise(function(resolve) {
        cropImage.onload = function() {
            crop.width = cropImage.naturalWidth;
            crop.height = cropImage.naturalHeight;
            crop.rotation = 0;
            crop.x = 0;
            crop.y = 0;
            crop.scale = 0; // 一開始剛好蓋滿裁剪框
            crop.resolve = resolve;
            cropDialog.showModal();
            // 視窗打開後才量得到裁剪框的大小
            crop.frame = cropFrame.getBoundingClientRect().width;
            drawCrop();
        };
        cropImage.onerror = function() {
            URL.revokeObjectURL(cropImage.src);
            cropImage.removeAttribute("src");
            alert("這個檔案打不開，請選擇照片或圖片檔");
            resolve(null);
        };
        cropImage.src = URL.createObjectURL(file);
    });
}
