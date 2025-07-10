const { Transaction, TopicBroadcaster, LookupResolver, Utils, Hash } = require("@bsv/sdk");
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
        // const wallet = new WalletClient("auto", process.env.SLACK_WORKSPACE);

        // // Create new transaction
        // const response = await wallet.createAction({
        //     description: "Slack thread",
        //     outputs: [
        //         {
        //             outputDescription: "Slack thread",
        //             lockingScript: new HashPuzzle().lock(threadInfo),
        //             satoshis: 1,
        //         }
        //     ]
        // });

        
        const tx = new Transaction();
        tx.addInput({
            sourceTransaction: sourceTX, // Need to get from server
            sourceTXID: txid,
            sourceOutputIndex: 0,
            unlockingScript: unlockScript, // Need to get from server private key (?)
        });
        tx.addOutput({
            lockingScript: new HashPuzzle().lock(threadInfo),
            satoshis: 1,
            change: true,
        });

        tx.fee();
        tx.sign();
        tx.verify('scripts only');

        broadcastTransaction(tx);

        return tx;
    } catch (error) {
        console.error("Error creating transaction:", error);
    }
}

async function spendTransaction(txid, oldThreadInfo, newThreadInfo) {
    try {
        // const wallet = new WalletClient("auto", process.env.SLACK_WORKSPACE);
        const hash = Hash.sha256(Utils.toArray(JSON.stringify(oldThreadInfo) + randomSecret, "utf8"));
        const oldThreadTx = await getTransactionByThreadHash(txid, hash);

        // // Use old transaction to make a new one with new info (create chain)
        // const response = await wallet.createAction({
        //     description: "Slack thread",
        //     inputBEEF: tx.BEEF,
        //     inputs: [
        //         {
        //             inputDescription: "Slack thread",
        //             txid: txid,
        //             unlockingScript: new HashPuzzle().unlock(oldThreadInfo),
        //             outpoint: tx.outpoints[0],
        //         }
        //     ],
        //     outputs: [
        //         {
        //             outputDescription: "Slack thread",
        //             lockingScript: new HashPuzzle().lock(newThreadInfo),
        //             satoshis: 1,
        //         }
        //     ]
        // });

        const tx = new Transaction();
        tx.addInput({
            sourceTransaction: oldThreadTx.BEEF,
            sourceTXID: txid,
            sourceOutputIndex: 0,
            unlockingScript: new HashPuzzle().unlock(oldThreadInfo),
        });
        tx.addOutput({
            lockingScript: new HashPuzzle().lock(newThreadInfo),
            satoshis: 1,
            change: true,
        });

        tx.fee();
        tx.sign();
        tx.verify('scripts only');

        broadcastTransaction(tx);

        return tx;
    } catch (error) {
        console.error("Error spending thread tx:", error);
    }
}

// async function spendOnly(txid, threadInfo) {
//     try {
//         //const wallet = new WalletClient("auto", process.env.SLACK_WORKSPACE);
//         const oldThreadTx = await getTransactionByThreadHash(txid);

//         // // Redeem old transaction on thread deletion (end of chain)
//         // const response = await wallet.createAction({
//         //     description: "Slack thread",
//         //     inputBEEF: tx.BEEF,
//         //     inputs: [
//         //         {
//         //             inputDescription: "Slack thread",
//         //             txid: txid,
//         //             unlockingScript: new HashPuzzle().unlock(threadInfo),
//         //             outpoint: tx.outpoints[0],
//         //         }
//         //     ]
//         // });

//         const tx = new Transaction();
//         tx.addInput({
//             sourceTransaction: oldThreadTx.BEEF,
//             sourceTXID: txid,
//             sourceOutputIndex: 0,
//             unlockingScript: new HashPuzzle().unlock(threadInfo),
//         });

//         tx.fee();
//         tx.sign();
//         tx.verify('scripts only');

//         broadcastTransaction(tx);

//         return tx;
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