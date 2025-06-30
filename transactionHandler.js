const { WalletClient } = require("@bsv/sdk");
const { Hash, Utils } = require("@bsv/sdk");
const ThreadTemplate = require("./threadTemplate");
require("dotenv").config();

async function createTransaction(threadInfo) {
    try {
        const wallet = new WalletClient("auto", process.env.SLACK_WORKSPACE);

        const data = Hash.sha256(Utils.toArray(JSON.stringify(threadInfo), "utf8"));

        const response = await wallet.createAction({
            description: "Slack thread",
            outputs: [
                {
                    outputDescription: "Slack thread",
                    lockingScript: ThreadTemplate.lock(data).toHex(),
                    satoshis: 1,
                }
            ]
        });

        broadcastTransaction(response.txid);

        return response;
    } catch (error) {
        console.error("Error creating transaction:", error);
    }
}

async function spendTransaction(txid, oldThreadInfo, newThreadInfo) {
    try {
        const wallet = new WalletClient("auto", process.env.SLACK_WORKSPACE);
        const previousData = Hash.sha256(Utils.toArray(JSON.stringify(oldThreadInfo), "utf8"));
        const newData = Hash.sha256(Utils.toArray(JSON.stringify(newThreadInfo), "utf8"));
        
        const tx = getTransaction(txid);
        
        // TODO: implement redeem action
        const response = await wallet.createAction({
            description: "Slack thread",
            inputBEEF: tx.BEEF,
            inputs: [
                {
                    inputDescription: "Slack thread",
                    txid: txid,
                    unlockingScript: ThreadTemplate.unlock(previousData).toHex(),
                    outpoint: tx.outpoints[0],
                }
            ],
            outputs: [
                {
                    outputDescription: "Slack thread",
                    lockingScript: ThreadTemplate.lock(newData).toHex(),
                    satoshis: 1,
                }
            ]
        });

        broadcastTransaction(response.txid);

        return response;
    } catch (error) {
        console.error("Error spending thread tx:", error);
    }
}

async function broadcastTransaction(txid) {
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