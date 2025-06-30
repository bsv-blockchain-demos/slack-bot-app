const { LockingScript, UnlockingScript, ScriptTemplate, OP } = require("@bsv/sdk");

class ThreadTemplate extends ScriptTemplate {
    lock(data) {
        return new LockingScript([
            { op: OP.OP_SHA256 },
            { op: data.length, data: data },
            { op: OP.OP_EQUAL }
        ])
    }
    unlock(data) {
        return {
            sign: async (tx, inputIndex) => {
                return new UnlockingScript([
                    { op: data.length, data: data }
                ])
              },
            estimateLength: () => Promise.resolve(2)
        }
    }
}

module.exports = ThreadTemplate;