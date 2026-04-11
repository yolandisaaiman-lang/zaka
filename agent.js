import OpenAI from 'openai';
import { fetch_latest_tenders, pre_filter_tender_json, download_secure_etender_pdf, send_telegram_alert } from './tools.js';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Definition of tools for OpenAI
const toolDefinitions = [
    {
        type: "function",
        function: {
            name: "fetch_latest_tenders",
            description: "Fetches the latest tenders from the eTenders API, returning a JSON array of {title, category, pdf_link, upload_date}.",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "The eTenders API endpoint URL"
                    }
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "pre_filter_tender_json",
            description: "Fast, cheap pre-filter that checks if a tender's metadata (title and category) is remotely relevant to the client's keywords. Returns {relevant: true/false}. Call this BEFORE attempting any PDF download to save time and cost.",
            parameters: {
                type: "object",
                properties: {
                    description: {
                        type: "string",
                        description: "The tender title/description from the JSON metadata"
                    },
                    category: {
                        type: "string",
                        description: "The tender category from the JSON metadata"
                    },
                    client_keywords: {
                        type: "string",
                        description: "Comma-separated list of the client's business keywords"
                    }
                },
                required: ["description", "category", "client_keywords"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "download_secure_etender_pdf",
            description: "Securely downloads and extracts text from an eTenders PDF using session-aware cookies with a Playwright headless browser fallback. Returns {text: ...} with the extracted PDF content. Only call this AFTER pre_filter_tender_json returns relevant: true.",
            parameters: {
                type: "object",
                properties: {
                    pdf_url: {
                        type: "string",
                        description: "The full eTenders document download URL"
                    }
                },
                required: ["pdf_url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "send_telegram_alert",
            description: "Sends a formatted Markdown message to the configured Telegram chat.",
            parameters: {
                type: "object",
                properties: {
                    formatted_message: {
                        type: "string",
                        description: "The nicely formatted markdown message containing the Tender Name, Closing Date, CIDB Grading Required, and Mandatory Documents. Make it emoji-rich."
                    }
                },
                required: ["formatted_message"]
            }
        }
    }
];

const availableTools = {
    fetch_latest_tenders,
    pre_filter_tender_json,
    download_secure_etender_pdf,
    send_telegram_alert
};

export async function runAgent() {
    const targetUrl = process.env.TARGET_URL;
    const clientKeywords = process.env.CLIENT_KEYWORDS;

    const messages = [
        {
            role: "system",
            content: `You are Zaka AI, an elite, highly accurate Tender Scouting Agent operating in South Africa. Your job is to save contractors time by reading massive, bureaucratic government tender documents and extracting only the absolute most critical information.

YOUR WORKFLOW (follow this exact order):

PHASE 1 — FETCH
Call 'fetch_latest_tenders' with the URL: ${targetUrl}
This returns a JSON array of tenders, each with: title, category, pdf_link, upload_date.

PHASE 2 — PRE-FILTER (MANDATORY for every tender)
For EACH tender returned, call 'pre_filter_tender_json' with:
  - description: the tender title
  - category: the tender category
  - client_keywords: "${clientKeywords}"
This is a fast, cheap check. If it returns {relevant: false}, SKIP that tender entirely — do NOT attempt to download its PDF.

PHASE 3 — SECURE PDF DOWNLOAD (only for relevant tenders)
For each tender where pre-filter returned {relevant: true}, call 'download_secure_etender_pdf' with the pdf_link.
This will return {text: "..."} with the extracted PDF content, or {error: "..."} if the download failed.
If you get an error, log it and move to the next tender.

PHASE 4 — ANALYSIS & DELIVERY
For each successfully extracted PDF text, analyze it against the client keywords: [${clientKeywords}].

If the PDF content confirms the tender is a strong match, extract the key data and format it using the EXACT template below, then call 'send_telegram_alert':

🚨 NEW TENDER ALERT 🚨

Project: [Extract the official title or a clear 1-sentence summary of the work]
Institution: [Extract the Municipality or Government Department issuing the tender]
Closing Date & Time: [Extract the exact deadline. If a compulsory briefing exists, add it here]
Required CIDB: [Extract the specific CIDB grading required, e.g., "3 GB" or "4 CE". If none is mentioned, write "Not Specified"]

📋 Mandatory Requirements:
- [List 3 to 5 strict mandatory requirements found in the document using bullet points. Focus on things like COIDA, specific ISO certifications, local content requirements, or site meeting attendance.]

🔗 Document Link: [Insert the pdf_link of the tender]
⚡ Scouted by Zaka AI

If the PDF text does NOT confirm relevance after deeper reading, simply skip it.

IMPORTANT RULES:
- ALWAYS pre-filter before downloading. Never skip the pre-filter step.
- Process all tenders from the fetch results, not just the first one.
- Once all tenders are processed, you are finished.`
        },
        {
            role: "user",
            content: "Please begin your scout for tenders now."
        }
    ];

    console.log("Agent started.");

    let tendersAlerted = 0;

    while (true) {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: messages,
            tools: toolDefinitions,
            tool_choice: "auto",
        });

        const responseMessage = response.choices[0].message;
        messages.push(responseMessage);

        if (responseMessage.tool_calls) {
            for (const toolCall of responseMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const functionToCall = availableTools[functionName];
                const functionArgs = JSON.parse(toolCall.function.arguments);
                
                console.log(`Agent is calling tool: ${functionName}`);

                if (functionName === "send_telegram_alert") {
                    tendersAlerted++;
                }

                let functionResponse;
                try {
                    functionResponse = await functionToCall(functionArgs);
                } catch (e) {
                    console.error(`Error in tool execution: ${e.message}`);
                    functionResponse = JSON.stringify({ error: e.message });
                }

                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: functionName,
                    content: functionResponse,
                });
            }
        } else {
            console.log("Agent finished its work.");
            if (responseMessage.content) {
                console.log("Agent final message:", responseMessage.content);
            }
            break;
        }
    }

    // Always send a completion summary to Telegram so the user knows the job ran
    const timestamp = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
    const summaryMessage = tendersAlerted > 0
        ? `✅ *Zaka AI — Scan Complete*\n\n📋 *${tendersAlerted} matching tender${tendersAlerted === 1 ? "" : "s"} found* and alert${tendersAlerted === 1 ? "" : "s"} sent above.\n\n🕐 *Completed:* ${timestamp}`
        : `✅ *Zaka AI — Scan Complete*\n\n🔍 No matching tenders found this run.\n\n🕐 *Completed:* ${timestamp}`;

    console.log("Sending completion summary to Telegram...");
    try {
        await send_telegram_alert({ formatted_message: summaryMessage });
        console.log("Completion summary sent.");
    } catch (e) {
        console.error("Failed to send completion summary:", e.message);
    }
}
