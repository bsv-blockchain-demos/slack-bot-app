const { Transaction, TopicBroadcaster, LookupResolver, Utils, Hash, WalletClient } = require("@bsv/sdk");
const { makeWallet } = require("./createWallet");
const HashPuzzle = require("./HashPuzzle");
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
        //const wallet = await makeWallet(CHAIN === 'testnet' ? 'test' : 'main', WALLET_STORAGE_URL, SERVER_PRIVATE_KEY);

        const wallet = new WalletClient("auto", "localhost:8080");
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
        const wallet = await makeWallet(CHAIN === 'testnet' ? 'test' : 'main', WALLET_STORAGE_URL, SERVER_PRIVATE_KEY);
        const hash = Hash.hash256(Utils.toArray(JSON.stringify(oldThreadInfo) + randomSecret, "utf8"));
        const oldThreadTx = await getTransactionByThreadHash(hash);

        // Use old transaction to make a new one with new info (create chain)
        const response = await wallet.createAction({
            description: "Slack thread",
            inputBEEF: oldThreadTx.BEEF,
            inputs: [
                {
                    inputDescription: "Slack thread",
                    txid: txid,
                    unlockingScript: new HashPuzzle().unlock(oldThreadInfo).toHex(),
                    outpoint: oldThreadTx.outpoints[0],
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

// async function spendOnly(txid, threadInfo) {
//     try {
//         const wallet = await makeWallet(CHAIN === 'testnet' ? 'test' : 'main', WALLET_STORAGE_URL, SERVER_PRIVATE_KEY);
//         const hash = Hash.hash256(Utils.toArray(JSON.stringify(threadInfo) + randomSecret, "utf8"));
//         const oldThreadTx = await getTransactionByThreadHash(hash);

//         // // Redeem old transaction on thread deletion (end of chain)
//         // const response = await wallet.createAction({
//         //     description: "Slack thread",
//         //     inputBEEF: oldThreadTx.BEEF,
//         //     inputs: [
//         //         {
//         //             inputDescription: "Slack thread",
//         //             txid: txid,
//         //             unlockingScript: new HashPuzzle().unlock(threadInfo),
//         //             outpoint: oldThreadTx.outpoints[0],
//         //         }
//         //     ]
//         // });

//         broadcastTransaction(response);

//         return response;
//     } catch (error) {
//         console.error("Error spending thread tx:", error);
//     }
// }

async function broadcastTransaction(response) {
    try {
        // broadcast transaction to overlay
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
        // get transaction from overlay
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
    //spendOnly,
};