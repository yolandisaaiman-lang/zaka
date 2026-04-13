import { runAgent } from './agent.js';

async function main() {
    console.log("Zaka AI initialized.\n");
    
    // Check prerequisites
    const requiredEnv = ['GEMINI_API_KEY', 'PERPLEXITY_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'CLIENT_KEYWORDS'];
    for (const env of requiredEnv) {
        if (!process.env[env]) {
            console.error(`Missing required environment variable: ${env}`);
            process.exit(1);
        }
    }

    try {
        await runAgent();
        console.log("\nExecution completed successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Critical error during agent execution:", error);
        process.exit(1);
    }
}

main();
