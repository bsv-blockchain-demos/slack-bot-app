const { Transaction, TopicBroadcaster, LookupResolver, Utils, Hash } = require("@bsv/sdk");
const makeWallet = require("./createWallet");
const HashPuzzle = require("../utils/HashPuzzle");
require("dotenv").config();

const randomSecret = process.env.RANDOM_SECRET;
const CHAIN = process.env.CHAIN;
const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY;
const WALLET_STORAGE_URL = process.env.WALLET_STORAGE_URL;

const overlay = new LookupResolver({
    slapTrackers: ['https://overlay-us-1.bsvb.tech'],
    additionalHosts: {
        'ls_slackthread': ['https://overlay-us-1.bsvb.tech']
    }
})

async function createTransaction(threadInfo) {
    try {
        const wallet = await makeWallet(CHAIN === 'testnet' ? 'test' : 'main', WALLET_STORAGE_URL, SERVER_PRIVATE_KEY);

        // Create new transaction
        const response = await wallet.createAction({
            description: "Slack thread",
            outputs: [
                {
                    outputDescription: "Slack thread",
                    lockingScript: new HashPuzzle().lock(threadInfo).toHex(),
                    satoshis: 1,
                }
            ],
            randomizeOutputs: false,
        });
        console.log("Transaction response:", response);

        broadcastTransaction(response);

        return response;
    } catch (error) {
        console.error("Error creating transaction:", error);
    }
}

async function spendTransaction(txid, oldThreadInfo, newThreadInfo) {
    try {
        const wallet = await makeWallet(CHAIN === 'testnet' ? 'test' : 'main', WALLET_STORAGE_URL, SERVER_PRIVATE_KEY);
        const oldThreadTx = await getTransactionByTxid(txid);
        console.log("Old thread tx (spend):", oldThreadTx.outputs[0].beef);
        
        const oldTx = Transaction.fromBEEF(oldThreadTx.outputs[0].beef);
        console.log("Old transaction:", oldTx);

        // Use old transaction to make a new one with new info (create chain)
        const response = await wallet.createAction({
            description: "Slack thread",
            inputBEEF: oldThreadTx.outputs[0].beef,
            inputs: [
                {
                    inputDescription: "Slack thread",
                    unlockingScript: new HashPuzzle().unlock(oldThreadInfo).toHex(),
                    outpoint: `${oldTx.id('hex')}.0`,
                }
            ],
            outputs: [
                {
                    outputDescription: "Slack thread",
                    lockingScript: new HashPuzzle().lock(newThreadInfo).toHex(),
                    satoshis: 1,
                }
            ],
            randomizeOutputs: false,
        });
        console.log("Transaction response (spend):", response);

        broadcastTransaction(response);

        return response;
    } catch (error) {
        console.error("Error spending thread tx:", error);
    }
}

async function createUnspendableTransaction(txid, oldThreadInfo) {
    try {
        const wallet = await makeWallet(CHAIN === 'testnet' ? 'test' : 'main', WALLET_STORAGE_URL, SERVER_PRIVATE_KEY);
        const oldThreadTx = await getTransactionByTxid(txid);
        console.log("Old thread tx (unspendable):", oldThreadTx.outputs[0].beef);

        const oldTx = Transaction.fromBEEF(oldThreadTx.outputs[0].beef);
        console.log("Old transaction:", oldTx);

        // Leave output empty to create unspendable transaction on thread delete
        const response = await wallet.createAction({
            description: "Slack thread",
            inputBEEF: oldThreadTx.outputs[0].beef,
            inputs: [
                {
                    inputDescription: "Slack thread",
                    unlockingScript: new HashPuzzle().unlock(oldThreadInfo).toHex(),
                    outpoint: `${oldTx.sourceTXID}.${oldTx.sourceOutputIndex}`,
                }
            ],
        });
        console.log("Transaction response (unspendable):", response);

        broadcastTransaction(response);

        return response;
    } catch (error) {
        console.error("Error spending thread tx:", error);
    }
}

async function broadcastTransaction(response) {
    try {
        // broadcast transaction to overlay
        // Capture the resulting transaction
        const tx = Transaction.fromBEEF(response.tx);

        // Lookup a service which accepts this type of token
        const tb = new TopicBroadcaster(['tm_slackthread'], {
            resolver: overlay,
          })

        // Send the tx to that overlay.
        const overlayResponse = await tx.broadcast(tb)
        console.log("Overlay response: ", overlayResponse);
    } catch (error) {
        console.error("Error broadcasting thread tx:", error);
    }
}

async function getTransactionByTxid(txid) {
    try {
        // get transaction from overlay
        const response = await overlay.query({
            service: 'ls_slackthread', query: {
                txid: txid
            }
        }, 10000);
        console.log("Response: ", response);

        return response;
    } catch (error) {
        console.error("Error getting transaction:", error);
    }
}

module.exports = {
    createTransaction,
    spendTransaction,
    createUnspendableTransaction,
};