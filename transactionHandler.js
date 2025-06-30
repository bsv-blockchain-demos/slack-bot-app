const { WalletClient } = require("@bsv/sdk");
const HashPuzzle = require("./HashPuzzle");
require("dotenv").config();

async function createTransaction(threadInfo) {
    try {
        const wallet = new WalletClient("auto", process.env.SLACK_WORKSPACE);

        const response = await wallet.createAction({
            description: "Slack thread",
            outputs: [
                {
                    outputDescription: "Slack thread",
                    lockingScript: new HashPuzzle().lock(threadInfo).toHex(),
                    satoshis: 1,
                }
            ]
        });

        broadcastTransaction(response);

        return response;
    } catch (error) {
        console.error("Error creating transaction:", error);
    }
}

async function spendTransaction(txid, oldThreadInfo, newThreadInfo) {
    try {
        const wallet = new WalletClient("auto", process.env.SLACK_WORKSPACE);
        const tx = getTransaction(txid);
        
        // TODO: implement redeem action
        const response = await wallet.createAction({
            description: "Slack thread",
            inputBEEF: tx.BEEF,
            inputs: [
                {
                    inputDescription: "Slack thread",
                    txid: txid,
                    unlockingScript: new HashPuzzle().unlock(oldThreadInfo).toHex(),
                    outpoint: tx.outpoints[0],
                }
            ],
            outputs: [
                {
                    outputDescription: "Slack thread",
                    lockingScript: new HashPuzzle().lock(newThreadInfo).toHex(),
                    satoshis: 1,
                }
            ]
        });

        broadcastTransaction(response);

        return response;
    } catch (error) {
        console.error("Error spending thread tx:", error);
    }
}

async function broadcastTransaction(tx) {
    try {
        // TODO: implement broadcast transaction to overlay
    } catch (error) {
        console.error("Error broadcasting thread tx:", error);
    }
}

function getTransaction(txid) {
    try {
        //TODO get transaction from overlay
    } catch (error) {
        console.error("Error getting transaction:", error);
    }
}

module.exports = {
    createTransaction,
    spendTransaction,
};