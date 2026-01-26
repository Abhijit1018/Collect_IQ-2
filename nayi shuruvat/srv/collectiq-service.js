const cds = require('@sap/cds');

module.exports = class CollectiqService extends cds.ApplicationService {

    async init() {
        const { Payers, OutreachHistory } = this.entities;

        // Generate outreach for all payers
        this.on('generateOutreachForAll', async (req) => {
            const payers = await SELECT.from(Payers);
            let count = 0;

            for (const payer of payers) {
                if (payer.TotalPastDue > 0) {
                    const draft = `Dear ${payer.PayerName}, This is a reminder about your outstanding balance of $${payer.TotalPastDue.toLocaleString()}. Please arrange payment at your earliest convenience.`;

                    await UPDATE(Payers)
                        .set({
                            latestOutreachDraft: draft,
                            LastOutreachStatus: 'PENDING'
                        })
                        .where({ PayerId: payer.PayerId });
                    count++;
                }
            }

            return `Generated outreach drafts for ${count} customers`;
        });

        // Send outreach to all payers
        this.on('sendOutreachToAll', async (req) => {
            const payers = await SELECT.from(Payers).where({ LastOutreachStatus: 'PENDING' });
            const now = new Date().toISOString();
            let count = 0;

            for (const payer of payers) {
                // Create outreach history record
                await INSERT.into(OutreachHistory).entries({
                    outreachId: cds.utils.uuid(),
                    PayerId: payer.PayerId,
                    stageAtGeneration: payer.Stage,
                    outreachType: 'EMAIL',
                    bodyText: payer.latestOutreachDraft,
                    status: 'SENT'
                });

                // Update payer status
                await UPDATE(Payers)
                    .set({
                        LastOutreachStatus: 'SENT',
                        lastOutreachAt: now
                    })
                    .where({ PayerId: payer.PayerId });
                count++;
            }

            return `Sent outreach to ${count} customers`;
        });

        // Generate outreach for single payer
        this.on('generateOutreach', async (req) => {
            const { PayerId } = req.data;
            const payer = await SELECT.one.from(Payers).where({ PayerId });

            if (!payer) {
                return req.error(404, `Payer ${PayerId} not found`);
            }

            const draft = `Dear ${payer.PayerName}, This is a reminder about your outstanding balance of $${payer.TotalPastDue.toLocaleString()}. Please arrange payment at your earliest convenience.`;

            await UPDATE(Payers)
                .set({
                    latestOutreachDraft: draft,
                    LastOutreachStatus: 'PENDING'
                })
                .where({ PayerId });

            return `Generated outreach draft for ${payer.PayerName}`;
        });

        // Send outreach for single payer
        this.on('sendOutreach', async (req) => {
            const { PayerId } = req.data;
            const payer = await SELECT.one.from(Payers).where({ PayerId });

            if (!payer) {
                return req.error(404, `Payer ${PayerId} not found`);
            }

            const now = new Date().toISOString();

            // Create outreach history record
            await INSERT.into(OutreachHistory).entries({
                outreachId: cds.utils.uuid(),
                PayerId: payer.PayerId,
                stageAtGeneration: payer.Stage,
                outreachType: 'EMAIL',
                bodyText: payer.latestOutreachDraft || 'Standard outreach message',
                status: 'SENT'
            });

            // Update payer status
            await UPDATE(Payers)
                .set({
                    LastOutreachStatus: 'SENT',
                    lastOutreachAt: now
                })
                .where({ PayerId });

            return `Sent outreach to ${payer.PayerName}`;
        });

        // Sync AR data action
        this.on('syncAR', async (req) => {
            const payers = await SELECT.from(Payers);
            // Simulate syncing AR data - in production this would call external AR system
            let count = 0;

            for (const payer of payers) {
                // Recalculate criticality based on days past due
                let newCriticality = 0;
                if (payer.MaxDaysPastDue > 60) {
                    newCriticality = 3;
                } else if (payer.MaxDaysPastDue > 30) {
                    newCriticality = 2;
                } else if (payer.MaxDaysPastDue > 0) {
                    newCriticality = 1;
                }

                await UPDATE(Payers)
                    .set({ criticality: newCriticality })
                    .where({ PayerId: payer.PayerId });
                count++;
            }

            return `Synced AR data for ${count} customers`;
        });

        await super.init();
    }
};
