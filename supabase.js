import { createClient } from '@supabase/supabase-js';

// 優先自環境變數讀取，次自本地儲存 LocalStorage 讀取
let supabaseUrl = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('supabase_url') || '';
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
  localStorage.setItem('supabase_url', url.trim());
  localStorage.setItem('supabase_anon_key', key.trim());
  supabase = createClient(url.trim(), key.trim());
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
