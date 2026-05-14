/**
 * puppeteer-worker.js
 * Browser automation worker untuk DreamFace - Anti "Service Busy"
 * Selector verified dari DOM inspection langsung.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// ============================
// LOAD ACCOUNTS
// ============================
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.txt');
let accounts = [];
let currentAccountIndex = 0;

function loadAccounts() {
    try {
        if (!fs.existsSync(ACCOUNTS_FILE)) {
            console.warn('[BOT] accounts.txt tidak ditemukan!');
            return;
        }
        const data = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
        const blocks = data.split(/\n{2,}|\r\n{2,}/);
        const parsed = [];
        for (const block of blocks) {
            const emailMatch = block.match(/Email\s*:\s*(.+)/i);
            const passMatch = block.match(/Password\s*:\s*(.+)/i);
            if (emailMatch && passMatch) {
                parsed.push({
                    email: emailMatch[1].trim(),
                    password: passMatch[1].trim()
                });
            }
        }
        accounts = parsed;
        console.log(`[BOT] Loaded ${accounts.length} akun dari accounts.txt`);
    } catch (e) {
        console.error('[BOT] Error loading accounts:', e.message);
    }
}

function getNextAccount() {
    if (accounts.length === 0) return null;
    const acc = accounts[currentAccountIndex];
    currentAccountIndex = (currentAccountIndex + 1) % accounts.length;
    return acc;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================
// LOGIN HELPER
// ============================
async function doLogin(page, email, password) {
    console.log(`[BOT] Mengisi form login untuk: ${email}`);

    // Tunggu input muncul (bisa di modal atau inline)
    await page.waitForSelector('input', { timeout: 10000 });
    await sleep(500);

    const inputs = await page.$$('input');
    if (inputs.length < 2) throw new Error('Form login tidak ditemukan (< 2 input)');

    // Clear & isi email (input pertama)
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(email, { delay: 60 });

    // Clear & isi password (input kedua)
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type(password, { delay: 60 });

    await sleep(400);
    await page.keyboard.press('Enter');
    await sleep(4000);

    // Verifikasi login berhasil
    const isLoggedIn = await page.evaluate(() => {
        const cfg = localStorage.getItem('weblogConfig');
        return cfg !== null && (cfg.includes('token') || cfg.includes('user_id'));
    });

    return isLoggedIn;
}

// ============================
// POLL HALAMAN CREATION
// ============================
async function pollCreationPage(page, maxMinutes = 10) {
    const maxAttempts = maxMinutes * 12; // setiap 5 detik
    console.log(`[BOT] Polling halaman creation (max ${maxMinutes} menit)...`);
    await page.goto('https://www.dreamfaceapp.com/creation', { waitUntil: 'networkidle2', timeout: 30000 });

    for (let i = 0; i < maxAttempts; i++) {
        await sleep(5000);
        console.log(`[BOT] Polling attempt ${i + 1}/${maxAttempts}...`);

        try {
            await page.reload({ waitUntil: 'networkidle2', timeout: 20000 });
        } catch(e) { /* reload timeout, lanjutkan */ }

        const result = await page.evaluate(() => {
            // Cari video element yang sudah jadi
            const videos = document.querySelectorAll('video');
            for (const v of videos) {
                if (v.src && v.src.startsWith('http')) return { type: 'video', url: v.src };
                const source = v.querySelector('source');
                if (source && source.src) return { type: 'video', url: source.src };
            }

            // Cari link download .mp4
            const links = document.querySelectorAll('a[href*=".mp4"], a[download]');
            for (const l of links) {
                if (l.href && l.href.includes('http')) return { type: 'link', url: l.href };
            }

            // Cek teks status
            const bodyText = document.body.innerText;
            if (bodyText.includes('Failed')) return { type: 'failed' };
            if (bodyText.includes('Queuing')) {
                const match = bodyText.match(/(\d+)\s*tasks?\s*ahead/i);
                return { type: 'queuing', ahead: match ? match[1] : '?' };
            }
            if (bodyText.includes('Processing') || bodyText.includes('Rendering')) {
                return { type: 'processing' };
            }

            return { type: 'unknown' };
        });

        console.log(`[BOT] Status: ${result.type}${result.ahead ? ` (${result.ahead} ahead)` : ''}${result.url ? ` - ${result.url}` : ''}`);

        if (result.type === 'video' || result.type === 'link') {
            return result.url;
        }
        if (result.type === 'failed') {
            throw new Error('Task gagal di server DreamFace');
        }
    }

    throw new Error(`Timeout: Video tidak selesai dalam ${maxMinutes} menit`);
}

// ============================
// MAIN BOT FUNCTION
// ============================
async function runDreamActBot(videoPath, imagePath) {
    loadAccounts();
    const account = getNextAccount();

    if (!account) {
        throw new Error('Tidak ada akun tersedia di accounts.txt');
    }

    console.log(`\n[BOT] ===== MULAI =====`);
    console.log(`[BOT] Akun: ${account.email}`);
    console.log(`[BOT] Video: ${path.basename(videoPath)}`);
    console.log(`[BOT] Gambar: ${path.basename(imagePath)}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,800'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    try {
        // =====================
        // STEP 1: Buka halaman DreamAct
        // =====================
        console.log('\n[BOT] STEP 1: Membuka halaman DreamAct...');
        await page.goto('https://www.dreamfaceapp.com/apps/dreamact', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        await sleep(2000);

        // =====================
        // STEP 2: Cek & Login jika perlu
        // =====================
        const needLogin = await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button')];
            return btns.some(b => b.innerText.includes('Log in') || b.innerText.includes('Sign up'));
        });

        if (needLogin) {
            console.log('\n[BOT] STEP 2: Login diperlukan...');
            // Klik tombol "Log in / Sign up" di header
            await page.evaluate(() => {
                const btns = [...document.querySelectorAll('button')];
                const loginBtn = btns.find(b => b.innerText.includes('Log in') || b.innerText.includes('Sign up'));
                if (loginBtn) loginBtn.click();
            });
            await sleep(2000);

            const loginOk = await doLogin(page, account.email, account.password);
            if (!loginOk) {
                throw new Error(`Login gagal untuk akun ${account.email}`);
            }
            console.log('[BOT] Login berhasil!');

            // Kembali ke halaman DreamAct setelah login
            await page.goto('https://www.dreamfaceapp.com/apps/dreamact', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            await sleep(2000);
        } else {
            console.log('\n[BOT] STEP 2: Sudah login (session tersimpan).');
        }

        // =====================
        // STEP 3: Pilih "Add Motion to Photo"
        // =====================
        console.log('\n[BOT] STEP 3: Memilih mode "Add Motion to Photo"...');
        const motionClicked = await page.evaluate(() => {
            const allEls = [...document.querySelectorAll('*')];
            const motionEl = allEls.find(el =>
                el.children.length === 0 &&
                el.innerText &&
                el.innerText.trim().includes('Add Motion to Photo')
            );
            if (motionEl) {
                motionEl.click();
                return true;
            }
            return false;
        });

        if (motionClicked) {
            console.log('[BOT] Mode "Add Motion to Photo" dipilih!');
        } else {
            console.log('[BOT] Tombol "Add Motion to Photo" tidak ditemukan, lanjut dengan default...');
        }
        await sleep(1000);

        // =====================
        // STEP 4: Upload Video Referensi
        // =====================
        console.log('\n[BOT] STEP 4: Mengupload video referensi...');

        // Selector verified: input[accept=".mp4,.webm"] dengan class _file_input_rym3v_10
        await page.waitForSelector('input[accept=".mp4,.webm"]', { timeout: 10000 });
        const videoInput = await page.$('input[accept=".mp4,.webm"]');

        if (!videoInput) throw new Error('Input file video tidak ditemukan!');

        await videoInput.uploadFile(videoPath);
        console.log('[BOT] Video berhasil diunggah!');
        await sleep(3000);

        // =====================
        // STEP 5: Upload Gambar Karakter
        // =====================
        console.log('\n[BOT] STEP 5: Mengupload gambar karakter...');

        // Selector verified: input[accept=".png,.jpeg,.jpg"] dengan class _file_input_rym3v_10
        await page.waitForSelector('input[accept=".png,.jpeg,.jpg"]', { timeout: 10000 });
        const imageInput = await page.$('input[accept=".png,.jpeg,.jpg"]');

        if (!imageInput) throw new Error('Input file gambar tidak ditemukan!');

        await imageInput.uploadFile(imagePath);
        console.log('[BOT] Gambar berhasil diunggah!');
        await sleep(3000);

        // =====================
        // STEP 6: Klik tombol Create
        // =====================
        console.log('\n[BOT] STEP 6: Menekan tombol Create...');

        // Selector verified: button._createButton_8o7vb_40
        // Fallback: cari button dengan teks "Create"
        const createClicked = await page.evaluate(() => {
            // Coba selector spesifik dulu
            let btn = document.querySelector('button._createButton_8o7vb_40');
            if (!btn) {
                // Fallback: cari by text
                const allBtns = [...document.querySelectorAll('button')];
                btn = allBtns.find(b => b.innerText.toLowerCase().includes('create'));
            }
            if (btn && !btn.disabled) {
                btn.click();
                return true;
            }
            return false;
        });

        if (!createClicked) throw new Error('Tombol Create tidak ditemukan atau disabled!');
        console.log('[BOT] Tombol Create berhasil diklik!');
        await sleep(3000);

        // Cek apakah muncul login modal setelah klik Create
        const loginModalAppeared = await page.evaluate(() => {
            const inputs = document.querySelectorAll('input');
            return inputs.length >= 2;
        });

        if (loginModalAppeared && needLogin === false) {
            console.log('[BOT] Modal login muncul setelah Create, melakukan login...');
            const loginOk = await doLogin(page, account.email, account.password);
            if (!loginOk) throw new Error('Login modal gagal untuk ' + account.email);
            console.log('[BOT] Login modal berhasil!');
            await sleep(2000);

            // Klik Create lagi setelah login
            await page.evaluate(() => {
                let btn = document.querySelector('button._createButton_8o7vb_40');
                if (!btn) {
                    const allBtns = [...document.querySelectorAll('button')];
                    btn = allBtns.find(b => b.innerText.toLowerCase().includes('create'));
                }
                if (btn) btn.click();
            });
            await sleep(3000);
        }

        // =====================
        // STEP 7: Poll halaman /creation untuk hasil
        // =====================
        console.log('\n[BOT] STEP 7: Menunggu hasil video...');
        const resultUrl = await pollCreationPage(page, 10);

        console.log(`\n[BOT] ===== SELESAI =====`);
        console.log(`[BOT] URL Video: ${resultUrl}`);

        return resultUrl;

    } finally {
        await browser.close();
        console.log('[BOT] Browser ditutup.');
    }
}

module.exports = { runDreamActBot, loadAccounts };
