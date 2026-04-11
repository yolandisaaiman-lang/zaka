import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import TelegramBot from 'node-telegram-bot-api';

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Fetch tender list from eTenders JSON API ────────────────────────────────
export async function fetch_latest_tenders(url) {
    console.log(`Fetching tenders from eTenders API...`);
    try {
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const rawData = response.data;
        const tenders = Array.isArray(rawData) ? rawData : (rawData.data || []);

        console.log(`✔ Received ${tenders.length} tenders from API.`);
        return tenders;
    } catch (error) {
        console.error('✘ Error fetching tenders:', error.message);
        return [];
    }
}

// ─── Evaluate a single tender with Gemini (filter + format in one call) ──────
export async function evaluate_tender_with_gemini(tenderObject) {
    const clientKeywords = process.env.CLIENT_KEYWORDS;
    const tenderJsonData = JSON.stringify(tenderObject);

    const zakaPrompt = `
You are Zaka AI. Your job is to evaluate government tender metadata and format it for a client.

**STEP 1: FILTER**
Evaluate the following JSON tender data against these client keywords: [${clientKeywords}].
Look primarily at the "description" and "category" fields.
If this tender is NOT a strong match for the keywords, you must return exactly and only the word: "REJECT". Do not output anything else.

**STEP 2: FORMATTING**
If it IS a match, extract the data from the JSON and format it EXACTLY like this for Telegram. Use these exact labels and emojis. If a field is null or missing, write "Not Provided".

🚨 **ZAKA AI - NEW TENDER MATCH** 🚨

**Tender Number:** [Extract from tender_No]
**Organ of State:** [Extract from organ_of_State]
**Tender Type:** [Extract from type]
**Province:** [Extract from province]
**Date Published:** [Extract from date_Published (Format to YYYY/MM/DD)]
**Closing Date:** [Extract from closing_Date (Format to YYYY/MM/DD HH:MM)]

📍 **Location Details:**
**Place Required:** [Extract from delivery or combine streetname, town, code]

👤 **Contact Details:**
**Contact Person:** [Extract from contactPerson]
**Email:** [Extract from email]
**Telephone:** [Extract from telephone]

📅 **Briefing Session:**
**Is there a briefing?:** [Extract from briefingSession (Yes/No)]
**Is it compulsory?:** [Extract from briefingCompulsory (Yes/No)]
**Briefing Date/Time:** [Extract from compulsory_briefing_session]
**Briefing Venue:** [Extract from briefingVenue]

--
⚡ *Scouted by Zaka AI*

Here is the tender JSON data to evaluate:
${tenderJsonData}
`;

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent(zakaPrompt);
        const text = result.response.text().trim();
        return text;
    } catch (error) {
        console.error('✘ Gemini evaluation error:', error.message);
        return 'REJECT';
    }
}

// ─── Send formatted alert to Telegram ────────────────────────────────────────
export async function send_telegram_alert(message) {
    console.log(`Sending Telegram alert...`);
    try {
        await telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
        console.log('✔ Telegram alert sent.');
        return true;
    } catch (error) {
        console.error('✘ Telegram send error:', error.message);
        return false;
    }
}
