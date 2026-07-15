import { MANAGER_UID, APPS_SCRIPT_URL, INTERVIEW_TEMPLATE, USER_DICT } from './config';
import { gasGet, gasPost, initSheet, readSheet, appendRow, updateRow, deleteRow } from './api';


/* ══ 安全防線：只允許在 etalking 網域執行 ══ */

const host=window.location.hostname;
if(!['www.etalkingonline.com','admin.etalkingonline.com'].includes(host)){
    alert('❌ 此工具僅限在 etalking 後台使用\n\n請先登入後台再點擊書籤！');
    return;
}

const path=window.location.pathname;

if(host==='www.etalkingonline.com'&&!path.includes('request_develop')){
    alert('⚠️ 通道已失效！\n\n① 點確定返回後台\n② 進入名單管理頁面\n③ 點開任一張單的「編輯」\n④ 再點一次書籤');
    window.location.href='https://admin.etalkingonline.com/etalking2.0/#/request_list';
    return;
}

if(host==='admin.etalkingonline.com'){
    if(confirm('需要切換至專屬通道\n\n點確定後跳轉，再點一次書籤即可載入！\n\n💡 若跳轉失敗，請先點開任一張單的「編輯」再試。')){
        const uid=localStorage.getItem('uid')||'';
        const tUrl='https://www.etalkingonline.com/admin/request_develop?member_id=232821&hide_layout=true'+(uid?'&crm_uid='+uid:'');
        const f=document.createElement('iframe');f.style.display='none';f.src=tUrl;
        document.body.appendChild(f);
        setTimeout(()=>{f.remove();window.location.href=tUrl;},2000);
    }
    return;
}

const urlParams=new URLSearchParams(window.location.search);
const crmUid=urlParams.get('crm_uid')||'';
const originalUid=urlParams.get('original_uid')||''; // ★ 新增：用於記錄真實身分
if(!crmUid){alert('❌ 無法識別身份！\n\n請從 etalking 後台點擊書籤來啟動工具。');return;}

/* ══ ★ 新增：手機版 Viewport 優化 (確保手機正確縮放) ══ */
let addedViewport = false;
if (!document.querySelector('meta[name="viewport"]')) {
    const meta = document.createElement('meta');
    meta.id = 'custom-crm-viewport';
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1.0';
    document.head.appendChild(meta);
    addedViewport = true;
}


const isManager=crmUid===MANAGER_UID;
const isSpoofing=!!originalUid; 
const fetchUrl='https://server.etalkingonline.com/name_list/new_list/'+(isManager?'-1':crmUid);
const CRM_BUILD_ID=__CRM_BUILD_ID__;
const CRM_SCRIPT_CHECK_URL='https://raw.githubusercontent.com/JimChen0712/etalking-crm/main/crm.js';
const PANEL_MAX_AGE_MS=2*60*60*1000;
const GUARD_SESSION_CACHE_MS=30000;
const GUARD_VERSION_CACHE_MS=60000;
const panelStartedAt=Date.now();
let lastBackendGuardAt=0;
let lastVersionGuardAt=0;
let lastGuardAlertAt=0;

async function guardFetch(url, options={}, timeoutMs=12000) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(), timeoutMs);
    try{
        return await fetch(url,{...options,signal:controller.signal,credentials:'include'});
    }catch(e){
        if(e.name==='AbortError')throw new Error('連線逾時，請重新整理後台並重新開啟 CRM 面板');
        throw e;
    }finally{
        clearTimeout(timer);
    }
}

async function ensureLatestPanelVersion(){
    const now=Date.now();
    if(now-lastVersionGuardAt<GUARD_VERSION_CACHE_MS)return;
    let res;
    let text;
    try{
        res=await guardFetch(CRM_SCRIPT_CHECK_URL+'?crm_version_check='+now,{cache:'no-store'},12000);
        text=await res.text();
    }catch(e){
        console.warn('[CRM 版本檢查暫時失敗，允許繼續寫入]',e);
        return;
    }
    if(!res.ok){
        console.warn('[CRM 版本檢查服務回應異常，允許繼續寫入]',res.status);
        return;
    }
    lastVersionGuardAt=now;
    if(!text.includes(CRM_BUILD_ID)){
        throw new Error('CRM 面板已有新版，請關閉面板、重新整理後台，再點一次書籤');
    }
}

function looksLikeLoginPage(text){
    const compact=String(text||'').replace(/\s+/g,'').toLowerCase();
    return compact.includes('login')||compact.includes('登入')||compact.includes('請先登入')||compact.includes('sign in');
}

function looksLikeMemberDetail(text, memberId){
    const body=String(text||'');
    if(!body||body.length<500)return false;
    if(looksLikeLoginPage(body))return false;
    return body.includes(String(memberId))||body.includes('<table')||body.includes('聯絡')||body.includes('名單')||body.includes('request_develop');
}

async function ensureBackendSession(memberId){
    const now=Date.now();
    if(now-lastBackendGuardAt<GUARD_SESSION_CACHE_MS)return;
    const checkId=memberId||232821;
    let lastError=null;
    for(let attempt=0;attempt<2;attempt++){
        try{
            const res=await guardFetch('/admin/request_develop?member_id='+encodeURIComponent(checkId)+'&hide_layout=true&crm_guard='+Date.now(),{cache:'no-store'},12000);
            const text=await res.text();
            if(!res.ok||!looksLikeMemberDetail(text, checkId)){
                throw new Error('後台回應異常或登入狀態已失效');
            }
            lastBackendGuardAt=Date.now();
            return;
        }catch(e){
            lastError=e;
            if(attempt===0)await new Promise(r=>setTimeout(r,500));
        }
    }
    throw new Error('無法確認後台登入狀態，紀錄尚未送出。請重新整理後台並重新開啟 CRM 面板。'+(lastError&&lastError.message?'（'+lastError.message+'）':''));
}

async function ensurePanelCanWrite(memberId){
    if(Date.now()-panelStartedAt>PANEL_MAX_AGE_MS){
        throw new Error('CRM 面板已開啟超過 2 小時，請重新整理後台並重新開啟面板');
    }
    await ensureLatestPanelVersion();
    await ensureBackendSession(memberId);
}

function notifyGuardError(err){
    const message=err&&err.message?err.message:String(err||'未知錯誤');
    if(Date.now()-lastGuardAlertAt>5000){
        lastGuardAlertAt=Date.now();
        alert('⚠️ 寫入已停止\n\n'+message);
    }
}

/* ══ LocalStorage 聯繫紀錄管理 ══ */
const LOCAL_CONTACTED_KEY = 'etalking_contacted_pool';
const EXPIRE_DAYS = 14; 

function getLocalContacted() {
    try {
        let dict = JSON.parse(localStorage.getItem(LOCAL_CONTACTED_KEY) || '{}');
        let now = Date.now();
        let changed = false;
        for (let id in dict) {
            if (now - dict[id] > EXPIRE_DAYS * 86400000) {
                delete dict[id];
                changed = true;
            }
        }
        if (changed) localStorage.setItem(LOCAL_CONTACTED_KEY, JSON.stringify(dict));
        return dict;
    } catch(e) { return {}; }
}

function setLocalContacted(id, toggle = false) {
    let dict = getLocalContacted();
    if (toggle && dict[id]) {
        delete dict[id];
    } else {
        dict[id] = Date.now();
    }
    localStorage.setItem(LOCAL_CONTACTED_KEY, JSON.stringify(dict));
}



/* ══ 全局變數 ══ */
let sheetData={}, sheetRowMap={};
let allData=[], detailData={}, currentItem=null;
let contactHistoryCache={};
let currentHistoryMemberId='';
let historyShowAll=false;
let maxKnownRow = 1;

let currentTab = 'crm';
let poolData = [];
let poolSourceFilter = '-1';
let poolFilterStart  = '';
let poolFilterEnd    = '';
let renderPoolList = () => {}; 

// ★ 分頁與搜尋狀態管理
let currentPage = 1;
let poolCurrentPage = 1;
let currentSearchTerm = '';

/* ══════════════════════════════════════════════════════
   ★ Global Promise Queue（全域單線程排隊鎖）
══════════════════════════════════════════════════════ */
let globalSheetWriteLock = Promise.resolve();

async function appendMemberToSheet(memberId, item, assignDate) {
    const id = String(memberId);
    if (typeof sheetRowMap[id] === 'number') return;
    await ensurePanelCanWrite(id);

    const now = new Date();
    const month = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0');
    const dateStr = assignDate || now.toISOString().split('T')[0];
    const ownerName = (item.user_name && item.user_name.trim())
        ? item.user_name.trim() : getWriterName();

    const contactRate = (detailData[id] && detailData[id].contactRate) ? detailData[id].contactRate : '';

    const res = await appendRow([
        id, item.member_name || '', item.mobile || '',
        item.source || '無', ownerName, crmUid, dateStr, month,
        item.type == 1 ? '新單' : '', '', '', now.toLocaleString('zh-TW'),
        contactRate
    ]);

    if (res && typeof res.rowNum === 'number' && res.rowNum > 0) {
        sheetRowMap[id] = res.rowNum;
        if (res.rowNum > maxKnownRow) maxKnownRow = res.rowNum;
    } else {
        throw new Error('appendRow 回傳異常: ' + JSON.stringify(res));
    }
}

async function ensureMemberInSheet(memberId, item, assignDate, alreadyQueued = false) {
    const id = String(memberId);
    if (typeof sheetRowMap[id] === 'number') return;

    if (alreadyQueued) {
        await appendMemberToSheet(memberId, item, assignDate);
        return;
    }

    let releaseLock;
    const waitMyTurn = new Promise(r => releaseLock = r);
    const previousLock = globalSheetWriteLock;
    globalSheetWriteLock = waitMyTurn;

    await previousLock;

    try {
        await appendMemberToSheet(memberId, item, assignDate);
    } finally {
        releaseLock();
    }
}

/* ══ 防抖儲存佇列 ══ */
const saveTimers = {};
const saveStatus = {};

function setSaveStatus(memberId, status) {
    saveStatus[memberId] = status;
    const el = document.getElementById('save-status-'+memberId);
    if(!el) return;
    if(status === 'pending') { el.textContent = '⏳ 待儲存'; el.style.color = '#e67e22'; }
    else if(status === 'saving') { el.textContent = '🔄 儲存中...'; el.style.color = '#3498db'; }
    else if(status === 'saved') { el.textContent = '✅ 已儲存'; el.style.color = '#27ae60'; setTimeout(()=>{ const e=document.getElementById('save-status-'+memberId); if(e)e.textContent=''; }, 2000); }
    else if(status === 'error') { el.textContent = '❌ 失敗'; el.style.color = '#e74c3c'; }
}

function debounceSaveMemo(memberId, grade, memo, item) {
    setSaveStatus(memberId, 'pending');
    if(saveTimers[memberId]) clearTimeout(saveTimers[memberId]); 
    
    saveTimers[memberId] = setTimeout(async () => {
        setSaveStatus(memberId, 'saving');

        let releaseLock;
        const waitMyTurn = new Promise(r => releaseLock = r);
        const previousLock = globalSheetWriteLock;
        globalSheetWriteLock = waitMyTurn;
        await previousLock;

        try {
            const sd = sheetData[String(memberId)] || {status:'', grade:'', memo:''};
            
            if (item.type == 4 && sd.status !== '再次留單') {
                sd.grade = '';
                sd.memo = '';
            }
            
            let statusToSave = sd.status || '';
            let gradeToSave = sd.grade || '';
            let memoToSave = sd.memo || '';
            if(item.type == 1) statusToSave = '新單';

            let rowNum = sheetRowMap[String(memberId)];
            const isEmpty = (statusToSave === '' && !gradeToSave && !memoToSave);

            if (item.type != 1 && isEmpty && typeof rowNum === 'number') {
                await updateSheetMemo(memberId, '', '', '', item);
            } 
            else if (!isEmpty || item.type == 1) {
                await updateSheetMemo(memberId, statusToSave, gradeToSave, memoToSave, item);
            }
            
            setSaveStatus(memberId, 'saved');
        } catch(e) {
            console.error(e);
            setSaveStatus(memberId, 'error');
            notifyGuardError(e);
        } finally {
            releaseLock();
        }
        delete saveTimers[memberId];
    }, 800); 
}

async function loadSheetData(){
    try{
        await initSheet();
        const data=await readSheet();
        sheetData={}; sheetRowMap={}; maxKnownRow=1;
        if(data.values){
            data.values.forEach((row,idx)=>{
                if(idx===0)return;
                const memberId=row[0];
                if(memberId){
                    sheetData[memberId]={status:row[8]||'',grade:row[9]||'',memo:row[10]||'', contactRate:row[12]||''};
                    sheetRowMap[memberId]=idx+1;
                    if((idx+1) > maxKnownRow) maxKnownRow = idx+1;
                }
            });
        }
    }catch(e){console.log('Sheet載入失敗:',e);}
}

function getWriterName(){ return USER_DICT[crmUid]||crmUid; }

async function syncNewMemberToSheet(item, assignDate){
    await ensureMemberInSheet(item.member_id, item, assignDate);
}

async function updateSheetMemo(memberId, status, grade, memo, item){
    const id = String(memberId);
    await ensurePanelCanWrite(id);

    if (typeof sheetRowMap[id] !== 'number') {
        const detail = detailData[id] || {};
        await ensureMemberInSheet(memberId, item, detail.assignDate || detail.normalDate || null, true);
    }
    const rowNum = sheetRowMap[id];
    if (typeof rowNum !== 'number') {
        throw new Error('updateSheetMemo: 無法取得有效 rowNum，memberId=' + id);
    }
    const now = new Date();
    const timeStr = now.toLocaleString('zh-TW');
    const contactRate = (detailData[id] && detailData[id].contactRate) ? detailData[id].contactRate : (sheetData[id] ? sheetData[id].contactRate : '');
    await updateRow(rowNum, [status, grade, memo, timeStr, contactRate]);

    if(!sheetData[id]) sheetData[id] = {status:'', grade:'', memo:'', contactRate:''};
    sheetData[id].status = status;
    sheetData[id].grade  = grade;
    sheetData[id].memo   = memo;
    sheetData[id].contactRate = contactRate;
}

async function sheetsDeleteRow(rowNum){ await deleteRow(rowNum); }

function normalizeLogText(value){
    return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g,char=>({
        '&':'&amp;',
        '<':'&lt;',
        '>':'&gt;',
        '"':'&quot;',
        "'":'&#39;'
    })[char]);
}

function extractDate(value){
    const match = String(value || '').match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if(!match) return '';
    return match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
}

function getLogDate(cells, fallbackText=''){
    return extractDate(cells[1] ? cells[1].innerText : '') || extractDate(fallbackText);
}

function getContentDate(cells, fallbackText=''){
    return extractDate(fallbackText) || getLogDate(cells, fallbackText);
}

function isDemoMoveLog(logType, compactContent){
    return logType.includes('名單移動') && compactContent.includes('DEMO') && compactContent.includes('移動到');
}

function isNewLeadMoveLog(logType, compactContent){
    return logType.includes('名單移動') && compactContent.includes('移動到新名單');
}

function isDemoScheduleLog(logType, compactContent){
    return compactContent.includes('預約DEMO') || normalizeLogText(logType).includes('預約DEMO');
}

/* ══ Demo 同步 ══ */
async function syncDemoRawData(){
    const statusLabel=document.getElementById('loading-status');
    statusLabel.innerText='🔄 準備同步 Demo 名單...';
    const demoTargets=allData.filter(item=>String(item.type)==='3');
    if(demoTargets.length===0){statusLabel.innerText='✅ 目前沒有 Demo 名單';setTimeout(()=>statusLabel.innerText='',2000);return;}
    for(let i=0;i<demoTargets.length;i+=5){
        const batch=demoTargets.slice(i,i+5);
        statusLabel.innerText='🔄 抓取 Demo 軌跡 '+Math.min(i+5,demoTargets.length)+'/'+demoTargets.length+'...';
        await Promise.all(batch.map(async m=>{
            try{
                const res=await fetch('/admin/request_develop?member_id='+(m.member_id||m.id)+'&hide_layout=true');
                const html=await res.text();
                const doc=new DOMParser().parseFromString(html,'text/html');
                const rows=doc.querySelectorAll('table tbody tr');
                let leadDate='',demoDate='',assignDate='',demoLogDate='',oldestLogDate='';
                const debugLogs=[];
                rows.forEach(r=>{
                    const cells=r.querySelectorAll('td');
                    if(cells.length<4)return;
                    const logType=cells[3].innerText.trim();
                    const logContent=cells[4]?cells[4].innerText:'';
                    const compactContent=normalizeLogText(logContent);
                    const dateVal=getLogDate(cells, logContent);
                    debugLogs.push({
                        date:dateVal,
                        next_time:cells[2]?cells[2].innerText.trim():'',
                        type:logType,
                        content:logContent.trim().replace(/\s+/g, ' ').slice(0, 180)
                    });
                    if(!dateVal)return;
                    oldestLogDate=dateVal;
                    if(isNewLeadMoveLog(logType, compactContent)&&!leadDate)leadDate=getContentDate(cells, logContent);
                    if(isDemoMoveLog(logType, compactContent)&&!demoDate){
                        demoDate=getContentDate(cells, logContent);
                    }
                    if(logType.includes('指派')&&!assignDate)assignDate=dateVal;
                    if(isDemoScheduleLog(logType, compactContent)&&!demoLogDate)demoLogDate=getContentDate(cells, logContent);
                });
                m.leadDate=leadDate||assignDate||extractDate(m.create_time)||oldestLogDate||'';
                m.demoDate=demoDate||demoLogDate||'';
                m._demoSyncDebugLogs=debugLogs;
            }catch(e){}
        }));
    }
    statusLabel.innerText='🔄 傳送資料至試算表...';
    const missingDemoDates=demoTargets.filter(item=>!item.demoDate);
    if(missingDemoDates.length){
        console.warn('[Demo同步] 以下名單仍未抓到轉Demo日期', missingDemoDates.map(item=>({
            member_id:item.member_id||item.id,
            name:item.member_name,
            next_time:item.next_time,
            create_time:item.create_time,
            logs:item._demoSyncDebugLogs||[]
        })));
    }
    const demoList=demoTargets.map(item=>({
        member_id:item.member_id||item.id,member_name:item.member_name,mobile:item.mobile,
        source:item.source,user_name:item.user_name,
        next_time:(item.next_time&&!item.next_time.includes('0000'))?item.next_time.split(' ')[0]:'無紀錄',
        leadDate:item.leadDate||'',demoDate:item.demoDate||''
    }));
    try{
        const res=await gasPost({action:'syncDemoRaw',demoList});
        if(res.success){
            const added=Number(res.addedCount||0);
            const updated=Number(res.updatedCount||0);
            statusLabel.innerText=(added||updated)?'✅ 新增 '+added+' 筆，補日期 '+updated+' 筆':'✅ 名單皆已存在，無須新增';
        }else{
            throw new Error(res.error||'同步失敗');
        }
        setTimeout(()=>statusLabel.innerText='',3000);
    }catch(e){statusLabel.innerText='❌ 同步失敗：'+(e.message||e);}
}

/* ══ DOM UI ══ */
['custom-crm-curtain','custom-crm-panel'].forEach(id=>{const el=document.getElementById(id);if(el)el.remove();});
const curtain=document.createElement('div');
curtain.id='custom-crm-curtain';
curtain.style.cssText='position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(236,240,241,0.85);backdrop-filter:blur(8px);z-index:999998;pointer-events:all;user-select:none;';
curtain.addEventListener('click',e=>e.stopPropagation());
document.body.style.overflow='hidden';
document.body.appendChild(curtain);

const panel=document.createElement('div');
panel.id='custom-crm-panel';
panel.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:96vw;max-width:1100px;height:88vh;background:#fff;box-shadow:0 15px 50px rgba(0,0,0,0.2);border-radius:12px;z-index:999999;display:flex;flex-direction:column;overflow:hidden;font-family:sans-serif;';

if(isSpoofing) {
    const banner = document.createElement('div');
    banner.style.cssText = 'background:#c0392b;color:white;text-align:center;padding:6px;font-size:13px;font-weight:bold;letter-spacing:1px;flex-shrink:0;z-index:100;';
    banner.innerText = `🕵️‍♂️ 【模擬模式】您目前正完全以「${USER_DICT[crmUid] || crmUid}」的身份進行操作！所有動作皆會以此身份執行。`;
    panel.appendChild(banner);
}

const header=document.createElement('div');
header.style.cssText='padding:12px 15px;background:#2c3e50;color:white;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;flex-shrink:0;position:relative;';
header.id='crm-header';
    
header.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-right:85px;padding-bottom:5px;">
        <h3 style="margin:0 8px 0 0;font-size:15px;color:white;">名單管理面板</h3>
${isManager ? `
    <button id="tab-crm" style="padding:4px 14px;cursor:pointer;border-radius:4px;border:2px solid #3498db;background:#3498db;color:white;font-weight:bold;">名單管理</button>
    <button id="tab-pool" style="padding:4px 14px;cursor:pointer;border-radius:4px;border:2px solid rgba(255,255,255,0.4);background:transparent;color:white;font-weight:bold;">釋出池</button>
` : ''}
        ${isManager ? `
            <select id="consultant-filter" style="padding:4px;border-radius:4px;border:none;max-width:130px;"><option value="-1">所有業務</option></select>
            <select id="source-filter" style="padding:4px;border-radius:4px;border:none;max-width:90px;"><option value="-1">所有來源</option></select>
            <button id="sync-all-new-btn" style="padding:4px 10px;cursor:pointer;border-radius:4px;border:none;background:#8e44ad;color:white;font-weight:bold;">同步名單細節</button>
            <button id="sync-demo-btn" style="padding:4px 10px;cursor:pointer;border-radius:4px;border:none;background:#e67e22;color:white;font-weight:bold;">同步Demo</button>
            <button id="bulk-sync-rate-btn" style="padding:4px 10px;cursor:pointer;border-radius:4px;border:none;background:#16a085;color:white;font-weight:bold;">同步常態單觸及率</button>
            <button id="batch-release-btn" style="padding:4px 10px;cursor:pointer;border-radius:4px;border:none;background:#c0392b;color:white;font-weight:bold;display:none;">批量處理 (0)</button>
            <div id="pool-sync-block" style="display:none;align-items:center;gap:4px;background:rgba(255,255,255,0.1);padding:3px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);margin-left:4px;">
                <input type="date" id="pool-start-date" style="padding:2px 4px;border-radius:4px;border:none;font-size:11px;width:115px;height:22px;line-height:22px;box-sizing:border-box;">
                <span style="font-size:11px;color:#fff;">~</span>
                <input type="date" id="pool-end-date" style="padding:2px 4px;border-radius:4px;border:none;font-size:11px;width:115px;height:22px;line-height:22px;box-sizing:border-box;">
                <button id="sync-pool-btn" style="padding:2px 10px;cursor:pointer;border-radius:4px;border:none;background:#2ecc71;color:white;font-weight:bold;font-size:11px;height:22px;line-height:18px;">更新釋出池</button>
            </div>
        ` : '<span style="font-size:12px;color:#bdc3c7;">我的名單</span>'}
        
        <input type="text" id="global-search-input" placeholder="🔍 搜尋姓名/電話" style="padding:4px 8px;border-radius:4px;border:none;width:120px;font-size:12px;outline:none;margin-left:4px;">
        
        <select id="t-type-filter" style="padding:4px;border-radius:4px;border:none;">
            <option value="-1">所有種類</option><option value="1">新單</option><option value="2">常態名單</option><option value="3">Demo過名單</option><option value="4">釋出名單</option>
        </select>
        <button id="refresh-btn" style="padding:4px 10px;cursor:pointer;border-radius:4px;border:none;background:#3498db;color:white;">重新整理</button>
        <span id="loading-status" style="font-size:11px;color:#f1c40f;font-weight:bold;"></span>
    </div>
    <div style="position:absolute;top:50%;right:15px;transform:translateY(-50%);display:flex;align-items:center;gap:8px;">
        ${(isManager || isSpoofing) ? `
        <button id="spoof-identity-btn" title="切換操作身分 (任意門)" 
            onmouseover="this.style.transform='scale(1.2)'" 
            onmouseout="this.style.transform='scale(1)'"
            style="background:transparent;border:none;font-size:20px;cursor:pointer;padding:0;transition:transform 0.2s;">
            🎭
        </button>
        ` : ''}
        <div style="position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center;">
            <svg viewBox="0 0 100 100" style="position:absolute;width:100%;height:100%;pointer-events:none;">
                <circle cx="50" cy="50" r="44" fill="none" stroke="#dfe6e9" stroke-width="5" stroke-linecap="round" stroke-dasharray="245 31" transform="rotate(-90 50 50)"/>
                <polygon points="0,-7 10,0 0,7" fill="#dfe6e9" transform="translate(30,13) rotate(-30)"/>
            </svg>
            <button id="open-dialer-btn" title="啟動自動撥號系統" 
                onmouseover="this.style.background='#3498db'; this.style.borderColor='#3498db';"
                onmouseout="this.style.background='transparent'; this.style.borderColor='#b2bec3';"
                style="position:relative;z-index:1;display:flex;align-items:center;justify-content:center;width:32px;height:32px;cursor:pointer;border-radius:50%;border:2px solid #b2bec3;background:transparent;color:white;padding:0;transition:0.2s;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
                    <path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z"/>
                </svg>
            </button>
        </div>
        <button id="close-btn" title="關閉" 
            onmouseover="this.style.color='#e74c3c'" 
            onmouseout="this.style.color='white'"
            style="background:transparent;border:none;color:white;font-size:26px;line-height:1;cursor:pointer;padding:0 4px;transition:color 0.2s;">×</button>
    </div>
`;

const content=document.createElement('div');
content.style.cssText='flex:1;overflow-y:auto;padding:12px;background:#f8f9fa;display:flex;flex-direction:column;';
content.id='crm-content';
    
/* ══ 共用業務選項清單 ══ */
const salesOptionsHtmlStr = `
    <option value="130">Jeremy testjeremy [IT&CS]</option>
    <option value="283">Ash 俞任鴻 [IT&CS]</option>
    <option value="465">Lily 李昱萱 [IT&CS]</option>
    <option value="248">Luka 林冠宇 [IT&CS]</option>
    <option value="434">Nina 林怡欣 [IT&CS]</option>
    <option value="358">amiee 林琬倩 [IT&CS]</option>
    <option value="469">Lara 王品儒 [IT&CS]</option>
    <option value="410">Claire 葉芷羽 [IT&CS]</option>
    <option value="241">Paris 黃雅琪 [IT&CS]</option>
    <option value="279">test3 test3 [業務部]</option>
    <option value="467">Anna 余可芳 [業務部]</option>
    <option value="452">Rita 侯宛余 [業務部]</option>
    <option value="433">Wynn 吳昱瑩 [業務部]</option>
    <option value="464">ori 孫逸亭 [業務部]</option>
    <option value="468">Ria 廖沐琳 [業務部]</option>
    <option value="432">Elsie 林采庭 [業務部]</option>
    <option value="445">Luke 楊博竣 [業務部]</option>
    <option value="457">Alan 楊碩頫 [業務部]</option>
    <option value="438">Lily 楊若莉 [業務部]</option>
    <option value="451">Kyle 江宗翰 [業務部]</option>
    <option value="454">Andy 沈祐頡 [業務部]</option>
    <option value="206">Connie 游婷瑛 [業務部]</option>
    <option value="462">homer 許瀚方 [業務部]</option>
    <option value="458">Josie 陳品妤 [業務部]</option>
    <option value="459">An 陳怡安 [業務部]</option>
    <option value="409">Joyce 魏良伃 [業務部]</option>
    <option value="453">Wolf 黃詳淵 [業務部]</option>
    <option value="368">Jordan 李睿峰 [業務部()]</option>
    <option value="69">TEST test0504 [業務部(主管)]</option>
    <option value="162">Joy 洪淑慧 [業務部(主管)]</option>
    <option value="240">Minzing 程銘靜 [業務部(主管)]</option>
    <option value="60">johnny 謝愷澤 [業務部(主管)]</option>
    <option value="424">Jim 陳昕謨 [業務部(主管)]</option>
`;

/* ══ 壓紀錄 Modal ══ */
const recordModal=document.createElement('div');
recordModal.id='record-modal';
recordModal.style.cssText='display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:90vw;max-width:480px;max-height:85vh;overflow-y:auto;background:white;padding:20px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.2);z-index:1000005;';
recordModal.innerHTML='<h4 style="margin-top:0;">新增聯絡紀錄</h4><input type="hidden" id="modal-member-id"><div id="modal-info-text" style="font-size:11px;color:#e67e22;margin-bottom:10px;font-weight:bold;"></div><div style="margin-bottom:10px;"><label>聯絡類型:</label><select id="modal-status" style="width:100%;padding:5px;margin-top:5px;"><option value="3">未接</option><option value="1">已接聽</option><option value="2">非本人</option><option value="4">關機</option></select></div><div style="margin-bottom:10px;"><label>聯絡內容:</label><textarea id="modal-content" style="width:100%;padding:5px;margin-top:5px;min-height:60px;font-family:sans-serif;font-size:13px;border:1px solid #ddd;border-radius:4px;resize:vertical;">未接 *1</textarea></div><div style="margin-bottom:10px;"><label>下次聯繫日期:</label><input type="date" id="modal-date" style="width:100%;padding:5px;margin-top:5px;"></div><div style="display:flex;justify-content:space-between;margin-top:15px;"><button id="modal-cancel" style="padding:5px 15px;cursor:pointer;">取消</button><button id="modal-submit" style="padding:5px 15px;background:#27ae60;color:white;border:none;cursor:pointer;border-radius:4px;">送出紀錄</button></div>';

/* ══ 聯繫歷史 Modal（點擊單筆名單時才載入）══ */
const historyOverlay=document.createElement('div');
historyOverlay.id='contact-history-overlay';
historyOverlay.style.cssText='display:none;position:absolute;inset:0;background:rgba(22,34,45,0.58);z-index:1000006;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;';
historyOverlay.innerHTML=`
    <div id="contact-history-modal" style="width:100%;max-width:760px;max-height:88%;background:#fff;border-radius:10px;box-shadow:0 14px 45px rgba(0,0,0,0.3);display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:8px 12px;background:#2c3e50;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;">
            <div style="min-width:0;display:flex;align-items:center;gap:7px;white-space:nowrap;overflow:hidden;">
                <span style="font-size:13px;font-weight:bold;flex-shrink:0;">聯繫歷史</span>
                <span style="color:#95a5a6;font-size:11px;flex-shrink:0;">·</span>
                <span id="contact-history-member" style="font-size:11px;color:#dfe6e9;overflow:hidden;text-overflow:ellipsis;"></span>
            </div>
            <button id="contact-history-close" title="關閉" style="background:transparent;border:none;color:#fff;font-size:20px;line-height:1;cursor:pointer;padding:0 4px;">×</button>
        </div>
        <div style="padding:9px 14px;border-bottom:1px solid #e5e8eb;background:#f8f9fa;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;">
            <span id="contact-history-updated" style="font-size:11px;color:#7f8c8d;">點擊後才會載入系統紀錄</span>
            <button id="contact-history-refresh" style="padding:5px 10px;border:1px solid #3498db;border-radius:4px;background:#fff;color:#2980b9;cursor:pointer;font-size:11px;font-weight:bold;">重新整理</button>
        </div>
        <div id="contact-history-body" style="padding:10px 12px;overflow:auto;min-height:180px;background:#1e272e;flex:1;"></div>
        <div style="padding:10px 14px;border-top:1px solid #e5e8eb;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;">
            <span id="contact-history-count" style="font-size:11px;color:#7f8c8d;"></span>
            <button id="contact-history-toggle" style="display:none;padding:5px 12px;border:1px solid #bdc3c7;border-radius:4px;background:#fff;color:#555;cursor:pointer;font-size:11px;font-weight:bold;">顯示全部</button>
        </div>
    </div>
`;

/* ══ 單筆/一般批次 釋出 Modal ══ */
const releaseModal=document.createElement('div');
releaseModal.id='release-modal';
releaseModal.style.cssText='display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:90vw;max-width:420px;background:white;padding:20px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.2);z-index:1000005;';

const reassignHtml = isManager ? `
    <div style="margin-top:15px; border-top:1px dashed #ccc; padding-top:15px;">
        <label style="font-size:13px;font-weight:bold;color:#1a6fc4;">👑 主管專屬：轉派人員 (選填)</label>
        <select id="release-reassign" style="width:100%;height:auto;min-height:36px;line-height:normal;box-sizing:border-box;padding:8px;margin-top:8px;border-radius:4px;border:2px solid #1a6fc4;font-size:13px;color:#333;background:#f0f8ff;appearance:auto;">
            <option value="-1">單純釋出 (不轉派)</option>
            ${salesOptionsHtmlStr}
        </select>
    </div>
` : '';

releaseModal.innerHTML=`
    <h4 style="margin-top:0;color:#c0392b;">釋出名單</h4>
    <input type="hidden" id="release-member-id">
    <div>
        <label style="font-size:13px;font-weight:bold;color:#333;">請選擇釋出原因:</label>
        <select id="release-reason" style="width:100%;height:auto;min-height:36px;line-height:normal;box-sizing:border-box;padding:8px;margin-top:8px;border-radius:4px;border:1px solid #ccc;font-size:13px;color:#333;background:#fff;appearance:auto;">
            <option value="1-1 聯繫不上 - 多次未接">1-1 聯繫不上 - 多次未接</option>
            <option value="1-2 聯繫不上 - 多次語音">1-2 聯繫不上 - 多次語音</option>
            <option value="1-3 聯繫不上 - 直接掛斷">1-3 聯繫不上 - 直接掛斷</option>
            <option value="1-4 聯繫不上 - 關機">1-4 聯繫不上 - 關機</option>
            <option value="1-5 聯繫不上 - 出國">1-5 聯繫不上 - 出國</option>
            <option value="2-1 無效號碼 - 空號">2-1 無效號碼 - 空號</option>
            <option value="2-2 無效號碼 - 暫停使用">2-2 無效號碼 - 暫停使用</option>
            <option value="2-3 無效號碼 - 非本人">2-3 無效號碼 - 非本人</option>
            <option value="2-4 無效號碼 - 外國人">2-4 無效號碼 - 外國人</option>
            <option value="2-5 無效號碼 - 沒留過資料">2-5 無效號碼 - 沒留過資料</option>
            <option value="3-1 費用問題 - 認為費用太高">3-1 費用問題 - 認爲費用太高</option>
            <option value="3-2 費用問題 - 無付款主導權">3-2 費用問題 - 無付款主導權</option>
            <option value="4-1 需求不符 - 針對多益">4-1 需求不符 - 針對多益</option>
            <option value="4-2 需求不符 - 針對雅思">4-2 需求不符 - 針對雅思</option>
            <option value="4-3 需求不符 - 針對托福">4-3 需求不符 - 針對托福</option>
            <option value="4-4 需求不符 - 上課時間無法配合">4-4 需求不符 - 上課時間無法配合</option>
            <option value="4-5 需求不符 - 要短期課程">4-5 需求不符 - 要短期課程</option>
            <option value="4-6 需求不符 - 找實體補習班">4-6 需求不符 - 找實體補習班</option>
            <option value="4-7 需求不符 - 體驗後不喜歡上課方式">4-7 需求不符 - 體驗後不喜歡上課方式</option>
            <option value="5-1 已報名其他機構 - 機構名稱(自填)">5-1 已報名其他機構 - 機構名稱(自填)</option>
            <option value="6-1 無需求 - 無需求">6-1 無需求 - 無需求</option>
            <option value="6-2 無需求 - 近期無學習計畫">6-2 無需求 - 近期無學習計畫</option>
            <option value="7-1 遊留學 - 即將出國遊留學">7-1 遊留學 - 即將出國遊留學</option>
            <option value="7-2 遊留學 - 國外遊留學回來">7-2 遊留學 - 國外遊留學回來</option>
            <option value="7-3 遊留學 - 目前正在國外遊留學">7-3 遊留學 - 目前正在國外遊留學</option>
            <option value="7-4 遊留學 - 打工度假">7-4 遊留學 - 打工度假</option>
            <option value="8-1 其他 - 學習觀念無法溝通">8-1 其他 - 學習觀念無法溝通</option>
            <option value="8-2 其他 - 純體驗/只想要贈品">8-2 其他 - 純體驗/只想要贈品</option>
            <option value="8-3 其他 - 網路設備問題">8-3 其他 - 網路設備問題</option>
            <option value="8-4 其他 - 沒決心無法堅持">8-4 其他 - 沒決心無法堅持</option>
            <option value="8-5 其他 - 資料已留很久">8-5 其他 - 資料已留很久</option>
            <option value="8-6 其他 - 顧問自填">8-6 其他 - 顧問自填</option>
        </select>
    </div>
    <div style="margin-top:15px;">
        <label style="font-size:13px;font-weight:bold;color:#333;">備註說明 (自填):</label>
        <textarea id="release-memo" rows="2" style="width:100%;line-height:1.5;box-sizing:border-box;padding:8px;margin-top:8px;border-radius:4px;border:1px solid #ccc;font-size:13px;color:#333;background:#fff;resize:none;font-family:sans-serif;" placeholder="輸入補充說明..."></textarea>
    </div>
    ${reassignHtml}
    <div style="display:flex;justify-content:space-between;margin-top:20px;">
        <button id="release-cancel" style="padding:6px 15px;cursor:pointer;border:1px solid #ddd;background:#f5f5f5;border-radius:4px;color:#333;">取消</button>
        <button id="release-submit" style="padding:6px 15px;background:#c0392b;color:white;border:none;cursor:pointer;border-radius:4px;font-weight:bold;">確定送出</button>
    </div>
`;

/* ══ 釋出池專用：純派發 Modal ══ */
const poolAssignModal = document.createElement('div');
poolAssignModal.id = 'pool-assign-modal';
poolAssignModal.style.cssText = 'display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:90vw;max-width:400px;background:white;padding:20px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.2);z-index:1000005;';
poolAssignModal.innerHTML = `
    <h4 style="margin-top:0;color:#27ae60;">批次派發名單 (釋出池)</h4>
    <p style="font-size:12px;color:#666;margin-bottom:15px;">將選取的名單大量指派給特定業務。此操作沒有延遲，送出後即刻生效。</p>
    <input type="hidden" id="pool-assign-ids">
    <div>
        <label style="font-size:13px;font-weight:bold;color:#333;">選擇轉派人員:</label>
        <select id="pool-assign-select" style="width:100%;height:auto;min-height:36px;padding:8px;margin-top:8px;border-radius:4px;border:2px solid #27ae60;font-size:13px;background:#f0f8ff;">
            <option value="-1">請選擇轉派業務...</option>
            ${salesOptionsHtmlStr}
        </select>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:20px;">
        <button id="pool-assign-cancel" style="padding:6px 15px;cursor:pointer;border:1px solid #ddd;background:#f5f5f5;border-radius:4px;color:#333;">取消</button>
        <button id="pool-assign-submit" style="padding:6px 15px;background:#27ae60;color:white;border:none;cursor:pointer;border-radius:4px;font-weight:bold;">一鍵派發</button>
    </div>
`;
/* ══ 手機版響應式樣式（只蓋樣式，不動任何邏輯）══ */
if(!document.getElementById('crm-mobile-style')){
    const mobileStyle=document.createElement('style');
    mobileStyle.id='crm-mobile-style';
    mobileStyle.textContent=`
@media (max-width: 768px){
  #custom-crm-panel{
    width:100vw !important;
    height:100vh !important;
    max-height:100dvh !important;
    top:0 !important;
    left:0 !important;
    transform:none !important;
    border-radius:0 !important;
  }
  #crm-header{
    padding:8px 10px !important;
  }
  #crm-header h3{ font-size:13px !important; }
  #crm-header select, #crm-header input[type="text"]{
    max-width:100px !important;
    font-size:12px !important;
    padding:4px !important;
  }
  #crm-content{
    padding:6px !important;
    overflow-x:auto !important;
    -webkit-overflow-scrolling:touch !important;
  }
  #crm-content table{
    width:720px !important;
    min-width:720px !important;
  }
  #record-modal, #release-modal, #pool-assign-modal, #contact-history-modal{
    width:92vw !important;
    max-width:480px !important;
    max-height:88vh !important;
  }
}`;
    document.head.appendChild(mobileStyle);
}
panel.appendChild(header);
panel.appendChild(content);
panel.appendChild(recordModal);
panel.appendChild(releaseModal);
panel.appendChild(poolAssignModal);
panel.appendChild(historyOverlay);
document.body.appendChild(panel);

function closeContactHistory(){
    historyOverlay.style.display='none';
    currentHistoryMemberId='';
    historyShowAll=false;
}

function getHistoryTypeColor(type){
    const text=String(type||'');
    if(text.includes('聯絡'))return '#27ae60';
    if(text.includes('DEMO')||text.includes('Demo')||text.includes('demo'))return '#e67e22';
    if(text.includes('名單移動'))return '#8e44ad';
    if(text.includes('指派'))return '#2980b9';
    return '#7f8c8d';
}

function renderContactHistory(entry){
    const body=document.getElementById('contact-history-body');
    const count=document.getElementById('contact-history-count');
    const toggle=document.getElementById('contact-history-toggle');
    body.textContent='';

    if(!entry||!entry.logs.length){
        const empty=document.createElement('div');
        empty.style.cssText='padding:40px 15px;text-align:center;color:#718093;font-size:13px;';
        empty.textContent='目前找不到可顯示的聯繫歷史。';
        body.appendChild(empty);
        count.textContent='共 0 筆紀錄';
        toggle.style.display='none';
        return;
    }

    const visibleLogs=historyShowAll?entry.logs:entry.logs.slice(0,20);
    const table=document.createElement('table');
    table.style.cssText='width:100%;min-width:620px;border-collapse:collapse;font-size:11px;';
    const thead=document.createElement('thead');
    const headRow=document.createElement('tr');
    headRow.style.cssText='background:#2f3640;color:#a4b0be;position:sticky;top:0;z-index:1;';
    ['#','時間','類型','內容','操作者'].forEach((label,index)=>{
        const th=document.createElement('th');
        th.style.cssText='padding:6px;text-align:left;'+(index!==3?'white-space:nowrap;':'');
        th.textContent=label;
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody=document.createElement('tbody');
    visibleLogs.forEach((log,index)=>{
        const tr=document.createElement('tr');
        tr.style.cssText='background:'+(index%2===0?'#1e272e':'#252f38')+';border-bottom:1px solid #2f3640;';

        const num=document.createElement('td');
        num.style.cssText='padding:6px;color:#636e72;white-space:nowrap;vertical-align:top;';
        num.textContent=log.num||String(index+1);

        const time=document.createElement('td');
        time.style.cssText='padding:6px;color:#718093;white-space:nowrap;font-size:10px;vertical-align:top;';
        time.textContent=log.date||'-';

        const type=document.createElement('td');
        type.style.cssText='padding:6px;color:'+getHistoryTypeColor(log.type)+';white-space:nowrap;vertical-align:top;font-weight:bold;';
        type.textContent=log.type||'系統紀錄';

        const contentCell=document.createElement('td');
        contentCell.style.cssText='padding:6px;word-break:break-word;line-height:1.5;vertical-align:top;';
        const contentText=document.createElement('div');
        const content=log.content||'（無內容）';
        let contentColor='#dcdde1';
        if(content.includes('未接'))contentColor='#e74c3c';
        if(content.includes('已接')||content.includes('【'))contentColor='#2ecc71';
        contentText.style.cssText='color:'+contentColor+';white-space:pre-wrap;';
        contentText.textContent=content;
        contentCell.appendChild(contentText);
        if(log.nextTime&&!log.nextTime.includes('0000')){
            const next=document.createElement('div');
            next.style.cssText='font-size:10px;color:#f39c12;margin-top:4px;';
            next.textContent='下次聯繫：'+log.nextTime;
            contentCell.appendChild(next);
        }

        const operator=document.createElement('td');
        operator.style.cssText='padding:6px;color:#636e72;white-space:nowrap;font-size:10px;vertical-align:top;';
        operator.textContent=log.operator||'-';

        tr.appendChild(num);
        tr.appendChild(time);
        tr.appendChild(type);
        tr.appendChild(contentCell);
        tr.appendChild(operator);
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);

    count.textContent='顯示 '+visibleLogs.length+' 筆，共 '+entry.logs.length+' 筆紀錄';
    if(entry.logs.length>20){
        toggle.style.display='inline-block';
        toggle.textContent=historyShowAll?'只顯示最近 20 筆':'顯示全部';
    }else{
        toggle.style.display='none';
    }
}

async function loadContactHistory(memberId, forceRefresh=false){
    const id=String(memberId);
    const body=document.getElementById('contact-history-body');
    const updated=document.getElementById('contact-history-updated');
    const refreshBtn=document.getElementById('contact-history-refresh');

    if(!forceRefresh&&contactHistoryCache[id]){
        renderContactHistory(contactHistoryCache[id]);
        updated.textContent='本次面板已載入：'+contactHistoryCache[id].fetchedAt;
        return;
    }

    body.innerHTML='<div style="padding:45px 15px;text-align:center;color:#3498db;font-size:13px;font-weight:bold;">🔄 正在載入這筆名單的聯繫歷史...</div>';
    document.getElementById('contact-history-count').textContent='';
    document.getElementById('contact-history-toggle').style.display='none';
    updated.textContent='正在連線公司系統...';
    refreshBtn.disabled=true;
    refreshBtn.style.opacity='0.55';

    try{
        const res=await guardFetch('/admin/request_develop?member_id='+encodeURIComponent(id)+'&hide_layout=true&crm_history='+Date.now(),{cache:'no-store'},20000);
        const html=await res.text();
        if(!res.ok||!looksLikeMemberDetail(html,id))throw new Error('後台連線或登入狀態已失效');

        const doc=new DOMParser().parseFromString(html,'text/html');
        const logs=[];
        doc.querySelectorAll('table tbody tr').forEach(row=>{
            const cells=row.querySelectorAll('td');
            if(cells.length<4)return;
            const num=cells[0]?cells[0].innerText.trim():'';
            const type=cells[3]?cells[3].innerText.trim():'';
            const content=cells[4]?cells[4].innerText.trim():'';
            const date=cells[1]?cells[1].innerText.trim():'';
            const nextTime=cells[2]?cells[2].innerText.trim():'';
            const operator=cells.length>5&&cells[cells.length-1]?cells[cells.length-1].innerText.trim():'';
            if(!type&&!content&&!date)return;
            logs.push({num,type,content,date,nextTime,operator});
        });

        const entry={logs,fetchedAt:new Date().toLocaleString('zh-TW')};
        contactHistoryCache[id]=entry;
        if(currentHistoryMemberId===id){
            renderContactHistory(entry);
            updated.textContent='最後載入：'+entry.fetchedAt;
        }
    }catch(e){
        if(currentHistoryMemberId===id){
            body.textContent='';
            const error=document.createElement('div');
            error.style.cssText='padding:40px 15px;text-align:center;color:#c0392b;font-size:13px;line-height:1.6;';
            error.textContent='❌ 聯繫歷史載入失敗\n'+(e.message||e)+'\n請確認後台登入狀態後再點擊「重新整理」。';
            body.appendChild(error);
            updated.textContent='載入失敗';
        }
    }finally{
        refreshBtn.disabled=false;
        refreshBtn.style.opacity='1';
    }
}

function openContactHistory(item){
    const id=String(item.member_id||item.id||'');
    if(!id)return;
    currentHistoryMemberId=id;
    historyShowAll=false;
    document.getElementById('contact-history-member').textContent=(item.member_name||'未知名單')+' · ID '+id;
    historyOverlay.style.display='flex';
    loadContactHistory(id,false);
}

document.getElementById('contact-history-close').onclick=closeContactHistory;
historyOverlay.onclick=e=>{if(e.target===historyOverlay)closeContactHistory();};
document.getElementById('contact-history-refresh').onclick=()=>{
    if(!currentHistoryMemberId)return;
    historyShowAll=false;
    loadContactHistory(currentHistoryMemberId,true);
};
document.getElementById('contact-history-toggle').onclick=()=>{
    if(!currentHistoryMemberId||!contactHistoryCache[currentHistoryMemberId])return;
    historyShowAll=!historyShowAll;
    renderContactHistory(contactHistoryCache[currentHistoryMemberId]);
};

/* ══ ★ 身分任意門切換邏輯 ══ */
if(isManager || isSpoofing) {
    const spoofBtn = document.getElementById('spoof-identity-btn');
    if(spoofBtn) {
        spoofBtn.onclick = () => {
            const targetUid = prompt('🕵️‍♂️【主管任意門】\n請輸入您想模擬登入的「員工代號」(例如：445)\n\n※ 想要恢復原本的主管身分，請輸入 424。', '');
            if(targetUid !== null && targetUid.trim() !== '') {
                const cleanUid = targetUid.trim();
                const confirmName = USER_DICT[cleanUid] || ('未知代號: ' + cleanUid);
                if(confirm('確定要化身為【' + confirmName + '】嗎？\n\n切換後網頁將會「重新載入」，請在網頁跑完後，再次點擊書籤來開啟工具！')) {
                    const newUrl = new URL(window.location.href);
                    newUrl.searchParams.set('crm_uid', cleanUid);
                    if (cleanUid === MANAGER_UID) {
                        newUrl.searchParams.delete('original_uid'); // 恢復正常
                    } else {
                        newUrl.searchParams.set('original_uid', isSpoofing ? originalUid : crmUid);
                    }
                    window.location.href = newUrl.toString();
                }
            }
        };
    }
}

/* ══ 聯絡類型切換 ══ */
document.getElementById('modal-status').onchange=function(){
    const contentEl=document.getElementById('modal-content');
    if(this.value==='1'){
        contentEl.value=INTERVIEW_TEMPLATE;
        contentEl.style.minHeight='280px';
    }else{
        const m={'2':'非本人 *1','3':'未接 *1','4':'關機 *1'};
        contentEl.value=m[this.value]||'聯絡 *1';
        contentEl.style.minHeight='60px';
    }
};

function updateConsultantDropdown(){
    if(!isManager)return;
    const select=document.getElementById('consultant-filter');
    const names=[...new Set(allData.map(m=>m.user_name?m.user_name.trim():'未指派'))].sort();
    let html='<option value="-1">所有業務</option>';
    names.forEach(n=>{html+='<option value="'+n+'">'+n+'</option>';});
    select.innerHTML=html;select.value='-1';
}

function updateSourceDropdown() {
    if(!isManager) return; 
    const select = document.getElementById('source-filter');
    if(!select) return;
    const currentVal = select.value;
    const prefixes = new Set();
    allData.forEach(item => {
        if(item.source && item.source.trim().length >= 2) {
            prefixes.add(item.source.trim().substring(0, 2).toUpperCase());
        }
    });
    const sortedPrefixes = [...prefixes].sort();
    let html = '<option value="-1">所有來源</option>';
    sortedPrefixes.forEach(p => {
        html += '<option value="' + p + '">' + p + '</option>';
    });
    select.innerHTML = html;
    if(sortedPrefixes.includes(currentVal)) {
        select.value = currentVal;
    } else {
        select.value = '-1';
    }
}

async function fetchData(){
    detailData = {}; 
    const statusLabel=document.getElementById('loading-status');
    content.innerHTML='<div style="text-align:center;padding:20px;">資料載入中...</div>';
    statusLabel.innerText='🔄 連接 Google Sheet...';
    await loadSheetData();
    statusLabel.innerText='🔄 載入名單...';
    try{
        const res=await fetch(fetchUrl);
        const data=await res.json();
        allData=data.list||[];
        if(!isManager&&allData.length>0){
            try{
                const resAll=await fetch('https://server.etalkingonline.com/name_list/new_list/-1');
                const dataAll=await resAll.json();
                const allList=dataAll.list||[];
                allList.forEach(m=>{
                    const mId=m.member_id||m.id;
                    const target=allData.find(x=>(x.member_id||x.id)==mId);
                    if(target&&m.source)target.source=m.source;
                });
            }catch(e){}
        }
        updateConsultantDropdown();
        updateSourceDropdown(); 
        renderList();
        if(!isManager){
            statusLabel.innerText='🔄 載入名單細節...';
            await loadDetailsForAll();
        }
        statusLabel.innerText='✅ 載入完成';
        setTimeout(()=>statusLabel.innerText='',2000);
    }catch(err){
        content.innerHTML='<div style="color:red;text-align:center;">載入失敗: '+err.message+'</div>';
        statusLabel.innerText='❌ 載入失敗';
    }
}

async function fetchMemberDetail(m) {
    const memberId = m.member_id || m.id;
    let assignDate = null, normalDate = null, contactCount = 0;
    let lastLogNextTime = null;
    let reachedNormal = false;

    try {
        const res = await fetch('/admin/request_develop?member_id=' + memberId + '&hide_layout=true');
        if (!res.ok) throw new Error('Fetch API Failed');
        
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rows = doc.querySelectorAll('table tbody tr');
        let hasScheduledDemo = false;
        let hasBeenContacted = false;
        const unansweredPrefixes = ['未接', '關機', '空號', '通話中', '語音', '響轉', '非本人'];
        
        rows.forEach(r => {
            const cells = r.querySelectorAll('td');
            if (cells.length < 4) return;
            const logType = cells[3].innerText.trim();
            const logContent = cells[4] ? cells[4].innerText.trim() : '';
            const compactContent = normalizeLogText(logContent);
            const dateVal = getLogDate(cells, logContent);
            const nextTimeVal = extractDate(cells[2] ? cells[2].innerText : '');
            
            if (isDemoScheduleLog(logType, compactContent)) {
                if (!reachedNormal) hasScheduledDemo = true;
            }

            if (logType.includes('名單移動')) {
                if (isNewLeadMoveLog(logType, compactContent) && !assignDate) assignDate = dateVal;
                if (compactContent.includes('移動到常態名單') && !normalDate) {
                    normalDate = dateVal;
                    reachedNormal = true;
                }
            }
            if (logType.includes('聯絡')) {
                contactCount++;
                const isUnanswered = unansweredPrefixes.some(prefix => logContent.startsWith(prefix));
                if (!isUnanswered && !reachedNormal) {
                    hasBeenContacted = true;
                }
                
                if (!reachedNormal && !lastLogNextTime && nextTimeVal && !nextTimeVal.includes('0000')) {
                    lastLogNextTime = nextTimeVal;
                }
            }
        });

        if (m.type == 1 && !assignDate) {
            assignDate = new Date().toISOString().split('T')[0];
        }

        let contactRate = '';
        let contactPercent = 0;
        let actualStart = assignDate || normalDate || (m.create_time ? m.create_time.split(' ')[0] : null);
        
        if (actualStart && m.type == 2 && !hasScheduledDemo && !hasBeenContacted) {
            const msPerDay = 1000 * 60 * 60 * 24;
            const start = new Date(actualStart);
            const today = new Date();
            let daysHeld = Math.floor((today - start) / msPerDay);
            if (daysHeld < 1) daysHeld = 1;
            
            let target = 0;
            if (daysHeld <= 3) {
                target = daysHeld * 2;
            } else {
                target = 6 + Math.ceil((daysHeld - 3) * 1.5);
            }
            
            contactPercent = Math.round((contactCount / target) * 100);
            if (contactPercent > 100) contactPercent = 100;
            contactRate = contactPercent + '%';
        }

        detailData[memberId] = { assignDate, normalDate, contactCount, lastLogNextTime, contactRate, contactPercent, hasScheduledDemo, hasBeenContacted };
        renderList(); 

    } catch(e) {
        delete detailData[memberId];
        console.error("抓取日誌失敗，已移除快取準備重試", memberId, e);
        return; 
    }

    if (m.type == 1) {
        try {
            await syncNewMemberToSheet(m, assignDate);
        } catch(e) {
            console.error("Sheet 寫入失敗", memberId, e);
        }
    }
}

async function loadDetailsForAll(){
    const targets = allData.filter(m => (m.type == 1 || m.type == 2) && !detailData[m.member_id]);
    if (!targets.length) return;
    const statusLabel = document.getElementById('loading-status');
    for (let i = 0; i < targets.length; i += 5) {
        const batch = targets.slice(i, i + 5);
        await Promise.all(batch.map(m => fetchMemberDetail(m)));
        statusLabel.innerText = '🔄 名單細節 ' + Math.min(i + 5, targets.length) + '/' + targets.length;
        renderList();
    }
}

async function loadDetailsForConsultant(consultantName){
    const targets = allData.filter(m =>
        (m.type == 1 || m.type == 2) &&
        (m.user_name || '').trim() === consultantName &&
        !detailData[m.member_id]
    );
    if (!targets.length) return;
    const statusLabel = document.getElementById('loading-status');
    statusLabel.innerText = '🔄 同步 ' + consultantName + ' 的名單...';
    for (let i = 0; i < targets.length; i += 5) {
        const batch = targets.slice(i, i + 5);
        await Promise.all(batch.map(m => fetchMemberDetail(m)));
        statusLabel.innerText = '🔄 ' + consultantName + ' 名單細節 ' + Math.min(i + 5, targets.length) + '/' + targets.length;
        renderList();
    }
    statusLabel.innerText = '✅ ' + consultantName + ' 同步完成';
    setTimeout(() => statusLabel.innerText = '', 2000);
}

/* ══ 噴單天數計算 ══ */
function getDropDaysLeft(item, detail){
    const today = new Date(); today.setHours(0,0,0,0);

    if (item.type == 1) {
        if (!detail || !detail.assignDate) return null;
        const assign = new Date(detail.assignDate); assign.setHours(0,0,0,0);
        const dropDate = new Date(assign); dropDate.setDate(dropDate.getDate() + 3);
        return Math.ceil((dropDate - today) / 86400000);
    }

    if (item.type == 2) {
        if (!detail) return null;
        const base = detail.lastLogNextTime || detail.normalDate;
        if (!base) return null;
        const baseD = new Date(base); baseD.setHours(0,0,0,0);
        const dropDate = new Date(baseD); dropDate.setDate(baseD.getDate() + 4);
        return Math.ceil((dropDate - today) / 86400000);
    }

    if (!item.next_time || item.next_time.includes('0000-00-00')) return null;
    const nextT = new Date(item.next_time.split(' ')[0]); nextT.setHours(0,0,0,0);
    const dropDate = new Date(nextT); dropDate.setDate(nextT.getDate() + 4);
    return Math.ceil((dropDate - today) / 86400000);
}

// ★ 全局監聽搜尋輸入
document.getElementById('global-search-input').addEventListener('input', (e) => {
    currentSearchTerm = e.target.value.trim().toLowerCase();
    currentPage = 1;
    poolCurrentPage = 1;
    if (currentTab === 'pool') renderPoolList();
    else renderList();
});

function renderList(){
    if (currentTab === 'pool') return; 
    
    const selectedConsultant=isManager?document.getElementById('consultant-filter').value:'-1';
    const selectedTType=document.getElementById('t-type-filter').value;
    const selectedSource = (isManager && document.getElementById('source-filter')) ? document.getElementById('source-filter').value : '-1';
    const localContactedDict = getLocalContacted();
    
    let filteredData=allData.filter(item=>{
        const cMatch=isManager?(selectedConsultant=='-1'||(item.user_name||'').trim()===selectedConsultant):true;
        const tMatch = selectedTType=='-1'||String(item.type)===selectedTType;
        const sMatch = selectedSource === '-1' || (item.source && item.source.trim().substring(0, 2).toUpperCase() === selectedSource);
        
        // ★ 加入全域搜尋過濾
        let searchMatch = true;
        if (currentSearchTerm) {
            const nameStr = (item.member_name || '').toLowerCase();
            const phoneStr = (item.mobile || '').toLowerCase();
            searchMatch = nameStr.includes(currentSearchTerm) || phoneStr.includes(currentSearchTerm);
        }

        return cMatch && tMatch && sMatch && searchMatch;
    });
    
    filteredData.sort((a,b)=>(getDropDaysLeft(a,detailData[a.member_id])??999)-(getDropDaysLeft(b,detailData[b.member_id])??999));
    if(!filteredData.length){content.innerHTML='<div style="text-align:center;padding:20px;color:#666;">找不到符合條件的名單。</div>';return;}
    
    // ★ 分頁邏輯計算
    const ITEMS_PER_PAGE = 150;
    const totalItems = filteredData.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const pagedData = filteredData.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    const typeStyles={'1':{label:'新單',bg:'#1a6fc4'},'2':{label:'常態',bg:'#27ae60'},'3':{label:'Demo',bg:'#8e44ad'},'4':{label:'釋出',bg:'#e67e22'}};
    const sourceHeader=(isManager || isSpoofing)?'<th style="padding:6px;width:7%;">來源</th>':'';
    const batchHeader = isManager ? '<th style="padding:6px;width:30px;text-align:center;"><input type="checkbox" id="select-all-cb" style="cursor:pointer;"></th>' : '';

    let html='<div class="table-wrapper" style="flex:1;overflow:auto;-webkit-overflow-scrolling:touch;"><table style="width:100%;min-width:850px;border-collapse:collapse;font-size:12px;">';
    html+='<tr style="background:#e9ecef;text-align:left;position:sticky;top:0;z-index:10;">' + batchHeader + '<th style="padding:6px;">姓名/狀態</th><th style="padding:6px;">電話</th><th style="padding:6px;width:10%;">等級</th><th style="padding:6px;width:22%;">備註</th><th style="padding:6px;width:16%;">下次聯繫 & 預警</th>'+sourceHeader+'<th style="padding:6px;">業務</th><th style="padding:6px;width:9%;">操作</th></tr>';

    pagedData.forEach(item=>{
        const id=item.member_id||item.id||'';
        const d=detailData[id];
        const sd=sheetData[String(id)]||{};
        const dropDays=getDropDaysLeft(item,d);
        const ts=typeStyles[String(item.type)]||{label:'其他',bg:'#95a5a6'};
        const rowBorderColor=dropDays!==null&&dropDays<=0?'#e74c3c':dropDays!==null&&dropDays<=2?'#e67e22':ts.bg;

        let warningHtml='';
        if(dropDays!==null){
            if(dropDays<0)warningHtml='<br><span style="color:#c0392b;font-weight:bold;">🔥 已噴單(過期'+Math.abs(dropDays)+'天)</span>';
            else if(dropDays===0)warningHtml='<br><span style="color:#d35400;font-weight:bold;">🔥 今日噴單</span>';
            else if(dropDays<=2)warningHtml='<br><span style="color:#e67e22;font-weight:bold;">⚠️ 剩 '+dropDays+' 天</span>';
            else warningHtml='<br><span style="color:#16a085;">距噴單 '+dropDays+' 天</span>';
        } else if((item.type==1 || item.type==2) && !d){
            warningHtml=isManager&&selectedConsultant=='-1'?'<br><span style="color:#95a5a6;">請選取業務載入</span>':'<br><span style="color:#95a5a6;">載入中...</span>';
        }

        let progressHtml='';
        if(d){
            if(item.type==1){
                const count=d.contactCount||0;
                const pct=Math.min(100,(count/6)*100);
                progressHtml='<div style="font-size:10px;color:#1a6fc4;margin-top:3px;">進單:'+(d.assignDate||'-')+' 進度:'+count+'/6</div><div style="width:100%;height:3px;background:#ddd;border-radius:2px;margin-top:2px;"><div style="width:'+pct+'%;height:100%;background:'+(pct<100?'#3498db':'#27ae60')+';border-radius:2px;"></div></div>';
            }else if (item.type==2) {
                progressHtml='<div style="font-size:10px;color:#27ae60;margin-top:3px;">轉常態時間:'+(d.normalDate||'-')+'</div>';
            }
            
            if (item.type==2) {
                if (d.hasScheduledDemo) {
                    progressHtml += '<div style="font-size:11px;font-weight:bold;color:#8e44ad;margin-top:2px;">已約 Demo</div>';
                } else if (d.hasBeenContacted) {
                    progressHtml += '<div style="font-size:11px;font-weight:bold;color:#27ae60;margin-top:2px;">已聯絡</div>';
                } else if (d.contactRate) {
                    const rateColor = d.contactPercent < 50 ? '#e74c3c' : '#27ae60';
                    progressHtml += '<div style="font-size:11px;font-weight:bold;color:'+rateColor+';margin-top:2px;">觸及率: '+d.contactRate+'</div>';
                }
            }
        }

        const isReInquire = (sd.status === '再次留單');
        const reInquireHtml = isReInquire ? '<span style="background:#c0392b;color:white;padding:1px 5px;border-radius:3px;font-size:10px;margin-left:5px;">再次留單</span>' : '';
        const btnBg=dropDays!==null&&dropDays<=0?'#e74c3c':ts.bg;
        const sourceCell=(isManager || isSpoofing)?'<td style="padding:6px;color:#8e44ad;font-size:11px;vertical-align:top;">S:'+(item.source||'-')+'</td>':'';
        const displayUserName=(item.user_name&&item.user_name.trim())?item.user_name.trim():getWriterName();

        let gradeHtml = '';
        let memoHtml = '';

        if (item.type == 4 && !isReInquire) {
            gradeHtml = '<span style="color:#bdc3c7;font-size:11px;">無須評等</span>';
            const isLocalContacted = !!localContactedDict[id];
            memoHtml = '<button class="reinquire-btn" data-id="'+id+'" style="padding:6px 12px;border:1px solid #c0392b;border-radius:4px;background:#fff;color:#c0392b;cursor:pointer;font-size:12px;font-weight:bold;width:100%;margin-bottom:6px;">🚩 標記為「再次留單」</button>' + 
                       '<br><button class="local-contact-btn" data-id="'+id+'" style="padding:6px 12px;border:1px solid '+(isLocalContacted?'#27ae60':'#bdc3c7')+';border-radius:4px;background:'+(isLocalContacted?'#e8f8f5':'#fff')+';color:'+(isLocalContacted?'#27ae60':'#7f8c8d')+';cursor:pointer;font-size:11px;font-weight:bold;width:100%;">'+(isLocalContacted?'💬 已聯繫 (本機暫存)':'標記為已聯繫')+'</button>';
        } else {
            const gradeA = sd.grade==='A';
            const gradeC = sd.grade==='C';
            gradeHtml =
                '<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">' +
                '<button class="grade-inline-btn" data-id="'+id+'" data-val="A" style="padding:2px 10px;border:2px solid '+(gradeA?'#1a6fc4':'#ddd')+';border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;background:'+(gradeA?'#1a6fc4':'#fff')+';color:'+(gradeA?'white':'#333')+';">A</button>' +
                '<button class="grade-inline-btn" data-id="'+id+'" data-val="C" style="padding:2px 10px;border:2px solid '+(gradeC?'#e67e22':'#ddd')+';border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;background:'+(gradeC?'#e67e22':'#fff')+';color:'+(gradeC?'white':'#333')+';">C</button>' +
                (sd.grade?'<button class="grade-inline-btn" data-id="'+id+'" data-val="" style="padding:2px 6px;border:1px solid #ddd;border-radius:4px;cursor:pointer;font-size:10px;background:#f5f5f5;color:#999;">✕</button>':'') +
                '</div>';

            let reInqToggle = '';
            if (item.type != 1) { 
                if (isReInquire) {
                    reInqToggle = '<button class="reinquire-btn" data-id="'+id+'" style="margin-bottom:4px;padding:2px 6px;border:none;border-radius:4px;background:#c0392b;color:#fff;cursor:pointer;font-size:10px;font-weight:bold;">✅ 已標記再次留單 (點擊取消)</button><br>';
                } else if (item.type != 4) { 
                    reInqToggle = '<button class="reinquire-btn" data-id="'+id+'" style="margin-bottom:4px;padding:2px 6px;border:1px solid #c0392b;border-radius:4px;background:#fff;color:#c0392b;cursor:pointer;font-size:10px;font-weight:bold;">🚩 標記為再次留單</button><br>';
                }
            }

            memoHtml =
                '<div style="position:relative;">' +
                reInqToggle +
                '<textarea class="memo-inline-input" data-id="'+id+'" rows="2" style="width:100%;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:11px;font-family:sans-serif;resize:none;background:#fafafa;" placeholder="輸入備註...">'+( sd.memo||'' )+'</textarea>' +
                '<span id="save-status-'+id+'" style="font-size:10px;position:absolute;bottom:2px;right:4px;"></span>' +
                '</div>';
        }

        const batchCell = isManager ? '<td style="padding:6px;text-align:center;vertical-align:top;"><input type="checkbox" class="row-cb" value="'+id+'" style="cursor:pointer;"></td>' : '';
        const hasPhone=!!String(item.mobile||'').trim();
        const nameTools='<span style="display:inline-flex;align-items:center;gap:8px;margin-left:6px;vertical-align:middle;">' +
            '<button class="history-btn" data-id="'+id+'" title="查看聯繫歷史" aria-label="查看聯繫歷史" style="width:24px;height:22px;padding:0;border:1px solid #b2babb;border-radius:50%;background:#f2f3f4;color:#707b7c;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                    '<path d="M13 3h5a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8"/>' +
                    '<path d="M11 11h6M9 15h8M9 19h6"/>' +
                    '<circle cx="6" cy="6" r="4.5" fill="#f2f3f4"/>' +
                    '<path d="M6 3.8v2.5l1.8 1"/>' +
                '</svg>' +
            '</button>' +
            '<button class="single-dial-btn" data-id="'+id+'" title="'+(hasPhone?'撥打此名單':'沒有電話號碼')+'" '+(hasPhone?'':'disabled')+' style="width:24px;height:22px;padding:0;border:1px solid '+(hasPhone?'#27ae60':'#bdc3c7')+';border-radius:50%;background:'+(hasPhone?'#eafaf1':'#f2f3f4')+';color:'+(hasPhone?'#1e8449':'#aab7b8')+';cursor:'+(hasPhone?'pointer':'not-allowed')+';font-size:12px;line-height:20px;">📞</button>' +
            '</span>';

        html+='<tr style="border-bottom:1px solid #dee2e6;border-left:4px solid '+rowBorderColor+';">' + batchCell + '<td style="padding:6px;vertical-align:top;"><b>'+(item.member_name||'未知')+'</b>'+nameTools+'<br><span style="background:'+ts.bg+';color:white;padding:1px 5px;border-radius:3px;font-size:10px;">'+ts.label+'</span>'+reInquireHtml+progressHtml+'</td><td style="padding:6px;vertical-align:top;">'+(item.mobile||'-')+'</td><td style="padding:6px;vertical-align:top;">'+gradeHtml+'</td><td style="padding:6px;vertical-align:top;">'+memoHtml+'</td><td style="padding:6px;vertical-align:top;"><span style="color:#d35400;">'+(item.type==2 && d ? (d.lastLogNextTime || d.normalDate || '無紀錄') : (item.next_time&&!item.next_time.includes('0000')?item.next_time.split(' ')[0]:'無紀錄'))+'</span>'+warningHtml+'</td>'+sourceCell+'<td style="padding:6px;color:#7f8c8d;vertical-align:top;font-size:11px;">'+displayUserName+'</td><td style="padding:6px;vertical-align:top;"><button class="quick-record-btn" data-id="'+id+'" style="padding:4px 8px;background:'+btnBg+';color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;width:100%;">壓紀錄</button><button class="quick-release-btn" data-id="'+id+'" style="margin-top:4px;padding:4px 8px;background:#c0392b;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;width:100%;">釋出</button></td></tr>';
    });

    html+='</table></div>';
    
    // ★ 底部新增分頁列
    html += `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:#fff;border-top:1px solid #dee2e6;flex-shrink:0;">
            <div style="font-size:12px;color:#666;">
                顯示第 ${totalItems === 0 ? 0 : startIndex + 1} 到 ${Math.min(startIndex + ITEMS_PER_PAGE, totalItems)} 筆，共 <b style="color:#2c3e50;">${totalItems}</b> 筆 
                <span style="margin-left:8px;color:#888;">(第 ${currentPage} / ${totalPages} 頁)</span>
            </div>
            <div style="display:flex;gap:8px;">
                <button id="page-prev-btn" ${currentPage === 1 ? 'disabled' : ''} style="padding:5px 14px;border:1px solid #ddd;border-radius:4px;background:${currentPage === 1 ? '#f1f1f1' : '#fff'};color:${currentPage === 1 ? '#aaa' : '#333'};cursor:${currentPage === 1 ? 'not-allowed' : 'pointer'};font-weight:bold;">上一頁</button>
                <button id="page-next-btn" ${currentPage === totalPages ? 'disabled' : ''} style="padding:5px 14px;border:1px solid #ddd;border-radius:4px;background:${currentPage === totalPages ? '#f1f1f1' : '#fff'};color:${currentPage === totalPages ? '#aaa' : '#333'};cursor:${currentPage === totalPages ? 'not-allowed' : 'pointer'};font-weight:bold;">下一頁</button>
            </div>
        </div>
    `;
    
    let currentScrollTop = 0;
    const oldWrapper = content.querySelector('.table-wrapper');
    if (oldWrapper) currentScrollTop = oldWrapper.scrollTop;

    content.innerHTML=html;

    const newWrapper = content.querySelector('.table-wrapper');
    if (newWrapper && currentScrollTop > 0) newWrapper.scrollTop = currentScrollTop;
    
    // ★ 綁定分頁按鈕事件
    const prevBtn = document.getElementById('page-prev-btn');
    const nextBtn = document.getElementById('page-next-btn');
    if(prevBtn && !prevBtn.disabled) prevBtn.onclick = () => { currentPage--; renderList(); };
    if(nextBtn && !nextBtn.disabled) nextBtn.onclick = () => { currentPage++; renderList(); };

    if (isManager) {
        const batchBtn = document.getElementById('batch-release-btn');
        const updateBatchBtn = () => {
            const checkedCount = document.querySelectorAll('.row-cb:checked').length;
            if(batchBtn) {
                if(checkedCount > 0) {
                    batchBtn.style.display = 'inline-block';
                    batchBtn.innerText = '批量處理 (' + checkedCount + ')';
                } else {
                    batchBtn.style.display = 'none';
                }
            }
        };
        
        const selectAllCb = document.getElementById('select-all-cb');
        if(selectAllCb) {
            selectAllCb.onchange = e => {
                document.querySelectorAll('.row-cb').forEach(cb => cb.checked = e.target.checked);
                updateBatchBtn();
            };
        }
        document.querySelectorAll('.row-cb').forEach(cb => cb.onchange = updateBatchBtn);
        updateBatchBtn();
    }

    document.querySelectorAll('.reinquire-btn').forEach(btn=>{
        btn.onclick=e=>{
            const memberId=e.target.getAttribute('data-id');
            const item=allData.find(m=>(m.member_id||m.id)==memberId);
            if(!sheetData[String(memberId)])sheetData[String(memberId)]={status:'',grade:'',memo:''};
            const sd=sheetData[String(memberId)];
            sd.status = (sd.status === '再次留單') ? '' : '再次留單';
            renderList(); 
            debounceSaveMemo(memberId, sd.grade, sd.memo, item); 
        };
    });

    document.querySelectorAll('.local-contact-btn').forEach(btn=>{
        btn.onclick=e=>{
            const memberId = e.target.getAttribute('data-id');
            setLocalContacted(memberId, true); 
            renderList(); 
        };
    });

    document.querySelectorAll('.grade-inline-btn').forEach(btn=>{
        btn.onclick=e=>{
            const memberId=e.target.getAttribute('data-id');
            const val=e.target.getAttribute('data-val');
            const item=allData.find(m=>(m.member_id||m.id)==memberId);
            if(!sheetData[String(memberId)])sheetData[String(memberId)]={status:'',grade:'',memo:''};
            sheetData[String(memberId)].grade=val;
            renderList(); 
            const sd=sheetData[String(memberId)];
            debounceSaveMemo(memberId, sd.grade, sd.memo, item); 
        };
    });

    document.querySelectorAll('.memo-inline-input').forEach(input=>{
        input.addEventListener('input', e=>{
            const memberId=e.target.getAttribute('data-id');
            const memo=e.target.value;
            const item=allData.find(m=>(m.member_id||m.id)==memberId);
            if(!sheetData[String(memberId)])sheetData[String(memberId)]={status:'',grade:'',memo:''};
            sheetData[String(memberId)].memo=memo;
            const sd=sheetData[String(memberId)];
            debounceSaveMemo(memberId, sd.grade, sd.memo, item); 
        });
    });

    document.querySelectorAll('.quick-record-btn').forEach(btn=>{
        btn.onclick=e=>{
            const memberId=e.target.getAttribute('data-id');
            const item=allData.find(m=>(m.member_id||m.id)==memberId);
            currentItem=item;
            document.getElementById('modal-member-id').value=memberId;
            const formatDate=(date)=>{
                const y=date.getFullYear();
                const mo=String(date.getMonth()+1).padStart(2,'0');
                const d=String(date.getDate()).padStart(2,'0');
                return y+'-'+mo+'-'+d;
            };
            const today=new Date();
            const nextTarget=new Date(today);
            nextTarget.setDate(today.getDate()+(item.type==1?1:3));
            const dateInput=document.getElementById('modal-date');
            dateInput.value=formatDate(nextTarget);
            const maxDate=new Date(today);
            maxDate.setDate(today.getDate()+14);
            dateInput.min=formatDate(today);
            dateInput.max=formatDate(maxDate);
            const d=detailData[memberId];
            document.getElementById('modal-info-text').innerText=item.type==1&&d?'【新單】已壓 '+d.contactCount+' 次，目標 6 次，還需 '+Math.max(0,6-d.contactCount)+' 次':'';
            const statusSel=document.getElementById('modal-status');
            statusSel.value='3';
            const contentEl=document.getElementById('modal-content');
            contentEl.value='未接 *1';
            contentEl.style.minHeight='60px';
            recordModal.style.display='block';
        };
    });

    document.querySelectorAll('.history-btn').forEach(btn=>{
        btn.onclick=e=>{
            const memberId=e.currentTarget.getAttribute('data-id');
            const item=allData.find(m=>(m.member_id||m.id)==memberId);
            if(item)openContactHistory(item);
        };
    });

    document.querySelectorAll('.single-dial-btn:not([disabled])').forEach(btn=>{
        btn.onclick=e=>{
            const memberId=e.currentTarget.getAttribute('data-id');
            const item=allData.find(m=>(m.member_id||m.id)==memberId);
            if(!item)return;
            if(dialerActive&&!confirm('目前撥號流程尚未結束，確定要改為撥打「'+(item.member_name||'這筆名單')+'」嗎？'))return;
            dialerInit([item]);
        };
    });

    document.querySelectorAll('.quick-release-btn').forEach(btn=>{
        btn.onclick=e=>{
            const memberId=e.target.getAttribute('data-id');
            document.getElementById('release-member-id').value=memberId;
            document.getElementById('release-memo').value='';
            document.getElementById('release-modal').style.display='block';
        };
    });
}
document.getElementById('modal-cancel').onclick = () => { document.getElementById('record-modal').style.display='none'; };
document.getElementById('modal-submit').onclick=async()=>{
    if(!currentItem)return;
    const memberId=document.getElementById('modal-member-id').value;
    const btn=document.getElementById('modal-submit');btn.innerText='送出中...';
    btn.disabled=true;

    try{
        await ensurePanelCanWrite(memberId);

        let iframe=document.getElementById('hidden-save-frame');
        if(!iframe){
            iframe=document.createElement('iframe');
            iframe.name='hidden-save-frame';iframe.id='hidden-save-frame';iframe.style.display='none';iframe.sandbox='allow-forms allow-same-origin';
            document.body.appendChild(iframe);
        }
        const form=document.createElement('form');form.target='hidden-save-frame';form.method='POST';
        form.action='https://www.etalkingonline.com/admin/request_develop/save';
        const params={'current_member_id':memberId,'contact_status':document.getElementById('modal-status').value,'content':document.getElementById('modal-content').value,'sub_content':'','search_begin':document.getElementById('modal-date').value,'time':'12:00:00','consultant_type':'10','type':'20'};
        for(let k in params){let i=document.createElement('input');i.type='hidden';i.name=k;i.value=params[k];form.appendChild(i);}
        
        document.body.appendChild(form);form.submit();
        setTimeout(()=>form.remove(), 500);

        setTimeout(()=>{
            alert('✅ 紀錄已成功送出！');
            recordModal.style.display='none';btn.innerText='送出紀錄';btn.disabled=false;
            if(currentItem.type==1&&detailData[memberId])detailData[memberId].contactCount++;
            if(detailData[memberId]) {
                detailData[memberId].lastLogNextTime = params['search_begin'];
            }
            currentItem.next_time=params['search_begin']+' 11:59:59';

            if (params['contact_status'] === '1' && currentItem.type == 4) {
                setLocalContacted(memberId, false);
            }

            renderList();
        },1000);
    }catch(e){
        console.error(e);
        btn.innerText='送出紀錄';
        btn.disabled=false;
        notifyGuardError(e);
    }
};

/* ══ 名單管理頁面：批次處理 (包含延遲的原始邏輯) ══ */
const batchBtnObj = document.getElementById('batch-release-btn');
if (batchBtnObj) {
    batchBtnObj.onclick = () => {
        const checkedCbs = document.querySelectorAll('.row-cb:checked');
        if(checkedCbs.length === 0) return;
        const ids = Array.from(checkedCbs).map(cb => cb.value);
        document.getElementById('release-member-id').value = ids.join(',');
        document.getElementById('release-memo').value = '';
        document.getElementById('release-modal').style.display = 'block';
    };
}

document.getElementById('release-cancel').onclick=()=>{ document.getElementById('release-modal').style.display='none'; };

document.getElementById('release-submit').onclick = async () => {
    const memberIdsStr = document.getElementById('release-member-id').value;
    const reason = document.getElementById('release-reason').value;
    const memo = document.getElementById('release-memo').value.trim();
    const btn = document.getElementById('release-submit');
    
    const reassignSelect = document.getElementById('release-reassign');
    const targetSalesId = reassignSelect ? reassignSelect.value : '-1';
    
    if (!memberIdsStr) return;
    const memberIds = memberIdsStr.split(',');

    btn.innerText = '處理中...';
    btn.disabled = true;

    const randomDelay = (min, max) => new Promise(res => setTimeout(res, Math.random() * (max - min) + min));

    let successCount = 0;
    let failCount = 0;

    try {
        const adminNameStr = getWriterName();
        const accountStr = adminNameStr.split(' ')[0] || adminNameStr;
        const finalReason = memo ? reason + '，' + memo : reason + '，';

        for (let i = 0; i < memberIds.length; i++) {
            const mId = memberIds[i];
            btn.innerText = `處理中 (${i+1}/${memberIds.length})...`;

            try {
                const releaseUrl = `https://www.etalkingonline.com/admin/sys/api_member_release_member.php?id=${mId}&reason=${encodeURIComponent(finalReason)}&uid=${crmUid}&account=${encodeURIComponent(accountStr)}&admin_name=${encodeURIComponent(adminNameStr)}`;
                const releaseRes = await fetch(releaseUrl);
                if (!releaseRes.ok) throw new Error('釋出 API 錯誤');

                if (targetSalesId !== '-1') {
                    await randomDelay(1500, 2500); 
                    const reassignUrl = `https://www.etalkingonline.com/admin/sys/api_release_appoint.php?uid=${crmUid}&account=${encodeURIComponent(accountStr)}&admin_name=${encodeURIComponent(adminNameStr)}`;
                    
                    const formData = new URLSearchParams();
                    formData.append('sales', targetSalesId);
                    formData.append('checked[]', mId);

                    const reassignRes = await fetch(reassignUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: formData.toString()
                    });
                    if (!reassignRes.ok) throw new Error('轉派 API 錯誤');
                }
                
                successCount++;
                allData = allData.filter(m => (m.member_id || m.id) != mId);
                
            } catch(err) {
                console.error(`名單 ${mId} 處理失敗:`, err);
                failCount++;
            }

            if(i < memberIds.length - 1) {
                await randomDelay(2000, 3000);
            }
        }

        if (memberIds.length > 1) {
            alert(`✅ 批量執行完畢！\n成功: ${successCount} 筆\n失敗: ${failCount} 筆`);
        } else if (targetSalesId !== '-1') {
            alert('✅ 釋出並轉派成功！');
        } else {
            alert('✅ 名單已成功釋出！');
        }

        document.getElementById('release-modal').style.display = 'none';
        
        if(currentTab === 'pool') {
            const dispatchedIds = new Set(memberIds);
            poolData = poolData.filter(item => !dispatchedIds.has(item.member_id));
            if(typeof renderPoolList === 'function') renderPoolList();
        } else {
            renderList();
        }

        if (typeof dialerCheckAndSkipIfReleased === 'function') {
            dialerCheckAndSkipIfReleased(memberIds);
        }
        
    } catch(e) {
        alert('❌ 發生預期外錯誤！');
        console.error(e);
    } finally {
        btn.innerText = '確定送出';
        btn.disabled = false;
        if(reassignSelect) reassignSelect.value = '-1';
    }
};

/* ══ 釋出池專用：純轉派 API 呼叫邏輯 ══ */
document.getElementById('pool-assign-cancel').onclick = () => { document.getElementById('pool-assign-modal').style.display='none'; };

document.getElementById('pool-assign-submit').onclick = async () => {
    const idsStr = document.getElementById('pool-assign-ids').value;
    const targetSalesId = document.getElementById('pool-assign-select').value;
    
    if (targetSalesId === '-1') {
        alert('⚠️ 請選擇要轉派的業務！');
        return;
    }
    if (!idsStr) return;

    const memberIds = idsStr.split(',');
    const btn = document.getElementById('pool-assign-submit');
    btn.innerText = '處理中...';
    btn.disabled = true;

    try {
        const adminNameStr = getWriterName();
        const accountStr = adminNameStr.split(' ')[0] || adminNameStr;
        const reassignUrl = `https://www.etalkingonline.com/admin/sys/api_release_appoint.php?uid=${crmUid}&account=${encodeURIComponent(accountStr)}&admin_name=${encodeURIComponent(adminNameStr)}`;
        
        const formData = new URLSearchParams();
        formData.append('sales', targetSalesId);
        memberIds.forEach(id => formData.append('checked[]', id));

        const reassignRes = await fetch(reassignUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
        });

        if (!reassignRes.ok) throw new Error('轉派 API 錯誤');
        
        alert(`✅ 成功派發 ${memberIds.length} 筆名單給指定的業務！`);
        
        document.getElementById('pool-assign-modal').style.display = 'none';
        const dispatchedIds = new Set(memberIds);
        poolData = poolData.filter(item => !dispatchedIds.has(String(item.member_id)));
        
        if (typeof renderPoolList === 'function') renderPoolList();

    } catch(e) {
        alert('❌ 派發發生錯誤！');
        console.error(e);
    } finally {
        btn.innerText = '一鍵派發';
        btn.disabled = false;
        document.getElementById('pool-assign-select').value = '-1';
    }
};

document.getElementById('close-btn').onclick=()=>{
    dialerDestroy();
    // ★ 修改點：關閉時若有注入手機版 viewport 則還原，避免影響原系統
    if (addedViewport) {
        const m = document.getElementById('custom-crm-viewport');
        if(m) m.remove();
    }
    panel.remove();curtain.remove();document.body.style.overflow='';
    setTimeout(()=>{window.location.href='https://admin.etalkingonline.com/etalking2.0/#/kpi';},300);
};
document.getElementById('refresh-btn').onclick=fetchData;

// ★ 所有切換條件時，重置為第一頁 (加上防護罩避免組員端報錯)
if(document.getElementById('t-type-filter')) {
    document.getElementById('t-type-filter').onchange = () => { currentPage = 1; renderList(); };
}
if(document.getElementById('source-filter')) {
    document.getElementById('source-filter').onchange = () => { currentPage = 1; renderList(); };
}
if(document.getElementById('consultant-filter')) {
    document.getElementById('consultant-filter').onchange=function(){
        currentPage = 1;
        renderList();
        if(this.value!=='-1')loadDetailsForConsultant(this.value);
    };
}

if(isManager){
    function switchTab(tab) {
        currentTab = tab;
        const tabCrm = document.getElementById('tab-crm');
        const tabPool = document.getElementById('tab-pool');
        const poolSyncBlock = document.getElementById('pool-sync-block');
        const typeFilter = document.getElementById('t-type-filter'); 

        [tabCrm, tabPool].forEach(t => {
            if(t) {
                t.style.background = 'transparent';
                t.style.border = '2px solid rgba(255,255,255,0.4)';
            }
        });

        // 切換頁籤時重置分頁狀態
        currentPage = 1;
        poolCurrentPage = 1;

        if(tab === 'crm') {
            tabCrm.style.background = '#3498db';
            tabCrm.style.border = '2px solid #3498db';
            ['consultant-filter','source-filter','sync-all-new-btn','sync-demo-btn','bulk-sync-rate-btn','refresh-btn'].forEach(id => {
                const el = document.getElementById(id);
                if(el) el.style.display = '';
            });
            if(typeFilter) typeFilter.style.display = ''; 
            if(poolSyncBlock) poolSyncBlock.style.display = 'none';
            renderList();

        } else {
            tabPool.style.background = '#2ecc71';
            tabPool.style.border = '2px solid #2ecc71';
            ['consultant-filter','source-filter','sync-all-new-btn','sync-demo-btn','bulk-sync-rate-btn','refresh-btn'].forEach(id => {
                const el = document.getElementById(id);
                if(el) el.style.display = 'none';
            });
            if(typeFilter) typeFilter.style.display = 'none';
            if(poolSyncBlock) poolSyncBlock.style.display = 'inline-flex';
            renderPoolEmptyState();
        }
    }

    document.getElementById('tab-crm').onclick = () => switchTab('crm');
    document.getElementById('tab-pool').onclick = () => switchTab('pool');

    function renderPoolEmptyState() {
        if(currentTab !== 'pool') return;

        const prefixesGuess = [...new Set(
            allData.map(item => (item.source||'').trim().substring(0,2).toUpperCase()).filter(Boolean)
        )].sort();

        const filterHtml = `
            <div style="padding:30px;text-align:center;">
                <h4 style="margin-top:0;color:#2c3e50;">📂 釋出池查詢設定</h4>
                <p style="color:#888;font-size:13px;">請先選擇日期區間與來源，再點擊「載入資料」</p>
                <div style="display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap;margin-top:15px;">
                    <select id="pool-source-filter" style="padding:6px 10px;border-radius:4px;border:1px solid #ddd;font-size:13px;">
                        <option value="-1">所有來源</option>
                        ${prefixesGuess.map(p => `<option value="${p}">${p}</option>`).join('')}
                    </select>
                    <input type="date" id="pool-filter-start" style="padding:6px 10px;border-radius:4px;border:1px solid #ddd;font-size:13px;">
                    <span style="color:#666;">~</span>
                    <input type="date" id="pool-filter-end" style="padding:6px 10px;border-radius:4px;border:1px solid #ddd;font-size:13px;">
                    <button id="pool-load-btn" style="padding:6px 16px;background:#1a6fc4;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold;">
                        🔍 載入資料
                    </button>
                </div>
            </div>`;

        content.innerHTML = filterHtml;

        document.getElementById('pool-load-btn').onclick = () => {
            poolSourceFilter = document.getElementById('pool-source-filter').value;
            poolFilterStart  = document.getElementById('pool-filter-start').value;
            poolFilterEnd    = document.getElementById('pool-filter-end').value;
            poolData = [];
            poolCurrentPage = 1;
            loadPoolData();
        };
    }

    async function loadPoolData() {
        const statusLabel = document.getElementById('loading-status');
        statusLabel.innerText = '🔄 載入釋出池...';
        poolData = [];
        content.innerHTML = '<div style="text-align:center;padding:30px;color:#666;">🔄 載入中，請稍候...</div>';

        const LIMIT = 500;
        let offset = 0;
        let total  = null;

        try {
            while (true) {
                const res = await gasGet({
                    action:    'readPool',
                    offset:    offset,
                    limit:     LIMIT,
                    source:    poolSourceFilter,
                    startDate: poolFilterStart,
                    endDate:   poolFilterEnd
                });

                if (res.error) throw new Error(res.error);

                if (total === null) total = res.total || 0;
                if (!res.values || res.values.length === 0) break;

                const batch = res.values.map(row => ({
                    member_id:    String(row[0] || ''),
                    member_name:  row[1] || '',
                    mobile:       row[2] || '',
                    source:       row[3] || '',
                    release_time: String(row[4] || '').substring(0, 10),
                    sync_time:    String(row[5] || '').substring(0, 10)
                }));

                poolData = poolData.concat(batch);
                offset  += LIMIT;

                statusLabel.innerText = `🔄 載入中 ${poolData.length} / ${total} 筆...`;
                renderPoolList();

                if (poolData.length >= total) break;
            }

            statusLabel.innerText = `✅ 釋出池共 ${poolData.length} 筆`;
            setTimeout(() => statusLabel.innerText = '', 3000);
            renderPoolList();

        } catch(e) {
            statusLabel.innerText = '❌ 釋出池載入失敗';
            content.innerHTML = '<div style="text-align:center;padding:20px;color:#e74c3c;">❌ 載入失敗，請重試</div>';
            console.error(e);
        }
    }

    renderPoolList = function() {
        if(currentTab !== 'pool') return;

        const prefixes = [...new Set(
            allData.map(item => (item.source||'').trim().substring(0,2).toUpperCase()).filter(Boolean)
        )].sort();

        const localContactedDict = getLocalContacted();

        // ★ 釋出池專屬前端搜尋過濾
        let poolFiltered = poolData.filter(item => {
            if (!currentSearchTerm) return true;
            const nameStr = (item.member_name || '').toLowerCase();
            const phoneStr = (item.mobile || '').toLowerCase();
            return nameStr.includes(currentSearchTerm) || phoneStr.includes(currentSearchTerm);
        });

        // ★ 釋出池分頁計算
        const POOL_ITEMS_PER_PAGE = 300;
        const totalItems = poolFiltered.length;
        const totalPages = Math.ceil(totalItems / POOL_ITEMS_PER_PAGE) || 1;
        if (poolCurrentPage > totalPages) poolCurrentPage = totalPages;
        const startIndex = (poolCurrentPage - 1) * POOL_ITEMS_PER_PAGE;
        const pagedData = poolFiltered.slice(startIndex, startIndex + POOL_ITEMS_PER_PAGE);

        const filterHtml = `
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid #dee2e6;margin-bottom:8px;">
                <select id="pool-source-filter" style="padding:5px 8px;border-radius:4px;border:1px solid #ddd;font-size:12px;">
                    <option value="-1">所有來源</option>
                    ${prefixes.map(p => `<option value="${p}" ${poolSourceFilter===p?'selected':''}>${p}</option>`).join('')}
                </select>
                <input type="date" id="pool-filter-start" value="${poolFilterStart}"
                    style="padding:5px 8px;border-radius:4px;border:1px solid #ddd;font-size:12px;">
                <span style="font-size:12px;color:#666;">~</span>
                <input type="date" id="pool-filter-end" value="${poolFilterEnd}"
                    style="padding:5px 8px;border-radius:4px;border:1px solid #ddd;font-size:12px;">
                <button id="pool-filter-btn"
                    style="padding:5px 14px;background:#1a6fc4;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;">
                    🔍 篩選
                </button>
                <button id="pool-filter-clear-btn"
                    style="padding:5px 10px;background:#95a5a6;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
                    清除篩選
                </button>
                <button id="pool-batch-btn"
                    style="display:none;padding:5px 14px;background:#27ae60;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;margin-left:auto;">
                    批次派發 (0)
                </button>
                <button id="pool-start-dial-btn"
                    style="padding:5px 14px;background:#f39c12;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;">
                    🚀 對此批名單撥號
                </button>
                <button id="pool-reload-btn"
                    style="padding:5px 10px;background:#7f8c8d;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
                    🔄 重新載入
                </button>
            </div>`;

        let tableHtml = '<div class="table-wrapper" style="flex:1;overflow:auto;-webkit-overflow-scrolling:touch;"><table style="width:100%;min-width:750px;border-collapse:collapse;font-size:12px;">';
        tableHtml += `
            <tr style="background:#e9ecef;text-align:left;position:sticky;top:0;z-index:10;">
                <th style="padding:6px;width:30px;text-align:center;">
                    <input type="checkbox" id="pool-select-all" style="cursor:pointer;">
                </th>
                <th style="padding:6px;">姓名 / 狀態</th>
                <th style="padding:6px;">電話</th>
                <th style="padding:6px;width:8%;">來源</th>
                <th style="padding:6px;width:14%;">釋出時間</th>
                <th style="padding:6px;width:14%;">同步時間</th>
            </tr>`;

        if (poolFiltered.length === 0) {
            tableHtml += '<tr><td colspan="6" style="text-align:center;padding:30px;color:#999;">目前沒有符合條件的資料</td></tr>';
        } else {
            pagedData.forEach(item => {
                const isLocalContacted = !!localContactedDict[item.member_id];
                tableHtml += `
                    <tr style="border-bottom:1px solid #dee2e6;">
                        <td style="padding:6px;text-align:center;vertical-align:top;">
                            <input type="checkbox" class="pool-cb" value="${item.member_id}" style="cursor:pointer;">
                        </td>
                        <td style="padding:6px;vertical-align:top;">
                            <b>${item.member_name || '未知'}</b><br>
                            <button class="local-contact-btn" data-id="${item.member_id}" style="margin-top:4px;padding:2px 6px;border:1px solid ${isLocalContacted?'#27ae60':'#bdc3c7'};border-radius:4px;background:${isLocalContacted?'#e8f8f5':'#fff'};color:${isLocalContacted?'#27ae60':'#7f8c8d'};cursor:pointer;font-size:10px;">${isLocalContacted?'💬 已聯繫':'標記已聯繫'}</button>
                        </td>
                        <td style="padding:6px;vertical-align:top;">${item.mobile || '-'}</td>
                        <td style="padding:6px;vertical-align:top;color:#8e44ad;font-size:11px;">${item.source || '-'}</td>
                        <td style="padding:6px;vertical-align:top;font-size:11px;color:#d35400;">${item.release_time || '-'}</td>
                        <td style="padding:6px;vertical-align:top;font-size:11px;color:#95a5a6;">${item.sync_time || '-'}</td>
                    </tr>`;
            });
        }
        tableHtml += '</table></div>';
        
        let paginationHtml = `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:#fff;border-top:1px solid #dee2e6;flex-shrink:0;">
                <div style="font-size:12px;color:#666;">
                    顯示第 ${totalItems === 0 ? 0 : startIndex + 1} 到 ${Math.min(startIndex + POOL_ITEMS_PER_PAGE, totalItems)} 筆，共 <b style="color:#2c3e50;">${totalItems}</b> 筆 
                    <span style="margin-left:8px;color:#888;">(第 ${poolCurrentPage} / ${totalPages} 頁)</span>
                </div>
                <div style="display:flex;gap:8px;">
                    <button id="pool-page-prev-btn" ${poolCurrentPage === 1 ? 'disabled' : ''} style="padding:5px 14px;border:1px solid #ddd;border-radius:4px;background:${poolCurrentPage === 1 ? '#f1f1f1' : '#fff'};color:${poolCurrentPage === 1 ? '#aaa' : '#333'};cursor:${poolCurrentPage === 1 ? 'not-allowed' : 'pointer'};font-weight:bold;">上一頁</button>
                    <button id="pool-page-next-btn" ${poolCurrentPage === totalPages ? 'disabled' : ''} style="padding:5px 14px;border:1px solid #ddd;border-radius:4px;background:${poolCurrentPage === totalPages ? '#f1f1f1' : '#fff'};color:${poolCurrentPage === totalPages ? '#aaa' : '#333'};cursor:${poolCurrentPage === totalPages ? 'not-allowed' : 'pointer'};font-weight:bold;">下一頁</button>
                </div>
            </div>
        `;

        content.innerHTML = filterHtml + tableHtml + paginationHtml;

        // ★ 綁定釋出池分頁按鈕事件
        const prevBtn = document.getElementById('pool-page-prev-btn');
        const nextBtn = document.getElementById('pool-page-next-btn');
        if(prevBtn && !prevBtn.disabled) prevBtn.onclick = () => { poolCurrentPage--; renderPoolList(); };
        if(nextBtn && !nextBtn.disabled) nextBtn.onclick = () => { poolCurrentPage++; renderPoolList(); };

        document.querySelectorAll('.local-contact-btn').forEach(btn=>{
            btn.onclick=e=>{
                const memberId = e.target.getAttribute('data-id');
                setLocalContacted(memberId, true);
                renderPoolList(); 
            };
        });

        document.getElementById('pool-filter-btn').onclick = () => {
            poolSourceFilter = document.getElementById('pool-source-filter').value;
            poolFilterStart  = document.getElementById('pool-filter-start').value;
            poolFilterEnd    = document.getElementById('pool-filter-end').value;
            poolData = [];
            poolCurrentPage = 1;
            loadPoolData();
        };

        document.getElementById('pool-filter-clear-btn').onclick = () => {
            poolSourceFilter = '-1';
            poolFilterStart  = '';
            poolFilterEnd    = '';
            poolData = [];
            poolCurrentPage = 1;
            renderPoolEmptyState();
        };

        document.getElementById('pool-reload-btn').onclick = () => {
            poolData = [];
            poolCurrentPage = 1;
            loadPoolData();
        };

        document.getElementById('pool-start-dial-btn').onclick = () => {
            if(poolFiltered.length === 0) { alert('⚠️ 請先載入釋出池名單'); return; }
            dialerShowEntryChoice(poolFiltered);
        };

        const poolBatchBtn = document.getElementById('pool-batch-btn');
        const updatePoolBatchBtn = () => {
            const count = document.querySelectorAll('.pool-cb:checked').length;
            poolBatchBtn.style.display = count > 0 ? 'inline-block' : 'none';
            poolBatchBtn.innerText = `批次派發 (${count})`;
        };

        document.getElementById('pool-select-all').onchange = e => {
            document.querySelectorAll('.pool-cb').forEach(cb => cb.checked = e.target.checked);
            updatePoolBatchBtn();
        };
        document.querySelectorAll('.pool-cb').forEach(cb => cb.onchange = updatePoolBatchBtn);

        poolBatchBtn.onclick = () => {
            const checkedIds = Array.from(document.querySelectorAll('.pool-cb:checked')).map(cb => cb.value);
            if(!checkedIds.length) return;
            
            document.getElementById('pool-assign-ids').value = checkedIds.join(',');
            document.getElementById('pool-assign-select').value = '-1';
            document.getElementById('pool-assign-modal').style.display = 'block';
        };
    };

    const todayStr = new Date().toISOString().split('T')[0];
    const poolStartInput = document.getElementById('pool-start-date');
    const poolEndInput   = document.getElementById('pool-end-date');
    if(poolStartInput) poolStartInput.value = todayStr;
    if(poolEndInput)   poolEndInput.value   = todayStr;

    const syncPoolBtn = document.getElementById('sync-pool-btn');
    if(syncPoolBtn) {
        syncPoolBtn.onclick = async () => {
            const start = poolStartInput.value;
            const end   = poolEndInput.value;
            if (!start || !end) return alert('⚠️ 請選擇完整的日期區間！');

            const statusLabel = document.getElementById('loading-status');
            syncPoolBtn.disabled = true;
            syncPoolBtn.style.background = '#95a5a6';
            syncPoolBtn.innerText = '撈取中...';

            try {
                const url = `https://server.etalkingonline.com/release_list/v4?startdate=${start}&enddate=${end}`;
                statusLabel.innerText = `🔄 正在打撈 ${start} ~ ${end} 的釋出池...`;
                const res  = await fetch(url);
                const data = await res.json();
                const list = data.list || [];

                if (list.length === 0) {
                    alert('➔ 該日期區間內，系統釋出池中沒有任何名單。');
                    return;
                }

                const BATCH_SIZE = 200;
                let totalAdded = 0;

                for (let i = 0; i < list.length; i += BATCH_SIZE) {
                    const batch = list.slice(i, i + BATCH_SIZE);
                    statusLabel.innerText = `🔄 寫入中 ${Math.min(i + BATCH_SIZE, list.length)} / ${list.length} 筆...`;

                    const releaseList = batch.map(item => ({
                        member_id:   item.id,
                        member_name: item.member_name,
                        mobile:      item.mobile,
                        source:      item.source || '未知',
                        next_time:   item.cdate  || '無紀錄'
                    }));

                    const gasRes = await gasPost({ action: 'syncReleasePool', releaseList });
                    if (gasRes.success) {
                        totalAdded += gasRes.addedCount;
                    } else {
                        throw new Error(gasRes.error || 'GAS 端寫入失敗');
                    }
                }

                statusLabel.innerText = `✅ 成功寫入 ${totalAdded} 筆！`;
                alert(`🎉 搬家成功！\n系統總共撈到: ${list.length} 筆\n新成功寫入 Sheet: ${totalAdded} 筆\n(重複的單已為您自動過濾)`);

            } catch (err) {
                alert('❌ 同步失敗！請檢查 Console 或確認 API 是否可存取。');
                console.error(err);
                statusLabel.innerText = '❌ 同步失敗';
            } finally {
                syncPoolBtn.disabled = false;
                syncPoolBtn.style.background = '#2ecc71';
                syncPoolBtn.innerText = '更新釋出池';
                setTimeout(() => { if (statusLabel.innerText.includes('成功')) statusLabel.innerText = ''; }, 3000);
            }
        };
    }

    document.getElementById('source-filter').onchange = () => { currentPage = 1; renderList(); };
    document.getElementById('consultant-filter').onchange=function(){
        currentPage = 1;
        renderList();
        if(this.value!=='-1')loadDetailsForConsultant(this.value);
    };

    const syncNewBtn=document.getElementById('sync-all-new-btn');
    if(syncNewBtn){
        syncNewBtn.onclick=async()=>{
            const statusLabel=document.getElementById('loading-status');
            syncNewBtn.disabled=true;syncNewBtn.style.background='#95a5a6';syncNewBtn.innerText='同步中...';
            await loadDetailsForAll();
            syncNewBtn.disabled=false;syncNewBtn.style.background='#8e44ad';syncNewBtn.innerText='同步名單細節';
            statusLabel.innerText='✅ 細節同步完成';
            setTimeout(()=>statusLabel.innerText='',3000);
            renderList();
        };
    }

    const syncDemoBtn=document.getElementById('sync-demo-btn');
    if(syncDemoBtn){
        syncDemoBtn.onclick=async()=>{
            syncDemoBtn.disabled=true;syncDemoBtn.style.background='#95a5a6';syncDemoBtn.innerText='同步中...';
            await syncDemoRawData();
            syncDemoBtn.disabled=false;syncDemoBtn.style.background='#e67e22';syncDemoBtn.innerText='同步Demo';
            renderList();
        };
    }

    const bulkSyncBtn=document.getElementById('bulk-sync-rate-btn');
    if(bulkSyncBtn){
        bulkSyncBtn.onclick=async()=>{
            const targets = allData.filter(m => m.type == 2 && detailData[m.member_id || m.id]);
            if(!targets.length) {
                alert('目前沒有已載入的常態名單可以同步！請先點擊「同步名單細節」。');
                return;
            }
            const pending = [];
            let unchangedCount = 0;
            let missingCount = 0;

            targets.forEach(item => {
                const id = String(item.member_id || item.id);
                const sd = sheetData[id];
                const rowNum = sheetRowMap[id];
                const contactRate = detailData[id].contactRate || '';

                if (!sd || !rowNum) {
                    missingCount++;
                    return;
                }
                if ((sd.contactRate || '') === contactRate) {
                    unchangedCount++;
                    return;
                }
                pending.push({ id, sd, rowNum, contactRate });
            });

            if (!pending.length) {
                alert('✅ 已檢查 ' + targets.length + ' 筆常態單，沒有需要寫入的觸及率。' +
                    (unchangedCount ? '\n無變化：' + unchangedCount + ' 筆' : '') +
                    (missingCount ? '\n⚠️ ' + missingCount + ' 筆在 Google Sheet 找不到對應資料。' : ''));
                return;
            }

            if(!confirm('已檢查 ' + targets.length + ' 筆常態單，其中 ' + pending.length + ' 筆觸及率有變化，即將寫入 Google Sheet。\n\n寫入期間請勿關閉網頁。確定嗎？')) return;

            bulkSyncBtn.disabled=true; bulkSyncBtn.style.background='#95a5a6';
            let successCount = 0;
            let failedCount = 0;
            let abortedError = null;
            const failedItems = [];
            const maxAttempts = 3;

            try {
                for(let i=0; i<pending.length; i++){
                    const task = pending[i];
                    let lastError = null;

                    for(let attempt=1; attempt<=maxAttempts; attempt++){
                        bulkSyncBtn.innerText = `同步中 (${i+1}/${pending.length})` + (attempt > 1 ? ` 重試 ${attempt}/${maxAttempts}` : '');
                        try {
                            await ensurePanelCanWrite(task.id);
                            const timeStr = new Date().toLocaleString('zh-TW');
                            await updateRow(task.rowNum, [task.sd.status, task.sd.grade, task.sd.memo, timeStr, task.contactRate]);
                            task.sd.contactRate = task.contactRate;
                            successCount++;
                            lastError = null;
                            break;
                        } catch(e) {
                            lastError = e;
                            const message = e && e.message ? e.message : String(e || '');
                            const mustStop = message.includes('超過 2 小時') ||
                                message.includes('面板已有新版') ||
                                message.includes('登入狀態已失效');
                            console.error('Batch update row failed', task.id, 'attempt', attempt, e);
                            if (mustStop) {
                                abortedError = e;
                                break;
                            }
                            if (attempt < maxAttempts) {
                                await new Promise(r => setTimeout(r, attempt * 1500));
                            }
                        }
                    }

                    if (abortedError) break;
                    if (lastError) {
                        failedCount++;
                        failedItems.push({ id: task.id, error: lastError.message || String(lastError) });
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
            } finally {
                bulkSyncBtn.disabled=false;
                bulkSyncBtn.style.background='#16a085';
                bulkSyncBtn.innerText='同步常態單觸及率';
            }

            if (failedItems.length) console.warn('[觸及率同步] 重試後仍失敗的名單', failedItems);
            if (abortedError) {
                notifyGuardError(abortedError);
                alert('觸及率同步已停止。\n\n已更新：' + successCount + ' 筆\n未寫入：' + (pending.length - successCount) + ' 筆\n\n' + (abortedError.message || abortedError));
                return;
            }

            alert('✅ 觸及率同步完成\n\n成功更新：' + successCount + ' 筆\n無變化：' + unchangedCount + ' 筆\n寫入失敗：' + failedCount + ' 筆' +
                (missingCount ? '\nSheet 無對應資料：' + missingCount + ' 筆' : '') +
                (failedCount ? '\n\n失敗名單已記錄在 Console，可再次點擊同步只重跑未成功的資料。' : ''));
        };
    }
}

/* ══════════════════════════════════════════════════════
   ★★★ 撥號模組 (Dialer Module) ★★★
══════════════════════════════════════════════════════ */

let dialerQueue      = [];   
let dialerIndex      = 0;    
let dialerTimer      = null; 
let dialerCountdown  = 0;    
let dialerActive     = false;
let dialerPaused     = false;
let dialerCallReady  = false;
let dialerRequestToken = 0;
let dialerCallAttempt = 1;
const DIALER_CALL_SECONDS = 40;
const DIALER_EXTENSION_KEY = 'etalking_dialer_extension_' + crmUid;
let dialerExtension  = (()=>{
    try{return localStorage.getItem(DIALER_EXTENSION_KEY)||'';}catch(e){return '';}
})();
let dialerMissCount  = {};   
let dialerTickInterval = null;
let dialerPendingPause = false; 
let dialerMinimized = false; 

function dialerCheckAndSkipIfReleased(releasedIds) {
    if (!dialerActive) return;
    const currentItem = dialerQueue[dialerIndex];
    if (currentItem && releasedIds.includes(String(currentItem.member_id || currentItem.id))) {
        dialerIndex++;
        dialerStep();
    }
}

let dialerPanel = null;

function dialerDestroy() {
    dialerRequestToken++;
    dialerCallReady = false;
    if(dialerTimer)       clearTimeout(dialerTimer);
    if(dialerTickInterval) clearInterval(dialerTickInterval);
    dialerActive = false;
    dialerPaused = false;
    dialerPendingPause = false;
    dialerMinimized = false;
    if(dialerPanel) { dialerPanel.remove(); dialerPanel = null; }
    dialerCloseHistory();
    document.removeEventListener('keydown', dialerKeyHandler);
}

function dialerInit(queue) {
    dialerDestroy(); 

    if(!queue || queue.length === 0) {
        alert('⚠️ 名單為空，無法啟動撥號。');
        return;
    }

    if(!dialerExtension){
        const ext = prompt('請輸入您的分機號碼：', '');
        if(ext === null) return;
        if(!ext.trim()) { alert('⚠️ 分機號碼不能為空！'); return; }
        dialerExtension = ext.trim();
        try{localStorage.setItem(DIALER_EXTENSION_KEY,dialerExtension);}catch(e){}
    }

    dialerQueue     = queue;
    dialerIndex     = 0;
    dialerMissCount = {};
    dialerActive    = true;
    dialerPaused    = false;

    // ★ 新增：注入 8 秒警告的呼吸燈動畫 CSS
    if (!document.getElementById('dialer-pulse-style')) {
        const style = document.createElement('style');
        style.id = 'dialer-pulse-style';
        style.innerHTML = `
            @keyframes emergencyBreathing {
                0% { 
                    box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 15px rgba(231, 76, 60, 0.3); 
                    border-color: #e74c3c; 
                    background-color: #1e272e;
                }
                50% { 
                    box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 60px rgba(255, 71, 87, 1), inset 0 0 25px rgba(255, 71, 87, 0.4); 
                    border-color: #ff4757; 
                    background-color: #2c1e1e; 
                }
                100% { 
                    box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 15px rgba(231, 76, 60, 0.3); 
                    border-color: #e74c3c; 
                    background-color: #1e272e;
                }
            }
            .dialer-warning-pulse {
                animation: emergencyBreathing 0.6s infinite alternate !important;
            }
        `;
        document.head.appendChild(style);
    }

    dialerPanel = document.createElement('div');
    dialerPanel.id = 'dialer-float-panel';
    // ★ 修改點：將撥號面板寬度改為不超出螢幕 (max-width)
    dialerPanel.style.cssText = [
        'position:fixed',
        'bottom:20px',
        'right:20px',
        'width:90vw',
        'max-width:320px',
        'background:#1e272e',
        'color:#dcdde1',
        'border-radius:14px',
        'box-shadow:0 8px 32px rgba(0,0,0,0.45)',
        'font-family:sans-serif',
        'z-index:1000001',
        'overflow:hidden',
        'border:2px solid #f39c12',
        'user-select:none',
        'transition: border-color 0.3s'
    ].join(';');

    dialerPanel.innerHTML = `
        <div id="dialer-header" style="
            background:#f39c12;
            color:#1e272e;
            padding:10px 14px;
            display:flex;
            justify-content:space-between;
            align-items:center;
            cursor:move;
            font-weight:bold;
            font-size:14px;
        ">
            <span>自動撥號系統</span>
            <div style="display:flex;align-items:center;gap:2px;margin-left:auto;">
                <button id="dialer-minimize-btn" title="縮小" style="
                    width:26px;height:24px;display:flex;align-items:center;justify-content:center;
                    background:transparent;border:none;border-radius:4px;
                    font-size:16px;cursor:pointer;color:#1e272e;line-height:1;padding:0;
                ">▬</button>
                <button id="dialer-close-btn" title="關閉" style="
                    width:26px;height:24px;display:flex;align-items:center;justify-content:center;
                    background:transparent;border:none;border-radius:4px;
                    font-size:19px;cursor:pointer;color:#1e272e;line-height:1;padding:0;
                ">×</button>
            </div>
        </div>

        <div style="padding:12px 14px 8px;">
            <div style="font-size:11px;color:#f39c12;margin-bottom:4px;letter-spacing:0.5px;">目前撥打</div>
            <div id="dialer-name" style="font-size:20px;font-weight:bold;color:#fff;line-height:1.2;">-</div>
            <div id="dialer-phone" style="font-size:15px;color:#a4b0be;margin-top:2px;">-</div>
            <div id="dialer-source" style="font-size:11px;color:#718093;margin-top:2px;"></div>
        </div>

        <div style="padding:0 14px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#718093;margin-bottom:4px;">
                <span id="dialer-progress">0 / 0</span>
                <span id="dialer-miss-count" style="color:#e67e22;"></span>
            </div>
            <div style="background:#2f3640;border-radius:4px;height:4px;overflow:hidden;">
                <div id="dialer-progress-bar" style="height:100%;background:#f39c12;width:0%;transition:width 0.3s;border-radius:4px;"></div>
            </div>
        </div>

        <div style="padding:10px 14px 8px;text-align:center;">
            <div id="dialer-status-label" style="font-size:11px;color:#718093;margin-bottom:6px;">等待撥出...</div>
            <div style="background:#2f3640;border-radius:6px;height:8px;overflow:hidden;margin-bottom:6px;">
                <div id="dialer-countdown-bar" style="height:100%;background:#e74c3c;width:100%;transition:width 1s linear;border-radius:6px;"></div>
            </div>
            <div id="dialer-countdown-text" style="font-size:22px;font-weight:bold;color:#e74c3c;font-variant-numeric:tabular-nums;">${DIALER_CALL_SECONDS}</div>
            <div id="dialer-countdown-hint" style="font-size:10px;color:#636e72;margin-top:2px;height:14px;">秒後自動視為未接</div>
        </div>

        <div id="dialer-pre-call-actions" style="padding:8px 14px 14px;display:flex;gap:8px;">
            <button id="dialer-btn-answer" style="
                flex:1;padding:10px 6px;border:none;border-radius:8px;
                background:#27ae60;color:white;font-weight:bold;font-size:13px;
                cursor:pointer;letter-spacing:0.5px;
            ">✅ 接通 (Z)</button>
            <button id="dialer-btn-miss" style="
                flex:1;padding:10px 6px;border:none;border-radius:8px;
                background:#e74c3c;color:white;font-weight:bold;font-size:13px;
                cursor:pointer;letter-spacing:0.5px;
            ">❌ 未接 (X)</button>
            <button id="dialer-btn-retry" style="
                display:none;flex:1;padding:10px 6px;border:none;border-radius:8px;
                background:#3498db;color:white;font-weight:bold;font-size:12px;
                cursor:pointer;white-space:nowrap;
            ">重新撥號</button>
            <button id="dialer-btn-skip" title="轉語音後切換下一通（快捷鍵 C）" style="
                padding:10px 12px;border:none;border-radius:8px;
                background:#636e72;color:white;font-weight:bold;font-size:13px;
                cursor:pointer;white-space:nowrap;
            ">語音(C)</button>
            <button id="dialer-btn-pause" style="
                padding:10px 8px;border:none;border-radius:8px;
                background:#8e44ad;color:white;font-weight:bold;font-size:12px;
                cursor:pointer;white-space:nowrap;
            ">⏸ 暫停</button>
        </div>

        <div id="dialer-interview-area" style="display:none;padding:0 14px 14px;">
            <div style="border-top:1px solid #2f3640;padding-top:10px;margin-bottom:8px;">
                <div style="font-size:11px;color:#2ecc71;font-weight:bold;margin-bottom:6px;">🟢 通話中 — 訪談記錄</div>
                <textarea id="dialer-interview-text" rows="8" style="
                    width:100%;box-sizing:border-box;
                    background:#2f3640;color:#dcdde1;
                    border:1px solid #4f5d73;border-radius:6px;
                    padding:8px;font-size:11px;font-family:sans-serif;
                    resize:vertical;line-height:1.5;
                "></textarea>
            </div>
            
            <div style="display:flex;flex-direction:column;gap:8px;">
                <input type="date" id="dialer-next-date" style="
                    width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;
                    border:1px solid #4f5d73;background:#2f3640;
                    color:#dcdde1;font-size:12px;
                ">
                <div style="display:flex;gap:8px;">
                    <button id="dialer-btn-submit" style="
                        flex:1;padding:8px 0;border:none;border-radius:6px;
                        background:#2ecc71;color:white;font-weight:bold;
                        font-size:12px;cursor:pointer;text-align:center;
                    ">壓紀錄</button>
                    <button id="dialer-btn-release" style="
                        flex:1;padding:8px 0;border:none;border-radius:6px;
                        background:#c0392b;color:white;font-weight:bold;
                        font-size:12px;cursor:pointer;text-align:center;
                    ">釋出</button>
                    <button id="dialer-btn-next" style="
                        flex:1;padding:8px 0;border:none;border-radius:6px;
                        background:#3498db;color:white;font-weight:bold;
                        font-size:12px;cursor:pointer;text-align:center;
                    ">下一通 →</button>
                </div>
            </div>
        </div>

        <div style="padding:4px 14px 10px;text-align:right;">
            <span style="font-size:10px;color:#636e72;">分機：</span>
            <span id="dialer-ext-display" style="font-size:10px;color:#a4b0be;cursor:pointer;text-decoration:underline dotted;">${dialerExtension}</span>
        </div>
    `;

    document.body.appendChild(dialerPanel);

    const dragHandle = document.getElementById('dialer-header');
    let isDragging = false, dragOffX = 0, dragOffY = 0;
    dragHandle.addEventListener('mousedown', e => {
        if(e.target.closest('button')) return;
        isDragging = true;
        const rect = dialerPanel.getBoundingClientRect();
        dragOffX = e.clientX - rect.left;
        dragOffY = e.clientY - rect.top;
        dialerPanel.style.right = 'auto';
        dialerPanel.style.bottom = 'auto';
    });
    // ★ 修改點：增加觸控事件 (Touch)，讓手機也能拖曳撥號面板
    dragHandle.addEventListener('touchstart', e => {
        if(e.target.closest('button')) return;
        isDragging = true;
        const touch = e.touches[0];
        const rect = dialerPanel.getBoundingClientRect();
        dragOffX = touch.clientX - rect.left;
        dragOffY = touch.clientY - rect.top;
        dialerPanel.style.right = 'auto';
        dialerPanel.style.bottom = 'auto';
    }, {passive: false});

    document.addEventListener('mousemove', e => {
        if(!isDragging) return;
        dialerPanel.style.left = (e.clientX - dragOffX) + 'px';
        dialerPanel.style.top  = (e.clientY - dragOffY) + 'px';
    });
    document.addEventListener('touchmove', e => {
        if(!isDragging) return;
        const touch = e.touches[0];
        dialerPanel.style.left = (touch.clientX - dragOffX) + 'px';
        dialerPanel.style.top  = (touch.clientY - dragOffY) + 'px';
        e.preventDefault(); // 防止拖曳時網頁跟著滑動
    }, {passive: false});

    document.addEventListener('mouseup', () => isDragging = false);
    document.addEventListener('touchend', () => isDragging = false);

    document.getElementById('dialer-close-btn').onclick = () => {
        if(dialerActive && !confirm('確定要關閉撥號系統嗎？目前進度將會遺失。')) return;
        dialerDestroy();
    };

    document.getElementById('dialer-minimize-btn').onclick = () => { dialerToggleMinimize(); };
    document.getElementById('dialer-btn-answer').onclick = dialerOnAnswer;
    document.getElementById('dialer-btn-miss').onclick   = () => dialerOnMiss(true);
    document.getElementById('dialer-btn-retry').onclick  = () => dialerStep({sameMember:true});
    document.getElementById('dialer-btn-skip').onclick   = dialerOnSkip;

    document.getElementById('dialer-btn-pause').onclick = () => {
        dialerPendingPause = !dialerPendingPause;
        const btn = document.getElementById('dialer-btn-pause');
        if(dialerPendingPause) {
            btn.innerText = '🟣 暫停中';
            btn.style.background = '#6c3483';
            btn.style.outline = '2px solid #d7bde2';
        } else {
            btn.innerText = '⏸ 暫停';
            btn.style.background = '#8e44ad';
            btn.style.outline = 'none';
        }
    };

    document.getElementById('dialer-btn-next').onclick = () => {
        dialerIndex++;
        dialerStep();
    };

    document.getElementById('dialer-btn-submit').onclick = () => { dialerSubmitRecord(true); };

    document.getElementById('dialer-btn-release').onclick = () => {
        const item = dialerQueue[dialerIndex];
        if(!item) return;
        document.getElementById('release-member-id').value = item.member_id || item.id;
        document.getElementById('release-memo').value = '';
        document.getElementById('release-modal').style.display = 'block';
    };

    document.getElementById('dialer-ext-display').onclick = () => {
        const newExt = prompt('修改分機號碼：', dialerExtension);
        if(newExt !== null && newExt.trim()) {
            dialerExtension = newExt.trim();
            try{localStorage.setItem(DIALER_EXTENSION_KEY,dialerExtension);}catch(e){}
            document.getElementById('dialer-ext-display').innerText = dialerExtension;
        }
    };

    document.addEventListener('keydown', dialerKeyHandler);
    dialerStep();
}

function dialerKeyHandler(e) {
    if(!dialerActive) return;
    if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key.toLowerCase();
    if(key === 'z') dialerOnAnswer();
    if(key === 'x') dialerOnMiss(true);
    if(key === 'c') dialerOnSkip();
}

function setDialerCallActionsReady(ready){
    ['dialer-btn-answer','dialer-btn-miss','mini-btn-answer','mini-btn-miss'].forEach(id=>{
        const btn=document.getElementById(id);
        if(!btn)return;
        btn.disabled=!ready;
        btn.style.opacity=ready?'1':'0.45';
        btn.style.cursor=ready?'pointer':'not-allowed';
    });
}

async function dialerStep({sameMember=false}={}) {
    const requestToken=++dialerRequestToken;
    dialerCallReady=false;
    if(!sameMember)dialerCallAttempt=1;
    if(dialerTimer)        clearTimeout(dialerTimer);
    if(dialerTickInterval) clearInterval(dialerTickInterval);
    dialerCloseHistory();

    const interviewArea = document.getElementById('dialer-interview-area');
    const preCallActions = document.getElementById('dialer-pre-call-actions'); 
    
    if(interviewArea) interviewArea.style.display = 'none';
    if(preCallActions) preCallActions.style.display = 'flex'; 

    const btnSkip = document.getElementById('dialer-btn-skip');
    if(btnSkip) { 
        btnSkip.disabled = false; 
        btnSkip.style.background = '#636e72';
        btnSkip.style.border = 'none';
        btnSkip.style.color = 'white';
        btnSkip.style.cursor = 'pointer';
        btnSkip.innerText = '語音(C)';
    }
    const miniBtnSkip = document.getElementById('mini-btn-skip');
    if(miniBtnSkip) {
        miniBtnSkip.disabled = false;
        miniBtnSkip.style.background = '#636e72';
        miniBtnSkip.style.border = 'none';
        miniBtnSkip.style.color = 'white';
        miniBtnSkip.style.cursor = 'pointer';
    }

    const btnAnswer = document.getElementById('dialer-btn-answer');
    const btnMiss   = document.getElementById('dialer-btn-miss');
    const btnRetry  = document.getElementById('dialer-btn-retry');
    if(btnAnswer) btnAnswer.style.display = '';
    if(btnMiss)   btnMiss.style.display = '';
    if(btnRetry)  btnRetry.style.display = 'none';
    setDialerCallActionsReady(false);

    dialerPaused = false;

    if(dialerPendingPause) {
        dialerPendingPause = false;
        dialerPanel.style.border = '2px solid #8e44ad';
        const nameEl   = document.getElementById('dialer-name');
        const phoneEl  = document.getElementById('dialer-phone');
        const statusEl = document.getElementById('dialer-status-label');
        const cdText   = document.getElementById('dialer-countdown-text');
        const pauseBtn = document.getElementById('dialer-btn-pause');
        if(nameEl)   nameEl.innerText   = '⏸ 已暫停';
        if(phoneEl)  phoneEl.innerText  = '點「繼續」恢復撥號';
        if(statusEl) statusEl.innerText = '';
        if(cdText)   cdText.innerText   = '-';
        
        if(btnAnswer) btnAnswer.style.display = 'none';
        if(btnMiss)   btnMiss.style.display = 'none';
        if(btnSkip) {
            btnSkip.disabled = true;
            btnSkip.style.background = '#2f3640';
            btnSkip.style.color = '#718093';
            btnSkip.innerText = '語音(C)';
        }

        if(pauseBtn) {
            pauseBtn.innerText = '▶ 繼續';
            pauseBtn.style.background = '#27ae60';
            pauseBtn.style.outline = 'none';
            pauseBtn.onclick = () => {
                dialerPendingPause = false;
                pauseBtn.innerText = '⏸ 暫停';
                pauseBtn.style.background = '#8e44ad';
                pauseBtn.style.outline = 'none';
                pauseBtn.onclick = () => {
                    dialerPendingPause = !dialerPendingPause;
                    if(dialerPendingPause) {
                        pauseBtn.innerText = '🟣 暫停中';
                        pauseBtn.style.background = '#6c3483';
                        pauseBtn.style.outline = '2px solid #d7bde2';
                    } else {
                        pauseBtn.innerText = '⏸ 暫停';
                        pauseBtn.style.background = '#8e44ad';
                        pauseBtn.style.outline = 'none';
                    }
                };
                dialerStep();
            };
        }
        return;
    }

    if(dialerIndex >= dialerQueue.length) {
        dialerFinish();
        return;
    }

    const item = dialerQueue[dialerIndex];
    const total = dialerQueue.length;
    const pct   = (dialerIndex / total) * 100;

    const nameEl    = document.getElementById('dialer-name');
    const phoneEl   = document.getElementById('dialer-phone');
    const sourceEl  = document.getElementById('dialer-source');
    const progressEl= document.getElementById('dialer-progress');
    const barEl     = document.getElementById('dialer-progress-bar');
    const missEl    = document.getElementById('dialer-miss-count');
    const statusEl  = document.getElementById('dialer-status-label');

    if(nameEl)    nameEl.innerText  = item.member_name || '未知';
    if(phoneEl)   phoneEl.innerText = item.mobile || '-';
    if(sourceEl)  sourceEl.innerText = '';
    dialerSyncMiniBar();
    if(progressEl)progressEl.innerText = (dialerIndex + 1) + ' / ' + total;
    if(barEl)     barEl.style.width = pct + '%';
    const missN = dialerMissCount[item.member_id] || 0;
    if(missEl)    missEl.innerText = missN > 0 ? '本次已未接 ' + missN + ' 次' : '';
    if(statusEl)  statusEl.innerText = '正在建立第 '+dialerCallAttempt+' 次撥號...';
    dialerCountdown = 0;

    dialerPanel.style.border = '2px solid #f39c12';
    dialerPanel.classList.remove('dialer-warning-pulse'); 
    
    const hintText = document.getElementById('dialer-countdown-hint');
    const cdText = document.getElementById('dialer-countdown-text');
    const cdBar = document.getElementById('dialer-countdown-bar');
    if(hintText) hintText.innerText = '確認撥號服務中';
    if(cdText) {
        cdText.innerText = '…';
        cdText.style.color = '#3498db';
    }
    if(cdBar) {
        cdBar.style.width = '100%';
        cdBar.style.background = '#3498db';
    }
    const miniCd=document.getElementById('mini-countdown');
    if(miniCd) {
        miniCd.innerText = '…';
        miniCd.style.color = '#3498db';
    }

    dialerOpenHistory(item);
    const callResult=await dialerCallApi(item);
    if(requestToken!==dialerRequestToken||!dialerActive||dialerQueue[dialerIndex]!==item)return;

    if(!callResult.success){
        dialerCallReady=false;
        if(dialerMinimized)dialerToggleMinimize();
        dialerPanel.style.border = '2px solid #e74c3c';
        if(statusEl) statusEl.innerText = '撥號建立失敗' + (callResult.message?'：'+callResult.message:'');
        if(hintText) hintText.innerText = '未啟動倒數，不會自動壓未接';
        if(cdText) {
            cdText.innerText = '—';
            cdText.style.color = '#e74c3c';
        }
        if(cdBar) cdBar.style.width = '0%';
        if(miniCd) miniCd.innerText = 'ERR';
        if(btnAnswer) btnAnswer.style.display = 'none';
        if(btnMiss) btnMiss.style.display = 'none';
        if(btnRetry) btnRetry.style.display = '';
        return;
    }

    const SEC = DIALER_CALL_SECONDS;
    dialerCallReady=true;
    setDialerCallActionsReady(true);
    if(statusEl) statusEl.innerText = '第 '+dialerCallAttempt+' 次撥號已建立，撥出中...';
    if(hintText) hintText.innerText = '秒後自動視為未接';
    if(cdText) cdText.style.color = '#e74c3c';
    dialerCountdown = SEC;
    dialerUpdateCountdown(SEC, SEC);

    dialerTickInterval = setInterval(() => {
        dialerCountdown--;
        dialerUpdateCountdown(dialerCountdown, SEC);

        if(dialerCountdown <= 0) {
            clearInterval(dialerTickInterval);
            dialerTickInterval = null;
        }
    }, 1000);

    dialerTimer = setTimeout(() => {
        if(!dialerPaused) dialerOnMiss(false); 
    }, SEC * 1000);
}

function dialerUpdateCountdown(remaining, total) {
    const barEl  = document.getElementById('dialer-countdown-bar');
    const textEl = document.getElementById('dialer-countdown-text');
    if(!barEl || !textEl) return;
    const pct = Math.max(0, (remaining / total) * 100);
    barEl.style.width = pct + '%';
    barEl.style.background = remaining <= 5 ? '#c0392b' : remaining <= 10 ? '#e67e22' : '#e74c3c';
    textEl.innerText = Math.max(0, remaining);
    textEl.style.color = remaining <= 5 ? '#c0392b' : '#e74c3c';

    const miniCd = document.getElementById('mini-countdown');
    if(miniCd) {
        miniCd.innerText = '00:' + String(Math.max(0, remaining)).padStart(2, '0');
        miniCd.style.color = remaining <= 5 ? '#c0392b' : remaining <= 10 ? '#e67e22' : '#e74c3c';
    }

    const panel = document.getElementById('dialer-float-panel');
    const hintText = document.getElementById('dialer-countdown-hint');

    if (panel) {
        if (remaining <= 8 && remaining > 0 && !dialerPaused) {
            panel.classList.add('dialer-warning-pulse');
            if (hintText) hintText.innerHTML = '<span style="color:#ff4757;font-weight:bold;font-size:12px;text-shadow:0 0 5px rgba(255,71,87,0.3);">⚠️ 請清空線路，準備掛斷！</span>';
        } else {
            panel.classList.remove('dialer-warning-pulse');
            if (hintText && !dialerPaused) hintText.innerHTML = '秒後自動視為未接';
        }
    }
}

async function dialerCallApi(item) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try {
        const res = await fetch('https://server.etalkingonline.com/api/sales_manager/dial', {
            method: 'POST',
            headers: { 'content-type': 'application/json;charset=UTF-8' },
            body: JSON.stringify({ caller: dialerExtension, callee: item.mobile }),
            signal: controller.signal
        });
        const data = await res.json().catch(() => ({}));
        const responseStatus=String(data.status||'').toLowerCase();
        const explicitFailure=data.success===false||data.ok===false||
            ['error','failed','failure'].includes(responseStatus)||!!data.error;
        if(!res.ok||explicitFailure){
            const message=data.error||data.message||data.msg||('HTTP '+res.status);
            console.error('[撥號 API 失敗]',{status:res.status,data});
            return {success:false,message:String(message)};
        }
        return {success:true,data};
    } catch(e) {
        const message=e.name==='AbortError'?'撥號服務連線逾時':'撥號 API 無回應';
        console.error('[撥號 API 異常]',e);
        return {success:false,message};
    } finally {
        clearTimeout(timer);
    }
}

function dialerOnAnswer() {
    if(!dialerActive || dialerPaused || !dialerCallReady) return;
    dialerCallReady = false;
    dialerPaused = true;

    if(dialerTimer)        clearTimeout(dialerTimer);
    if(dialerTickInterval) clearInterval(dialerTickInterval);

    dialerPanel.style.border = '2px solid #2ecc71';
    dialerPanel.classList.remove('dialer-warning-pulse'); 

    const statusEl = document.getElementById('dialer-status-label');
    if(statusEl) statusEl.innerText = '🟢 通話中';
    const cdText = document.getElementById('dialer-countdown-text');
    if(cdText) cdText.innerText = '✅';

    const preCallActions = document.getElementById('dialer-pre-call-actions');
    if(preCallActions) preCallActions.style.display = 'none'; 

    const interviewArea = document.getElementById('dialer-interview-area');
    const interviewText = document.getElementById('dialer-interview-text');
    const nextDateInput = document.getElementById('dialer-next-date');
    if(interviewArea) interviewArea.style.display = 'block';
    if(interviewText) interviewText.value = INTERVIEW_TEMPLATE;

    if(nextDateInput) {
        const d = new Date();
        d.setDate(d.getDate() + 10);
        nextDateInput.value = d.toISOString().split('T')[0];
    }

}

async function countBackendRecords(memberId, expectedContent){
    const res=await guardFetch('/admin/request_develop?member_id='+encodeURIComponent(memberId)+'&hide_layout=true&crm_record_verify='+Date.now(),{cache:'no-store'},12000);
    const html=await res.text();
    if(!res.ok||!looksLikeMemberDetail(html,memberId))throw new Error('後台連線或登入狀態已失效');
    const expected=normalizeLogText(expectedContent);
    const doc=new DOMParser().parseFromString(html,'text/html');
    let count=0;
    doc.querySelectorAll('table tbody tr').forEach(row=>{
        const cells=row.querySelectorAll('td');
        if(!cells.length)return;
        const rowText=Array.from(cells).map(cell=>cell.innerText||'').join(' ');
        if(expected&&normalizeLogText(rowText).includes(expected))count++;
    });
    return count;
}

async function countBackendRecordsBeforeSubmit(memberId,expectedContent){
    let lastError=null;
    for(let attempt=0;attempt<3;attempt++){
        try{
            return await countBackendRecords(memberId,expectedContent);
        }catch(e){
            lastError=e;
            if(attempt<2)await new Promise(r=>setTimeout(r,500*(attempt+1)));
        }
    }
    throw new Error('寫入前無法讀取聯繫歷史，紀錄尚未送出。請確認網路後再試。'+(lastError&&lastError.message?'（'+lastError.message+'）':''));
}

function markRecordErrorStage(error,stage){
    const err=error instanceof Error?error:new Error(String(error||'未知錯誤'));
    err.recordStage=stage;
    return err;
}

async function submitBackendRecordAndVerify(memberId,params){
    const id=String(memberId||'');
    if(!id)throw markRecordErrorStage(new Error('無法取得名單 ID'),'not-submitted');

    const expectedContent=String(params.content||'');
    let beforeCount;
    try{
        await ensurePanelCanWrite(id);
        beforeCount=await countBackendRecordsBeforeSubmit(id,expectedContent);
    }catch(e){
        throw markRecordErrorStage(e,'not-submitted');
    }
    const targetName='crm-record-save-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    const iframe=document.createElement('iframe');
    iframe.name=targetName;
    iframe.style.display='none';
    iframe.sandbox='allow-forms allow-same-origin';
    const form=document.createElement('form');
    form.target=targetName;
    form.method='POST';
    form.action='https://www.etalkingonline.com/admin/request_develop/save';

    Object.keys(params).forEach(key=>{
        const input=document.createElement('input');
        input.type='hidden';
        input.name=key;
        input.value=params[key];
        form.appendChild(input);
    });

    document.body.appendChild(iframe);
    document.body.appendChild(form);
    try{
        try{
            form.submit();
        }catch(e){
            throw markRecordErrorStage(new Error('表單送出失敗，紀錄尚未送出。'+(e.message?'（'+e.message+'）':'')),'not-submitted');
        }
        let lastError=null;
        let observedCount=beforeCount;
        for(let attempt=0;attempt<12;attempt++){
            await new Promise(r=>setTimeout(r,attempt===0?500:750));
            try{
                const currentCount=await countBackendRecords(id,expectedContent);
                if(currentCount>beforeCount)return true;
                observedCount=currentCount;
                lastError=null;
            }catch(e){
                lastError=e;
            }
        }
        console.warn('[紀錄寫入驗證未通過]',{
            memberId:id,
            expectedLength:normalizeLogText(expectedContent).length,
            beforeCount,
            observedCount
        });
        if(lastError)throw markRecordErrorStage(new Error('紀錄已送出，但無法回讀歷史確認：'+(lastError.message||lastError)),'submitted-unconfirmed');
        throw markRecordErrorStage(new Error('紀錄已送出，但在歷史中尚未確認到新紀錄'),'submitted-unconfirmed');
    }finally{
        form.remove();
        iframe.remove();
    }
}

function stopDialerForRecordError(error){
    dialerCallReady=false;
    setDialerCallActionsReady(false);
    if(dialerPanel){
        dialerPanel.style.border='2px solid #e74c3c';
        dialerPanel.classList.remove('dialer-warning-pulse');
    }
    const statusEl=document.getElementById('dialer-status-label');
    const hintText=document.getElementById('dialer-countdown-hint');
    const wasSubmitted=error&&error.recordStage==='submitted-unconfirmed';
    if(statusEl)statusEl.innerText=wasSubmitted?'紀錄已送出但未確認，撥號流程已停止':'紀錄尚未送出，撥號流程已停止';
    if(hintText)hintText.innerText=wasSubmitted?'請先檢查歷史紀錄，避免重複寫入':'修正連線後可重新操作，不會造成重複紀錄';
    if(wasSubmitted){
        alert('紀錄已送出但無法確認，已停止自動切換。\n\n'+(error.message||error)+'\n\n請先檢查歷史紀錄，確認後再繼續，避免重複寫入。');
    }else{
        alert('紀錄尚未送出，已停止自動切換。\n\n'+(error.message||error)+'\n\n修正連線或重新整理後台後，可以重新操作。');
    }
}

async function dialerOnMiss(isManual) {
    if(!dialerActive) return;
    if(dialerPaused) return; 
    if(!dialerCallReady) return;

    // ★ 新增：手動操作時防呆確認
    if (isManual) {
        if (!confirm('準備結束此通電話並寫入未接紀錄。\n\n請確認實體話機已掛斷，且線路已清空。')) {
            return;
        }
    }

    if(dialerPanel) dialerPanel.classList.remove('dialer-warning-pulse'); 
    dialerCallReady = false;

    if(dialerTimer)        clearTimeout(dialerTimer);
    if(dialerTickInterval) clearInterval(dialerTickInterval);

    const item = dialerQueue[dialerIndex];
    if(!item) return;

    const n = dialerCallAttempt;
    dialerMissCount[item.member_id] = n;

    const statusEl = document.getElementById('dialer-status-label');
    if(statusEl) statusEl.innerText = (isManual ? '手動標記未接' : '逾時未接') + `，正在寫入未接 *${n}...`;

    try{
        await dialerAutoRecord(item,n,'未接');
    }catch(e){
        console.error('[自動未接紀錄寫入失敗]',e);
        stopDialerForRecordError(e);
        return;
    }

    if(n<2){
        dialerCallAttempt=2;
        dialerStep({sameMember:true});
    }else{
        dialerIndex++;
        dialerStep();
    }
}

async function dialerOnSkip() {
    if(!dialerActive) return;
    const item = dialerQueue[dialerIndex];
    if(!item)return;
    const shouldWriteVoice=dialerCallReady;
    const voiceCount=dialerCallAttempt;
    const confirmText=shouldWriteVoice
        ? '確定已轉語音嗎？\n\n請確認實體話機已掛斷，且線路已清空。\n\n將寫入「語音 *'+voiceCount+'」後直接切換下一通，不會重複撥打這筆名單。'
        : '撥號尚未成功建立。\n\n確定要跳過這筆名單嗎？此次不會寫入聯繫紀錄。';

    if (!confirm(confirmText)) return;

    dialerCallReady=false;
    if(dialerTimer)        clearTimeout(dialerTimer);
    if(dialerTickInterval) clearInterval(dialerTickInterval);
    const skipBtn=document.getElementById('dialer-btn-skip');
    if(skipBtn)skipBtn.disabled=true;
    if(shouldWriteVoice){
        const statusEl=document.getElementById('dialer-status-label');
        if(statusEl)statusEl.innerText='正在寫入語音 *'+voiceCount+'...';
        try{
            await dialerAutoRecord(item,voiceCount,'語音');
        }catch(e){
            console.error('[語音紀錄寫入失敗]',e);
            stopDialerForRecordError(e);
            return;
        }
    }
    dialerIndex++;
    dialerStep();
}

async function dialerAutoRecord(item, attemptCount, resultLabel='未接') {
    const nextDate = (() => {
        const d = new Date();
        d.setDate(d.getDate() + 10);
        return d.toISOString().split('T')[0];
    })();

    const memberId = item.member_id||item.id;
    const content  = `${resultLabel} *${attemptCount}`;
    await submitBackendRecordAndVerify(memberId,{
        'current_member_id':memberId,
        'contact_status':'3',
        'content':content,
        'sub_content':'',
        'search_begin':nextDate,
        'time':'12:00:00',
        'consultant_type':'10',
        'type':'20'
    });
}

async function dialerSubmitRecord(isAnswer) {
    const item = dialerQueue[dialerIndex];
    if(!item) return;

    const memberId    = item.member_id||item.id;
    const content     = document.getElementById('dialer-interview-text').value;
    const nextDate    = document.getElementById('dialer-next-date').value;
    const submitBtn   = document.getElementById('dialer-btn-submit');

    if(!nextDate) { alert('⚠️ 請設定下次聯繫日期'); return; }
    if(submitBtn) { submitBtn.innerText = '送出中...'; submitBtn.disabled = true; }

    try {
        await submitBackendRecordAndVerify(memberId,{
            'current_member_id': memberId,
            'contact_status':    '1',
            'content':           content,
            'sub_content':       '',
            'search_begin':      nextDate,
            'time':              '12:00:00',
            'consultant_type':   '10',
            'type':              '20'
        });
        if(submitBtn) { submitBtn.innerText = '壓紀錄'; submitBtn.disabled = false; }
        alert('紀錄已寫入並確認成功！');

        setLocalContacted(memberId, false);
        if (currentTab === 'pool' && typeof renderPoolList === 'function') {
            renderPoolList();
        } else if (typeof renderList === 'function') {
            renderList();
        }
    } catch(e) {
        console.error('[已接聽紀錄寫入失敗]', e);
        if(submitBtn) { submitBtn.innerText = '壓紀錄'; submitBtn.disabled = false; }
        stopDialerForRecordError(e);
    }
}

function dialerFinish() {
    dialerActive = false;
    dialerCallReady = false;
    if(dialerPanel) {
        dialerPanel.style.border = '2px solid #9b59b6';
        const nameEl   = document.getElementById('dialer-name');
        const phoneEl  = document.getElementById('dialer-phone');
        const statusEl = document.getElementById('dialer-status-label');
        const cdText   = document.getElementById('dialer-countdown-text');
        if(nameEl)   nameEl.innerText  = '🎉 全部完成！';
        if(phoneEl)  phoneEl.innerText = '';
        if(statusEl) statusEl.innerText = '本次名單已跑完';
        if(cdText)   cdText.innerText   = '✔';
    }
    document.removeEventListener('keydown', dialerKeyHandler);
}

function dialerSyncMiniBar() {
    if(!dialerMinimized) return;
    const item = dialerQueue[dialerIndex];
    if(!item) return;
    const nameEl = document.getElementById('mini-name');
    const phoneEl = document.getElementById('mini-phone');
    const cdEl = document.getElementById('mini-countdown');
    if(nameEl)  nameEl.innerText  = item.member_name || '-';
    if(phoneEl) phoneEl.innerText = item.mobile || '-';
    if(cdEl)    cdEl.innerText    = '00:' + String(dialerCountdown).padStart(2, '0');
}

function dialerToggleMinimize() {
    if(!dialerPanel) return;

    let miniBar = document.getElementById('dialer-mini-bar');
    if(!miniBar) {
        miniBar = document.createElement('div');
        miniBar.id = 'dialer-mini-bar';
        miniBar.style.cssText = 'display:none;align-items:center;gap:10px;padding:8px 10px;background:#1e272e;box-sizing:border-box;';
        miniBar.innerHTML = `
            <div style="min-width:0;flex:1;display:flex;flex-direction:column;gap:2px;">
                <span id="mini-name" style="font-size:12px;font-weight:bold;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">-</span>
                <span id="mini-phone" style="font-size:10px;color:#a4b0be;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">-</span>
            </div>
            <div style="padding:2px 10px;border-left:1px solid #39444d;border-right:1px solid #39444d;text-align:center;">
                <span id="mini-countdown" style="display:block;font-size:15px;font-weight:bold;color:#e74c3c;font-variant-numeric:tabular-nums;white-space:nowrap;min-width:42px;">00:${String(DIALER_CALL_SECONDS).padStart(2, '0')}</span>
                <span style="display:block;font-size:9px;color:#718093;margin-top:1px;">倒數</span>
            </div>
            <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
                <button id="mini-btn-answer" title="接通（快捷鍵 Z）" style="height:30px;padding:0 9px;border:none;border-radius:6px;background:#27ae60;color:white;font-weight:bold;font-size:11px;cursor:pointer;white-space:nowrap;">接通(Z)</button>
                <button id="mini-btn-miss" title="未接（快捷鍵 X）" style="height:30px;padding:0 9px;border:none;border-radius:6px;background:#e74c3c;color:white;font-weight:bold;font-size:11px;cursor:pointer;white-space:nowrap;">未接(X)</button>
                <button id="mini-btn-skip" title="語音（快捷鍵 C）" style="height:30px;padding:0 9px;border:none;border-radius:6px;background:#636e72;color:white;font-weight:bold;font-size:11px;cursor:pointer;white-space:nowrap;">語音(C)</button>
                <button id="mini-btn-pause" title="暫停" style="width:32px;height:30px;padding:0;border:none;border-radius:6px;background:#8e44ad;color:white;font-weight:bold;font-size:13px;cursor:pointer;">⏸</button>
            </div>
        `;
        dialerPanel.appendChild(miniBar);

        document.getElementById('mini-btn-answer').onclick = dialerOnAnswer;
        document.getElementById('mini-btn-miss').onclick   = () => dialerOnMiss(true);
        document.getElementById('mini-btn-skip').onclick   = dialerOnSkip;
        document.getElementById('mini-btn-pause').onclick  = () => {
            document.getElementById('dialer-btn-pause').click();
            const pauseBtn = document.getElementById('mini-btn-pause');
            pauseBtn.innerText = dialerPendingPause ? '▶' : '⏸';
            pauseBtn.style.background = dialerPendingPause ? '#27ae60' : '#8e44ad';
        };
        setDialerCallActionsReady(dialerCallReady);
    }

    dialerMinimized = !dialerMinimized;

    const bodyEls = dialerPanel.querySelectorAll(':scope > div:not(#dialer-header):not(#dialer-mini-bar)');

    if(dialerMinimized) {
        bodyEls.forEach(el => { el.dataset.prevDisplay = el.style.display || ''; el.style.display = 'none'; });
        miniBar.style.display = 'flex';
        dialerPanel.style.width = '520px';
        dialerPanel.style.maxWidth = 'calc(100vw - 40px)';
        document.getElementById('dialer-minimize-btn').innerText = '▣';
        dialerSyncMiniBar();
    } else {
        miniBar.style.display = 'none';
        bodyEls.forEach(el => {
            if(el.id === 'dialer-interview-area' && !dialerPaused) {
                el.style.display = 'none';
            } else {
                el.style.display = el.dataset.prevDisplay || '';
            }
        });
        dialerPanel.style.width = '320px';
        dialerPanel.style.maxWidth = '320px';
        document.getElementById('dialer-minimize-btn').innerText = '▬';
    }
}

function dialerCloseHistory() {
    const old = document.getElementById('dialer-history-panel');
    if(old) old.remove();
}

async function dialerOpenHistory(item) {
    dialerCloseHistory();
    const memberId=item.member_id||item.id||'';
    const safeMemberName=escapeHtml(item.member_name||'');
    const safeMobile=escapeHtml(item.mobile||'');

    const dialerRect = dialerPanel.getBoundingClientRect();

    const hp = document.createElement('div');
    hp.id = 'dialer-history-panel';
    // ★ 修改點：歷史紀錄面板適應手機螢幕寬度
    hp.style.cssText = [
        'position:fixed',
        'top: 50%',
        'transform: translateY(-50%)',
        'left: 5%',
        'width: 90vw',
        'max-width: 640px',
        'height:80vh',
        'background:#1e272e',
        'color:#dcdde1',
        'border-radius:14px',
        'box-shadow:0 8px 32px rgba(0,0,0,0.45)',
        'font-family:sans-serif',
        'z-index:1000001',
        'overflow:hidden',
        'border:2px solid #2ecc71',
        'display:flex',
        'flex-direction:column'
    ].join(';');

    if (window.innerWidth > 768) {
        hp.style.left = Math.max(10, dialerRect.left - 660) + 'px';
    }

    hp.innerHTML = `
        <div style="
            background:#2ecc71;
            color:#1e272e;
            padding:10px 14px;
            display:flex;
            justify-content:space-between;
            align-items:center;
            font-weight:bold;
            font-size:14px;
            flex-shrink:0;
        ">
            <span>歷史紀錄 — ${safeMemberName}（${safeMobile}）</span>
            <button id="dialer-history-close" style="
                background:transparent;border:none;
                font-size:18px;cursor:pointer;
                color:#1e272e;line-height:1;padding:0 2px;
            ">×</button>
        </div>
        <div id="dialer-history-body" style="
            flex:1;overflow-y:auto;padding:10px 12px;
            font-size:12px;
        ">
            <div style="text-align:center;color:#718093;padding:20px;">🔄 載入中...</div>
        </div>
    `;

    document.body.appendChild(hp);

    document.getElementById('dialer-history-close').onclick = dialerCloseHistory;

    try {
        const res = await guardFetch('/admin/request_develop?member_id='+encodeURIComponent(memberId)+'&hide_layout=true&dialer_history='+Date.now(),{cache:'no-store'},20000);
        const html = await res.text();
        if(!res.ok||!looksLikeMemberDetail(html,memberId))throw new Error('後台連線或登入狀態已失效');
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rows = doc.querySelectorAll('table tbody tr');

        const body = document.getElementById('dialer-history-body');
        if(!body) return;

        if(!rows.length) {
            body.innerHTML = '<div style="text-align:center;color:#718093;padding:20px;">無歷史紀錄</div>';
            return;
        }

        let tableHtml = `
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
                <tr style="background:#2f3640;color:#a4b0be;position:sticky;top:0;">
                    <th style="padding:5px 6px;text-align:left;white-space:nowrap;">#</th>
                    <th style="padding:5px 6px;text-align:left;white-space:nowrap;">時間</th>
                    <th style="padding:5px 6px;text-align:left;white-space:nowrap;">類型</th>
                    <th style="padding:5px 6px;text-align:left;">內容</th>
                    <th style="padding:5px 6px;text-align:left;white-space:nowrap;">操作者</th>
                </tr>
        `;

        rows.forEach((r, idx) => {
            const cells = r.querySelectorAll('td');
            if(cells.length < 4) return;

            const num      = cells[0] ? cells[0].innerText.trim() : (idx + 1);
            const time     = cells[1] ? cells[1].innerText.trim() : '';
            const type     = cells[3] ? cells[3].innerText.trim() : '';
            const content  = cells[4] ? cells[4].innerText.trim() : '';
            const operator = cells[cells.length - 1] ? cells[cells.length - 1].innerText.trim() : '';

            let typeColor = '#a4b0be';
            if(type.includes('聯絡')) typeColor = '#f39c12';
            if(type.includes('名單移動')) typeColor = '#3498db';

            let contentColor = '#dcdde1';
            if(content.includes('未接')) contentColor = '#e74c3c';
            if(content.includes('已接') || content.includes('【')) contentColor = '#2ecc71';

            const rowBg = idx % 2 === 0 ? '#1e272e' : '#252f38';
            const safeNum=escapeHtml(num);
            const safeTime=escapeHtml(time);
            const safeType=escapeHtml(type);
            const safeContent=escapeHtml(content).replace(/\n/g,'<br>');
            const safeOperator=escapeHtml(operator);

            tableHtml += `
                <tr style="background:${rowBg};border-bottom:1px solid #2f3640;">
                    <td style="padding:5px 6px;color:#636e72;white-space:nowrap;">${safeNum}</td>
                    <td style="padding:5px 6px;color:#718093;white-space:nowrap;font-size:10px;">${safeTime}</td>
                    <td style="padding:5px 6px;color:${typeColor};white-space:nowrap;">${safeType}</td>
                    <td style="padding:5px 6px;color:${contentColor};word-break:break-all;line-height:1.5;">${safeContent}</td>
                    <td style="padding:5px 6px;color:#636e72;white-space:nowrap;font-size:10px;">${safeOperator}</td>
                </tr>
            `;
        });

        tableHtml += '</table>';
        body.innerHTML = tableHtml;

    } catch(e) {
        const body = document.getElementById('dialer-history-body');
        if(body) body.innerHTML = '<div style="text-align:center;color:#e74c3c;padding:20px;">❌ 載入失敗</div>';
        console.error('[歷史紀錄載入失敗]', e);
    }
}

document.getElementById('open-dialer-btn').onclick = () => {
    const targetPool = (currentTab === 'pool' && poolData.length > 0) ? poolData : allData;
    dialerShowEntryChoice(targetPool);
};

function dialerShowEntryChoice(baseDataArray) {
    const old = document.getElementById('dialer-entry-modal');
    if(old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'dialer-entry-modal';
    // ★ 修改點：視窗寬度響應式調整
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:90vw;max-width:380px;background:white;padding:20px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.2);z-index:1000002;font-family:sans-serif;';
    
modal.innerHTML = `
        <h4 style="margin:0 0 4px 0;color:#2c3e50;font-size:15px;">選擇撥號名單來源</h4>
        <p style="margin:0 0 16px 0;color:#888;font-size:12px;">請選擇您接下來要進行自動撥號的模式</p>

        <div style="display:flex;flex-direction:column;gap:10px;">
            <button id="dialer-entry-release-uncontacted"
                onmouseover="this.style.filter='brightness(1.1)';"
                onmouseout="this.style.filter='none';"
                style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:none;border-radius:6px;background:#1a6fc4;color:white;cursor:pointer;text-align:left;width:100%;transition:filter 0.15s ease;">
                <span style="flex-shrink:0;width:32px;height:32px;border-radius:6px;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"></path>
                        <polyline points="23 7 23 1 17 1"></polyline>
                        <line x1="16" y1="8" x2="23" y2="1"></line>
                    </svg>
                </span>
                <span>
                    <span style="display:block;font-size:13px;font-weight:bold;">撥打釋出名單</span>
                    <span style="display:block;font-size:11px;font-weight:normal;color:rgba(255,255,255,0.85);margin-top:1px;">自動撥打尚未聯繫的客戶</span>
                </span>
            </button>

            <button id="dialer-entry-manual"
                onmouseover="this.style.filter='brightness(1.1)';"
                onmouseout="this.style.filter='none';"
                style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:none;border-radius:6px;background:#8e44ad;color:white;cursor:pointer;text-align:left;width:100%;transition:filter 0.15s ease;">
                <span style="flex-shrink:0;width:32px;height:32px;border-radius:6px;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="white" stroke="none">
                        <circle cx="7" cy="7" r="1.7"></circle><circle cx="12" cy="7" r="1.7"></circle><circle cx="17" cy="7" r="1.7"></circle>
                        <circle cx="7" cy="12" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="17" cy="12" r="1.7"></circle>
                        <circle cx="7" cy="17" r="1.7"></circle><circle cx="12" cy="17" r="1.7"></circle><circle cx="17" cy="17" r="1.7"></circle>
                    </svg>
                </span>
                <span>
                    <span style="display:block;font-size:13px;font-weight:bold;">指定電話號碼</span>
                    <span style="display:block;font-size:11px;font-weight:normal;color:rgba(255,255,255,0.85);margin-top:1px;">手動輸入單一號碼撥打</span>
                </span>
            </button>
        </div>

        <div style="text-align:right;margin-top:16px;">
            <button id="dialer-entry-cancel"
                onmouseover="this.style.background='#e0e0e0';"
                onmouseout="this.style.background='#f5f5f5';"
                style="padding:5px 14px;border:1px solid #ccc;background:#f5f5f5;border-radius:4px;cursor:pointer;color:#555;font-weight:bold;font-size:12px;transition:background 0.15s ease;">取消</button>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('dialer-entry-cancel').onclick = () => modal.remove();

    const sortByNextTime = (a, b) => {
        const timeA = (!a.next_time || a.next_time.includes('0000')) ? 0 : new Date(a.next_time.replace(/-/g, '/')).getTime();
        const timeB = (!b.next_time || b.next_time.includes('0000')) ? 0 : new Date(b.next_time.replace(/-/g, '/')).getTime();
        return timeA - timeB;
    };

    const getReleaseList = (filterType) => {
        const localDict = getLocalContacted();

        return baseDataArray.filter(m => {
            if (currentTab !== 'pool' && m.type != 4) return false; 

            const id = String(m.member_id || m.id);
            const isContactedLocal = !!localDict[id]; 

            if (filterType === 'uncontacted') return !isContactedLocal;
            return true;
        }).map(m => ({
            member_id:   m.member_id || m.id,
            member_name: m.member_name,
            mobile:      m.mobile,
            source:      m.source,
            next_time:   m.next_time || ''
        })).sort(sortByNextTime); 
    };

    document.getElementById('dialer-entry-release-uncontacted').onclick = () => {
        modal.remove();
        const list = getReleaseList('uncontacted');
        if(list.length === 0) { alert('🎉 太棒了！目前畫面上沒有【未聯繫】的釋出名單。'); return; }
        dialerInit(list);
    };

    document.getElementById('dialer-entry-manual').onclick = () => {
        modal.remove();
        dialerShowManualInput(baseDataArray, sortByNextTime);
    };
}

function dialerShowManualInput(baseDataArray, sortByNextTime) {
    const old = document.getElementById('dialer-manual-modal');
    if(old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'dialer-manual-modal';
    // ★ 修改點：視窗寬度響應式調整
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:90vw;max-width:420px;background:white;padding:24px;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.3);z-index:1000002;font-family:sans-serif;';
    modal.innerHTML = `
        <h4 style="margin-top:0;color:#2c3e50;">指定電話號碼撥號</h4>
        <p style="font-size:12px;color:#888;margin-bottom:8px;">請貼上電話號碼，一行一個或用逗號分隔，工具會自動比對目前已載入的名單。</p>
        <textarea id="dialer-manual-phones" rows="6" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;font-family:sans-serif;resize:vertical;" placeholder="例如：&#10;0912345678&#10;0987654321"></textarea>
        <div style="display:flex;justify-content:space-between;margin-top:16px;">
            <button id="dialer-manual-cancel" style="padding:6px 14px;border:1px solid #ddd;background:#f5f5f5;border-radius:6px;cursor:pointer;color:#333;">取消</button>
            <button id="dialer-manual-start" style="padding:6px 18px;border:none;background:#3498db;color:white;border-radius:6px;cursor:pointer;font-weight:bold;">開始撥號</button>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('dialer-manual-cancel').onclick = () => modal.remove();

    document.getElementById('dialer-manual-start').onclick = () => {
        const raw = document.getElementById('dialer-manual-phones').value;
        const phones = raw.split(/[\n,，、\s]+/).map(p => p.trim()).filter(Boolean);

        if(phones.length === 0) {
            alert('⚠️ 請至少輸入一個電話號碼');
            return;
        }

        const normalize = p => p.replace(/[\s-]/g, '');
        const found = [];
        const notFound = [];

        phones.forEach(p => {
            const np = normalize(p);
            const match = baseDataArray.find(m => m.mobile && normalize(m.mobile) === np);
            if(match) {
                found.push({
                    member_id:   match.member_id || match.id,
                    member_name: match.member_name,
                    mobile:      match.mobile,
                    source:      match.source,
                    next_time:   match.next_time || '' 
                });
            } else {
                notFound.push(p);
            }
        });

        if(found.length === 0) {
            alert('❌ 所有輸入的號碼都找不到對應名單，請確認名單已載入且電話正確。');
            return;
        }

        modal.remove();

        if(notFound.length > 0) {
            alert('⚠️ 以下號碼找不到對應名單，將略過：\n' + notFound.join('\n') + '\n\n其餘 ' + found.length + ' 筆將開始撥號。');
        }

        found.sort(sortByNextTime);
        dialerInit(found);
    };
}

/* ══ 啟動 ══ */
fetchData();
