const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    // Log interceptor to find login endpoint
    page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('login') || url.includes('auth')) {
            console.log('API URL:', url);
        }
    });

    await page.goto('https://www.dreamfaceapp.com/avatar'); // Avatar page usually has the login right there
    await new Promise(r => setTimeout(r, 2000));
    
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
        await inputs[0].type('uqpdyule@guerrillamailblock.com');
        await inputs[1].type('trvgkDRbUK!7');
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 4000));
        const token = await page.evaluate(() => localStorage.getItem('weblogConfig'));
        console.log('TOKEN FROM STORAGE:', token);
    } else {
        console.log('Could not find login inputs');
    }

    await browser.close();
})();
