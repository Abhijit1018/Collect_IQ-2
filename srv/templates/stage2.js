module.exports = (payerName, amount, currency) => {
    return {
        subject: `URGENT: Overdue Payment Notice - ${payerName}`,
        body: `Dear ${payerName},

Our records indicate that your balance of ${currency} ${amount} is now significantly overdue. This is our second notice regarding this matter. 

We request you to process the payment immediately via our secure portal to avoid further collection actions and potential credit impact.

Regards,
Collections Department`
    };
};