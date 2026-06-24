const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcodeGenerator = require('qrcode');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

// Setup static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// State Management
let client = null;
let contacts = [];
let groups = [];

// Ensure persist directory exists (essential for Railway persistent volumes)
const persistDir = path.join(__dirname, 'persist');
if (!fs.existsSync(persistDir)) {
    fs.mkdirSync(persistDir, { recursive: true });
}

// Migrate old files to persist directory if they exist at root level
function migrateFileToPersist(filename) {
    const oldPath = path.join(__dirname, filename);
    const newPath = path.join(persistDir, filename);
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        try {
            fs.copyFileSync(oldPath, newPath);
            console.log(`Migrasi file ${filename} ke folder persist berhasil.`);
        } catch (e) {
            console.error(`Gagal migrasi file ${filename}:`, e.message);
        }
    }
}

// Migrate folder .wwebjs_auth if it exists in root
const oldAuthPath = path.join(__dirname, '.wwebjs_auth');
const newAuthPath = path.join(persistDir, '.wwebjs_auth');
if (fs.existsSync(oldAuthPath) && !fs.existsSync(newAuthPath)) {
    try {
        fs.renameSync(oldAuthPath, newAuthPath);
        console.log('Migrasi folder .wwebjs_auth ke folder persist berhasil.');
    } catch (e) {
        console.error('Gagal migrasi folder .wwebjs_auth:', e.message);
    }
}

migrateFileToPersist('manual_contacts.json');
migrateFileToPersist('manual_groups.json');
migrateFileToPersist('broadcast_state.json');

let manualContacts = [];
const manualContactsPath = path.join(persistDir, 'manual_contacts.json');
if (fs.existsSync(manualContactsPath)) {
    try {
        manualContacts = JSON.parse(fs.readFileSync(manualContactsPath, 'utf8'));
    } catch (e) {
        console.error('Gagal membaca manual_contacts.json:', e.message);
    }
}
let manualGroups = [];
const manualGroupsPath = path.join(persistDir, 'manual_groups.json');
if (fs.existsSync(manualGroupsPath)) {
    try {
        manualGroups = JSON.parse(fs.readFileSync(manualGroupsPath, 'utf8'));
    } catch (e) {
        console.error('Gagal membaca manual_groups.json:', e.message);
    }
}
let selectedTargets = new Set();
let broadcastMessage = '';
let delayValue = 10;
let delayUnit = 'seconds'; // seconds, hours, days
// Persistent state for broadcasts
const statePath = path.join(persistDir, 'broadcast_state.json');
let broadcastState = {
    status: 'IDLE', // IDLE, RUNNING, STOPPED, COMPLETED
    total: 0,
    sent: 0,
    failed: 0,
    currentTarget: null,
    startTime: null,
    estimatedEndTime: null,
    broadcastMessage: '',
    delayValue: 10,
    delayUnit: 'seconds',
    targets: [] // Array of { id, status: 'PENDING' | 'SENDING' | 'SUCCESS' | 'FAILED' }
};

function loadState() {
    if (fs.existsSync(statePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            broadcastState = { ...broadcastState, ...data };
            // Populate selectedTargets Set from broadcastState.targets JIDs
            selectedTargets.clear();
            if (Array.isArray(broadcastState.targets)) {
                broadcastState.targets.forEach(t => {
                    selectedTargets.add(t.id);
                });
            }
            broadcastMessage = broadcastState.broadcastMessage || '';
            delayValue = broadcastState.delayValue || 10;
            delayUnit = broadcastState.delayUnit || 'seconds';
            console.log('State broadcast dimuat dari database JSON.');
        } catch (e) {
            console.error('Gagal membaca broadcast_state.json:', e.message);
        }
    }
}

function saveState() {
    try {
        broadcastState.broadcastMessage = broadcastMessage;
        broadcastState.delayValue = delayValue;
        broadcastState.delayUnit = delayUnit;
        fs.writeFileSync(statePath, JSON.stringify(broadcastState, null, 2), 'utf8');
    } catch (e) {
        console.error('Gagal menyimpan broadcast_state.json:', e.message);
    }
}

let connectionStatus = 'DISCONNECTED'; // DISCONNECTED, INITIALIZING, RESTORING_SESSION, QR_RECEIVED, AUTHENTICATING, CONNECTED
let qrCodeBase64 = null;
let userInfo = null;
let logs = [];

// Helper: Add log
function addLog(text) {
    const timestamp = new Date().toLocaleTimeString();
    const logMsg = `[${timestamp}] ${text}`;
    logs.push(logMsg);
    if (logs.length > 250) logs.shift(); // Limit logs buffer
    io.emit('log-entry', logMsg);
    console.log(logMsg);
}

// Helper: Update connection state
function updateConnectionStatus(status) {
    connectionStatus = status;
    io.emit('status-update', { connectionStatus, qrCodeBase64, userInfo });
    addLog(`Status Koneksi: ${status}`);
}

// Helper: Promise Timeout wrapper
const promiseWithTimeout = (promise, ms, name = 'Operasi') => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${name} melampaui batas waktu ${ms}ms`));
        }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

// Helper: Check if string is formatted as a phone number
function isProbablyPhoneNumber(str) {
    if (!str) return false;
    const cleaned = str.replace(/[\s\-\+\(\)]/g, '');
    return /^\d+$/.test(cleaned);
}

// Helper: Load contacts and groups with fallback to active chats and auto-retry sync
async function loadContactsAndGroups(retries = 3) {
    io.emit('sync-status', 'SYNCING');
    addLog('Mengambil daftar kontak dan grup manual...');
    
    try {
        const contactsMap = new Map();

        // 1. Add manual contacts
        manualContacts.forEach(mc => {
            contactsMap.set(mc.id, {
                id: mc.id,
                name: mc.name,
                number: mc.number
            });
        });

        contacts = Array.from(contactsMap.values()).sort((a, b) => a.name.localeCompare(b.name));

        // 2. Add manual groups
        groups = manualGroups
            .map(mg => ({
                id: mg.id,
                name: mg.name
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        addLog(`Berhasil memuat ${contacts.length} kontak manual dan ${groups.length} grup manual.`);
        
        io.emit('contacts-list', contacts);
        io.emit('groups-list', groups);
        io.emit('sync-status', 'IDLE');

    } catch (err) {
        addLog(`Gagal memuat kontak/grup manual: ${err.message}`);
        io.emit('sync-status', 'IDLE');
    }
}

// Helper: Calculate delay in ms
function getDelayMs() {
    const multiplier = {
        seconds: 1000,
        minutes: 60 * 1000,
        hours: 60 * 60 * 1000,
        days: 24 * 60 * 60 * 1000
    };
    return (delayValue || 10) * (multiplier[delayUnit] || 1000);
}

// Initialize WhatsApp Web Client
function initWhatsAppClient(retryCount = 0) {
    const MAX_RETRIES = 3;
    const INIT_TIMEOUT_MS = 60000; // 60 seconds timeout for initialization
    let initResolved = false; // Track if any WA event has fired
    let initTimeoutHandle = null;

    addLog('Menginisialisasi WhatsApp Client...');
    updateConnectionStatus('INITIALIZING');

    // Dynamic Google Chrome path detection (supports macOS & Linux/Railway)
    const systemChromePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable'
    ];
    let selectedChromePath = null;
    for (const p of systemChromePaths) {
        if (fs.existsSync(p)) {
            selectedChromePath = p;
            break;
        }
    }

    const puppeteerOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    };

    if (selectedChromePath) {
        addLog(`Menggunakan system Chrome di: ${selectedChromePath}`);
        puppeteerOptions.executablePath = selectedChromePath;
    } else {
        addLog('System Google Chrome tidak ditemukan. Menggunakan pencarian internal Puppeteer.');
    }

    // Check if a saved session exists before creating the client (using persist directory)
    const sessionPath = path.join(persistDir, '.wwebjs_auth', 'session-dakauri-dashboard-bot');
    const hasSavedSession = fs.existsSync(sessionPath);

    // Clean up stale Chrome lock files that prevent Puppeteer from starting
    if (hasSavedSession) {
        const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
        lockFiles.forEach(lockFile => {
            const lockPath = path.join(sessionPath, lockFile);
            if (fs.existsSync(lockPath)) {
                try {
                    fs.rmSync(lockPath, { force: true });
                    addLog(`File lock lama dihapus: ${lockFile}`);
                } catch (e) {
                    // Ignore errors
                }
            }
        });

        addLog('Sesi tersimpan ditemukan! Memulihkan koneksi tanpa scan QR...');
        updateConnectionStatus('RESTORING_SESSION');
    }

    client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'dakauri-dashboard-bot',
            dataPath: path.join(persistDir, '.wwebjs_auth')
        }),
        puppeteer: puppeteerOptions
    });

    // Mark that initialization has progressed (any event = not stuck)
    function markInitResolved() {
        initResolved = true;
        if (initTimeoutHandle) {
            clearTimeout(initTimeoutHandle);
            initTimeoutHandle = null;
        }
    }

    client.on('qr', (qr) => {
        markInitResolved();
        console.log('\n--- SCAN QR CODE DI BAWAH INI ATAU BUKA http://localhost:3000 ---');
        qrcodeTerminal.generate(qr, { small: true });
        console.log('-------------------------------------------------------\n');
        
        qrcodeGenerator.toDataURL(qr, (err, url) => {
            if (err) {
                addLog('Gagal membuat URL base64 QR Code.');
                return;
            }
            qrCodeBase64 = url;
            updateConnectionStatus('QR_RECEIVED');
        });
    });

    client.on('authenticated', () => {
        markInitResolved();
        addLog('Autentikasi WhatsApp sukses! Sesi tersimpan untuk penggunaan berikutnya.');
        qrCodeBase64 = null;
        updateConnectionStatus('AUTHENTICATING');
    });

    client.on('auth_failure', (msg) => {
        markInitResolved();
        addLog(`Autentikasi gagal: ${msg}. Menghapus sesi lama...`);
        
        // Clean up corrupted session data
        const authPath = path.join(persistDir, '.wwebjs_auth');
        if (fs.existsSync(authPath)) {
            try {
                fs.rmSync(authPath, { recursive: true, force: true });
                addLog('Folder sesi yang rusak telah dibersihkan.');
            } catch (err) {
                addLog(`Gagal menghapus folder sesi: ${err.message}`);
            }
        }
        
        updateConnectionStatus('DISCONNECTED');
        
        // Auto-retry after clearing corrupted session
        if (retryCount < MAX_RETRIES) {
            addLog(`Mencoba ulang dalam 3 detik... (Percobaan ${retryCount + 1}/${MAX_RETRIES})`);
            setTimeout(() => initWhatsAppClient(retryCount + 1), 3000);
        }
    });

    client.on('ready', async () => {
        markInitResolved();
        
        try {
            const me = client.info;
            const myNumber = me.wid.user; // e.g. "6288293680886"
            
            if (myNumber !== '6288293680886') {
                addLog(`⚠️ Akses Ditolak: Nomor +${myNumber} tidak diizinkan menjadi bot. Hanya +6288293680886 yang diperbolehkan! Melakukan logout otomatis...`);
                userInfo = null;
                contacts = [];
                groups = [];
                qrCodeBase64 = null;
                updateConnectionStatus('DISCONNECTED');
                
                try {
                    await client.logout();
                    await client.destroy();
                } catch (e) {
                    addLog(`Error saat logout nomor tidak sah: ${e.message}`);
                }
                
                // Reinitialize client to show new QR
                initWhatsAppClient();
                return;
            }

            addLog('Koneksi WhatsApp siap! ✅');
            qrCodeBase64 = null;
            userInfo = {
                pushname: me.pushname || 'Owner Bot Dakauri',
                wid: me.wid._serialized
            };
            updateConnectionStatus('CONNECTED');

            // Trigger the dual-source contact load with sync retries
            await loadContactsAndGroups();
            
            // Resume broadcast if it was running
            if (broadcastState.status === 'RUNNING') {
                addLog('Melanjutkan kampanye siaran yang tertunda setelah restart...');
                resumeBroadcastLoop();
            }
            
        } catch (err) {
            addLog(`Error saat mengambil database WhatsApp: ${err.message}`);
        }
    });

    client.on('disconnected', (reason) => {
        addLog(`Koneksi WhatsApp terputus: ${reason}`);
        userInfo = null;
        contacts = [];
        groups = [];
        qrCodeBase64 = null;
        updateConnectionStatus('DISCONNECTED');
    });

    // Start initialization timeout — if no WA event fires within INIT_TIMEOUT_MS,
    // the session is stale/corrupted. Destroy and retry fresh.
    initTimeoutHandle = setTimeout(async () => {
        if (!initResolved) {
            addLog(`⚠️ Inisialisasi timeout setelah ${INIT_TIMEOUT_MS / 1000} detik. Sesi kemungkinan sudah kedaluwarsa.`);
            
            // Destroy the hanging client
            try {
                if (client) {
                    await client.destroy();
                    addLog('Client lama berhasil di-destroy.');
                }
            } catch (e) {
                addLog(`Peringatan saat destroy client: ${e.message}`);
            }
            
            // Remove stale session so next init produces a fresh QR
            const authPath = path.join(persistDir, '.wwebjs_auth');
            if (fs.existsSync(authPath)) {
                try {
                    fs.rmSync(authPath, { recursive: true, force: true });
                    addLog('Sesi kedaluwarsa dihapus. Memulai ulang dengan QR baru...');
                } catch (e) {
                    addLog(`Gagal menghapus sesi: ${e.message}`);
                }
            }
            
            updateConnectionStatus('DISCONNECTED');
            
            // Retry — this time without saved session, so it will show QR
            if (retryCount < MAX_RETRIES) {
                addLog(`Memulai ulang inisialisasi... (Percobaan ${retryCount + 1}/${MAX_RETRIES})`);
                setTimeout(() => initWhatsAppClient(retryCount + 1), 2000);
            } else {
                addLog('Gagal menginisialisasi setelah beberapa percobaan. Silakan restart bot secara manual.');
            }
        }
    }, INIT_TIMEOUT_MS);

    client.initialize().catch(err => {
        markInitResolved();
        addLog(`Error saat inisialisasi Client: ${err.message}`);
        updateConnectionStatus('DISCONNECTED');
        
        // Auto-retry if browser lock issue or transient error
        if (retryCount < MAX_RETRIES) {
            // Clean lock files again before retry
            if (fs.existsSync(sessionPath)) {
                ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(f => {
                    try { fs.rmSync(path.join(sessionPath, f), { force: true }); } catch (_) {}
                });
            }
            const delaySec = (retryCount + 1) * 3;
            addLog(`Mencoba ulang dalam ${delaySec} detik... (Percobaan ${retryCount + 1}/${MAX_RETRIES})`);
            setTimeout(() => initWhatsAppClient(retryCount + 1), delaySec * 1000);
        } else {
            addLog('Gagal menginisialisasi setelah beberapa percobaan. Silakan restart bot secara manual.');
        }
    });
}

// Execute sequential broadcast loop
async function executeBroadcast() {
    while (broadcastState.status === 'RUNNING') {
        const targetIdx = broadcastState.targets.findIndex(t => t.status === 'PENDING');
        
        if (targetIdx === -1) {
            // All targets sent for this round!
            // Wait for the user's selected delay interval before repeating
            const delayMs = getDelayMs();
            addLog(`Putaran siaran selesai. Menunggu jeda ${delayValue} ${delayUnit} sebelum mengirim ulang...`);
            
            const startTime = Date.now();
            let stopped = false;
            while (Date.now() - startTime < delayMs) {
                if (broadcastState.status !== 'RUNNING') {
                    stopped = true;
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            if (stopped) {
                break;
            }
            
            // Reset all targets back to PENDING for the next round
            broadcastState.targets.forEach(t => {
                t.status = 'PENDING';
            });
            saveState();
            io.emit('broadcast-status', broadcastState);
            io.emit('target-status-bulk', broadcastState.targets);
            
            addLog('Memulai ulang pengiriman ke semua target...');
            continue;
        }
        
        const target = broadcastState.targets[targetIdx];
        
        // Mark target as SENDING
        target.status = 'SENDING';
        broadcastState.currentTarget = target.id;
        saveState();
        io.emit('broadcast-status', broadcastState);
        io.emit('target-status-update', { id: target.id, status: 'SENDING' });
        
        let targetName = target.id.split('@')[0];
        if (target.id.endsWith('@g.us')) {
            const foundG = groups.find(g => g.id === target.id);
            targetName = foundG ? `${foundG.name} [Grup]` : 'Grup';
        } else {
            const foundC = contacts.find(c => c.id === target.id);
            targetName = foundC ? `${foundC.name} (+${foundC.number})` : `+${targetName}`;
        }
        
        addLog(`Mengirim ke ${targetName}...`);
        
        try {
            const footerLabel = '\n\n_BOT KWU Dakauri 2026_';
            const finalMessage = broadcastMessage + footerLabel;
            
            await promiseWithTimeout(client.sendMessage(target.id, finalMessage), 15000, `Kirim ke ${targetName}`);
            
            target.status = 'SUCCESS';
            broadcastState.sent++;
            addLog(`Sukses mengirim pesan ke ${targetName}`);
            io.emit('target-status-update', { id: target.id, status: 'SUCCESS' });
        } catch (error) {
            target.status = 'FAILED';
            broadcastState.failed++;
            addLog(`Gagal mengirim ke ${targetName}: ${error.message}`);
            io.emit('target-status-update', { id: target.id, status: 'FAILED' });
        }
        
        saveState();
        io.emit('broadcast-status', broadcastState);
        
        const nextPendingIdx = broadcastState.targets.findIndex(t => t.status === 'PENDING');
        if (nextPendingIdx === -1) {
            continue; // Will trigger the loop reset in next iteration
        }
        
        // Safety delay of 200ms between messages to prevent event loop blocking
        const startTime = Date.now();
        let stopped = false;
        while (Date.now() - startTime < 200) {
            if (broadcastState.status !== 'RUNNING') {
                stopped = true;
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        if (stopped) {
            break;
        }
    }
}

function runBroadcastLoop() {
    const targetArray = Array.from(selectedTargets);
    
    broadcastState.status = 'RUNNING';
    broadcastState.total = targetArray.length;
    broadcastState.sent = 0;
    broadcastState.failed = 0;
    broadcastState.currentTarget = null;
    broadcastState.startTime = new Date().toLocaleTimeString();
    broadcastState.estimatedEndTime = 'Terus Berjalan (Manual Stop)';
    
    // Construct target list
    broadcastState.targets = targetArray.map(id => ({ id, status: 'PENDING' }));
    
    addLog(`Memulai siaran pesan ke ${targetArray.length} target.`);
    
    saveState();
    
    io.emit('broadcast-status', broadcastState);
    io.emit('target-status-bulk', broadcastState.targets);
    
    // Start sequential loop without blocking the main event loop
    executeBroadcast().catch(err => {
        addLog(`Error fatal pada broadcast loop: ${err.message}`);
        broadcastState.status = 'STOPPED';
        saveState();
        io.emit('broadcast-status', broadcastState);
    });
}

function resumeBroadcastLoop() {
    // Reset any SENDING targets back to PENDING
    broadcastState.targets.forEach(t => {
        if (t.status === 'SENDING') t.status = 'PENDING';
    });
    
    // If all are completed, reset all to pending so it loops
    const pendingCount = broadcastState.targets.filter(t => t.status === 'PENDING').length;
    if (pendingCount === 0) {
        broadcastState.targets.forEach(t => {
            t.status = 'PENDING';
        });
    }
    
    broadcastState.estimatedEndTime = 'Terus Berjalan (Manual Stop)';
    broadcastState.status = 'RUNNING';
    saveState();
    
    io.emit('broadcast-status', broadcastState);
    io.emit('target-status-bulk', broadcastState.targets);
    
    // Start sequential loop without blocking the main event loop
    executeBroadcast().catch(err => {
        addLog(`Error fatal pada broadcast loop: ${err.message}`);
        broadcastState.status = 'STOPPED';
        saveState();
        io.emit('broadcast-status', broadcastState);
    });
}

// Socket.io real-time listeners
io.on('connection', (socket) => {
    // Send state on handshake
    socket.emit('status-update', { connectionStatus, qrCodeBase64, userInfo });
    socket.emit('contacts-list', contacts);
    socket.emit('groups-list', groups);
    socket.emit('broadcast-status', broadcastState);
    socket.emit('target-status-bulk', broadcastState.targets);
    socket.emit('config-update', { broadcastMessage, delayValue, delayUnit });
    socket.emit('targets-list', Array.from(selectedTargets));
    socket.emit('logs-history', logs);

    // Sync configs
    socket.on('update-config', (data) => {
        if (data.message !== undefined) broadcastMessage = data.message;
        if (data.delayValue !== undefined) {
            const parsed = parseInt(data.delayValue, 10);
            delayValue = isNaN(parsed) || parsed < 1 ? 10 : parsed;
        }
        if (data.delayUnit !== undefined) delayUnit = data.delayUnit;
        
        saveState();
        io.emit('config-update', { broadcastMessage, delayValue, delayUnit });
    });

    // Manual contact/group synchronization request
    socket.on('sync-contacts-groups', async () => {
        addLog('Menerima permintaan sinkronisasi ulang kontak dan grup dari Web UI...');
        await loadContactsAndGroups(1);
    });

    // Add manual contact request
    socket.on('add-manual-contact', async (data) => {
        const { name, phone } = data;
        if (!name || !name.trim() || !phone || !phone.trim()) {
            socket.emit('error-msg', 'Nama dan nomor WA harus diisi!');
            return;
        }

        addLog(`Memproses penambahan kontak manual: ${name} (${phone})...`);

        try {
            // Clean phone number: remove non-digits
            let cleanedPhone = phone.replace(/\D/g, '');
            // Replace leading 0 with 62 (Indonesia default) or 8 with 628
            if (cleanedPhone.startsWith('0')) {
                cleanedPhone = '62' + cleanedPhone.substring(1);
            } else if (cleanedPhone.startsWith('8')) {
                cleanedPhone = '62' + cleanedPhone;
            }

            if (cleanedPhone.length < 9) {
                socket.emit('error-msg', 'Format nomor WA tidak valid!');
                return;
            }

            let jid = cleanedPhone + '@c.us';
            if (connectionStatus === 'CONNECTED' && client) {
                try {
                    const numberId = await client.getNumberId(cleanedPhone);
                    if (numberId) {
                        jid = numberId._serialized;
                        addLog(`Nomor +${cleanedPhone} terverifikasi terdaftar di WhatsApp.`);
                    } else {
                        addLog(`Peringatan: +${cleanedPhone} tidak dapat diverifikasi otomatis oleh WhatsApp Web. Menggunakan JID fallback: ${jid}`);
                    }
                } catch (e) {
                    addLog(`Peringatan: Gagal memverifikasi nomor +${cleanedPhone} via WhatsApp (${e.message}). Menggunakan JID fallback: ${jid}`);
                }
            } else {
                addLog(`WhatsApp belum terhubung. Menyimpan +${cleanedPhone} dengan JID fallback: ${jid}`);
            }

            // Check if already exists in manualContacts
            if (manualContacts.some(mc => mc.id === jid)) {
                socket.emit('error-msg', 'Kontak manual sudah ada!');
                return;
            }

            // Add to manual contacts list
            const newContact = {
                id: jid,
                name: name.trim(),
                number: cleanedPhone
            };
            manualContacts.push(newContact);

            // Persist to file
            fs.writeFileSync(manualContactsPath, JSON.stringify(manualContacts, null, 2));

            addLog(`Kontak manual berhasil disimpan: ${name} (+${cleanedPhone})`);

            // Reload contact list
            await loadContactsAndGroups(0); // 0 retries, immediate load

        } catch (err) {
            socket.emit('error-msg', `Gagal menambah kontak: ${err.message}`);
        }
    });

    // Add manual group request
    socket.on('add-manual-group', async (data) => {
        const { name, groupId } = data;
        if (!name || !name.trim() || !groupId || !groupId.trim()) {
            socket.emit('error-msg', 'Nama dan ID Grup harus diisi!');
            return;
        }

        let cleanGroupId = groupId.trim();
        if (!cleanGroupId.endsWith('@g.us')) {
            cleanGroupId = cleanGroupId + '@g.us';
        }

        if (manualGroups.some(mg => mg.id === cleanGroupId)) {
            socket.emit('error-msg', 'Grup manual sudah ada!');
            return;
        }

        try {
            const newGroup = {
                id: cleanGroupId,
                name: name.trim()
            };
            manualGroups.push(newGroup);
            
            // Persist to file
            fs.writeFileSync(manualGroupsPath, JSON.stringify(manualGroups, null, 2));
            addLog(`Grup manual berhasil disimpan: ${name} (${cleanGroupId})`);

            // Reload list
            await loadContactsAndGroups(0);

        } catch (err) {
            socket.emit('error-msg', `Gagal menambah grup: ${err.message}`);
        }
    });

    // Delete manual contact request
    socket.on('delete-manual-contact', async (targetId) => {
        try {
            manualContacts = manualContacts.filter(mc => mc.id !== targetId);
            fs.writeFileSync(manualContactsPath, JSON.stringify(manualContacts, null, 2));
            addLog(`Kontak manual dengan ID ${targetId} berhasil dihapus.`);
            
            // Also remove from selected targets if queued
            if (selectedTargets.has(targetId)) {
                selectedTargets.delete(targetId);
                io.emit('targets-list', Array.from(selectedTargets));
            }
            
            await loadContactsAndGroups(0);
        } catch (err) {
            socket.emit('error-msg', `Gagal menghapus kontak: ${err.message}`);
        }
    });

    // Delete manual group request
    socket.on('delete-manual-group', async (targetId) => {
        try {
            manualGroups = manualGroups.filter(mg => mg.id !== targetId);
            fs.writeFileSync(manualGroupsPath, JSON.stringify(manualGroups, null, 2));
            addLog(`Grup manual dengan ID ${targetId} berhasil dihapus.`);
            
            // Also remove from selected targets if queued
            if (selectedTargets.has(targetId)) {
                selectedTargets.delete(targetId);
                io.emit('targets-list', Array.from(selectedTargets));
            }
            
            await loadContactsAndGroups(0);
        } catch (err) {
            socket.emit('error-msg', `Gagal menghapus grup: ${err.message}`);
        }
    });

    // Handle single target toggles
    socket.on('toggle-target', (targetId) => {
        if (selectedTargets.has(targetId)) {
            selectedTargets.delete(targetId);
        } else {
            selectedTargets.add(targetId);
        }
        io.emit('targets-list', Array.from(selectedTargets));
    });

    // Bulk selectors
    socket.on('add-targets-bulk', (targetIds) => {
        targetIds.forEach(id => selectedTargets.add(id));
        io.emit('targets-list', Array.from(selectedTargets));
    });

    socket.on('remove-targets-bulk', (targetIds) => {
        targetIds.forEach(id => selectedTargets.delete(id));
        io.emit('targets-list', Array.from(selectedTargets));
    });

    socket.on('clear-targets', () => {
        selectedTargets.clear();
        io.emit('targets-list', []);
    });

    // Campaign triggers
    socket.on('start-broadcast', () => {
        if (connectionStatus !== 'CONNECTED') {
            socket.emit('error-msg', 'WhatsApp belum terhubung!');
            return;
        }
        if (selectedTargets.size === 0) {
            socket.emit('error-msg', 'Antrean target masih kosong!');
            return;
        }
        if (!broadcastMessage.trim()) {
            socket.emit('error-msg', 'Isi pesan broadcast tidak boleh kosong!');
            return;
        }
        if (broadcastState.status === 'RUNNING') {
            socket.emit('error-msg', 'Proses pengiriman sedang berlangsung.');
            return;
        }

        runBroadcastLoop();
    });

    socket.on('stop-broadcast', () => {
        if (broadcastState.status !== 'RUNNING') return;
        
        broadcastState.status = 'STOPPED';
        broadcastState.currentTarget = null;
        
        saveState();
        
        addLog('Siaran dihentikan oleh pengguna.');
        io.emit('broadcast-status', broadcastState);
    });

    // Log out sessions
    socket.on('logout-wa', async () => {
        addLog('Mencabut sesi WhatsApp...');
        if (client) {
            try {
                broadcastState.status = 'IDLE';
                broadcastState.currentTarget = null;
                saveState();
                
                await client.logout();
                await client.destroy();
            } catch (err) {
                addLog(`Error saat logout: ${err.message}. Memaksa destroy.`);
            }
        }
        
        const authPath = path.join(persistDir, '.wwebjs_auth');
        if (fs.existsSync(authPath)) {
            try {
                fs.rmSync(authPath, { recursive: true, force: true });
                addLog('Folder cache sesi dibersihkan.');
            } catch (err) {
                addLog(`Gagal menghapus folder sesi: ${err.message}`);
            }
        }

        userInfo = null;
        contacts = [];
        groups = [];
        qrCodeBase64 = null;
        updateConnectionStatus('DISCONNECTED');
        
        // Reinitialize client to show new QR
        initWhatsAppClient();
    });
});

// Load persistent state
loadState();

// Load manual contacts and groups into memory
loadContactsAndGroups(0);

// Start Client
initWhatsAppClient();

// Start web server
server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`Scan Web UI running at: http://localhost:${PORT}`);
    console.log(`======================================================\n`);
});
