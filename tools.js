import axios from 'axios';
import https from 'https';
import { createRequire } from 'module';
import TelegramBot from 'node-telegram-bot-api';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

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
