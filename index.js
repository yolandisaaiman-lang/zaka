import { runAgent } from './agent.js';

async function main() {
    console.log("Zaka AI initialized and beginning execution sequence.");
    
    // Check prerequisites
    const requiredEnv = ['OPENAI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'FIRECRAWL_API_KEY', 'TARGET_URL', 'CLIENT_KEYWORDS'];
    for (const env of requiredEnv) {
        if (!process.env[env]) {
            console.error(`Missing required environment variable: ${env}`);
            process.exit(1);
        }
    }

    try {
        await runAgent();
        console.log("Execution sequence completed successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Critical error during agent execution:", error);
        process.exit(1);
    }
}

main();
