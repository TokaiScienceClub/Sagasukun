// worker.js - 重い処理を担当する新しいファイル
importScripts('jszip.min.js');

// 処理済みデータのキャッシュ
const dataCache = new Map();

function getCitationText() {
  return `「日本海洋データセンター 統計プロダクト 500mメッシュ水深データ」（https://www.jodc.go.jp/vpage/depth500_file_j.html）（${new Date().toLocaleDateString('ja-JP')}に利用）`;
}

self.addEventListener('message', async function(e) {
  const { action, url, type, params } = e.data;
  
  try {
    if (action === 'processData') {
      // キャッシュ確認
      const cacheKey = `${url}_${type}_${JSON.stringify(params || [])}`;
      if (dataCache.has(cacheKey)) {
        self.postMessage({ type: 'processing_complete', data: dataCache.get(cacheKey) });
        return;
      }
      
      // 進捗更新
      self.postMessage({ type: 'progress', data: { percent: 10, message: 'ZIPファイルを読み込み中...' } });
      
      // ZIPファイル読み込み
      const text = await loadZip(url);
      self.postMessage({ type: 'progress', data: { percent: 40, message: 'データを解析中...' } });
      
      // データ解析
      const { data10, data60 } = parseData(text);
      self.postMessage({ type: 'progress', data: { percent: 60, message: 'データを処理中...' } });
      
      // ベース名抽出
      const baseNameMatch = url.match(/mesh500_\d{2,3}_\d{2,3}/);
      if (!baseNameMatch) throw new Error("ファイル名が不正です。");
      const baseName = baseNameMatch[0];
      
      let content, filename;
      
      // 処理タイプ別の処理
      self.postMessage({ type: 'progress', data: { percent: 80, message: '出力形式を準備中...' } });
      
      // worker.js（base10処理部分の修正）
      if (type === "base10") {
        const response = await fetch(url);
        const blob = await response.blob();
      
        // ZIPファイルを解凍してファイル名変更
        const zip = await JSZip.loadAsync(blob);
        const originalTxtFile = zip.file(/\.txt$/)[0];
      
        // ファイル名に_base10を追加
        const newFilename = originalTxtFile.name.replace(/\.txt$/, '_base10.txt');
      
        // 新しいZIPファイルを作成
        const newZip = new JSZip();
        newZip.file(newFilename, originalTxtFile.async("text"));
        
        // 出典ファイルを追加
        newZip.file("出典.txt", `${getCitationText()}を元に作成`);
      
        content = await newZip.generateAsync({ type: "blob" });
        filename = `${originalTxtFile.name.replace(/\.txt$/, '')}_base10.zip`;
      } 
      else if (type === "base60" || type === "search60" || type === "convert_gis") {
        // Original content processing stays the same
        let processedContent;
        let originalFilename;
        
        if (type === "base60") {
          processedContent = toTxt(data60);
          originalFilename = `${baseName}_base60.txt`;
        } else if (type === "search60") {
          const filteredData = boolIndex(data60, params);
          if (filteredData.length === 0) throw new Error("指定された条件に該当するデータがありません。");
          processedContent = toTxt(filteredData);
          originalFilename = `${baseName}_search60.txt`;
        } else if (type === "convert_gis") {
          processedContent = JSON.stringify(convertGis(data10), null, 2);
          originalFilename = `${baseName}_geojson.geojson`;
        }
        
        // 新しいzipファイルを生成
        const newZip = new JSZip();
        newZip.file(originalFilename, processedContent);
        // 出典ファイルを追加
        newZip.file(
        "出典.txt", 
        `出典：${getCitationText()}\n日本海洋データセンター 統計プロダクト 500mメッシュ水深データ」（https://www.jodc.go.jp/vpage/depth500_file_j.html）を加工して作成`
        );
        
        content = await newZip.generateAsync({ type: "blob" });
        filename = originalFilename.replace(/\.[^.]+$/, '.zip');
      }
      
      self.postMessage({ type: 'progress', data: { percent: 100, message: '完了！ダウンロードを開始します...' } });
      
      // 結果をキャッシュ
      const result = { content, filename };
      dataCache.set(cacheKey, result);
      
      // メインスレッドに結果を送信
      self.postMessage({ type: 'processing_complete', data: result });
    }
  } catch (error) {
    self.postMessage({ error: error.message });
  }
});

async function loadZip(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTPエラー: ${response.status} - ${response.statusText}`);
    }
    
    const blob = await response.blob();
    const zip = await JSZip.loadAsync(blob);
    const txtFile = zip.file(/\.txt$/)[0];
    
    if (!txtFile) {
      throw new Error("ZIPファイルにテキストファイルが含まれていません。");
    }
    
    return await txtFile.async("text");
  } catch (error) {
    console.error("ZIPファイルの読み込みに失敗しました:", error);
    throw new Error(`ZIPファイルの読み込みに失敗しました: ${error.message}`);
  }
}

// parseData関数の修正（緯度経度の逆転を修正）
function parseData(text) {
  const lines = text.split("\n");
  const data10 = [];
  const data60 = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();
  if (!trimmed) continue;

  const parts = trimmed.split(/\s+/);
  if (parts.length <4) continue;

  try {
    const typeInt = parseInt(parts[0]);
    const latFloat = parseFloat(parts[1]);
    const longFloat = parseFloat(parts[2]);
    const depthInt = parseInt(parts[3]);

    data10.push([typeInt, longFloat, latFloat, depthInt]);

    const [longD, longM, longS] = dms(longFloat);
    const [latD, latM, latS] = dms(latFloat);

    data60.push([typeInt, longD, longM, longS, latD, latM, latS, depthInt]);

  } catch (e) {
    console.warn(`データ解析エラー (行: '${line}'): ${e.message}`);
  }
}

  return { data10, data60 };
}


// DMS計算の最適化
function dms(n) {
  const d = Math.floor(n);
  const minTotal = (n - d) * 60;
  const m = Math.floor(minTotal);
  const s = (minTotal - m) * 60;
  return [d, m, s.toFixed(3)];
}

function toTxt(data) {
  // ループ内での文字列連結を配列joinに変更
  const lines = new Array(data.length);
  
for (let i = 0; i < data.length; i++) {
  const item = data[i];
  const typeInt = item[0];
  const latD = item[4];
  const latM = item[5];
  const latS = item[6];
  const longD = item[1];
  const longM = item[2];
  const longS = item[3];
  const depth = item[7];
  
  lines[i] = `${typeInt}  ${latD}°${latM.toString().padStart(2, "0")}'${latS.toString().padStart(6, "0")}" ` +
             `${longD}°${longM.toString().padStart(2, "0")}'${longS.toString().padStart(6, "0")}" ${depth}`;
}

  return lines.join("\n");
}

function boolIndex(data60, b) {
  // フィルタリング操作の最適化
  const result = [];
  const [longMin, longMax, latMin, latMax] = b;
  
  const checkLongMin = longMin !== null;
  const checkLongMax = longMax !== null;
  const checkLatMin = latMin !== null;
  const checkLatMax = latMax !== null;

  for (let i = 0; i < data60.length; i++) {
    const item = data60[i];
    const longM = item[2];
    const latM = item[5];
    
    if (checkLongMin && longM < longMin) continue;
    if (checkLongMax && longM > longMax) continue;
    if (checkLatMin && latM < latMin) continue;
    if (checkLatMax && latM > latMax) continue;
    
    result.push(item);
  }
  
  return result;
}

function convertGis(data10) {
  // 深さの最小値/最大値を一度だけ計算
  let depthMin = Infinity;
  let depthMax = -Infinity;
  
  // 最初のパスで深さの範囲を決定
  for (let i = 0; i < data10.length; i++) {
    const depth = data10[i][3];
    if (depth < depthMin) depthMin = depth;
    if (depth > depthMax) depthMax = depth;
  }
  
  const depthRange = depthMax === depthMin ? 1 : depthMax - depthMin;
  
  // features配列を事前に確保
  const features = new Array(data10.length);
  
  // 2回目のパスでfeatures生成
  for (let i = 0; i < data10.length; i++) {
    const [_, long, lat, depth] = data10[i];
    const greenValue = 255 - Math.round(((depth - depthMin) / depthRange) * 255);
    const hexCode = `#00${greenValue.toString(16).padStart(2, "0")}ff`;
    
    features[i] = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [long, lat] },
      properties: { name: String(depth), "marker-color": hexCode, "marker-size": "medium", "marker-symbol": "" }
    };
  }
  
  return { type: "FeatureCollection", features };
}
