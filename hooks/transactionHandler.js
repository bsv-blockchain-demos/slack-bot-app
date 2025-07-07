const { WalletClient, Transaction, TopicBroadcaster, LookupResolver, Utils, Hash } = require("@bsv/sdk");
const HashPuzzle = require("./HashPuzzle");
require("dotenv").config();

const randomSecret = process.env.RANDOM_SECRET;

const overlay = new LookupResolver({
    slapTrackers: ['https://overlay-us-1.bsvb.tech'],
    additionalHosts: {
        'ls_slackthread': ['https://overlay-us-1.bsvb.tech']
    }
})

async function createTransaction(threadInfo) {
    try {
        const wallet = new WalletClient("auto", process.env.SLACK_WORKSPACE);

        // Create new transaction
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
        const hash = Hash.sha256(Utils.toArray(JSON.stringify(oldThreadInfo) + randomSecret, "utf8"));
        const tx = await getTransactionByThreadHash(txid, hash);

        // Use old transaction to make a new one with new info (create chain)
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

async function spendOnly(txid, threadInfo) {
    try {
        const wallet = new WalletClient("auto", process.env.SLACK_WORKSPACE);
        const tx = await getTransactionByThreadHash(txid);

        // Redeem old transaction on thread deletion (end of chain)
        const response = await wallet.createAction({
            description: "Slack thread",
            inputBEEF: tx.BEEF,
            inputs: [
                {
                    inputDescription: "Slack thread",
                    txid: txid,
                    unlockingScript: new HashPuzzle().unlock(threadInfo).toHex(),
                    outpoint: tx.outpoints[0],
                }
            ]
        });

        broadcastTransaction(response);

        return response;
    } catch (error) {
        console.error("Error spending thread tx:", error);
    }
}

async function broadcastTransaction(response) {
    try {
        // TODO: implement broadcast transaction to overlay
        // Capture the resulting transaction
        const tx = Transaction.fromBEEF(response.tx);

        // Lookup a service which accepts this type of token
        const tb = new TopicBroadcaster(['tm_slackthread'], {
            resolver: overlay,
            requireAcknowledgmentFromSpecificHostsForTopics: {
              'ls_slackthread': ['https://overlay-us-1.bsvb.tech']
            }
          })

        // Send the tx to that overlay.
        const overlayResponse = await tx.broadcast(tb)
        console.log("Overlay response: ", overlayResponse);
    } catch (error) {
        console.error("Error broadcasting thread tx:", error);
    }
}

async function getTransactionByThreadHash(hash) {
    try {
        //TODO get transaction from overlay
        const response = await overlay.query({
            service: 'ls_slackthread', query: {
                threadHash: hash
            }
        }, 10000);

        return response;
    } catch (error) {
        console.error("Error getting transaction:", error);
    }
}

module.exports = {
    createTransaction,
    spendTransaction,
    spendOnly,
};