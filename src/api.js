import { APPS_SCRIPT_URL } from './config.js';

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('GAS 連線逾時，請重新開啟 CRM 面板後再試');
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

function parseJsonResponse(text) {
    try {
        return JSON.parse(text);
    } catch(e) {
        return {
            success: false,
            error: 'GAS 回傳不是 JSON，可能部署或登入狀態異常'
        };
    }
}

export async function gasGet(params){
    const url=APPS_SCRIPT_URL+'?'+new URLSearchParams(params).toString();
    const res=await fetchWithTimeout(url);
    const text=await res.text();
    return parseJsonResponse(text);
}

export async function gasPost(data){
    const res=await fetchWithTimeout(APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(data)});
    const text=await res.text();
    return parseJsonResponse(text);
}

function requireSuccess(result, actionName) {
    if (result && result.success === false) {
        throw new Error(result.error || (actionName + ' 失敗'));
    }
    return result;
}

export async function initSheet(){ await gasGet({action:'init'}); }
export async function readSheet(){ return gasGet({action:'read'}); }
export async function appendRow(values){ return requireSuccess(await gasPost({action:'append',values}), 'append'); }
export async function updateRow(rowNum,values){ return requireSuccess(await gasPost({action:'update',rowNum,values}), 'update'); }
export async function deleteRow(rowNum){ return requireSuccess(await gasPost({action:'delete',rowNum}), 'delete'); }
