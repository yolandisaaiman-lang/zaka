import FirecrawlApp from '@mendable/firecrawl-js';
import axios from 'axios';
import https from 'https';
import { createRequire } from 'module';
import TelegramBot from 'node-telegram-bot-api';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

export async function fetch_latest_tenders({ url }) {
    console.log(`Fetching latest tenders via crawl from: ${url}`);
    try {
        const crawlResult = await firecrawl.crawlUrl(url, {
            limit: 50,
            scrapeOptions: {
                formats: ['extract'],
                actions: [
                    { type: 'wait', milliseconds: 2000 },
                    { type: 'click', selector: 'table a' },
                    { type: 'wait', milliseconds: 2000 }
                ],
                extract: {
                    prompt: "Extract tender details from this page. Look for the tender title, any direct PDF download links (href ending in .pdf or containing 'download'), the upload date or publication date, and the closing date. Return all tenders found on the page.",
                    schema: {
                        type: "object",
                        properties: {
                            tenders: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        title: { type: "string" },
                                        pdf_link: { type: "string" },
                                        upload_date: { type: "string" },
                                        closing_date: { type: "string" }
                                    },
                                    required: ["title"]
                                }
                            }
                        },
                        required: ["tenders"]
                    }
                }
            },
            allowBackwardLinks: false,
            allowExternalLinks: false
        });

        if (crawlResult.success) {
            // Aggregate tenders from all crawled pages, deduplicating by title
            const seen = new Set();
            const allTenders = [];

            for (const page of crawlResult.data || []) {
                const pageTenders = page.extract?.tenders || [];
                for (const tender of pageTenders) {
                    if (tender.title && !seen.has(tender.title)) {
                        seen.add(tender.title);
                        allTenders.push(tender);
                    }
                }
            }

            console.log(`Crawl complete. Found ${allTenders.length} unique tenders across ${(crawlResult.data || []).length} pages.`);
            return JSON.stringify(allTenders);
        } else {
            console.error('Firecrawl crawl failed:', crawlResult.error);
            return JSON.stringify({ error: crawlResult.error });
        }
    } catch (error) {
        console.error('Error fetching latest tenders:', error.message);
        return JSON.stringify({ error: error.message });
    }
}

export async function extract_tender_text({ pdf_url }) {
    console.log(`Extracting text from PDF: ${pdf_url}`);
    try {
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        const response = await axios.get(pdf_url, { 
            responseType: 'arraybuffer',
            httpsAgent: httpsAgent
        });
        const data = await pdfParse(response.data);
        // Truncate to ~30k characters to save context window and tokens
        return JSON.stringify({ text: data.text.substring(0, 30000) });
    } catch (error) {
        console.error('Error extracting PDF text:', error.message);
        return JSON.stringify({ error: error.message });
    }
}

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
