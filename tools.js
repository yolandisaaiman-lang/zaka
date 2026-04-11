import axios from 'axios';
import https from 'https';
import { createRequire } from 'module';
import TelegramBot from 'node-telegram-bot-api';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

export async function fetch_latest_tenders() {
    const url = process.env.TARGET_URL;
    console.log(`Fetching latest tenders via API from: ${url}`);
    try {
        const response = await axios.get(url);
        const responseData = response.data;

        // Handle both a direct array response and an object with a `data` property
        const tenders = Array.isArray(responseData) ? responseData : (responseData.data || []);

        const allTenders = tenders.map(tender => {
            const pdfDoc = (tender.supportDocument || []).find(doc => doc.extension === '.pdf');
            const pdf_link = pdfDoc
                ? `https://www.etenders.gov.za/Home/DownloadDocument?id=${pdfDoc.supportDocumentID}`
                : null;

            return {
                title: tender.description,
                pdf_link,
                upload_date: tender.date_Published
            };
        });

        console.log(`API fetch complete. Found ${allTenders.length} tenders.`);
        return JSON.stringify(allTenders);
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
