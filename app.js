import { 
  supabase, 
  initSupabase, 
  clearSupabaseConfig, 
  isSupabaseConfigured, 
  getSavedConfig 
} from './supabase.js';

// ==========================================
// ▼▼▼ 系統全域狀態管理 (Global State) ▼▼▼
// ==========================================
const state = {
  session: null,
  activeTab: 'panel-dashboard',
  projects: [],
  payees: [],
  transactions: [],
  filters: {
    projectId: '',
    payeeId: '',
    taxStatus: '',
    searchQuery: ''
  }
};

// ==========================================
// ▼▼▼ 啟動進入點 (Initialization) ▼▼▼
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  checkDatabaseConfig();
});

/**
 * 檢查資料庫連線金鑰是否存在，若不存在則強制顯示設定視窗
 */
function checkDatabaseConfig() {
  const loader = document.getElementById('loader');
  
  if (!isSupabaseConfigured()) {
    loader.style.opacity = '0';
    setTimeout(() => loader.style.display = 'none', 400);
    
    document.getElementById('config-screen').style.display = 'flex';
    showToast('⚠️ 請先輸入您的 Supabase 連線金鑰進行初始化！', 'danger');
  } else {
    // 已設定，載入金鑰至設定表單中備用
    const config = getSavedConfig();
    document.getElementById('settings-url').value = config.url;
    document.getElementById('settings-key').value = config.key;
    
    // 初始化驗證狀態監聽
    initAuthListener();
  }
}

/**
 * 初始化 Supabase 驗證狀態監聽
 */
async function initAuthListener() {
  const loader = document.getElementById('loader');
  
  try {
    // 取得當前 Session
    const { data: { session } } = await supabase.auth.getSession();
    handleAuthStateChange(session);

    // 監聽後續狀態轉變
    supabase.auth.onAuthStateChange((_event, session) => {
      handleAuthStateChange(session);
    });
  } catch (err) {
    console.error('驗證監聽初始化失敗：', err);
    showToast('❌ 連線 Supabase Auth 失敗，請確認金鑰是否正確！', 'danger');
    loader.style.opacity = '0';
    setTimeout(() => loader.style.display = 'none', 400);
  }
}

/**
 * 處理驗證狀態轉變
 * @param {object} session 
 */
async function handleAuthStateChange(session) {
  const loader = document.getElementById('loader');
  const authScreen = document.getElementById('auth-screen');
  
  state.session = session;

  if (session) {
    // 已登入：隱藏登入畫面，顯示主畫面並載入資料
    authScreen.style.animation = 'fadeOut 0.4s ease-out forwards';
    setTimeout(() => authScreen.style.display = 'none', 400);
    
    // 更新左下角使用者資訊
    const email = session.user.email;
    document.getElementById('user-email-display').innerText = email;
    document.getElementById('user-avatar-initial').innerText = email.charAt(0).toUpperCase();

    // 讀取資料庫
    await refreshAllData();
  } else {
    // 未登入：顯示登入畫面
    authScreen.style.display = 'flex';
    authScreen.style.animation = 'fadeIn 0.3s ease-out forwards';
    resetAppState();
  }

  // 關閉初始 Loader
  loader.style.opacity = '0';
  setTimeout(() => loader.style.display = 'none', 400);
}

/**
 * 登出或重設時清空狀態
 */
function resetAppState() {
  state.projects = [];
  state.payees = [];
  state.transactions = [];
  renderDashboard();
  renderTransactionsTable();
  renderProjectsTable();
  renderPayeesTable();
}

// ==========================================
// ▼▼▼ 資料讀取與載入模組 (Data Refresh) ▼▼▼
// ==========================================
async function refreshAllData() {
  if (!supabase) return;
  
  showLoaderMask('正在同步雲端資料，請稍候...');
  
  try {
    await Promise.all([
      fetchProjects(),
      fetchPayees(),
      fetchTransactions()
    ]);
    
    // 更新篩選下拉選單與表單下拉選單
    populateDropdowns();
    
    // 渲染各個視圖
    renderDashboard();
    renderTransactionsTable();
    renderProjectsTable();
    renderPayeesTable();
  } catch (err) {
    console.error('同步資料失敗：', err);
    showToast('❌ 同步雲端資料庫失敗！請檢查 RLS 政策與網路連線。', 'danger');
  } finally {
    hideLoaderMask();
  }
}

async function fetchProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('project_code', { ascending: true });
    
  if (error) throw error;
  state.projects = data || [];
}

async function fetchPayees() {
  const { data, error } = await supabase
    .from('payees')
    .select('*')
    .order('name', { ascending: true });
    
  if (error) throw error;
  state.payees = data || [];
}

async function fetchTransactions() {
  // 使用多表聯外鍵查詢，將專案編號與所得人姓名合併撈出
  const { data, error } = await supabase
    .from('transactions')
    .select(`
      *,
      projects ( project_code, project_name ),
      payees ( name )
    `)
    .order('transaction_date', { ascending: false });
    
  if (error) throw error;
  state.transactions = data || [];
}

// ==========================================
// ▼▼▼ 下拉選單填充元件 (Dropdown Populator) ▼▼▼
// ==========================================
function populateDropdowns() {
  // 1. 流水帳篩選選單
  const filterProj = document.getElementById('filter-tx-project');
  const filterPayee = document.getElementById('filter-tx-payee');
  
  // 2. 新增交易表單選單
  const formProj = document.getElementById('form-tx-project');
  const formPayee = document.getElementById('form-tx-payee');

  // 清空原有項目
  filterProj.innerHTML = '<option value="">-- 全部計畫 --</option>';
  filterPayee.innerHTML = '<option value="">-- 全部所得人 --</option>';
  
  formProj.innerHTML = '<option value="" disabled selected>-- 選擇計畫專案 * --</option>';
  formPayee.innerHTML = '<option value="">-- 無特定所得人 --</option>';

  // 填入專案
  state.projects.forEach(proj => {
    const optFilter = document.createElement('option');
    optFilter.value = proj.id;
    optFilter.textContent = `[${proj.project_code}] ${proj.project_name}`;
    filterProj.appendChild(optFilter);

    const optForm = document.createElement('option');
    optForm.value = proj.id;
    optForm.textContent = `[${proj.project_code}] ${proj.project_name}`;
    formProj.appendChild(optForm);
  });

  // 填入所得人
  state.payees.forEach(payee => {
    const optFilter = document.createElement('option');
    optFilter.value = payee.id;
    optFilter.textContent = payee.name;
    filterPayee.appendChild(optFilter);

    const optForm = document.createElement('option');
    optForm.value = payee.id;
    optForm.textContent = payee.name + (payee.title ? ` (${payee.title})` : '');
    formPayee.appendChild(optForm);
  });
}

// ==========================================
// ▼▼▼ 儀表板視圖渲染 (Dashboard Renderer) ▼▼▼
// ==========================================
function renderDashboard() {
  // 1. 計算統計指標
  const totalSpending = state.transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
  document.getElementById('dash-total-spending').innerText = formatCurrency(totalSpending);
  document.getElementById('dash-total-projects').innerText = state.projects.length;
  document.getElementById('dash-total-payees').innerText = state.payees.length;

  // 2. 渲染近期 5 筆交易
  const recentTbody = document.getElementById('dash-recent-tbody');
  recentTbody.innerHTML = '';
  
  const recentTxs = state.transactions.slice(0, 5);
  
  if (recentTxs.length === 0) {
    recentTbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">
          📭 目前尚無任何交易明細。
        </td>
      </tr>`;
  } else {
    recentTxs.forEach(tx => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${tx.transaction_date}</td>
        <td><span class="badge muted">${tx.projects?.project_code || '未關聯'}</span></td>
        <td><span style="font-weight:600;color:#4f46e5;">${tx.subject}</span></td>
        <td title="${tx.description || ''}" style="max-width: 180px; overflow: hidden; text-overflow: ellipsis;">${tx.description || '-'}</td>
        <td><b>${tx.payees?.name || '無特定人'}</b></td>
        <td class="num-col" style="color: #10b981;">${formatCurrency(tx.amount)}</td>
      `;
      recentTbody.appendChild(tr);
    });
  }

  // 3. 渲染科目支出占比分析 (Top 5)
  const subjectList = document.getElementById('dash-subject-list');
  subjectList.innerHTML = '';

  const subjectSums = {};
  state.transactions.forEach(tx => {
    if (!subjectSums[tx.subject]) {
      subjectSums[tx.subject] = 0;
    }
    subjectSums[tx.subject] += tx.amount || 0;
  });

  const sortedSubjects = Object.entries(subjectSums)
    .map(([name, val]) => ({ name, val }))
    .sort((a, b) => b.val - a.val);

  if (sortedSubjects.length === 0) {
    subjectList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 1rem;">無科目分析資料。</div>`;
  } else {
    sortedSubjects.slice(0, 5).forEach(item => {
      const percent = totalSpending > 0 ? ((item.val / totalSpending) * 100) : 0;
      
      const div = document.createElement('div');
      div.className = 'subject-analytic-item';
      div.innerHTML = `
        <div class="subject-analytic-info">
          <span class="subject-analytic-name">${item.name}</span>
          <span class="subject-analytic-amount">${formatCurrency(item.val)} (${percent.toFixed(1)}%)</span>
        </div>
        <div class="subject-analytic-bar">
          <div class="subject-analytic-fill" style="width: ${percent.toFixed(1)}%;"></div>
        </div>
      `;
      subjectList.appendChild(div);
    });
  }
}

// ==========================================
// ▼▼▼ 流水帳交易視圖與 CRUD (Transactions CRUD) ▼▼▼
// ==========================================
function renderTransactionsTable() {
  const tbody = document.getElementById('tx-tbody');
  tbody.innerHTML = '';

  // 依據全域篩選過濾流水帳
  const filteredTxs = state.transactions.filter(tx => {
    const matchProj = !state.filters.projectId || tx.project_id === state.filters.projectId;
    const matchPayee = !state.filters.payeeId || tx.payee_id === state.filters.payeeId;
    
    let matchTax = true;
    if (state.filters.taxStatus === 'true') matchTax = tx.is_tax_deductible === true;
    if (state.filters.taxStatus === 'false') matchTax = tx.is_tax_deductible !== true;

    const query = state.filters.searchQuery.toLowerCase();
    const matchQuery = !query || 
      (tx.subject && tx.subject.toLowerCase().includes(query)) ||
      (tx.description && tx.description.toLowerCase().includes(query)) ||
      (tx.voucher_code && tx.voucher_code.toLowerCase().includes(query)) ||
      (tx.receipt_code && tx.receipt_code.toLowerCase().includes(query));

    return matchProj && matchPayee && matchTax && matchQuery;
  });

  if (filteredTxs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10">
          <div class="empty-state">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <p>找不到符合條件的流水帳交易資料。</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  // 渲染交易明細行
  filteredTxs.forEach(tx => {
    const tr = document.createElement('tr');
    
    // 拼湊狀態標記小標章
    let badgeHtml = '';
    if (tx.is_tax_deductible) {
      badgeHtml += `<span class="badge success" style="margin-right: 0.2rem;">💰 扣免繳</span>`;
    }
    if (tx.receipt_generated) {
      badgeHtml += `<span class="badge success" style="background:rgba(79, 70, 229, 0.1);color:#4f46e5;border-color:rgba(79, 70, 229, 0.2);margin-right: 0.2rem;">📃 收據</span>`;
    }
    if (tx.voucher_generated) {
      badgeHtml += `<span class="badge success" style="background:rgba(245, 158, 11, 0.1);color:#d97706;border-color:rgba(245, 158, 11, 0.2);">📦 憑單</span>`;
    }
    if (!badgeHtml) {
      badgeHtml = `<span style="color:var(--text-muted);font-size:0.8rem;">-</span>`;
    }

    tr.innerHTML = `
      <td><b>${tx.payees?.name || '無特定所得人'}</b></td>
      <td><span class="badge muted">${tx.projects?.project_code || '未關聯'}</span></td>
      <td><span style="color:#4f46e5;font-weight:600">${tx.subject}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${tx.description || ''}">${tx.description || '-'}</td>
      <td>${tx.transaction_date}</td>
      <td><span style="font-family:'Outfit';color:var(--text-muted);">${tx.voucher_code || '-'}</span></td>
      <td><span style="font-family:'Outfit';color:var(--text-muted);">${tx.receipt_code || '-'}</span></td>
      <td class="num-col" style="color:#10b981;font-weight:700">${formatCurrency(tx.amount)}</td>
      <td style="text-align: center;">${badgeHtml}</td>
      <td class="col-actions">
        <button class="btn-action-icon edit-tx-btn" data-id="${tx.id}" title="修改收支紀錄">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        </button>
        <button class="btn-action-icon delete delete-tx-btn" data-id="${tx.id}" title="刪除此紀錄">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 為動態產生的編輯與刪除按鈕註冊事件
  document.querySelectorAll('.edit-tx-btn').forEach(btn => {
    btn.addEventListener('click', () => openTransactionModal(btn.getAttribute('data-id')));
  });
  document.querySelectorAll('.delete-tx-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteTransaction(btn.getAttribute('data-id')));
  });
}

/**
 * 開啟交易流水帳 Modal 表單
 * @param {string|null} txId (若為編輯傳入 id，新增傳 null)
 */
function openTransactionModal(txId = null) {
  const modal = document.getElementById('modal-transaction');
  const form = document.getElementById('form-transaction');
  
  form.reset();
  document.getElementById('form-tx-id').value = '';
  document.getElementById('modal-tx-title').innerText = txId ? '✏️ 編輯收支明細' : '➕ 新增收支明細';

  if (txId) {
    const tx = state.transactions.find(t => t.id === txId);
    if (tx) {
      document.getElementById('form-tx-id').value = tx.id;
      document.getElementById('form-tx-date').value = tx.transaction_date;
      document.getElementById('form-tx-project').value = tx.project_id;
      document.getElementById('form-tx-payee').value = tx.payee_id || '';
      document.getElementById('form-tx-subject').value = tx.subject;
      document.getElementById('form-tx-amount').value = tx.amount;
      document.getElementById('form-tx-reason').value = tx.description || '';
      document.getElementById('form-tx-voucher').value = tx.voucher_code || '';
      document.getElementById('form-tx-receipt').value = tx.receipt_code || '';
      document.getElementById('form-tx-istax').checked = tx.is_tax_deductible || false;
      document.getElementById('form-tx-gen-receipt').checked = tx.receipt_generated || false;
      document.getElementById('form-tx-gen-voucher').checked = tx.voucher_generated || false;
    }
  } else {
    // 預設日期為今天
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('form-tx-date').value = today;
  }

  modal.classList.add('active');
}

/**
 * 儲存收支交易流水帳 (新增與修改)
 */
async function saveTransaction(event) {
  event.preventDefault();
  const txId = document.getElementById('form-tx-id').value;
  
  const txData = {
    transaction_date: document.getElementById('form-tx-date').value,
    project_id: document.getElementById('form-tx-project').value,
    payee_id: document.getElementById('form-tx-payee').value || null,
    subject: document.getElementById('form-tx-subject').value.trim(),
    amount: parseInt(document.getElementById('form-tx-amount').value) || 0,
    description: document.getElementById('form-tx-reason').value.trim() || null,
    voucher_code: document.getElementById('form-tx-voucher').value.trim() || null,
    receipt_code: document.getElementById('form-tx-receipt').value.trim() || null,
    is_tax_deductible: document.getElementById('form-tx-istax').checked,
    receipt_generated: document.getElementById('form-tx-gen-receipt').checked,
    voucher_generated: document.getElementById('form-tx-gen-voucher').checked
  };

  showLoaderMask('儲存收支帳目中...');
  
  try {
    let response;
    if (txId) {
      // 編輯修改
      response = await supabase
        .from('transactions')
        .update(txData)
        .eq('id', txId);
    } else {
      // 新增流水帳
      response = await supabase
        .from('transactions')
        .insert([txData]);
    }

    if (response.error) throw response.error;
    
    showToast('🎉 收支明細已成功儲存！', 'success');
    closeAllModals();
    await refreshAllData();
  } catch (err) {
    console.error('儲存收支交易失敗：', err);
    showToast('❌ 儲存失敗！請確認連線與欄位資料設定。', 'danger');
  } finally {
    hideLoaderMask();
  }
}

/**
 * 刪除單筆收支明細
 * @param {string} txId 
 */
async function deleteTransaction(txId) {
  if (!confirm('🚨 確定要刪除這筆收支交易流水帳嗎？此動作將無法復原！')) return;
  
  showLoaderMask('正在刪除交易帳目...');
  
  try {
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', txId);
      
    if (error) throw error;
    
    showToast('🗑️ 交易已成功刪除！', 'success');
    await refreshAllData();
  } catch (err) {
    console.error('刪除交易失敗：', err);
    showToast('❌ 刪除交易失敗，請稍後再試。', 'danger');
  } finally {
    hideLoaderMask();
  }
}

// ==========================================
// ▼▼▼ 計畫專案管理視圖與 CRUD (Projects CRUD) ▼▼▼
// ==========================================
function renderProjectsTable() {
  const tbody = document.getElementById('project-tbody');
  tbody.innerHTML = '';

  if (state.projects.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">
          📭 目前尚無任何計畫專案資料，請點擊新增。
        </td>
      </tr>`;
    return;
  }

  state.projects.forEach(proj => {
    const tr = document.createElement('tr');
    
    // 格式化建立時間
    let timeStr = '-';
    if (proj.created_at) {
      const d = new Date(proj.created_at);
      timeStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }

    tr.innerHTML = `
      <td><b><span class="badge muted">${proj.project_code}</span></b></td>
      <td>${proj.project_name}</td>
      <td><span style="font-family:'Outfit';color:var(--text-muted);">${timeStr}</span></td>
      <td class="col-actions">
        <button class="btn-action-icon edit-proj-btn" data-id="${proj.id}" title="修改計畫資訊">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        </button>
        <button class="btn-action-icon delete delete-proj-btn" data-id="${proj.id}" title="刪除專案計畫">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.edit-proj-btn').forEach(btn => {
    btn.addEventListener('click', () => openProjectModal(btn.getAttribute('data-id')));
  });
  document.querySelectorAll('.delete-proj-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteProject(btn.getAttribute('data-id')));
  });
}

function openProjectModal(projId = null) {
  const modal = document.getElementById('modal-project');
  const form = document.getElementById('form-project');
  
  form.reset();
  document.getElementById('form-proj-id').value = '';
  document.getElementById('modal-proj-title').innerText = projId ? '✏️ 編輯計畫專案' : '➕ 新增計畫專案';

  if (projId) {
    const proj = state.projects.find(p => p.id === projId);
    if (proj) {
      document.getElementById('form-proj-id').value = proj.id;
      document.getElementById('form-proj-code').value = proj.project_code;
      document.getElementById('form-proj-name').value = proj.project_name;
    }
  }

  modal.classList.add('active');
}

async function saveProject(event) {
  event.preventDefault();
  const projId = document.getElementById('form-proj-id').value;
  
  const projData = {
    project_code: document.getElementById('form-proj-code').value.trim(),
    project_name: document.getElementById('form-proj-name').value.trim()
  };

  showLoaderMask('儲存計畫專案中...');
  
  try {
    let response;
    if (projId) {
      response = await supabase
        .from('projects')
        .update(projData)
        .eq('id', projId);
    } else {
      response = await supabase
        .from('projects')
        .insert([projData]);
    }

    if (response.error) throw response.error;
    
    showToast('🎉 計畫專案已儲存成功！', 'success');
    closeAllModals();
    await refreshAllData();
  } catch (err) {
    console.error('儲存專案失敗：', err);
    showToast('❌ 儲存失敗！代碼可能重複。', 'danger');
  } finally {
    hideLoaderMask();
  }
}

async function deleteProject(projId) {
  if (!confirm('🚨 確定要刪除此計畫專案嗎？\n此動作將一併刪除所有與此計畫關聯的收支交易流水帳！且動作無法復原！')) return;
  
  showLoaderMask('正在刪除計畫...');
  
  try {
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projId);
      
    if (error) throw error;
    
    showToast('🗑️ 專案已成功刪除！', 'success');
    await refreshAllData();
  } catch (err) {
    console.error('刪除專案失敗：', err);
    showToast('❌ 刪除專案失敗，請稍後再試。', 'danger');
  } finally {
    hideLoaderMask();
  }
}

// ==========================================
// ▼▼▼ 所得人清冊管理視圖與 CRUD (Payees CRUD) ▼▼▼
// ==========================================
function renderPayeesTable() {
  const tbody = document.getElementById('payee-tbody');
  tbody.innerHTML = '';

  if (state.payees.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">
          📭 目前尚無任何所得人清冊資料，請點擊新增。
        </td>
      </tr>`;
    return;
  }

  state.payees.forEach(payee => {
    const tr = document.createElement('tr');
    
    tr.innerHTML = `
      <td><b>${payee.name}</b></td>
      <td><span style="font-family:'Outfit';color:var(--text-muted);">${payee.id_number || '-'}</span></td>
      <td>${payee.unit || '-'} ${payee.title ? `/ ${payee.title}` : ''}</td>
      <td><span style="font-family:'Outfit';">${payee.phone || '-'}</span></td>
      <td title="${payee.address || ''}" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${payee.address || '-'}</td>
      <td class="col-actions">
        <button class="btn-action-icon edit-payee-btn" data-id="${payee.id}" title="修改所得人資訊">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        </button>
        <button class="btn-action-icon delete delete-payee-btn" data-id="${payee.id}" title="刪除所得人">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.edit-payee-btn').forEach(btn => {
    btn.addEventListener('click', () => openPayeeModal(btn.getAttribute('data-id')));
  });
  document.querySelectorAll('.delete-payee-btn').forEach(btn => {
    btn.addEventListener('click', () => deletePayee(btn.getAttribute('data-id')));
  });
}

function openPayeeModal(payeeId = null) {
  const modal = document.getElementById('modal-payee');
  const form = document.getElementById('form-payee');
  
  form.reset();
  document.getElementById('form-payee-id').value = '';
  document.getElementById('modal-payee-title').innerText = payeeId ? '✏️ 編輯所得人' : '➕ 新增所得人資料';

  if (payeeId) {
    const payee = state.payees.find(p => p.id === payeeId);
    if (payee) {
      document.getElementById('form-payee-id').value = payee.id;
      document.getElementById('form-payee-name').value = payee.name;
      document.getElementById('form-payee-idnum').value = payee.id_number || '';
      document.getElementById('form-payee-phone').value = payee.phone || '';
      document.getElementById('form-payee-unit').value = payee.unit || '';
      document.getElementById('form-payee-title').value = payee.title || '';
      document.getElementById('form-payee-address').value = payee.address || '';
    }
  }

  modal.classList.add('active');
}

async function savePayee(event) {
  event.preventDefault();
  const payeeId = document.getElementById('form-payee-id').value;
  
  const payeeData = {
    name: document.getElementById('form-payee-name').value.trim(),
    id_number: document.getElementById('form-payee-idnum').value.trim() || null,
    phone: document.getElementById('form-payee-phone').value.trim() || null,
    unit: document.getElementById('form-payee-unit').value.trim() || null,
    title: document.getElementById('form-payee-title').value.trim() || null,
    address: document.getElementById('form-payee-address').value.trim() || null
  };

  showLoaderMask('儲存所得人資料中...');
  
  try {
    let response;
    if (payeeId) {
      response = await supabase
        .from('payees')
        .update(payeeData)
        .eq('id', payeeId);
    } else {
      response = await supabase
        .from('payees')
        .insert([payeeData]);
    }

    if (response.error) throw response.error;
    
    showToast('🎉 所得人資訊已成功儲存！', 'success');
    closeAllModals();
    await refreshAllData();
  } catch (err) {
    console.error('儲存所得人失敗：', err);
    showToast('❌ 儲存失敗！身分證號可能重疊。', 'danger');
  } finally {
    hideLoaderMask();
  }
}

async function deletePayee(payeeId) {
  if (!confirm('確定要刪除此所得人建檔嗎？\n原有的交易流水帳仍會保留，但連結到的所得人將設為空白。動作無法復原！')) return;
  
  showLoaderMask('正在刪除所得人資訊...');
  
  try {
    const { error } = await supabase
      .from('payees')
      .delete()
      .eq('id', payeeId);
      
    if (error) throw error;
    
    showToast('🗑️ 所得人已成功刪除！', 'success');
    await refreshAllData();
  } catch (err) {
    console.error('刪除所得人失敗：', err);
    showToast('❌ 刪除所得人失敗，請稍後再試。', 'danger');
  } finally {
    hideLoaderMask();
  }
}

// ==========================================
// ▼▼▼ 帳密驗證核心控制列 (Authentication Auth CRUD) ▼▼▼
// ==========================================
let isSignUpMode = false;

function toggleAuthMode() {
  isSignUpMode = !isSignUpMode;
  
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const submitBtn = document.getElementById('btn-auth-submit');
  const toggleMsg = document.getElementById('auth-toggle-msg');
  const toggleLink = document.getElementById('auth-toggle-link');
  
  if (isSignUpMode) {
    title.innerText = '註冊系統帳號';
    subtitle.innerText = '建立您的電子郵件與密碼，加入財務收支管理系統';
    submitBtn.innerText = '🆕 註冊新帳號';
    toggleMsg.innerText = '已經擁有帳號嗎？';
    toggleLink.innerText = '立即登入';
  } else {
    title.innerText = '登入系統';
    subtitle.innerText = '請輸入您的電子郵件與密碼登入財務管理系統';
    submitBtn.innerText = '🔑 安全登入';
    toggleMsg.innerText = '尚未擁有帳號嗎？';
    toggleLink.innerText = '立即註冊';
  }
}

async function handleAuthFormSubmit(event) {
  event.preventDefault();
  
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  
  showLoaderMask(isSignUpMode ? '正在註冊並驗證...' : '安全登入中，請稍候...');
  
  try {
    if (isSignUpMode) {
      // 1. 註冊帳號
      const { data, error } = await supabase.auth.signUp({
        email,
        password
      });
      if (error) throw error;
      
      // 判斷是否需要信箱驗證
      if (data.user && data.session === null) {
        showToast('📬 註冊成功！請至您的信箱收取驗證信，以啟用您的帳戶。', 'success');
        isSignUpMode = false;
        toggleAuthMode();
      } else if (data.session) {
        showToast('🎉 帳號已成功註冊並登入！', 'success');
      }
    } else {
      // 2. 登入帳號
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      if (error) throw error;
      showToast('⚡ 歡迎回來！登入成功。', 'success');
    }
  } catch (err) {
    console.error('身分驗證失敗：', err);
    showToast('❌ 驗證失敗：' + (err.message || '請確認密碼或帳號存在！'), 'danger');
  } finally {
    hideLoaderMask();
  }
}

async function handleLogOut() {
  if (!confirm('🚪 確定要登出財務會計管理系統嗎？')) return;
  
  showLoaderMask('正在登出...');
  
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    showToast('👋 已安全登出系統。', 'success');
  } catch (err) {
    console.error('登出失敗：', err);
    showToast('❌ 登出發生錯誤，請重試。', 'danger');
  } finally {
    hideLoaderMask();
  }
}

// ==========================================
// ▼▼▼ 資料庫連線配置控制列 (Database Settings) ▼▼▼
// ==========================================
function saveDbConfiguration(urlInputId, keyInputId) {
  const url = document.getElementById(urlInputId).value.trim();
  const key = document.getElementById(keyInputId).value.trim();
  
  if (!url || !key) {
    showToast('❌ 請輸入完整的 Project URL 與 Anon Key！', 'danger');
    return;
  }
  
  try {
    initSupabase(url, key);
    showToast('💾 資料庫金鑰設定儲存成功！正在重載...', 'success');
    
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  } catch (err) {
    console.error('設定失敗：', err);
    showToast('❌ 金鑰設定失敗，請確認網址格式！', 'danger');
  }
}

function handleClearDbConfig() {
  if (!confirm('⚠️ 清除後您將無法與雲端資料庫同步，且將強制跳轉至設定畫面！確定清除嗎？')) return;
  clearSupabaseConfig();
  showToast('🗑️ 資料庫連線金鑰已成功清除。', 'success');
  setTimeout(() => {
    window.location.reload();
  }, 1000);
}

// ==========================================
// ▼▼▼ 事件註冊與視圖切換 (Event Handlers) ▼▼▼
// ==========================================
function setupEventListeners() {
  // 1. 左側選單切換
  document.querySelectorAll('.menu-list .menu-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.menu-list .menu-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      
      const targetId = item.getAttribute('data-target');
      document.querySelectorAll('.content-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(targetId).classList.add('active');
      
      state.activeTab = targetId;

      // 手機版自動收合選單
      if (window.innerWidth <= 768) {
        document.querySelector('.sidebar').classList.remove('active');
      }

      // 切換至儀表板或分析時重新繪製動畫
      if (targetId === 'panel-dashboard') {
        renderDashboard();
      }
    });
  });

  // 手機版側欄收合切換
  const sidebarToggle = document.getElementById('sidebar-toggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      document.querySelector('.sidebar').classList.toggle('active');
    });
  }

  // 點擊側欄以外的區域自動收起側欄
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
      const sidebar = document.querySelector('.sidebar');
      const toggle = document.getElementById('sidebar-toggle');
      if (sidebar.classList.contains('active') && !sidebar.contains(e.target) && !toggle.contains(e.target)) {
        sidebar.classList.remove('active');
      }
    }
  });

  // 2. 帳密登入與註冊表單事件
  document.getElementById('auth-form').addEventListener('submit', handleAuthFormSubmit);
  document.getElementById('auth-toggle-link').addEventListener('click', toggleAuthMode);
  document.getElementById('btn-logout').addEventListener('click', handleLogOut);

  // 3. 初始化資料庫金鑰與設定視窗
  document.getElementById('config-form').addEventListener('submit', () => saveDbConfiguration('config-url', 'config-key'));
  document.getElementById('settings-db-form').addEventListener('submit', () => saveDbConfiguration('settings-url', 'settings-key'));
  document.getElementById('btn-settings-clear-db').addEventListener('click', handleClearDbConfig);

  // 4. 流水帳搜尋與篩選事件
  document.getElementById('filter-tx-project').addEventListener('change', (e) => {
    state.filters.projectId = e.target.value;
    renderTransactionsTable();
  });
  document.getElementById('filter-tx-payee').addEventListener('change', (e) => {
    state.filters.payeeId = e.target.value;
    renderTransactionsTable();
  });
  document.getElementById('filter-tx-tax').addEventListener('change', (e) => {
    state.filters.taxStatus = e.target.value;
    renderTransactionsTable();
  });
  document.getElementById('filter-tx-search').addEventListener('input', (e) => {
    state.filters.searchQuery = e.target.value;
    renderTransactionsTable();
  });
  document.getElementById('btn-tx-reset').addEventListener('click', () => {
    document.getElementById('filter-tx-project').value = '';
    document.getElementById('filter-tx-payee').value = '';
    document.getElementById('filter-tx-tax').value = '';
    document.getElementById('filter-tx-search').value = '';
    state.filters = { projectId: '', payeeId: '', taxStatus: '', searchQuery: '' };
    renderTransactionsTable();
  });

  // 5. 彈出式表單 (Modals) 開啟與儲存事件
  // 流水帳 Modal
  document.getElementById('btn-add-transaction').addEventListener('click', () => openTransactionModal(null));
  document.getElementById('form-transaction').addEventListener('submit', saveTransaction);

  // 計畫專案 Modal
  document.getElementById('btn-add-project').addEventListener('click', () => openProjectModal(null));
  document.getElementById('form-project').addEventListener('submit', saveProject);

  // 所得人 Modal
  document.getElementById('btn-add-payee').addEventListener('click', () => openPayeeModal(null));
  document.getElementById('form-payee').addEventListener('submit', savePayee);

  // 通用關閉 Modal 按鈕事件
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  // 點擊 Modal 外部半透明處關閉視窗
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeAllModals();
    });
  });
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(o => o.classList.remove('active'));
}

// ==========================================
// ▼▼▼ 介面輔助工具元件 (UI Helpers) ▼▼▼
// ==========================================

/**
 * 格式化為台幣千分位
 * @param {number} num 
 */
function formatCurrency(num) {
  return '$' + Math.round(num || 0).toLocaleString('zh-TW');
}

/**
 * 彈出式 Toast 通知
 * @param {string} msg 
 * @param {string} type ('success' | 'danger' | 'info')
 */
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.className = ''; // 重設
  if (type === 'danger') toast.classList.add('danger');
  if (type === 'success') toast.classList.add('success');
  
  // 圖示拼湊
  let icon = '✨';
  if (type === 'danger') icon = '🚨';
  if (type === 'success') icon = '✅';
  
  toast.querySelector('.toast-icon').innerText = icon;
  toast.querySelector('.toast-text').innerText = msg;
  
  toast.style.display = 'flex';
  
  // 3.5秒後淡出
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.4s ease-out forwards';
    setTimeout(() => {
      toast.style.display = 'none';
      toast.style.animation = ''; // 還原
    }, 400);
  }, 3500);
}

/**
 * 顯示主進度載入遮罩
 * @param {string} text 
 */
function showLoaderMask(text = '處理中，請稍候...') {
  const mask = document.getElementById('loader');
  mask.querySelector('.loader-text').innerText = text;
  mask.style.display = 'flex';
  mask.style.opacity = '1';
}

/**
 * 隱藏主進度載入遮罩
 */
function hideLoaderMask() {
  const mask = document.getElementById('loader');
  mask.style.opacity = '0';
  setTimeout(() => {
    mask.style.display = 'none';
  }, 400);
}
