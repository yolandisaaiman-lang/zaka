import { OpenAI } from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import TelegramBot from 'node-telegram-bot-api';

const telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const perplexity = new OpenAI({
    apiKey: process.env.PERPLEXITY_API_KEY,
    baseURL: 'https://api.perplexity.ai',
});

// ─── Search for tenders using Perplexity Sonar ───────────────────────────────
export async function search_tenders_with_perplexity(keywords) {
    console.log(`Searching for tenders via Perplexity Sonar...`);
    console.log(`Keywords: ${keywords}\n`);

    try {
        const response = await perplexity.chat.completions.create({
            model: 'sonar',
            messages: [
                {
                    role: 'system',
                    content: `You are a South African government tender research assistant. 
Your ONLY job is to find REAL, currently OPEN government tenders. 
Return ONLY factual tender listings with verifiable details.
Do NOT fabricate or invent tender numbers, dates, or departments.
If you cannot find any matching open tenders, say "NO_RESULTS_FOUND".`
                },
                {
                    role: 'user',
                    content: `Find all currently open South African government tenders related to these keywords: ${keywords}

Search these sources:
- etenders.gov.za (South African National Treasury eTender Portal)
- CIDB (Construction Industry Development Board)
- Municipal and provincial tender portals
- Government Tender Bulletin

For EACH tender found, provide ALL available details:
- Tender number / reference
- Issuing department, municipality, or organ of state
- Full description of the work
- Province / location
- Date published
- Closing date and time
- Contact person, email, telephone
- Whether there is a compulsory briefing session (date, time, venue)
- Source URL where the tender was found

CRITICAL: Only include tenders with a closing date in the future (after today, ${new Date().toISOString().split('T')[0]}). Do not include expired tenders.`
                }
            ],
        });

        const content = response.choices[0].message.content;
        const citations = response.citations || [];

        console.log(`✔ Perplexity search complete.`);
        if (citations.length > 0) {
            console.log(`  📎 ${citations.length} source(s) cited.`);
        }

        return { content, citations };
    } catch (error) {
        console.error('✘ Perplexity search error:', error.message);
        return { content: 'NO_RESULTS_FOUND', citations: [] };
    }
}

// ─── Use Gemini to extract and format tenders from Perplexity results ────────
export async function format_tenders_with_gemini(searchResults, citations, keywords) {
    const citationText = citations.length > 0
        ? `\n\nSource URLs from search:\n${citations.map((c, i) => `[${i + 1}] ${c}`).join('\n')}`
        : '';

    const zakaPrompt = `
You are Zaka AI, an elite tender formatting agent.

You have received RAW SEARCH RESULTS about South African government tenders from a web search. Your job is to:

**STEP 1: EXTRACT**
Parse the search results below and identify individual tenders.

**STEP 2: FILTER**  
Only keep tenders that are a STRONG match for these client keywords: [${keywords}].
Focus on civil engineering, construction, infrastructure, and related physical works.
Discard anything unrelated (IT, catering, consulting, etc.) unless it specifically matches a keyword.

**STEP 3: FORMAT**
For EACH matching tender, output a message formatted EXACTLY like this (use these exact labels and emojis). If a field is not available, write "Not Provided":

🚨 **ZAKA AI - NEW TENDER MATCH** 🚨

**Tender Number:** [number]
**Organ of State:** [department/municipality]
**Description:** [full description of work]
**Province:** [province]
**Date Published:** [YYYY/MM/DD]
**Closing Date:** [YYYY/MM/DD HH:MM]

📍 **Location Details:**
**Place Required:** [location/town]

👤 **Contact Details:**
**Contact Person:** [name]
**Email:** [email]
**Telephone:** [phone]

📅 **Briefing Session:**
**Is there a briefing?:** [Yes/No]
**Is it compulsory?:** [Yes/No]
**Briefing Date/Time:** [date and time]
**Briefing Venue:** [venue]

🔗 **Source:** [URL where tender was found]

--
⚡ *Scouted by Zaka AI*

===TENDER_SEPARATOR===

**IMPORTANT RULES:**
- Separate each tender with ===TENDER_SEPARATOR===
- If NO tenders match the keywords, return exactly: REJECT
- Do NOT invent or fabricate any tender details
- Extract only what is explicitly stated in the search results

Here are the search results to process:
${searchResults}
${citationText}
`;

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent(zakaPrompt);
        const text = result.response.text().trim();
        return text;
    } catch (error) {
        console.error('✘ Gemini formatting error:', error.message);
        return 'REJECT';
    }
}

// ─── Send formatted alert to Telegram ────────────────────────────────────────
export async function send_telegram_alert(message) {
    console.log(`Sending Telegram alert...`);
    try {
        // Telegram has a 4096 char limit per message
        if (message.length > 4000) {
            // Split long messages
            const chunks = [];
            let remaining = message;
            while (remaining.length > 0) {
                if (remaining.length <= 4000) {
                    chunks.push(remaining);
                    break;
                }
                // Find a good break point
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
