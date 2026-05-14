/**
 * puppeteer-worker.js
 * Browser automation worker untuk DreamFace.
 * Menyamar sebagai manusia untuk menembus antrean Web tanpa terkena "Service Busy".
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// --- KONFIGURASI ---
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.txt');
let accounts = [];
let currentAccountIndex = 0;

function loadAccounts() {
    try {
        if (!fs.existsSync(ACCOUNTS_FILE)) {
            console.warn('[BOT] File accounts.txt tidak ditemukan. Buat file dengan format:\nEmail: ...\nPassword: ...');
            return;
        }
        const data = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
        const blocks = data.split(/\n\s*\n/); // Split by blank lines
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

// Sleep helper
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Main function: Login dan submit DreamAct job via browser automation
 * @param {string} videoPath - absolute path to local video file
 * @param {string} imagePath - absolute path to local image file
 * @returns {string} - URL hasil video yang sudah jadi
 */
async function runDreamActBot(videoPath, imagePath) {
    loadAccounts();
    const account = getNextAccount();

    if (!account) {
        throw new Error('Tidak ada akun tersedia di accounts.txt');
    }

    console.log(`[BOT] Menggunakan akun: ${account.email}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    try {
        // =====================
        // STEP 1: Login
        // =====================
        console.log('[BOT] Membuka halaman login...');
        await page.goto('https://www.dreamfaceapp.com/apps/dreamact', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(2000);

        // Cek apakah sudah ada form login (kolom input email/password)
        const hasLoginForm = await page.evaluate(() => {
            const inputs = document.querySelectorAll('input');
            return inputs.length >= 2;
        });

        if (hasLoginForm) {
            console.log('[BOT] Form login ditemukan, mengisi kredensial...');
            const inputs = await page.$$('input');
            await inputs[0].click({ clickCount: 3 });
            await inputs[0].type(account.email, { delay: 50 });
            await inputs[1].click({ clickCount: 3 });
            await inputs[1].type(account.password, { delay: 50 });
            await sleep(500);
            await page.keyboard.press('Enter');
            await sleep(3000);
        }

        // Verifikasi login berhasil
        const isLoggedIn = await page.evaluate(() => {
            const cfg = localStorage.getItem('weblogConfig');
            return cfg !== null && cfg.includes('token');
        });

        if (!isLoggedIn) {
            throw new Error(`Login gagal untuk akun ${account.email}`);
        }
        console.log('[BOT] Login berhasil!');

        // =====================
        // STEP 2: Navigasi ke DreamAct
        // =====================
        console.log('[BOT] Navigasi ke halaman DreamAct...');
        await page.goto('https://www.dreamfaceapp.com/apps/dreamact', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(3000);

        // =====================
        // STEP 3: Upload Video Referensi
        // =====================
        console.log('[BOT] Mengupload video referensi...');
        // File input biasanya tersembunyi, kita trigger langsung
        const videoInputSelector = await page.evaluate(() => {
            const inputs = document.querySelectorAll('input[type="file"]');
            // Cari input yang menerima video
            for (let i = 0; i < inputs.length; i++) {
                const accept = inputs[i].accept || '';
                if (accept.includes('video') || accept === '') {
                    return i; // Return index
                }
            }
            return 0;
        });

        const fileInputs = await page.$$('input[type="file"]');
        
        if (fileInputs.length === 0) {
            throw new Error('Tidak ada input file ditemukan di halaman');
        }

        // Upload video ke input pertama
        await fileInputs[0].uploadFile(videoPath);
        console.log('[BOT] Video berhasil dimasukkan ke input');
        await sleep(3000);

        // Upload image ke input kedua (jika ada), atau input setelah select video
        const fileInputsAfter = await page.$$('input[type="file"]');
        if (fileInputsAfter.length >= 2) {
            await fileInputsAfter[1].uploadFile(imagePath);
            console.log('[BOT] Gambar berhasil dimasukkan ke input');
            await sleep(3000);
        } else {
            // Coba klik area image upload, lalu handle file chooser
            console.log('[BOT] Mencari area upload gambar...');
            const [fileChooser] = await Promise.all([
                page.waitForFileChooser({ timeout: 5000 }).catch(() => null),
                page.evaluate(() => {
                    // Cari elemen yang bertuliskan "Character Image" atau "image"
                    const divs = [...document.querySelectorAll('div, span, label, button')];
                    const target = divs.find(el => el.innerText && el.innerText.toLowerCase().includes('character'));
                    if (target) target.click();
                })
            ]);

            if (fileChooser) {
                await fileChooser.accept([imagePath]);
                console.log('[BOT] Gambar berhasil diupload via file chooser');
                await sleep(3000);
            }
        }

        // =====================
        // STEP 4: Pilih "Add Motion to Photo"
        // =====================
        console.log('[BOT] Memilih mode "Add Motion to Photo"...');
        await page.evaluate(() => {
            const allEls = [...document.querySelectorAll('*')];
            const motionEl = allEls.find(el => el.innerText && el.innerText.includes('Add Motion to Photo'));
            if (motionEl) motionEl.click();
        });
        await sleep(1000);

        // =====================
        // STEP 5: Klik tombol Create/Generate
        // =====================
        console.log('[BOT] Menekan tombol Create...');
        const clicked = await page.evaluate(() => {
            const buttons = [...document.querySelectorAll('button')];
            const createBtn = buttons.find(b => {
                const text = b.innerText.toLowerCase();
                return text.includes('create') || text.includes('generate') || text.includes('1 create');
            });
            if (createBtn) {
                createBtn.click();
                return true;
            }
            return false;
        });

        if (!clicked) {
            throw new Error('Tombol Create tidak ditemukan!');
        }
        console.log('[BOT] Tombol Create berhasil diklik!');
        await sleep(3000);

        // =====================
        // STEP 6: Polling hasil dari halaman /creation
        // =====================
        console.log('[BOT] Menunggu hasil dari halaman creation...');
        await page.goto('https://www.dreamfaceapp.com/creation', { waitUntil: 'networkidle2', timeout: 30000 });

        const maxWait = 120; // 120 * 5 detik = 10 menit
        let videoUrl = null;

        for (let i = 0; i < maxWait; i++) {
            console.log(`[BOT] Polling hasil... (${i + 1}/${maxWait})`);
            await sleep(5000);
            await page.reload({ waitUntil: 'networkidle2' });

            videoUrl = await page.evaluate(() => {
                // Cari elemen video atau link download di halaman creation
                const videos = document.querySelectorAll('video source, video');
                for (let v of videos) {
                    const src = v.src || v.getAttribute('src');
                    if (src && src.includes('http')) return src;
                }
                // Cari link download
                const links = document.querySelectorAll('a[download], a[href*=".mp4"]');
                for (let l of links) {
                    if (l.href) return l.href;
                }
                return null;
            });

            if (videoUrl) {
                console.log(`[BOT] Video hasil ditemukan: ${videoUrl}`);
                break;
            }

            // Cek apakah masih dalam status "Queuing"
            const status = await page.evaluate(() => {
                const body = document.body.innerText;
                if (body.includes('Queuing')) return 'queuing';
                if (body.includes('Processing')) return 'processing';
                if (body.includes('Failed')) return 'failed';
                return 'unknown';
            });
            console.log(`[BOT] Status: ${status}`);

            if (status === 'failed') {
                throw new Error('Task gagal di server DreamFace');
            }
        }

        if (!videoUrl) {
            throw new Error('Timeout: Video tidak selesai dalam 10 menit');
        }

        return videoUrl;

    } finally {
        await browser.close();
    }
}

module.exports = { runDreamActBot, loadAccounts };
