const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log('[DEBUG] Navigating to DreamAct page...');
    await page.goto('https://www.dreamfaceapp.com/apps/dreamact', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // Check if login form is visible
    const hasLoginForm = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input');
        return inputs.length >= 2;
    });

    console.log('[DEBUG] Has login form:', hasLoginForm);

    if (hasLoginForm) {
        console.log('[DEBUG] Logging in...');
        try {
            await page.type('input[type="text"]', 'uqpdyule@guerrillamailblock.com', { delay: 50 });
            await page.type('input[type="password"]', 'trvgkDRbUK!7', { delay: 50 });
            await page.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 4000));
        } catch(e) {
            console.log('[DEBUG] Login input error:', e.message);
            // Try with generic input selector
            const inputs = await page.$$('input');
            if (inputs.length >= 2) {
                await inputs[0].type('uqpdyule@guerrillamailblock.com', { delay: 50 });
                await inputs[1].type('trvgkDRbUK!7', { delay: 50 });
                await page.keyboard.press('Enter');
                await new Promise(r => setTimeout(r, 4000));
            }
        }
    }

    console.log('[DEBUG] Current URL:', page.url());

    // Get all interactive elements
    const report = await page.evaluate(() => {
        const result = {};

        // All input[type=file]
        const fileInputs = [...document.querySelectorAll('input[type="file"]')];
        result.fileInputs = fileInputs.map((el, i) => ({
            index: i,
            accept: el.accept,
            id: el.id,
            name: el.name,
            className: el.className,
            parentHTML: el.parentElement ? el.parentElement.outerHTML.substring(0, 300) : null
        }));

        // All buttons
        const buttons = [...document.querySelectorAll('button')];
        result.buttons = buttons.map((el, i) => ({
            index: i,
            text: el.innerText.trim().substring(0, 80),
            id: el.id,
            className: el.className.substring(0, 100),
            disabled: el.disabled
        }));

        // All clickable divs/spans that might trigger file upload
        const clickableEls = [...document.querySelectorAll('[onclick], [class*="upload"], [class*="Upload"], [class*="drop"]')];
        result.uploadTriggers = clickableEls.map(el => ({
            tag: el.tagName,
            text: el.innerText ? el.innerText.trim().substring(0, 80) : '',
            className: el.className.substring(0, 100)
        }));

        // Check for "Add Motion to Photo" text
        const allText = document.body.innerText;
        result.hasMotionToPhoto = allText.includes('Add Motion to Photo');
        result.hasSwapAvatar = allText.includes('Swap Avatar');
        result.hasCreateBtn = allText.includes('Create');

        // Page title
        result.title = document.title;
        result.url = window.location.href;

        return result;
    });

    console.log('\n=== PAGE REPORT ===');
    console.log('URL:', report.url);
    console.log('Title:', report.title);
    console.log('Has "Add Motion to Photo":', report.hasMotionToPhoto);
    console.log('Has "Swap Avatar":', report.hasSwapAvatar);
    console.log('Has "Create" button:', report.hasCreateBtn);

    console.log('\n--- FILE INPUTS ---');
    console.log(JSON.stringify(report.fileInputs, null, 2));

    console.log('\n--- BUTTONS ---');
    report.buttons.forEach(b => {
        if (b.text) console.log(`Button[${b.index}]: "${b.text}" | class: ${b.className.substring(0,50)}`);
    });

    console.log('\n--- UPLOAD TRIGGERS ---');
    report.uploadTriggers.forEach(t => {
        if (t.text) console.log(`${t.tag}: "${t.text}" | class: ${t.className.substring(0,60)}`);
    });

    // Take screenshot
    fs.mkdirSync('screenshots', { recursive: true });
    await page.screenshot({ path: 'screenshots/dreamact_debug.png', fullPage: true });
    console.log('\n[DEBUG] Screenshot saved: screenshots/dreamact_debug.png');

    await browser.close();
})();
