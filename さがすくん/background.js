// より確実に検知状態を管理するためのフラグ
let extensionInitialized = false;
// 処理済みURLを追跡するためのグローバル変数
let processedUrls = new Set();
const URL_REGEX = /mesh500_\d{2,3}_\d{2,3}\.zip$/;

// 拡張機能を初期化する関数
function initializeExtension() {
  if (extensionInitialized) return;

  console.log("拡張機能を初期化中...");
  extensionInitialized = true;

  processedUrls = new Set();

  // 保存されたデータのクリア処理
  chrome.storage.local.remove('interruptedDownload')
    .then(() => {
      console.log("初期化完了: 保存されたダウンロードデータをクリアしました");
    })
    .catch(error => {
      console.error("データクリアエラー:", error);
    });
}

// 拡張機能の起動時に初期化を実行
initializeExtension();

// 明示的にブラウザ起動イベントでも初期化
chrome.runtime.onStartup.addListener(() => {
  console.log("ブラウザ起動を検知");
  initializeExtension();
});

// ダウンロード検知と処理 
chrome.downloads.onCreated.addListener((downloadItem) => {
  // 拡張機能初期化前なら処理しない
  if (!extensionInitialized) {
    console.log("初期化前のダウンロードイベントを無視");
    return;
  }
  
  // 現在時刻を取得（古いダウンロードイベントを無視するため）
  const now = Date.now();
  const downloadCreationTime = downloadItem.startTime ? new Date(downloadItem.startTime).getTime() : now;
  
  // 5秒以上古いダウンロードイベントは無視（古いイベントの再発火を防ぐため）
  if (now - downloadCreationTime > 5000) {
    console.log("古いダウンロードイベントを無視", downloadItem.url);
    return;
  }
  
  // ZIPファイルのパターンにマッチし、かつまだ処理していないURLの場合のみ処理
  if (URL_REGEX.test(downloadItem.url) && !processedUrls.has(downloadItem.url)) {
    console.log("新規ダウンロードを検知:", downloadItem.url);
    
    // 処理済みとしてマーク
    processedUrls.add(downloadItem.url);
    
    chrome.downloads.cancel(downloadItem.id)
      .then(() => {
        // ストレージと通知を並列処理
        return Promise.all([
          chrome.storage.local.set({
            interruptedDownload: downloadItem.url,
            detectionTimestamp: now
          }),
          chrome.notifications.create({
            type: "basic",
            iconUrl: "icons/icon256.png",
            title: "Depth Data Processor",
            message: "ダウンロードを検知しました！"
          })
        ]);
      })
      .then(() => {
        const popupUrl = chrome.runtime.getURL('popup.html');
        return new Promise((resolve, reject) => {
          chrome.tabs.query({
            url: popupUrl,
            windowType: 'popup'
          }, (tabs) => {
            if (tabs.length > 0) {
              const tab = tabs[0];
              chrome.windows.update(tab.windowId, { focused: true }, () => resolve(tab));
            } else {
              chrome.windows.create({
                url: popupUrl,
                type: 'popup',
                width: 350,
                height: 500
              }, resolve);
            }
          });
        });
      })
      .then(() => {
        console.log("ポップアップを開きました");
      })
      .catch(error => {
        console.error("ダウンロードキャンセルまたは後続処理でエラー:", error);
      });
  } else {
    // ダウンロードURLがパターンにマッチしないか、既に処理済みの場合、ログに記録
    console.log("処理対象外または既に処理済みのダウンロード:", downloadItem.url);
  }
});

// メッセージ処理 - エラーハンドリング強化
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.action === "processingComplete") {
      // アクションが処理完了を示す場合
      // 処理完了時に該当URLを処理済みリストから削除（再処理を可能にする）
      if (message.url && processedUrls.has(message.url)) {
        console.log("処理完了: URLを再処理可能にします", message.url);
        processedUrls.delete(message.url);
      }
      
      // ストレージもクリア
      chrome.storage.local.remove('interruptedDownload')
        .then(() => {
          console.log("処理完了: 保存データをクリアしました");
        })
        .catch(error => {
          console.error("データクリアエラー:", error);
        });
      
      // 応答を確実に返す
      sendResponse({ success: true });
    } else if (message.action === "checkStatus") {
      // ポップアップからのステータスチェック要求の場合
      sendResponse({ 
        initialized: extensionInitialized,
        processedCount: processedUrls.size
      });
    } else {
      // 未知のアクションにも応答
      sendResponse({ success: false, error: "Unknown action" });
    }
  } catch (error) {
    console.error("メッセージ処理エラー:", error);
    // エラー時も応答を返す
    sendResponse({ success: false, error: error.message });
  }
  
  // 非同期レスポンスのためにtrueを返す
  return true;
});

// ブラウザ終了時の処理
chrome.runtime.onSuspend.addListener(() => {
  console.log("ブラウザ終了を検知: データクリア実行");
  chrome.storage.local.remove('interruptedDownload')
    .then(() => {
      console.log("ブラウザ閉鎖時にデータを初期化しました。");
    })
    .catch(error => {
      console.error("ブラウザ閉鎖時のデータ初期化に失敗しました:", error);
    });
});

// エラーハンドリング強化 - グローバルエラーキャッチ
self.addEventListener('error', function(event) {
  console.error('Global error:', event.error);
});

// Promise エラーハンドリング
self.addEventListener('unhandledrejection', function(event) {
  console.error('Unhandled promise rejection:', event.reason);
});

console.log("Depth Data Processor 拡張機能がロードされました");
