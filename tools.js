import { OpenAI } from 'openai';
import TelegramBot from 'node-telegram-bot-api';

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

const perplexity = new OpenAI({
    apiKey: process.env.PERPLEXITY_API_KEY,
    baseURL: 'https://api.perplexity.ai',
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ─── Search for tenders using Perplexity Sonar ───────────────────────────────
export async function search_tenders_with_perplexity(keywords) {
    console.log(`Searching for tenders via Perplexity Sonar...`);
    console.log(`Keywords: ${keywords}\n`);

    // Split keywords into an array for clearer prompting
    const keywordList = keywords.split(',').map(k => k.trim()).filter(Boolean);

    try {
        const response = await perplexity.chat.completions.create({
            model: 'sonar',
            messages: [
                {
                    role: 'system',
                    content: `You are a South African government tender research specialist.
Your job is to search the web and find REAL, currently OPEN government tenders.
You must return ONLY factual, verifiable tender listings.
NEVER fabricate tender numbers, dates, departments, or any details.
If you find no matching tenders, respond with exactly: NO_RESULTS_FOUND`
                },
                {
                    role: 'user',
                    content: `Search for currently open South African government tenders that match ANY of these keywords:

${keywordList.map((kw, i) => `${i + 1}. ${kw}`).join('\n')}

SEARCH THESE SOURCES:
- etenders.gov.za (SA National Treasury eTender Portal)  
- CIDB (Construction Industry Development Board)
- Municipal tender portals (e.g. Johannesburg, Cape Town, eThekwini, Tshwane)
- Provincial government tender pages
- Government Tender Bulletin
- sa-tenders.co.za

For EVERY tender you find, extract and list these details:
• Tender Number / Reference Number
• Organ of State / Issuing Department / Municipality
• Tender Type (e.g. Open Bid, RFQ, RFP)
• Full Description of the work required
• Province
• Date Published
• Closing Date and Time
• Place / Location where work is required
• Contact Person name
• Contact Email
• Contact Telephone
• Is there a Briefing Session? (Yes/No)
• Is the Briefing Compulsory? (Yes/No)
• Briefing Date and Time
• Briefing Venue / Location
• Source URL

TODAY'S DATE: ${new Date().toISOString().split('T')[0]}
ONLY include tenders with a closing date AFTER today. Exclude all expired tenders.
Be thorough — search for each keyword individually if needed.`
                }
            ],
        });

        const content = response.choices[0].message.content;
        const citations = response.citations || [];

        console.log(`✔ Perplexity search complete.`);
        if (citations.length > 0) {
            console.log(`  📎 ${citations.length} source(s) cited.`);
        }

        // Log a preview of results
        const preview = content.substring(0, 200);
        console.log(`  📋 Preview: ${preview}...\n`);

        return { content, citations };
    } catch (error) {
        console.error('✘ Perplexity search error:', error.message);
        return { content: 'NO_RESULTS_FOUND', citations: [] };
    }
}

// ─── Use OpenAI to extract and format tenders from Perplexity results ────────
export async function format_tenders_with_openai(searchResults, citations, keywords) {
    const citationText = citations.length > 0
        ? `\n\nSource URLs from the web search:\n${citations.map((c, i) => `[${i + 1}] ${c}`).join('\n')}`
        : '';

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are Zaka AI, a tender formatting agent for South African government tenders. You receive raw web search results and must extract, filter, and format them into a precise Telegram message format. You never invent data — only extract what exists in the search results.`
                },
                {
                    role: 'user',
                    content: `Below are RAW SEARCH RESULTS about South African government tenders. Process them with these steps:

**STEP 1 — EXTRACT:** Identify every individual tender listing in the search results.

**STEP 2 — FILTER:** Keep ONLY tenders that strongly match these client keywords: [${keywords}].
These are for a civil engineering / construction contractor. Keep tenders related to:
- Civil engineering works, construction, infrastructure
- Roadworks, paving, pothole repairs
- Stormwater drainage, trenching
- Bulk water supply, sewer reticulation  
- Earthworks, excavation
- Any CIDB-graded construction work
DISCARD tenders for IT, consulting, catering, cleaning, security, or anything unrelated to physical construction/engineering works.

**STEP 3 — FORMAT:** For each matching tender, output it in EXACTLY this Telegram format. Use "Not Provided" for any missing fields:

**ZAKA AI - NEW TENDER MATCH** 🚨

**Tender Number:** [the tender/reference number]
**Organ of State:** [issuing department or municipality]
**Tender Type:** [type e.g. Open Bid, RFQ, RFP]
**Province:** [province name]
**Date Published:** [YYYY/MM/DD format]
**Closing Date:** [YYYY/MM/DD HH:MM format]

📍 **Location Details:**
**Place Required:** [town, city, or street address where work is needed]

👤 **Contact Details:**
**Contact Person:** [full name]
**Email:** [email address]
**Telephone:** [phone number]

📅 **Briefing Session:**
**Is there a briefing?:** [Yes or No]
**Is it compulsory?:** [Yes or No]
**Briefing Date/Time:** [date and time if available]
**Briefing Venue:** [venue/location if available]

===TENDER_SEPARATOR===

**CRITICAL RULES:**
1. Separate each tender with the exact text: ===TENDER_SEPARATOR===
2. If ZERO tenders match the client keywords, return ONLY the word: REJECT
3. Do NOT invent, fabricate, or guess any tender details
4. Only extract information explicitly stated in the search results
5. Do NOT add any extra commentary, headers, or footers — just the formatted tenders separated by ===TENDER_SEPARATOR===

--- RAW SEARCH RESULTS ---
${searchResults}
${citationText}`
                }
            ],
            temperature: 0.1,
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error('✘ OpenAI formatting error:', error.message);
        return 'REJECT';
    }
}

// ─── Send formatted alert to Telegram ────────────────────────────────────────
export async function send_telegram_alert(message) {
    console.log(`Sending Telegram alert...`);
    try {
        // Telegram has a 4096 char limit per message
        if (message.length > 4000) {
            const chunks = [];
            let remaining = message;
            while (remaining.length > 0) {
                if (remaining.length <= 4000) {
                    chunks.push(remaining);
                    break;
                }
                let breakPoint = remaining.lastIndexOf('\n', 4000);
                if (breakPoint < 2000) breakPoint = 4000;
                chunks.push(remaining.substring(0, breakPoint));
                remaining = remaining.substring(breakPoint);
            }
            for (const chunk of chunks) {
                await telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, chunk, { parse_mode: 'Markdown' });
            }
        } else {
            await telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
        }
        console.log('✔ Telegram alert sent.');
        return true;
    } catch (error) {
        console.error('✘ Telegram send error:', error.message);
        return false;
    }
}
