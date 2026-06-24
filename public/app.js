const socket = io();

// Admin state check via query parameter (?admin=true or ?owner=true)
const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get('admin') === 'true' || urlParams.get('owner') === 'true';

// Local State
let contacts = [];
let groups = [];
let selectedTargets = [];
let activeTab = 'contacts'; // 'contacts' | 'groups'
let currentSearch = '';
let targetStatuses = {};

// DOM Cache - Screens
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');

// DOM Cache - Login View
const loginStatusDot = document.getElementById('login-status-dot');
const loginStatusTitle = document.getElementById('login-status-title');
const viewLoading = document.getElementById('view-loading');
const viewQr = document.getElementById('view-qr');
const viewOffline = document.getElementById('view-offline');
const qrImage = document.getElementById('qr-image');

// DOM Cache - Dashboard Header
const userPushname = document.getElementById('user-pushname');
const userWid = document.getElementById('user-wid');
const btnLogout = document.getElementById('btn-logout');

// DOM Cache - Composer
const messageInput = document.getElementById('message-input');
const previewText = document.getElementById('preview-text');
const delayValue = document.getElementById('delay-value');
const delayUnit = document.getElementById('delay-unit');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');

// DOM Cache - Directories
const tabContacts = document.getElementById('tab-contacts');
const tabGroups = document.getElementById('tab-groups');
const targetSearch = document.getElementById('target-search');
const contactsPanel = document.getElementById('contacts-panel');
const groupsPanel = document.getElementById('groups-panel');
const contactsUl = document.getElementById('contacts-ul');
const groupsUl = document.getElementById('groups-ul');
const btnSyncData = document.getElementById('btn-sync-data');
const manualNameInput = document.getElementById('manual-name');
const manualPhoneInput = document.getElementById('manual-phone');
const btnAddManual = document.getElementById('btn-add-manual');
const manualGroupNameInput = document.getElementById('manual-group-name');
const manualGroupIdInput = document.getElementById('manual-group-id');
const btnAddManualGroup = document.getElementById('btn-add-manual-group');

// DOM Cache - Target Queue
const queueUl = document.getElementById('queue-ul');
const targetsCount = document.getElementById('targets-count');
const btnClearTargets = document.getElementById('btn-clear-targets');

// DOM Cache - Footer Progress & Terminal
const progressBarSection = document.getElementById('progress-bar-section');
const progressStats = document.getElementById('progress-stats');
const progressFill = document.getElementById('progress-fill');
const progressCurrentTarget = document.getElementById('progress-current-target');
const terminalBody = document.getElementById('terminal-body');
const btnClearLogs = document.getElementById('btn-clear-logs');

// ----------------------------------------------------
// UI Render Helpers
// ----------------------------------------------------

function appendTerminalLine(text) {
    const line = document.createElement('div');
    line.className = 'font-mono text-xs leading-5';
    
    // Classify line colors
    if (text.includes('[Sistem]') || text.includes('[System]')) {
        line.classList.add('text-sky-400');
    } else if (text.includes('Sukses') || text.includes('Successfully') || text.includes('ready')) {
        line.classList.add('text-emerald-400');
    } else if (text.includes('Gagal') || text.includes('Failed') || text.includes('Error') || text.includes('failure')) {
        line.classList.add('text-rose-400');
    } else if (text.includes('Waiting') || text.includes('Jeda') || text.includes('menunggu') || text.includes('dihentikan')) {
        line.classList.add('text-amber-500');
    } else {
        line.classList.add('text-zinc-400');
    }
    
    line.textContent = text;
    terminalBody.appendChild(line);
    terminalBody.scrollTop = terminalBody.scrollHeight;
}

function renderContacts() {
    contactsUl.innerHTML = '';
    
    const filtered = contacts.filter(c => 
        c.name.toLowerCase().includes(currentSearch.toLowerCase()) || 
        c.number.includes(currentSearch)
    );
    
    if (filtered.length === 0) {
        contactsUl.innerHTML = `<li class="flex justify-center items-center text-center py-10 px-2.5 text-zinc-400 italic text-[13px] border border-dashed border-white/5 rounded-lg bg-transparent w-full list-none">${contacts.length === 0 ? 'Kontak kosong' : 'Kontak tidak ditemukan'}</li>`;
        return;
    }

    filtered.forEach(c => {
        const isAdded = selectedTargets.includes(c.id);
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center bg-white/2 p-2 px-3 rounded-lg border border-white/2 transition-all duration-200 hover:bg-white/4 hover:border-indigo-500/15 hover:translate-x-[2px] list-none';
        
        li.innerHTML = `
            <div class="flex flex-col">
                <span class="text-[13px] font-semibold text-zinc-100 truncate max-w-[150px]" title="${escapeHTML(c.name)}">${escapeHTML(c.name)}</span>
                <span class="text-[11px] text-zinc-400">+${c.number}</span>
            </div>
            <div class="flex items-center gap-1.5">
                <button class="btn-delete w-[26px] h-[26px] rounded-full flex items-center justify-center border-none cursor-pointer bg-white/5 text-zinc-400 transition-all duration-200 hover:bg-rose-600/30 hover:text-rose-400 hover:shadow-[0_0_8px_rgba(239,68,68,0.2)]" title="Hapus Kontak">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
                <button class="btn-toggle w-[26px] h-[26px] rounded-full flex items-center justify-center border-none cursor-pointer bg-white/5 text-zinc-400 transition-all duration-200 ${isAdded ? 'hover:bg-rose-600 hover:text-white hover:shadow-[0_0_8px_rgba(239,68,68,0.4)]' : 'hover:bg-indigo-600 hover:text-white hover:shadow-[0_0_8px_rgba(99,102,241,0.4)]'}" title="${isAdded ? 'Hapus dari Antrean' : 'Tambah ke Antrean'}">
                    ${isAdded ? 
                        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>` : 
                        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`
                    }
                </button>
            </div>
        `;
        
        li.querySelector('.btn-toggle').addEventListener('click', () => {
            socket.emit('toggle-target', c.id);
        });

        li.querySelector('.btn-delete').addEventListener('click', () => {
            if (confirm(`Apakah Anda yakin ingin menghapus kontak "${c.name}"?`)) {
                socket.emit('delete-manual-contact', c.id);
            }
        });
        
        contactsUl.appendChild(li);
    });
}

function renderGroups() {
    groupsUl.innerHTML = '';
    
    const filtered = groups.filter(g => 
        g.name.toLowerCase().includes(currentSearch.toLowerCase())
    );
    
    if (filtered.length === 0) {
        groupsUl.innerHTML = `<li class="flex justify-center items-center text-center py-10 px-2.5 text-zinc-400 italic text-[13px] border border-dashed border-white/5 rounded-lg bg-transparent w-full list-none">${groups.length === 0 ? 'Grup kosong' : 'Grup tidak ditemukan'}</li>`;
        return;
    }

    filtered.forEach(g => {
        const isAdded = selectedTargets.includes(g.id);
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center bg-white/2 p-2 px-3 rounded-lg border border-white/2 transition-all duration-200 hover:bg-white/4 hover:border-indigo-500/15 hover:translate-x-[2px] list-none';
        
        li.innerHTML = `
            <div class="flex flex-col">
                <span class="text-[13px] font-semibold text-zinc-100 truncate max-w-[150px]" title="${escapeHTML(g.name)}">${escapeHTML(g.name)}</span>
                <span class="text-[11px] text-zinc-400">Group Chat</span>
            </div>
            <div class="flex items-center gap-1.5">
                <button class="btn-delete w-[26px] h-[26px] rounded-full flex items-center justify-center border-none cursor-pointer bg-white/5 text-zinc-400 transition-all duration-200 hover:bg-rose-600/30 hover:text-rose-400 hover:shadow-[0_0_8px_rgba(239,68,68,0.2)]" title="Hapus Grup">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
                <button class="btn-toggle w-[26px] h-[26px] rounded-full flex items-center justify-center border-none cursor-pointer bg-white/5 text-zinc-400 transition-all duration-200 ${isAdded ? 'hover:bg-rose-600 hover:text-white hover:shadow-[0_0_8px_rgba(239,68,68,0.4)]' : 'hover:bg-indigo-600 hover:text-white hover:shadow-[0_0_8px_rgba(99,102,241,0.4)]'}" title="${isAdded ? 'Hapus dari Antrean' : 'Tambah ke Antrean'}">
                    ${isAdded ? 
                        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>` : 
                        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`
                    }
                </button>
            </div>
        `;
        
        li.querySelector('.btn-toggle').addEventListener('click', () => {
            socket.emit('toggle-target', g.id);
        });

        li.querySelector('.btn-delete').addEventListener('click', () => {
            if (confirm(`Apakah Anda yakin ingin menghapus grup "${g.name}"?`)) {
                socket.emit('delete-manual-group', g.id);
            }
        });
        
        groupsUl.appendChild(li);
    });
}

function renderQueue() {
    queueUl.innerHTML = '';
    targetsCount.textContent = selectedTargets.length;
    
    if (selectedTargets.length === 0) {
        queueUl.innerHTML = '<li class="flex justify-center items-center text-center py-10 px-2.5 text-zinc-400 italic text-[13px] border border-dashed border-white/5 rounded-lg bg-transparent w-full list-none">Belum ada target terpilih.</li>';
        return;
    }

    selectedTargets.forEach(targetId => {
        const li = document.createElement('li');
        let targetName = targetId;
        let isGroup = targetId.endsWith('@g.us');
        
        if (isGroup) {
            const foundG = groups.find(g => g.id === targetId);
            targetName = foundG ? foundG.name : 'Grup Tidak Dikenal';
        } else {
            const foundC = contacts.find(c => c.id === targetId);
            targetName = foundC ? `${foundC.name} (+${foundC.number})` : targetId.split('@')[0];
        }

        const status = targetStatuses[targetId] || 'IDLE';
        let statusBadge = '';
        let statusClass = 'border-l-white/10 bg-white/2';
        
        if (status === 'PENDING') {
            statusBadge = '<span class="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-amber-500/15 text-amber-500 border border-amber-500/25">Antrean</span>';
            statusClass = 'border-l-amber-500 bg-amber-500/5';
        } else if (status === 'SENDING') {
            statusBadge = '<span class="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-indigo-500/15 text-cyan-400 border border-cyan-400/25">Mengirim...</span>';
            statusClass = 'border-l-indigo-500 bg-indigo-500/10 animate-pulse';
        } else if (status === 'SUCCESS') {
            statusBadge = '<span class="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">Terkirim <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="inline-block align-middle ml-1"><polyline points="20 6 9 17 4 12"></polyline></svg></span>';
            statusClass = 'border-l-emerald-500 bg-emerald-500/5';
        } else if (status === 'FAILED') {
            statusBadge = '<span class="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider bg-rose-500/15 text-rose-300 border border-rose-500/25">Gagal <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="inline-block align-middle ml-1"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span>';
            statusClass = 'border-l-rose-500 bg-rose-500/5';
        }

        li.className = `flex justify-between items-center p-2 px-3 rounded-lg border border-white/2 border-l-[3px] transition-all duration-300 hover:bg-white/4 hover:border-indigo-500/15 hover:translate-x-[2px] list-none ${statusClass}`;
        li.innerHTML = `
            <div class="flex flex-col">
                <span class="text-[13px] font-semibold text-zinc-100 truncate max-w-[180px]" title="${escapeHTML(targetName)}">${escapeHTML(targetName)}</span>
                <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-[11px] text-zinc-400">${isGroup ? 'Group Chat' : 'Kontak'}</span>
                    ${statusBadge}
                </div>
            </div>
            <button class="w-[26px] h-[26px] rounded-full flex items-center justify-center border-none cursor-pointer bg-white/5 text-zinc-400 transition-all duration-200 hover:bg-rose-600 hover:text-white hover:shadow-[0_0_8px_rgba(239,68,68,0.4)]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        `;
        
        li.querySelector('button').addEventListener('click', () => {
            socket.emit('toggle-target', targetId);
        });
        
        queueUl.appendChild(li);
    });
}

function updateMessagePreview() {
    previewText.textContent = messageInput.value;
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// ----------------------------------------------------
// Socket.io Connection Handlers
// ----------------------------------------------------

socket.on('status-update', (data) => {
    const status = data.connectionStatus;
    
    // Hide logout button for non-admins to prevent unauthorized disconnections
    if (!isAdmin) {
        btnLogout.classList.add('hidden');
    } else {
        btnLogout.classList.remove('hidden');
    }
    
    // 1. If connected, show full dashboard screen
    if (status === 'CONNECTED') {
        loginScreen.classList.add('hidden');
        dashboardScreen.classList.remove('hidden');
        
        if (data.userInfo) {
            userPushname.textContent = data.userInfo.pushname;
            userWid.textContent = `+${data.userInfo.wid.split('@')[0]}`;
        }
    } 
    // 2. If loading / disconnected / restoring, show scanner screen
    else {
        dashboardScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        
        // Reset classes
        loginStatusDot.className = 'w-2.5 h-2.5 rounded-full transition-all duration-300';
        
        if (status === 'INITIALIZING') {
            loginStatusTitle.textContent = 'Menginisialisasi Bot...';
            loginStatusDot.classList.add('bg-amber-500', 'shadow-[0_0_8px_rgba(245,158,11,0.5)]', 'animate-pulse');
            
            viewLoading.classList.remove('hidden');
            viewLoading.classList.add('flex');
            
            viewQr.classList.add('hidden');
            viewQr.classList.remove('flex');
            
            viewOffline.classList.add('hidden');
            viewOffline.classList.remove('flex');
        }
        else if (status === 'RESTORING_SESSION') {
            loginStatusTitle.textContent = 'Memulihkan sesi tersimpan... Tidak perlu scan QR!';
            loginStatusDot.classList.add('bg-indigo-500', 'shadow-[0_0_8px_rgba(99,102,241,0.5)]', 'animate-pulse');
            
            viewLoading.classList.remove('hidden');
            viewLoading.classList.add('flex');
            
            viewQr.classList.add('hidden');
            viewQr.classList.remove('flex');
            
            viewOffline.classList.add('hidden');
            viewOffline.classList.remove('flex');
        }
        else if (status === 'AUTHENTICATING') {
            loginStatusTitle.textContent = 'Autentikasi berhasil! Menghubungkan...';
            loginStatusDot.classList.add('bg-emerald-500', 'shadow-[0_0_8px_rgba(16,185,129,0.5)]', 'animate-pulse');
            
            viewLoading.classList.remove('hidden');
            viewLoading.classList.add('flex');
            
            viewQr.classList.add('hidden');
            viewQr.classList.remove('flex');
            
            viewOffline.classList.add('hidden');
            viewOffline.classList.remove('flex');
        }
        else if (status === 'DISCONNECTED' || status === 'QR_RECEIVED') {
            if (data.qrCodeBase64) {
                loginStatusTitle.textContent = 'Menunggu Scan...';
                loginStatusDot.classList.add('bg-cyan-400', 'shadow-[0_0_8px_rgba(0,242,254,0.5)]', 'animate-pulse');
                
                if (isAdmin) {
                    qrImage.src = data.qrCodeBase64;
                    
                    viewLoading.classList.add('hidden');
                    viewLoading.classList.remove('flex');
                    
                    viewQr.classList.remove('hidden');
                    viewQr.classList.add('flex');
                    
                    viewOffline.classList.add('hidden');
                    viewOffline.classList.remove('flex');
                } else {
                    viewLoading.classList.add('hidden');
                    viewLoading.classList.remove('flex');
                    
                    viewQr.classList.add('hidden');
                    viewQr.classList.remove('flex');
                    
                    viewOffline.classList.remove('hidden');
                    viewOffline.classList.add('flex');
                }
            } else {
                loginStatusTitle.textContent = 'Menghubungkan ke WhatsApp...';
                loginStatusDot.classList.add('bg-rose-500', 'shadow-[0_0_8px_rgba(239,68,68,0.5)]');
                
                viewLoading.classList.remove('hidden');
                viewLoading.classList.add('flex');
                
                viewQr.classList.add('hidden');
                viewQr.classList.remove('flex');
                
                viewOffline.classList.add('hidden');
                viewOffline.classList.remove('flex');
            }
        }
    }
});

socket.on('sync-status', (status) => {
    const syncSvg = btnSyncData.querySelector('svg');
    if (status === 'SYNCING') {
        if (syncSvg) syncSvg.classList.add('animate-spin');
        btnSyncData.disabled = true;
    } else {
        if (syncSvg) syncSvg.classList.remove('animate-spin');
        btnSyncData.disabled = false;
    }
});

socket.on('contacts-list', (list) => {
    contacts = list;
    if (activeTab === 'contacts') renderContacts();
    renderQueue();
    // Reset manual contact inputs
    manualNameInput.value = '';
    manualPhoneInput.value = '';
});

socket.on('groups-list', (list) => {
    groups = list;
    if (activeTab === 'groups') renderGroups();
    renderQueue();
    // Reset manual group inputs
    manualGroupNameInput.value = '';
    manualGroupIdInput.value = '';
});

socket.on('targets-list', (list) => {
    selectedTargets = list;
    if (list.length === 0) {
        targetStatuses = {};
    }
    renderQueue();
    // Re-render source list checkmarks
    if (activeTab === 'contacts') renderContacts();
    else renderGroups();
});

socket.on('config-update', (data) => {
    if (!data) return;
    if (data.broadcastMessage !== undefined) {
        if (document.activeElement !== messageInput) {
            messageInput.value = data.broadcastMessage;
            updateMessagePreview();
        }
    }
    if (data.delayValue !== undefined) {
        if (document.activeElement !== delayValue) {
            delayValue.value = data.delayValue;
        }
    }
    if (data.delayUnit !== undefined) {
        if (document.activeElement !== delayUnit) {
            delayUnit.value = data.delayUnit;
        }
    }
});

socket.on('broadcast-status', (data) => {
    if (!data) return;
    const status = data.status || 'IDLE';
    const total = data.total || 0;
    const sent = data.sent || 0;
    const failed = data.failed || 0;
    const processed = sent + failed;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    
    // Update DOM fields
    const elStatus = document.getElementById('progress-status-text');
    const elPercent = document.getElementById('progress-percent');
    const elTotal = document.getElementById('stat-total');
    const elSent = document.getElementById('stat-sent');
    const elFailed = document.getElementById('stat-failed');
    const elStart = document.getElementById('time-start');
    const elEst = document.getElementById('time-est');
    
    if (elStatus) elStatus.textContent = status;
    if (elPercent) elPercent.textContent = `${pct}%`;
    if (progressFill) progressFill.style.width = `${pct}%`;
    
    if (elTotal) elTotal.textContent = total;
    if (elSent) elSent.textContent = sent;
    if (elFailed) elFailed.textContent = failed;
    
    if (elStart) elStart.textContent = data.startTime || '-';
    if (elEst) elEst.textContent = data.estimatedEndTime || '-';
    
    if (status === 'RUNNING') {
        btnStart.disabled = true;
        btnStop.disabled = false;
        progressBarSection.classList.remove('hidden');
        
        if (data.currentTarget) {
            let name = data.currentTarget;
            if (data.currentTarget.endsWith('@g.us')) {
                const foundG = groups.find(g => g.id === data.currentTarget);
                name = foundG ? foundG.name : 'Group';
            } else {
                const foundC = contacts.find(c => c.id === data.currentTarget);
                name = foundC ? `${foundC.name} (+${foundC.number})` : data.currentTarget.split('@')[0];
            }
            progressCurrentTarget.textContent = name;
        } else {
            progressCurrentTarget.textContent = 'Mempersiapkan...';
        }
    } else {
        btnStart.disabled = false;
        btnStop.disabled = true;
        
        if (status === 'COMPLETED' || status === 'STOPPED') {
            progressBarSection.classList.remove('hidden');
            progressCurrentTarget.textContent = status === 'COMPLETED' ? 'Siaran Selesai!' : 'Siaran Dihentikan.';
        } else {
            progressBarSection.classList.add('hidden');
        }
    }
});

socket.on('target-status-bulk', (list) => {
    targetStatuses = {};
    list.forEach(item => {
        targetStatuses[item.id] = item.status;
    });
    renderQueue();
});

socket.on('target-status-update', (data) => {
    targetStatuses[data.id] = data.status;
    renderQueue();
});

socket.on('log-entry', (msg) => {
    appendTerminalLine(msg);
});

socket.on('logs-history', (history) => {
    terminalBody.innerHTML = '';
    history.forEach(line => appendTerminalLine(line));
});

socket.on('error-msg', (msg) => {
    alert(msg);
    appendTerminalLine(`[Sistem] Peringatan: ${msg}`);
    // Re-enable Start button if broadcast was rejected by server
    btnStart.disabled = false;
    btnStop.disabled = true;
    progressBarSection.classList.add('hidden');
});

// ----------------------------------------------------
// UI Form Controls & Submissions
// ----------------------------------------------------

function syncConfig() {
    socket.emit('update-config', {
        message: messageInput.value,
        delayValue: delayValue.value,
        delayUnit: delayUnit.value
    });
}

messageInput.addEventListener('input', () => {
    updateMessagePreview();
    syncConfig();
});

delayValue.addEventListener('input', syncConfig);
delayUnit.addEventListener('change', syncConfig);

btnSyncData.addEventListener('click', () => {
    socket.emit('sync-contacts-groups');
});

btnAddManual.addEventListener('click', () => {
    const name = manualNameInput.value;
    const phone = manualPhoneInput.value;
    if (!name.trim() || !phone.trim()) {
        alert('Nama dan nomor WA harus diisi!');
        return;
    }
    socket.emit('add-manual-contact', { name, phone });
});

btnAddManualGroup.addEventListener('click', () => {
    const name = manualGroupNameInput.value;
    const groupId = manualGroupIdInput.value;
    if (!name.trim() || !groupId.trim()) {
        alert('Nama dan ID Grup harus diisi!');
        return;
    }
    socket.emit('add-manual-group', { name, groupId });
});

btnStart.addEventListener('click', () => {
    // Immediately disable to prevent double-click
    btnStart.disabled = true;
    btnStop.disabled = false;
    
    // Reset stats in DOM immediately
    progressBarSection.classList.remove('hidden');
    const elStatus = document.getElementById('progress-status-text');
    const elPercent = document.getElementById('progress-percent');
    const elTotal = document.getElementById('stat-total');
    const elSent = document.getElementById('stat-sent');
    const elFailed = document.getElementById('stat-failed');
    
    if (elStatus) elStatus.textContent = 'RUNNING';
    if (elPercent) elPercent.textContent = '0%';
    if (progressFill) progressFill.style.width = '0%';
    if (elTotal) elTotal.textContent = selectedTargets.length;
    if (elSent) elSent.textContent = '0';
    if (elFailed) elFailed.textContent = '0';
    
    progressCurrentTarget.textContent = 'Mempersiapkan...';
    
    socket.emit('start-broadcast');
});

btnStop.addEventListener('click', () => {
    // Immediately disable to prevent double-click
    btnStop.disabled = true;
    progressCurrentTarget.textContent = 'Menghentikan siaran...';
    
    socket.emit('stop-broadcast');
});

btnLogout.addEventListener('click', () => {
    if (confirm('Apakah Anda yakin ingin Logout sesi WhatsApp ini? Anda harus melakukan scan ulang.')) {
        socket.emit('logout-wa');
    }
});

btnClearTargets.addEventListener('click', () => {
    if (confirm('Kosongkan antrean target terpilih?')) {
        socket.emit('clear-targets');
    }
});

btnClearLogs.addEventListener('click', () => {
    terminalBody.innerHTML = '<div class="font-mono text-xs leading-5 text-sky-400">[Sistem] Terminal logs dibersihkan.</div>';
});

// Directories Tab navigation
tabContacts.addEventListener('click', () => {
    if (activeTab === 'contacts') return;
    activeTab = 'contacts';
    tabContacts.className = 'px-3 py-1 rounded-full text-xxs font-semibold transition-all bg-indigo-600 text-white shadow-[0_2px_8px_rgba(99,102,241,0.4)] cursor-pointer';
    tabGroups.className = 'px-3 py-1 rounded-full text-xxs font-semibold transition-all bg-transparent text-zinc-400 hover:text-zinc-200 cursor-pointer';
    contactsPanel.classList.remove('hidden');
    groupsPanel.classList.add('hidden');
    
    targetSearch.placeholder = 'Cari kontak...';
    targetSearch.value = currentSearch;
    renderContacts();
});

tabGroups.addEventListener('click', () => {
    if (activeTab === 'groups') return;
    activeTab = 'groups';
    tabGroups.className = 'px-3 py-1 rounded-full text-xxs font-semibold transition-all bg-indigo-600 text-white shadow-[0_2px_8px_rgba(99,102,241,0.4)] cursor-pointer';
    tabContacts.className = 'px-3 py-1 rounded-full text-xxs font-semibold transition-all bg-transparent text-zinc-400 hover:text-zinc-200 cursor-pointer';
    groupsPanel.classList.remove('hidden');
    contactsPanel.classList.add('hidden');
    
    targetSearch.placeholder = 'Cari grup...';
    targetSearch.value = currentSearch;
    renderGroups();
});

// Directory Search filtering
targetSearch.addEventListener('input', (e) => {
    currentSearch = e.target.value;
    if (activeTab === 'contacts') renderContacts();
    else renderGroups();
});
