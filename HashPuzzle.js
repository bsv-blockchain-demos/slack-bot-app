const { LockingScript, UnlockingScript, OP, Hash, Utils } = require("@bsv/sdk");
require("dotenv").config();

const randomSecret = process.env.RANDOM_SECRET;

class HashPuzzle {
    lock(newThreadInfo) {
        const threadHash = Hash.hash256(Utils.toArray(JSON.stringify(newThreadInfo) + randomSecret, "utf8"));

        return new LockingScript([
            { op: OP.OP_SHA256 },
            { op: threadHash.length, data: threadHash },
            { op: OP.OP_EQUAL }
        ])
    }
    unlock(oldThreadInfo) {
        const oldThreadHash = Hash.sha256(Utils.toArray(JSON.stringify(oldThreadInfo) + randomSecret, "utf8"));
        
        return new UnlockingScript([
            { op: oldThreadHash.length, data: oldThreadHash }
        ])
    }
}

module.exports = HashPuzzle;