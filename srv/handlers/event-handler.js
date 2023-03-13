const cds = require("@sap/cds"),
    SOAPClient = require("./soap-client");

class JournalEventHandler {
    async updateJournalEntry(message) {
        const db = await cds.connect.to("db"),
            { JournalEntries } = db.entities;
        let aGLAccountLineItems = [],
            oGLAccountLineItem = {},
            oReferenceFields = {},
            oLogMessage = {
                message: "Successfully updated!",
                isUpdatedSuccessfully: true
            };

        try {
            aGLAccountLineItems = await this.#getGLAccountLineItem(message);
            oGLAccountLineItem = aGLAccountLineItems[0];
            oReferenceFields = await this.#getReferenceFields(oGLAccountLineItem);
            await this.#runJournalEntryUpdate(message, oReferenceFields);
        } catch (error) {
            oLogMessage.message = error.message;
            oLogMessage.isUpdatedSuccessfully = false;
        }

        await db.run(UPDATE(JournalEntries, {
            ID: message.ID
        }).with(oLogMessage));
    }

    async #getGLAccountLineItem(message) {
        const oGLAccountAPI = await cds.connect.to("API_GLACCOUNTLINEITEM"),
            { GLAccountLineItem } = oGLAccountAPI.entities;
        let aGLAccountLineItems = [];

        try {
            aGLAccountLineItems = await oGLAccountAPI.run(SELECT.from(GLAccountLineItem).where({
                AccountingDocument: message.accountingDocument,
                CompanyCode: message.companyCode,
                FiscalYear: message.fiscalYear
            }));
        } catch (error) {
            throw error;
        }

        return aGLAccountLineItems;
    }

    async #getReferenceFields(oGLAccountLineItem) {
        const oBillingDocumentAPI = await cds.connect.to("API_BILLING_DOCUMENT_SRV"),
            oSupplierInvoiceAPI = await cds.connect.to("API_SUPPLIERINVOICE_PROCESS_SRV"),
            { A_BillingDocument } = oBillingDocumentAPI.entities,
            { A_SupplierInvoice } = oSupplierInvoiceAPI.entities;
        let oReferenceFields = {};

        switch (oGLAccountLineItem.AccountingDocumentType) {
            case "RE":
                try {
                    let oSupplierInvoice = await oSupplierInvoiceAPI.run(SELECT.from(A_SupplierInvoice, {
                        SupplierInvoice: oGLAccountLineItem.ReferenceDocument,
                        FiscalYear: oGLAccountLineItem.FiscalYear
                    }));

                    oReferenceFields = {
                        XREF2: oSupplierInvoice.YY1_SIHTravelBookRef_MIH,
                        XREF3: oSupplierInvoice.YY1_SIHTravelDepDate_MIH
                    };
                } catch (error) {
                    throw error;
                }

                break;
            case "RV":
                try {
                    let oBillingDocument = await oBillingDocumentAPI.run(SELECT.from(A_BillingDocument, {
                        BillingDocument: oGLAccountLineItem.ReferenceDocument
                    }));

                    oReferenceFields = {
                        XREF2: oBillingDocument.YY1_SDTravelBookRef_BDH,
                        XREF3: oBillingDocument.YY1_SDTravelDepDate_BDH
                    };
                } catch (error) {
                    throw error;
                }
                break;
        }

        return oReferenceFields;
    }

    async #runJournalEntryUpdate(message, oReferenceFields) {
        let oJournalEntryServiceEndpoint = { url: null };
        const oSOAPClient = new SOAPClient(),
            oJournalEntryService = await oSOAPClient.getSoapService("JOURNAL_ENTRY_CHANGE",
                "./srv/external/JOURNALENTRYBULKCHANGEREQUEST_.wsdl",
                oJournalEntryServiceEndpoint
            ),
            // Set the parameters for the JournalEntryBulkChangeRequest_In method of the sevice 
            oBody = {
                MessageHeader: {
                    ID: "POCTest001",
                    CreationDateTime: "2023-01-09T17:08:00.1234567Z"
                },
                JournalEntryGLItem: {
                    MessageHeader: {
                        ID: "MSG_ITM_ML001",
                        CreationDateTime: "2023-01-09T17:08:00.1234567Z"
                    },
                    ItemKey: {
                        AccountingDocument: message.accountingDocument,
                        CompanyCode: message.companyCode,
                        FiscalYear: message.fiscalYear,
                        AccountingDocumentItemID: "001"
                    },
                    Reference2IDByBusinessPartnerChange: {
                        Reference2IDByBusinessPartner: oReferenceFields.XREF2
                    },
                    Reference3IDByBusinessPartnerChange: {
                        Reference3IDByBusinessPartner: oReferenceFields.XREF3
                    }
                },
                JournalEntryDebtorCreditorItem: {
                    MessageHeader: {
                        ID: "MSG_ITM_ML001",
                        CreationDateTime: "2023-01-09T17:08:00.1234567Z"
                    },
                    ItemKey: {
                        AccountingDocument: message.accountingDocument,
                        CompanyCode: message.companyCode,
                        FiscalYear: message.fiscalYear,
                        AccountingDocumentItemID: "001"
                    },
                    Reference2IDByBusinessPartnerChange: {
                        Reference2IDByBusinessPartner: oReferenceFields.XREF2
                    },
                    Reference3IDByBusinessPartnerChange: {
                        Reference3IDByBusinessPartner: oReferenceFields.XREF3
                    }
                }
            };

        try {
            oJournalEntryService.setEndpoint(oJournalEntryServiceEndpoint.url);

            // Add Message ID with corresponding xmlns. Otherwise it fails
            oJournalEntryService.addSoapHeader({
                messageId: "urn:uuid:" + message.ID
            }, undefined, undefined, "http://www.w3.org/2005/08/addressing");
            
            // Invoke JournalEntryBulkChangeRequest_In method asynchronously and wait for the response
            await oJournalEntryService.JournalEntryBulkChangeRequest_InAsync(oBody);
        } catch (error) {
            throw error;
        }
    }
}

module.exports = JournalEventHandler;