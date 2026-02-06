const Database = require('better-sqlite3');
const db = new Database('db.sqlite');

// List all tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables in database:', tables.map(t => t.name));

// Try to get payer data
try {
    const payers = db.prepare("SELECT * FROM my_collectiq_Payers").all();
    console.log('\nPayers:');
    payers.forEach(p => {
        console.log(`  ${p.PayerId} | ${p.PayerName} | TotalPastDue: ${p.TotalPastDue} | ${p.Currency}`);
    });
} catch (e) {
    console.log('Error reading Payers:', e.message);
}

db.close();
