import { fetch_latest_tenders, evaluate_tender_with_gemini, send_telegram_alert } from './tools.js';

export async function runAgent() {
    const targetUrl = process.env.TARGET_URL;

    console.log('═══════════════════════════════════════════');
    console.log('  ZAKA AI — Tender Scout Starting...');
    console.log('═══════════════════════════════════════════');

    // ── Phase 1: Fetch tenders from eTenders JSON API ──
    const tenders = await fetch_latest_tenders(targetUrl);

    if (!tenders.length) {
        console.log('No tenders returned from API. Exiting.');
        const timestamp = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
        await send_telegram_alert(`✅ *Zaka AI — Scan Complete*\n\n⚠️ API returned 0 tenders.\n\n🕐 *Completed:* ${timestamp}`);
        return;
    }

    console.log(`\nProcessing ${tenders.length} tenders through Gemini...\n`);

    let tendersAlerted = 0;
    let tendersRejected = 0;

    // ── Phase 2: Loop → Gemini evaluate → Telegram deliver ──
    for (let i = 0; i < tenders.length; i++) {
        const tender = tenders[i];
        const label = tender.description || `Tender #${i + 1}`;
        console.log(`[${i + 1}/${tenders.length}] Evaluating: "${label}"`);

        // Send to Gemini for filtering + formatting
        const geminiResult = await evaluate_tender_with_gemini(tender);

        // Check if Gemini rejected
        if (geminiResult.toUpperCase().startsWith('REJECT')) {
            console.log(`  → ❌ REJECTED by Gemini.\n`);
            tendersRejected++;
            continue;
        }

        // Gemini returned a formatted match — send to Telegram
        console.log(`  → ✅ MATCH! Sending to Telegram...`);
        await send_telegram_alert(geminiResult);
        tendersAlerted++;
        console.log('');
    }

    // ── Phase 3: Completion summary ──
    console.log('───────────────────────────────────────────');
    console.log(`Scan complete. ${tendersAlerted} match(es), ${tendersRejected} rejected.`);
    console.log('───────────────────────────────────────────');

    const timestamp = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
    const summaryMessage = tendersAlerted > 0
        ? `✅ *Zaka AI — Scan Complete*\n\n📋 *${tendersAlerted} matching tender${tendersAlerted === 1 ? '' : 's'} found* and sent above.\n🚫 ${tendersRejected} tender${tendersRejected === 1 ? '' : 's'} rejected.\n\n🕐 *Completed:* ${timestamp}`
        : `✅ *Zaka AI — Scan Complete*\n\n🔍 No matching tenders found this run.\n🚫 ${tendersRejected} tender${tendersRejected === 1 ? '' : 's'} reviewed and rejected.\n\n🕐 *Completed:* ${timestamp}`;

    await send_telegram_alert(summaryMessage);
    console.log('Summary sent. Agent finished.');
}
