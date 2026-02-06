// Test script to verify payer data flow WITHOUT making a real call
const cds = require('@sap/cds');

async function testPayerData(payerId) {
    console.log('\n========== TESTING CALL DATA FLOW ==========\n');
    console.log(`Testing PayerId: ${payerId}`);
    
    await cds.connect.to('db');
    const db = cds.db;
    const { SELECT } = cds.ql;
    
    // Simulate exactly what loadPayer() does
    const payer = await db.run(SELECT.one.from('my.collectiq.Payers').where({ PayerId: payerId }));
    
    console.log('\n--- RAW DATABASE RESULT ---');
    console.log(JSON.stringify(payer, null, 2));
    
    if (!payer) {
        console.log('\n❌ ERROR: Payer not found!');
        return;
    }
    
    // Simulate exactly what the code does
    const payerName = payer?.PayerName || 'the customer';
    
    let amountContext = '';
    if (payer?.TotalPastDue) {
        const amount = `${payer.TotalPastDue} ${payer.Currency || ''}`.trim();
        amountContext = `The specific overdue amount is ${amount}.`;
    } else {
        amountContext = `The exact amount is not available, so refer to it generally as "your outstanding balance".`;
    }
    
    console.log('\n--- WHAT AI WILL RECEIVE ---');
    console.log(`PayerName: "${payerName}"`);
    console.log(`AmountContext: "${amountContext}"`);
    console.log(`TotalPastDue value: ${payer?.TotalPastDue} (type: ${typeof payer?.TotalPastDue})`);
    
    // Check for issues
    console.log('\n--- DIAGNOSIS ---');
    if (payerName === 'the customer') {
        console.log('❌ PROBLEM: PayerName is falling back to "the customer"');
        console.log('   Cause: payer.PayerName is null/undefined');
    } else {
        console.log(`✅ PayerName OK: "${payerName}"`);
    }
    
    if (amountContext.includes('not available')) {
        console.log('❌ PROBLEM: Amount is falling back to generic text');
        console.log('   Cause: payer.TotalPastDue is falsy (0, null, undefined)');
    } else {
        console.log(`✅ Amount OK: Will say "${amountContext}"`);
    }
    
    // Show what OpenAI session would receive
    console.log('\n--- OPENAI SESSION INSTRUCTIONS (PREVIEW) ---');
    const instructions = `You are a professional collections agent for Vegah CollectIQ.
              
Your Goal: professionally remind the customer about their payment.
1. Start by greeting ${payerName} and clearly stating the purpose of the call.
2. ${amountContext}
...`;
    console.log(instructions);
    
    console.log('\n========== TEST COMPLETE ==========\n');
}

// Test with PayerId 1003 (Adani Group - STAGE_3)
testPayerData('1003').catch(console.error);
