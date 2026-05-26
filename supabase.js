import { createClient } from '@supabase/supabase-js';

/**
 * 自動淨化與修正使用者輸入的 Supabase URL
 * @param {string} url 
 * @returns {string} 乾淨的 https://xxxx.supabase.co 網址
 */
export function sanitizeSupabaseUrl(url) {
  if (!url) return '';
  let cleaned = url.trim();
  
  // 1. 如果使用者不小心複製了後台管理頁面網址
  // 例如: https://supabase.com/dashboard/project/abcde...
  if (cleaned.includes('supabase.com/dashboard/project/')) {
    const parts = cleaned.split('/project/');
    if (parts.length > 1) {
      const ref = parts[1].split('/')[0].split('?')[0].trim();
      return `https://${ref}.supabase.co`;
    }
  }
  
  // 2. 如果使用者複製了包含 API 路徑的網址
  // 例如: https://xxxx.supabase.co/rest/v1
  if (cleaned.includes('.supabase.co')) {
    const parts = cleaned.split('.supabase.co');
    return parts[0].trim() + '.supabase.co';
  }
  
  // 3. 移除結尾的斜線
  if (cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1);
  }
  
  return cleaned;
}

// 優先自環境變數讀取，次自本地儲存 LocalStorage 讀取，並進行自動淨化
let supabaseUrl = sanitizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('supabase_url') || '');
let supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('supabase_anon_key') || '';

export let supabase = null;

if (supabaseUrl && supabaseUrl.trim() && supabaseAnonKey && supabaseAnonKey.trim()) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  } catch (err) {
    console.error('Supabase 初始化失敗：', err);
  }
}

/**
 * 手動設定 Supabase 連線資訊並初始化客戶端
 * @param {string} url 
 * @param {string} key 
 * @returns {object} Supabase Client
 */
export function initSupabase(url, key) {
  if (!url || !key) throw new Error('網址與金鑰不可為空！');
  const cleanUrl = sanitizeSupabaseUrl(url);
  localStorage.setItem('supabase_url', cleanUrl);
  localStorage.setItem('supabase_anon_key', key.trim());
  supabase = createClient(cleanUrl, key.trim());
  return supabase;
}

/**
 * 清除本地儲存的連線資訊並重設客戶端
 */
export function clearSupabaseConfig() {
  localStorage.removeItem('supabase_url');
  localStorage.removeItem('supabase_anon_key');
  supabase = null;
}

/**
 * 檢查系統目前是否已完成資料庫連線設定
 * @returns {boolean}
 */
export function isSupabaseConfigured() {
  return supabase !== null;
}

/**
 * 取得目前設定的連線網址與金鑰
 */
export function getSavedConfig() {
  return {
    url: import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('supabase_url') || '',
    key: import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('supabase_anon_key') || ''
  };
}
