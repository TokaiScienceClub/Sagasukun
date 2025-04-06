document.addEventListener("DOMContentLoaded", function () {
  // 初期化状況を確認（新規追加）
  chrome.runtime.sendMessage({ action: "checkStatus" }, function(response) {
    console.log("拡張機能ステータス:", response);
  });

  // タイムスタンプも取得するよう修正
  chrome.storage.local.get(["interruptedDownload", "detectionTimestamp"], function (data) {
    const url = data.interruptedDownload;
    const timestamp = data.detectionTimestamp || 0;
    const now = Date.now();
    
    // 1時間以上前のデータは古いとみなして無視（新規追加）
    if (now - timestamp > 3600000) {
      console.log("古いダウンロードデータを無視します");
      chrome.storage.local.remove('interruptedDownload');
      showError("処理対象のZIPファイルが見つかりません。新しいファイルをダウンロードしてください。");
      return;
    }
    
    if (!url) {
      showError("処理対象のZIPファイルが見つかりません。");
      return;
    }

    // Web Workerの初期化
    const worker = new Worker('worker.js');
    
    // Workerからのメッセージを処理
    worker.addEventListener('message', function(e) {
      const { type, data, error } = e.data;
      
      if (error) {
        showError(error);
        return;
      }
      
      switch (type) {
        case 'processing_complete':
          createZipAndDownload(data.content, data.filename, url);
          break;
        case 'progress':
          updateProgress(data.percent, data.message);
          break;
      }
    });

    document.getElementById("base10").addEventListener("click", () => {
      showProgress("10進法データを処理中...");
      worker.postMessage({ action: 'processData', url, type: "base10" });
    });

    document.getElementById("base60").addEventListener("click", () => {
      showProgress("60進法データを処理中...");
      worker.postMessage({ action: 'processData', url, type: "base60" });
    });

    document.getElementById("convert_gis").addEventListener("click", () => {
      showProgress("GeoJSONに変換中...");
      worker.postMessage({ action: 'processData', url, type: "convert_gis" });
    });

    const searchBtn = document.getElementById("search60");
    const searchForm = document.getElementById("searchForm");
    
    searchBtn.addEventListener("click", () => {
      searchForm.style.display = searchForm.style.display === "block" ? "none" : "block";
      searchBtn.textContent = searchForm.style.display === "block" ? "検索条件を閉じる" : "６０進法緯度経度検索";
    });

    document.getElementById("searchSubmit").addEventListener("click", () => {
      const b = [
        document.getElementById("longM1").value || null,
        document.getElementById("longM2").value || null,
        document.getElementById("latM1").value || null,
        document.getElementById("latM2").value || null,
      ].map((v) => (v === null || v === "" ? null : parseInt(v)));

      if (b[0] !== null && b[1] !== null && b[0] > b[1]) {
        showError("経度の最小値が最大値を超えています。");
        return;
      }

      if (b[2] !== null && b[3] !== null && b[2] > b[3]) {
        showError("緯度の最小値が最大値を超えています。");
        return;
      }

      showProgress("検索条件に基づいて処理中...");
      worker.postMessage({ action: 'processData', url, type: "search60", params: b });
    });
    
    // 終了時にクリーンアップ（新規追加）
    window.addEventListener('beforeunload', function() {
      worker.terminate();
    });
  });
});

function showError(message) {
  const errorDiv = document.getElementById("error");
  errorDiv.textContent = message;
  hideProgress();
  setTimeout(() => (errorDiv.textContent = ""), 5000);
}

function showProgress(message) {
  const progressContainer = document.getElementById("progressContainer");
  const progressMessage = document.getElementById("progressMessage");
  const progressBar = document.getElementById("progressBar");
  
  progressMessage.textContent = message;
  progressBar.style.width = "0%";
  progressContainer.style.display = "block";
}

function updateProgress(percent, message) {
  const progressMessage = document.getElementById("progressMessage");
  const progressBar = document.getElementById("progressBar");
  
  if (message) {
    progressMessage.textContent = message;
  }
  progressBar.style.width = `${percent}%`;
}

function hideProgress() {
  const progressContainer = document.getElementById("progressContainer");
  progressContainer.style.display = "none";
}

async function createZipAndDownload(content, filename, originalUrl) {
  try {
    // ZIP直接ダウンロード時のオブジェクトURL解放用
    let objectUrl = null;

    if (filename.endsWith('.zip')) {
      // 変更不要（既にworker側で_base10付きのファイル名が設定されている）
      const url = URL.createObjectURL(content);
      chrome.downloads.download({
        url: url,
        filename: filename,
      });
    }else {
      const zip = new JSZip();
      zip.file(filename, content);
      const blob = await zip.generateAsync({ type: "blob" });
      objectUrl = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        chrome.downloads.download({
          url: objectUrl,
          filename: filename.replace(/\.txt|\.geojson/, ".zip"),
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        });
      });
    }

    // クリーンアップ処理
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }

    chrome.storage.local.remove('interruptedDownload', () => {
      chrome.runtime.sendMessage({ 
        action: "processingComplete", 
        url: originalUrl 
      });
    });
    
    hideProgress();
  } catch (error) {
    console.error("ダウンロード処理失敗:", error);
    showError(`ダウンロードに失敗しました: ${error.message}`);
  }
}