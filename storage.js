const DB_NAME = 'yuu-vocal-range-trainer-v1';
let database;
export async function db() {
  if (database) return database;
  database = await new Promise((resolve,reject) => {
    const request = indexedDB.open(DB_NAME,1);
    request.onupgradeneeded = () => {
      const d = request.result;
      if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions',{keyPath:'id'});
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings');
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('別のタブを閉じてから再試行してください。'));
  });
  return database;
}
async function transaction(store,mode,action) {
  const d = await db();
  return new Promise((resolve,reject) => {
    const tx = d.transaction(store,mode), request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存を中断しました。'));
  });
}
export const saveSession = session => transaction('sessions','readwrite',s=>s.put(session));
export const listSessions = () => transaction('sessions','readonly',s=>s.getAll());
export const deleteSession = id => transaction('sessions','readwrite',s=>s.delete(id));
export const getSettings = () => transaction('settings','readonly',s=>s.get('preferences'));
export const saveSettings = settings => transaction('settings','readwrite',s=>s.put(settings,'preferences'));
