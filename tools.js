import axios from 'axios';
import https from 'https';
import { createRequire } from 'module';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import TelegramBot from 'node-telegram-bot-api';
import OpenAI from 'openai';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── SKILL 1: Fetch tender list from eTenders JSON API ───────────────────────
export async function fetch_latest_tenders({ url }) {
    console.log(`Fetching latest tenders from eTenders API: ${url}`);
    try {
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        // The eTenders API returns a DataTables-style response with a "data" array
        const rawData = response.data;
        const tenders = Array.isArray(rawData) ? rawData : (rawData.data || []);

        console.log(`Received ${tenders.length} tenders from API.`);

        const results = [];

        for (const tender of tenders) {
            // Find the .pdf support document
            const supportDocs = tender.supportDocument || [];
            const pdfDoc = supportDocs.find(doc => doc.extension === '.pdf');

            if (!pdfDoc) {
                console.log(`Skipping tender "${tender.description}" — no PDF attachment found.`);
                continue;
            }

            const pdfLink = `https://www.etenders.gov.za/Home/DownloadDocument?id=${pdfDoc.supportDocumentID}`;

            results.push({
                title: tender.description,
                category: tender.category || 'Unknown',
                pdf_link: pdfLink,
                upload_date: tender.date_Published
            });
        }

        console.log(`Found ${results.length} tenders with PDF documents.`);
        return JSON.stringify(results);
    } catch (error) {
        console.error('Error fetching latest tenders:', error.message);
        return JSON.stringify({ error: error.message });
    }
}

// ─── SKILL 2: Pre-filter tender using JSON metadata (cheap LLM check) ───────
export async function pre_filter_tender_json({ description, category, client_keywords }) {
    console.log(`Pre-filtering tender: "${description}" | Category: "${category}"`);
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are a tender classification assistant. You respond with ONLY the word "true" or "false". No other text.'
                },
                {
                    role: 'user',
                    content: `Does this South African government tender remotely relate to a contractor specializing in these areas?

Tender Title: "${description}"
Tender Category: "${category}"

Contractor Keywords: [${client_keywords}]

Consider broadly — if the tender involves any civil works, construction, infrastructure, or earthmoving that a civil engineering contractor could bid on, answer "true". Only answer "false" if it is completely unrelated (e.g., IT services, catering, stationery, consulting with no construction component).`
                }
            ],
            max_tokens: 5,
            temperature: 0
        });

        const answer = response.choices[0].message.content.trim().toLowerCase();
        const isRelevant = answer === 'true';
        console.log(`  → Pre-filter result for "${description}": ${isRelevant ? '✅ RELEVANT' : '❌ SKIP'}`);
        return JSON.stringify({ relevant: isRelevant });
    } catch (error) {
        console.error('Error in pre-filter LLM call:', error.message);
        // On error, default to relevant so we don't miss tenders
        return JSON.stringify({ relevant: true });
    }
}

// ─── SKILL 3: Secure PDF download with session cookies + Playwright fallback ─
export async function download_secure_etender_pdf({ pdf_url }) {
    console.log(`Attempting secure PDF download: ${pdf_url}`);

    const PORTAL_HOME = 'https://www.etenders.gov.za/';
    const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    // ── Method 1: Session-aware cookie jar download ──
    try {
        console.log('  Method 1: Cookie jar session download...');
        const jar = new CookieJar();
        const client = wrapper(axios.create({
            jar,
            httpsAgent: new https.Agent({ rejectUnauthorized: false })
        }));

        // Step A: Hit the portal homepage to establish ASP.NET session
        await client.get(PORTAL_HOME, {
            headers: {
                'User-Agent': BROWSER_UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br'
            }
        });
        console.log('  Session established via homepage.');

        // Step B: Download the PDF using the established session cookies
        const pdfResponse = await client.get(pdf_url, {
            responseType: 'arraybuffer',
            maxRedirects: 5,
            headers: {
                'User-Agent': BROWSER_UA,
                'Accept': 'application/pdf,application/octet-stream,*/*',
                'Referer': PORTAL_HOME,
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        const buffer = Buffer.from(pdfResponse.data);

        // Validate we actually got a PDF (check magic bytes %PDF)
        if (buffer.length < 100 || !buffer.subarray(0, 5).toString().startsWith('%PDF')) {
            const snippet = buffer.subarray(0, 200).toString();
            console.log(`  Cookie method returned non-PDF content (${buffer.length} bytes). Snippet: ${snippet.substring(0, 100)}`);
            throw new Error('Response is not a valid PDF — likely an HTML error page.');
        }

        // Step C: Parse the PDF buffer
        console.log(`  PDF downloaded successfully (${buffer.length} bytes). Parsing...`);
        const data = await pdfParse(buffer);
        const text = data.text.substring(0, 30000);
        console.log(`  Extracted ${text.length} characters of text.`);
        return JSON.stringify({ text });

    } catch (cookieError) {
        console.warn(`  Cookie method failed: ${cookieError.message}`);
    }

    // ── Method 2: Playwright headless browser fallback ──
    try {
        console.log('  Method 2: Playwright headless browser fallback...');
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext({
            userAgent: BROWSER_UA,
            acceptDownloads: true
        });
        const page = await context.newPage();

        // Navigate to homepage first to get session cookies
        await page.goto(PORTAL_HOME, { waitUntil: 'networkidle', timeout: 30000 });
        console.log('  Playwright: Session established via homepage.');

        // Navigate directly to the PDF download URL and capture the response
        const response = await page.goto(pdf_url, { waitUntil: 'commit', timeout: 30000 });

        if (!response) {
            throw new Error('Playwright: No response received from download URL.');
        }

        const contentType = response.headers()['content-type'] || '';
        const bodyBuffer = await response.body();

        await browser.close();

        // Validate it's a PDF
        if (bodyBuffer.length < 100 || !bodyBuffer.subarray(0, 5).toString().startsWith('%PDF')) {
            const snippet = bodyBuffer.subarray(0, 200).toString();
            throw new Error(`Playwright: Response is not a PDF (${contentType}). Snippet: ${snippet.substring(0, 100)}`);
        }

        console.log(`  Playwright: PDF downloaded (${bodyBuffer.length} bytes). Parsing...`);
        const data = await pdfParse(bodyBuffer);
        const text = data.text.substring(0, 30000);
        console.log(`  Extracted ${text.length} characters of text.`);
        return JSON.stringify({ text });

    } catch (playwrightError) {
        console.error(`  Playwright fallback failed: ${playwrightError.message}`);
        return JSON.stringify({ error: `All download methods failed. Cookie: session blocked. Playwright: ${playwrightError.message}` });
    }
}

// ─── SKILL 4: Send formatted alert to Telegram ──────────────────────────────
export async function send_telegram_alert({ formatted_message }) {
    console.log(`Sending Telegram alert...`);
    try {
        await telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, formatted_message, { parse_mode: 'Markdown' });
        return JSON.stringify({ success: true });
    } catch (error) {
        console.error('Error sending Telegram alert:', error.message);
        return JSON.stringify({ success: false, error: error.message });
    }
}
