import { search_tenders_with_perplexity, format_tenders_with_gemini, send_telegram_alert } from './tools.js';

export async function runAgent() {
    const keywords = process.env.CLIENT_KEYWORDS;

    console.log('═══════════════════════════════════════════');
    console.log('  ZAKA AI — Tender Scout Starting...');
    console.log('  Powered by Perplexity Sonar + Gemini');
    console.log('═══════════════════════════════════════════');

    // ── Phase 1: Search for tenders via Perplexity ──
    const { content: searchResults, citations } = await search_tenders_with_perplexity(keywords);

    if (searchResults === 'NO_RESULTS_FOUND' || !searchResults) {
        console.log('Perplexity returned no results. Exiting.');
        const timestamp = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
        await send_telegram_alert(`✅ *Zaka AI — Scan Complete*\n\n⚠️ Perplexity search returned no tender results.\n\n🕐 *Completed:* ${timestamp}`);
        return;
    }

    console.log(`\nPerplexity returned results. Sending to Gemini for extraction & formatting...\n`);

    // ── Phase 2: Gemini extracts + formats matching tenders ──
    const geminiResult = await format_tenders_with_gemini(searchResults, citations, keywords);

    if (geminiResult.toUpperCase().startsWith('REJECT')) {
        console.log('Gemini found no matching tenders in the search results.');
        const timestamp = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
        await send_telegram_alert(`✅ *Zaka AI — Scan Complete*\n\n🔍 Perplexity searched the web but no tenders matched your keywords.\n\n🕐 *Completed:* ${timestamp}`);
        return;
    }

    // ── Phase 3: Split individual tenders and send to Telegram ──
    const tenderMessages = geminiResult
        .split('===TENDER_SEPARATOR===')
        .map(t => t.trim())
        .filter(t => t.length > 0 && !t.toUpperCase().startsWith('REJECT'));

    console.log(`\n📋 ${tenderMessages.length} matching tender(s) found. Sending to Telegram...\n`);

    let sentCount = 0;
    for (const msg of tenderMessages) {
        const success = await send_telegram_alert(msg);
        if (success) sentCount++;
    }

    // ── Summary ──
    const timestamp = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
    const summaryMessage = `✅ *Zaka AI — Scan Complete*\n\n📋 *${sentCount} matching tender${sentCount === 1 ? '' : 's'} found* and sent above.\n\n🕐 *Completed:* ${timestamp}`;

    await send_telegram_alert(summaryMessage);

    console.log('───────────────────────────────────────────');
    console.log(`Scan complete. ${sentCount} tender(s) delivered.`);
    console.log('───────────────────────────────────────────');
}
