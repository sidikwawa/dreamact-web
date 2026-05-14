const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    // Intercept requests
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = request.url();
        if (url.includes('login') || url.includes('auth')) {
            console.log('\n--- API REQUEST ---');
            console.log('URL:', url);
            console.log('Method:', request.method());
            console.log('Headers:', request.headers());
            console.log('Post Data:', request.postData());
        }
        request.continue();
    });

    page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('login') || url.includes('auth')) {
            try {
                const text = await response.text();
                console.log('\n--- API RESPONSE ---');
                console.log('URL:', url);
                console.log('Body:', text.substring(0, 500));
            } catch (e) {}
        }
    });

    await page.goto('https://www.dreamfaceapp.com/avatar', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));
    
    // Click the login inputs and type
    // The inputs are usually placeholders like "Email" and "Password"
    try {
        await page.type('input[type="text"]', 'uqpdyule@guerrillamailblock.com');
        await page.type('input[type="password"]', 'trvgkDRbUK!7');
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 4000));
        
        const token = await page.evaluate(() => localStorage.getItem('weblogConfig'));
        console.log('\nTOKEN FROM STORAGE:', token);
    } catch (e) {
        console.log('Error typing:', e.message);
    }

    await browser.close();
})();
