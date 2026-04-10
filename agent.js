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
            content: `You are Zaka AI. Your goal is to find tenders matching these keywords: [${clientKeywords}]. 
Your initial task is to call 'fetch_latest_tenders' on the URL: ${targetUrl}. 
For every PDF link returned, you must call 'extract_tender_text' to read its contents. 
If the contents indicate the tender matches the client's keywords, format a clean, emoji-rich summary string containing: 
- Tender Name 
- Closing Date 
- CIDB Grading Required 
- Mandatory Documents

Then call 'send_telegram_alert' with the formatted string. Once you have successfully processed the tenders and sent the alerts for the matching ones, you can tell the user you are finished.`
        },
        {
            role: "user",
            content: "Please begin your scout for tenders now."
        }
    ];

    console.log("Agent started.");

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
}
