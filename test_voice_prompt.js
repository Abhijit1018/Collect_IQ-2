const cds = require('@sap/cds');
const stage3Template = require('./srv/templates/stage3');

(async () => {
    try {
        // MOCK DATA (Simulating valid DB response)
        const payer = {
            PayerId: '1003',
            PayerName: 'Adani Group',
            TotalPastDue: 85000.00,
            Currency: 'USD',
            LastOutreachStatus: 'CALL_INITIATED'
        };

        console.log(`\n>>> [TEST] Simulating Voice Agent Logic for Payer ID: ${payer.PayerId}`);
        console.log(`>>> [TEST] Mocked DB Data:`, payer);

        // 2. Logic from srv/service.js
        const payerName = payer?.PayerName || 'the customer';

        // "amount is the amount" logic check
        let amountContext = '';
        if (payer?.TotalPastDue) {
            const amount = `${payer.TotalPastDue} ${payer.Currency || ''}`.trim();
            amountContext = `The specific overdue amount is ${amount}.`;
        } else {
            amountContext = `The exact amount is not available, so refer to it generally as "your outstanding balance".`;
        }

        // 3. Template Generation
        // In service.js: stage3Template(payerName, payer?.TotalPastDue || amountText, payer?.Currency || '')
        // Note: service.js logic for 2nd arg is: payer?.TotalPastDue || amountText
        // If TotalPastDue is present, it passes the number. If not, it passes the fallback text.

        let amountTextForTemplate = 'the outstanding balance';
        if (payer?.TotalPastDue) {
            amountTextForTemplate = `${payer.TotalPastDue} ${payer.Currency || ''}`.trim();
        }

        // Logic from service.js connected event:
        // amountText = payer?.TotalPastDue ? ... : 'the outstanding balance';
        // voiceScript = stage3Template(payerName, payer?.TotalPastDue || amountText, payer?.Currency || '').body;

        // Strict replication:
        const amountText = payer?.TotalPastDue
            ? `${payer.TotalPastDue} ${payer.Currency || ''}`.trim()
            : 'the outstanding balance';

        const voiceScript = stage3Template(payerName, payer?.TotalPastDue || amountText, payer?.Currency || '').body;

        // 4. Construct System Prompt Context
        const callDetails = `
- Customer Name: ${payerName}
- Amount Info: ${amountContext}
- Status: ${payer?.LastOutreachStatus || 'unknown'}
        `.trim();

        const instructions = `You are Vegah CollectIQ calling ${payerName}. Open warmly, clearly state the overdue amount of ${amountText}, and ask if now is a good time to talk. Use this phrasing as a base: ${voiceScript}`;


        console.log(`\n>>> [TEST] --- GENERATED PROMPTS ---`);
        console.log(`>>> [CONTEXT] (Hidden System Prompt part):\n${callDetails}`);
        console.log(`>>> [INSTRUCTIONS] (What AI determines to say):\n${instructions}`);

        console.log(`\n>>> [TEST] --- VERIFICATION ---`);
        if (payerName === 'Adani Group') console.log("✓ Payer Name is correct");
        else console.warn("X Payer Name is INCORRECT");

        if (instructions.includes('85000') || instructions.includes('85,000')) console.log("✓ Amount is present in instructions");
        else console.warn("X Amount is MISSING");

    } catch (err) {
        console.error(">>> [TEST] Error:", err);
    }
})();
