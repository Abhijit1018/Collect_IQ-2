const cds = require('@sap/cds');
const cron = require('node-cron'); // Ensure node-cron is installed

class FollowUpExecutor {
    constructor() {
        this.running = false;
    }

    start() {
        if (this.running) {
            console.log('Follow-up executor already running');
            return;
        }

        // Run every hour
        cron.schedule('0 * * * *', async () => {
            console.log('[FollowUpExecutor] Checking for scheduled follow-ups...');
            await this.processScheduledFollowUps();
        });

        // Daily summary at 8 AM
        cron.schedule('0 8 * * *', async () => {
            console.log('[FollowUpExecutor] Sending daily summary...');
            await this.sendDailySummary();
        });

        this.running = true;
        console.log('[FollowUpExecutor] Started successfully');
    }

    async processScheduledFollowUps() {
        try {
            const db = await cds.connect.to('db');
            const { ScheduledFollowups } = db.entities('my.collectiq'); // Ensure correct namespace

            const now = new Date();
            const currentDate = now.toISOString().split('T')[0];
            const currentHour = now.getHours();

            // Find follow-ups scheduled for this hour
            const followUps = await db.run(
                SELECT.from(ScheduledFollowups)
                    .where({
                        scheduledDate: currentDate,
                        status: 'pending'
                    })
            );

            console.log(`[FollowUpExecutor] Found ${followUps.length} follow-ups for today`);

            for (const followUp of followUps) {
                if (followUp.scheduledTime) {
                    const scheduledHour = parseInt(followUp.scheduledTime.split(':')[0]);

                    if (scheduledHour === currentHour) {
                        await this.executeFollowUp(followUp.ID);
                    }
                }
            }
        } catch (error) {
            console.error('[FollowUpExecutor] Error processing follow-ups:', error);
        }
    }

    async executeFollowUp(followUpId) {
        try {
            const OutreachService = await cds.connect.to('CollectIQService'); // Match service name in srv/service.cds

            const result = await OutreachService.send({
                method: 'POST',
                path: 'executeFollowUp',
                data: { followUpId }
            });

            console.log(`[FollowUpExecutor] Follow-up ${followUpId} executed:`, result.message);
        } catch (error) {
            console.error(`[FollowUpExecutor] Error executing follow-up ${followUpId}:`, error);
        }
    }

    async sendDailySummary() {
        // TODO: Send email summary of today's follow-ups
        console.log('[FollowUpExecutor] Daily summary sent');
    }
}

module.exports = new FollowUpExecutor();
