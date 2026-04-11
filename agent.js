import OpenAI from 'openai';
import { fetch_latest_tenders, extract_tender_text, send_telegram_alert } from './tools.js';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Definition of tools for OpenAI
const toolDefinitions = [
    {
        type: "function",
        function: {
            name: "fetch_latest_tenders",
            description: "Fetches and scrapes the latest tenders from a given URL via Firecrawl, returning a JSON stringified array of {title, pdf_link, upload_date}.",
            parameters: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "The target URL to scrape"
                    }
                },
                required: ["url"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "extract_tender_text",
            description: "Downloads a PDF from a URL and extracts its raw text content. Returns JSON stringified {text: ...}.",
            parameters: {
                type: "object",
                properties: {
                    pdf_url: {
                        type: "string",
                        description: "The URL of the PDF to extract text from"
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
    extract_tender_text,
    send_telegram_alert
};

export async function runAgent() {
    const targetUrl = process.env.TARGET_URL;
    const clientKeywords = process.env.CLIENT_KEYWORDS;

    const messages = [
        {
            role: "system",
            content: `You are Zaka AI, an elite, highly accurate Tender Scouting Agent operating in South Africa. Your job is to save contractors time by reading massive, bureaucratic government tender documents and extracting only the absolute most critical information.

YOUR WORKFLOW:
Your initial task is to call 'fetch_latest_tenders' on the URL: ${targetUrl}. 
For every PDF link returned, you must call 'extract_tender_text' to read its contents.

YOUR OBJECTIVE:
You will be provided with raw, unformatted text extracted from a municipal tender PDF. You must analyze this text and determine if it is a highly relevant match for a contractor whose core business is defined by these keywords: [${clientKeywords}].

STEP 1: THE FILTER (CRITICAL) Analyze the scope of work.
If the tender has NOTHING to do with [${clientKeywords}], you must abort. Return exactly and only the word: "REJECT" for that tender.
If the tender is a match for [${clientKeywords}], proceed to Step 2.

STEP 2: THE EXTRACTION & FORMATTING
If the tender is a match, you must extract the key bidding data and format it into a clean, highly readable message designed for a Telegram chat.

You must strictly use the exact markdown and emoji formatting below. Do not add conversational filler. Be precise.

🚨 NEW TENDER ALERT 🚨

Project: [Extract the official title or a clear 1-sentence summary of the work]
Institution: [Extract the Municipality or Government Department issuing the tender]
Closing Date & Time: [Extract the exact deadline. If a compulsory briefing exists, add it here]
Required CIDB: [Extract the specific CIDB grading required, e.g., "3 GB" or "4 CE". If none is mentioned, write "Not Specified"]

📋 Mandatory Requirements:
- [List 3 to 5 strict mandatory requirements found in the document using bullet points. Focus on things like COIDA, specific ISO certifications, local content requirements, or site meeting attendance.]

🔗 Document Link: [Insert the pdf_link of the tender]
⚡ Scouted by Zaka AI

For every matching tender, call 'send_telegram_alert' with the formatted string. Once you have successfully processed the tenders and sent the alerts for the matching ones, you can tell the user you are finished.`
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
