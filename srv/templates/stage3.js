// srv/templates/stage3.js
module.exports = function (payerName, totalPastDue, currency) {
    return {
        subject: "Urgent: Payment Reminder - Action Required",
        body: `Hello, this is Vegah CollectIQ. I am calling for ${payerName} regarding a past due balance of ${totalPastDue} ${currency}. Your oldest invoice is significantly overdue. Please confirm when the payment will be initiated.`
    };
};