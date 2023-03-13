const cds = require("@sap/cds"),
    JournalEventHandler = require("./handlers/event-handler");

class JournalEntryReferences extends cds.ApplicationService {
    async init() {
        const messaging = await cds.connect.to("messaging"),
            db = await cds.connect.to("db"),
            { JournalEntries } = db.entities;

        messaging.on("/ce/sap/s4/beh/journalentry/v1/JournalEntry/Created/v1", async (msg) => {
            const sLogID = cds.utils.uuid(),
                oJournalEventHandler = new JournalEventHandler();
            // Insert event data for logging purposes
            await db.run(INSERT.into(JournalEntries).entries({
                ID: sLogID,
                accountingDocument: msg.data.AccountingDocument,
                companyCode: msg.data.CompanyCode,
                fiscalYear: msg.data.FiscalYear,
                journalEntry: msg.data.JournalEntry,
                message: "Waiting",
                isUpdatedSuccessfully: false
            }));

            await oJournalEventHandler.updateJournalEntry({
                ID: sLogID,
                accountingDocument: msg.data.AccountingDocument,
                companyCode: msg.data.CompanyCode,
                fiscalYear: msg.data.FiscalYear,
                journalEntry: msg.data.JournalEntry
            });
        });

        await super.init();
    }
}

module.exports = JournalEntryReferences;