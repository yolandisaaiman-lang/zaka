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
    console.log(`Fetching latest tenders from: ${url}`);
    try {
        const scrapeResult = await firecrawl.scrapeUrl(url, {
            formats: ['extract'],
            extract: {
                prompt: "Extract a list of the latest tenders. Ensure you get the title, the direct link to the PDF, and the upload date (or closing date if upload date is not present). Only include tenders from the last 24-48 hours if dates are specified. If dates are not clear, extract them anyway.",
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
                                    upload_date: { type: "string" }
                                },
                                required: ["title", "pdf_link"]
                            }
                        }
                    },
                    required: ["tenders"]
                }
            }
        });
        
        if (scrapeResult.success) {
            return JSON.stringify(scrapeResult.extract.tenders || []);
        } else {
            console.error('Firecrawl scrape failed:', scrapeResult.error);
            return JSON.stringify({ error: scrapeResult.error });
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
