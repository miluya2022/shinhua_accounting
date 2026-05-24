function generateBatchWordReceipts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName('計畫收支');
  const dbSheet = ss.getSheetByName('所得人清冊');
  const templateSheet = ss.getSheetByName('收據範本');

  if (!mainSheet || !dbSheet || !templateSheet) {
    SpreadsheetApp.getUi().alert('找不到工作表，請確認「計畫收支」、「所得人清冊」與「收據範本」的分頁名稱是否正確。');
    return;
  }

  // --- 1. 建立「收據範本」的對照字典 ---
  const templateData = templateSheet.getDataRange().getValues();
  const templateMap = {};
  for (let i = 1; i < templateData.length; i++) {
    const templateName = templateData[i][0] ? templateData[i][0].toString().trim() : '';
    const templateId = templateData[i][1] ? templateData[i][1].toString().trim() : '';
    if (templateName && templateId) {
      templateMap[templateName] = templateId;
    }
  }

  // --- 2. 建立「所得人清冊」的搜尋字典 (以姓名為 Key) ---
  const dbData = dbSheet.getDataRange().getValues();
  const payeeDict = {};
  
  for (let i = 1; i < dbData.length; i++) {
    let name = dbData[i][0]; // 姓名
    if (name) {
      payeeDict[name] = {
        id: dbData[i][1] || '',
        unit: dbData[i][5] || '',
        title: dbData[i][6] || '',
        address: dbData[i][3] || '',
        phone: dbData[i][4] || ''
      };
    }
  }

  // --- 3. 掃描「計畫收支」U欄 (索引 20) 找出需要生成的範本資料 ---
  const mainData = mainSheet.getDataRange().getValues();
  const recordsToProcess = [];
  const U_COL_INDEX = 20; // U 欄在陣列中的索引為 20 (A欄是0)
  const spreadsheetName = ss.getName();

  for (let i = 1; i < mainData.length; i++) {
    const templateNameVal = mainData[i][U_COL_INDEX] ? mainData[i][U_COL_INDEX].toString().trim() : '';
    if (templateNameVal && templateNameVal !== '已生成' && templateMap[templateNameVal]) {
      
      let rawDate = mainData[i][7]; // H欄 (索引7)
      let dateStr = '';
      let rocYear = '';
      let westernYear = '';
      let month = '';
      let day = '';
      
      if (rawDate instanceof Date) {
        dateStr = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), "yyyy/MM/dd");
        rocYear = (rawDate.getFullYear() - 1911).toString();
        westernYear = rawDate.getFullYear().toString();
        month = (rawDate.getMonth() + 1).toString();
        day = rawDate.getDate().toString();
      } else if (rawDate) {
        dateStr = rawDate.toString();
        let parsedDate = new Date(rawDate);
        if (!isNaN(parsedDate.getTime())) {
          rocYear = (parsedDate.getFullYear() - 1911).toString();
          westernYear = parsedDate.getFullYear().toString();
          month = (parsedDate.getMonth() + 1).toString();
          day = parsedDate.getDate().toString();
        }
      }

      let timeVal = mainData[i][8] !== null && mainData[i][8] !== undefined ? mainData[i][8].toString() : '';

      recordsToProcess.push({
        rowIndex: i + 1, // 紀錄試算表列號，稍後用來將 U 欄改為「已生成」
        name: mainData[i][12] || '', // M欄 (索引12)
        workItem: mainData[i][3] || '', // D欄 (索引3)
        subject: mainData[i][4] || '', // E欄 (索引4)
        reason: mainData[i][6] || '', // G欄 (索引6)
        dateStr: dateStr,
        timeVal: timeVal,
        rocYear: rocYear,
        westernYear: westernYear,
        month: month,
        day: day,
        price: mainData[i][9] || '', // J欄 (索引9)
        quantity: mainData[i][10] || '', // K欄 (索引10)
        amount: mainData[i][11] || '', // L欄 (索引11)
        templateName: templateNameVal,
        templateId: templateMap[templateNameVal]
      });
    }
  }

  if (recordsToProcess.length === 0) {
    SpreadsheetApp.getUi().alert('在 U 欄中沒有找到尚未處理且對應到「收據範本」的資料。');
    return;
  }

  // --- 4. 依據範本 ID 分組處理 ---
  const recordsByTemplate = {};
  recordsToProcess.forEach(record => {
    if (!recordsByTemplate[record.templateId]) {
      recordsByTemplate[record.templateId] = {
        templateName: record.templateName,
        records: []
      };
    }
    recordsByTemplate[record.templateId].records.push(record);
  });

  const generatedFiles = [];
  const templateIds = Object.keys(recordsByTemplate);

  templateIds.forEach(templateId => {
    const group = recordsByTemplate[templateId];
    const groupRecords = group.records;

    // --- 1. 決定檔名：{{生成年月日}}_{{姓名}}、{{姓名}}，重複者後面加流水號 ---
    const today = new Date();
    const yyyymmdd = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyyMMdd");
    
    const uniqueNames = [];
    groupRecords.forEach(record => {
      if (record.name && uniqueNames.indexOf(record.name) === -1) {
        uniqueNames.push(record.name);
      }
    });
    const namesStr = uniqueNames.join('、');
    const baseName = `${yyyymmdd}_${namesStr}`;
    let fileName = baseName;
    let counter = 1;
    
    while (true) {
      const files = DriveApp.getFilesByName(fileName);
      if (files.hasNext()) {
        fileName = `${baseName}_${counter}`;
        counter++;
      } else {
        break;
      }
    }

    // 複製 Word 範本並開啟
    const tempFile = DriveApp.getFileById(templateId).makeCopy(fileName);
    const tempDocId = tempFile.getId();
    const doc = DocumentApp.openById(tempDocId);
    const body = doc.getBody();

    // 1. 先讀取範本中原有的所有元素 (以備複製)
    const numChildren = body.getNumChildren();
    const templateElements = [];
    for (let i = 0; i < numChildren; i++) {
      templateElements.push(body.getChild(i).copy());
    }

    // 2. 清空 Body 內容 (Google 文件會自動保留一個空的 Paragraph)
    body.clear();

    // 依序填入資料並排版 (一頁一張，包含範本頁面中表格前後的說明文字)
    groupRecords.forEach((record, index) => {
      const info = payeeDict[record.name] || {};
      const amountChinese = convertToChineseNumber(record.amount);

      // 如果不是第一張，先加入分頁符號
      if (index > 0) {
        body.appendPageBreak();
      }

      // 複製並追加範本中所有的子元素到文件末尾
      templateElements.forEach(element => {
        const copiedEl = element.copy();
        const elType = copiedEl.getType();
        let appendedEl = null;

        if (elType === DocumentApp.ElementType.PARAGRAPH) {
          appendedEl = body.appendParagraph(copiedEl.asParagraph());
        } else if (elType === DocumentApp.ElementType.TABLE) {
          appendedEl = body.appendTable(copiedEl.asTable());
        } else if (elType === DocumentApp.ElementType.LIST_ITEM) {
          appendedEl = body.appendListItem(copiedEl.asListItem());
        } else if (elType === DocumentApp.ElementType.PAGE_BREAK) {
          appendedEl = body.appendPageBreak();
        }

        // 替換該元素內含的專屬標籤
        if (appendedEl && typeof appendedEl.replaceText === 'function') {
          appendedEl.replaceText('{{姓名}}', record.name);
          appendedEl.replaceText('{{身分證}}', info.id || '');
          appendedEl.replaceText('{{服務單位}}', info.unit || '');
          appendedEl.replaceText('{{職稱}}', info.title || '');
          appendedEl.replaceText('{{地址}}', info.address || '');
          appendedEl.replaceText('{{連絡電話}}', info.phone || '');
          appendedEl.replaceText('{{事由}}', record.reason);
          appendedEl.replaceText('{{計畫名稱}}', spreadsheetName);
          appendedEl.replaceText('{{科目}}', record.subject);
          appendedEl.replaceText('{{日期}}', record.dateStr);
          appendedEl.replaceText('{{時間}}', record.timeVal);
          appendedEl.replaceText('{{金額}}', record.amount);
          appendedEl.replaceText('{{單價}}', record.price);
          appendedEl.replaceText('{{數量}}', record.quantity);
          appendedEl.replaceText('{{金額國字}}', amountChinese);
          appendedEl.replaceText('{{民國年}}', record.rocYear);
          appendedEl.replaceText('{{西元年}}', record.westernYear);
          appendedEl.replaceText('{{月}}', record.month);
          appendedEl.replaceText('{{日}}', record.day);
        }
      });
    });

    // 刪除最前方的空段落 (由 body.clear() 產生的殘留段落)
    while (body.getChild(0).getType() === DocumentApp.ElementType.PARAGRAPH && body.getChild(0).getText() === "") {
      body.getChild(0).removeFromParent();
    }

    doc.saveAndClose();
    generatedFiles.push({
      name: group.templateName,
      id: tempDocId,
      file: tempFile
    });
  });

  if (generatedFiles.length === 0) {
    SpreadsheetApp.getUi().alert('產生收據時發生錯誤，請確認範本內容。');
    return;
  }

  // --- 5. 將已處理的資料標記為「已生成」，直接覆蓋 U 欄 ---
  recordsToProcess.forEach(record => {
    mainSheet.getRange(record.rowIndex, U_COL_INDEX + 1).setValue('已生成'); 
  });

  // --- 6. 產生下載對話框 ---
  let downloadButtonsHtml = '';
  let autoOpenScript = '';

  generatedFiles.forEach((fileInfo, idx) => {
    const downloadUrl = `https://docs.google.com/document/d/${fileInfo.id}/export?format=docx`;
    downloadButtonsHtml += `
      <a href="${downloadUrl}" target="_blank" 
         style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; margin: 5px; font-weight: bold;">
         📥 下載 ${fileInfo.name} (.docx)
      </a><br>
    `;
    autoOpenScript += `window.open('${downloadUrl}', '_blank');\n`;
  });

  const htmlContent = `
    <div style="font-family: sans-serif; text-align: center; padding: 15px;">
      <p style="font-size: 16px; margin-bottom: 10px;"><b>${recordsToProcess.length} 筆</b>收據已批次生成！</p>
      <p style="color: #666; font-size: 12px; margin-bottom: 15px;">已為您分組產出 ${generatedFiles.length} 個 Word 檔案，請點擊下載。</p>
      <div style="max-height: 150px; overflow-y: auto; padding: 5px;">
        ${downloadButtonsHtml}
      </div>
    </div>
    <script>
      // 自動嘗試下載所有檔案
      ${autoOpenScript}
      setTimeout(function() { google.script.host.close(); }, 5000);
    </script>
  `;

  const htmlOutput = HtmlService.createHtmlOutput(htmlContent).setWidth(400).setHeight(280);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, '正在打包下載收據...');

  // 設定暫存檔排程刪除
  Utilities.sleep(5000); 
  generatedFiles.forEach(fileInfo => {
    fileInfo.file.setTrashed(true); 
  });
}

// 輔助函數：數字轉大寫保持不變
function convertToChineseNumber(num) {
  if (!num) return "零";
  const strNum = num.toString();
  const digit = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
  const unit = ['', '拾', '佰', '仟', '萬', '拾', '佰', '仟', '億'];
  let result = '';
  for (let i = 0; i < strNum.length; i++) {
    const n = parseInt(strNum.charAt(i));
    const u = strNum.length - 1 - i;
    result += digit[n] + unit[u];
  }
  result = result.replace(/零[拾佰仟]/g, '零').replace(/零+/g, '零').replace(/零萬/g, '萬').replace(/零$/, '');
  return result;
}

// ==========================================
// ▼▼▼ 修改版：黏貼憑證單生成工具 (適應新增B欄與空行排版) ▼▼▼
// ==========================================

// 請替換為您「黏貼憑證單」的 Google Doc 範本 ID
const VOUCHER_TEMPLATE_ID = '18NVo0Mu1dXQXnrh_5msudjDFVY7nrBL1HKG10G9FG_c'; 

function generateBatchVouchers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getSheetByName('計畫收支');

  if (!mainSheet) {
    SpreadsheetApp.getUi().alert('找不到「計畫收支」工作表。');
    return;
  }

  const mainData = mainSheet.getDataRange().getValues();
  
  // 【修改1】因為 B 欄新增了「憑單編號」，原本的 V 欄 (黏貼單生成) 索引變成 21
  const V_COL_INDEX = 21; 

  // 用來群組化同一張憑單的物件字典
  const voucherGroups = {};
  const rowsToMark = [];

  // --- 1. 掃描 V 欄並進行群組化 ---
  for (let i = 1; i < mainData.length; i++) {
    if (mainData[i][V_COL_INDEX] === '生成') {
      rowsToMark.push(i + 1); // 紀錄列號

      // 【修改2】依據新欄位位置抓取資料 (所有索引 +1)
      let voucherKey = mainData[i][1] ? mainData[i][1].toString().trim() : '未命名憑單'; // B欄(1): 憑單編號
      let fullVoucherCode = mainData[i][2] ? mainData[i][2].toString().trim() : ''; // C欄(2): 憑證編號
      
      // 【修改4防呆】若憑證編號尾數是 08，自動轉為一位數 8 (例如 202601A001 08 -> 202601A001 8)
      fullVoucherCode = fullVoucherCode.replace(/ 0(\d)$/, ' $1');

      let subject = mainData[i][5] ? mainData[i][5].toString().trim() : ''; // F欄(5): 社大科目
      let reason = mainData[i][6] ? mainData[i][6].toString().trim() : ''; // G欄(6): 事由
      
      // 處理日期格式 (將 MM/dd 改為 M/d，解決月份出現 08 的問題)
      let rawDate = mainData[i][7]; // H欄(7): 日期
      let dateStr = '';
      if (rawDate instanceof Date) {
        dateStr = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), "M/d");
      } else if (rawDate) {
        dateStr = rawDate.toString();
      }

      let amount = parseFloat(mainData[i][11]) || 0; // L欄(11): 小計

      // 若該憑單尚未建立群組，則初始化
      if (!voucherGroups[voucherKey]) {
        voucherGroups[voucherKey] = {
          totalAmount: 0,
          subject: subject, // 【修改3】記錄該憑單的第一個社大科目
          details: []
        };
      }

      // 累加金額並紀錄明細
      voucherGroups[voucherKey].totalAmount += amount;
      voucherGroups[voucherKey].details.push({
        code: fullVoucherCode,
        desc: (dateStr + ' ' + reason).trim()
      });
    }
  }

  const groupKeys = Object.keys(voucherGroups);
  if (groupKeys.length === 0) {
    SpreadsheetApp.getUi().alert('在「黏貼單生成」欄位中沒有找到標註「生成」的資料。');
    return;
  }

  // --- 2. 複製 Word 範本並開啟 ---
  const tempFile = DriveApp.getFileById(VOUCHER_TEMPLATE_ID).makeCopy('批次黏貼單生成檔');
  const tempDocId = tempFile.getId();
  const doc = DocumentApp.openById(tempDocId);
  const body = doc.getBody();

  const tables = body.getTables();
  if (tables.length === 0) {
    SpreadsheetApp.getUi().alert('在範本文件中找不到表格。');
    return;
  }
  const masterTable = tables[0];
  const rocYear = new Date().getFullYear() - 1911;

  // --- 3. 依序填寫每個憑單群組 ---
  groupKeys.forEach((key, index) => {
    const groupData = voucherGroups[key];
    const newTable = body.appendTable(masterTable.copy());

    // 【修改3】準備分行列出的字串 (使用 \n\n 來產生空行)
    const codesStr = groupData.details.map(d => d.code).join('\n\n');
    const descsStr = groupData.details.map(d => d.desc).join('\n\n');

    // 處理金額拆解 (補齊 6 位數空格)
    let totalStr = Math.round(groupData.totalAmount).toString().padStart(6, ' ');

    // 替換單一標籤
    newTable.replaceText('{憑單編號}', key);
    newTable.replaceText('{year}', rocYear.toString());
    newTable.replaceText('{社大科目}', groupData.subject); // 統一顯示該群組的科目
    newTable.replaceText('{憑證編號}', codesStr);
    
    // 尋找並替換日期與事由
    newTable.replaceText('{日期} {事由}', descsStr); 
    newTable.replaceText('{日期}', ''); 
    newTable.replaceText('{事由}', descsStr);

    // 替換金額數字 (確保總額為一位數時也能完美對齊)
    newTable.replaceText('{dig_6}', totalStr.charAt(0) === ' ' ? '' : totalStr.charAt(0));
    newTable.replaceText('{dig_5}', totalStr.charAt(1) === ' ' ? '' : totalStr.charAt(1));
    newTable.replaceText('{dig_4}', totalStr.charAt(2) === ' ' ? '' : totalStr.charAt(2));
    newTable.replaceText('{dig_3}', totalStr.charAt(3) === ' ' ? '' : totalStr.charAt(3));
    newTable.replaceText('{dig_2}', totalStr.charAt(4) === ' ' ? '' : totalStr.charAt(4));
    newTable.replaceText('{dig_1}', totalStr.charAt(5) === ' ' ? '' : totalStr.charAt(5));

    // 排版邏輯：每一張表格後方加入換頁符號 (A4一頁一張)
    if (index < groupKeys.length - 1) {
      body.appendPageBreak();
    }
  });

  // 刪除母版表格與多餘空白
  masterTable.removeFromParent();
  while(body.getChild(0).getType() === DocumentApp.ElementType.PARAGRAPH && body.getChild(0).getText() === "") {
    body.getChild(0).removeFromParent();
  }
  doc.saveAndClose();

  // --- 4. 變更狀態為「已生成」 ---
  rowsToMark.forEach(rowIndex => {
    // 【修改1】V欄為第 22 欄 (getRange 是從 1 開始算)
    mainSheet.getRange(rowIndex, 22).setValue('已生成'); 
  });

  // --- 5. 觸發下載對話框 ---
  const downloadUrl = `https://docs.google.com/document/d/${tempDocId}/export?format=docx`;
  const htmlContent = `
    <div style="font-family: sans-serif; text-align: center; padding: 20px;">
      <p style="font-size: 16px;"><b>共 ${groupKeys.length} 張</b>黏貼單已批次生成！</p>
      <p style="color: #666; font-size: 12px;">如果沒有自動下載，請點擊下方按鈕。</p>
      <a href="${downloadUrl}" target="_blank" 
         style="display: inline-block; padding: 10px 20px; background-color: #2196F3; color: white; text-decoration: none; border-radius: 5px; margin-top: 10px;">
         📥 下載 Word 檔
      </a>
    </div>
    <script>
      window.open('${downloadUrl}', '_blank');
      setTimeout(function() { google.script.host.close(); }, 3000);
    </script>
  `;

  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(htmlContent).setWidth(350).setHeight(220), '正在打包下載...');
  Utilities.sleep(5000); 
  tempFile.setTrashed(true); 
}

// ==========================================
// 請用以下程式碼「完全覆蓋」您原本的 onOpen 函數
// 這樣選單就會同時出現這兩個功能！
// ==========================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('財務系統')
    .addItem('批次產出收據 (Word)', 'generateBatchWordReceipts')
    .addItem('批次產出黏貼憑證單 (Word)', 'generateBatchVouchers')
    .addToUi();
}