module.exports = (payerName, amount, currency) => {
    return {
        subject: `Friendly Reminder: Outstanding Balance for ${payerName}`,
        body: `Dear ${payerName},

This is a friendly reminder that your account has an outstanding balance of ${currency} ${amount}. We would appreciate it if you could settle this at your earliest convenience.

If you have already made the payment, please disregard this email.

Regards,
Accounts Receivable Team`
    };
};