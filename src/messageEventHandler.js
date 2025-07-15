const { spendTransaction } = require('../hooks/transactionHandler.js');
const { createFilteredThreadInfo } = require('../hooks/threadFormatting.js');
const { addReply, updateEditedMessage, markMessageDeleted, getThread } = require('../hooks/threadManager.js');
const { errorMessageBlock } = require('./ephemeralMessages.js');
require("dotenv").config();

async function handleMessageEvent(event, client, logger, threadTs) {
    let user;

    // Determine user based on event type (Slack API differences)
    if (event.subtype === "message_deleted") {
        user = event.previous_message.user;
    } else if (event.subtype === "message_changed") {
        user = event.message.user;
    } else {
        user = event.user;
    }
    const { subtype } = event;

    // Initialize response for transactions
    let response;
    
    try {
        // Fetch entire thread
        const newThreadResult = await client.conversations.replies({
            channel: event.channel,
            ts: threadTs,
        });
        let filteredNewThreadMessages = [];

        // Handle edits
        if (subtype === "message_changed") {
            const originalTs = event.message.ts;

            console.log("✏️ Message edited in tracked thread:");
            console.log("Old:", event.previous_message?.text);
            console.log("New:", event.message.text);
            console.log("Thread:", threadTs);

            // Create a new array of messages with the edited message
            // Format to satisfy transaction requirements
            filteredNewThreadMessages = newThreadResult.messages.map(message => {
                if (message.ts === originalTs) {
                    return {
                        text: event.message.text,
                        ts: message.ts,
                    }
                } else {
                    return {
                        text: message.text,
                        ts: message.ts,
                    }
                }
            });
            const filteredNewThreadInfo = {
                thread_ts: threadTs,
                channel: event.channel,
                saved_by: user,
                last_updated: event.ts,
                messages: filteredNewThreadMessages,
            };

            console.log("Filtered new thread info: ", filteredNewThreadInfo);

            // Get old thread info from db
            // Format to satisfy transaction requirements
            const oldThreadInfo = await getThread(threadTs);

            const filteredOldThreadInfo = createFilteredThreadInfo({ thread_ts: oldThreadInfo._id, channel: oldThreadInfo.channel, saved_by: oldThreadInfo.saved_by, messages: oldThreadInfo.messages, last_updated: oldThreadInfo.last_updated });
            console.log("Filtered old thread info: ", filteredOldThreadInfo);

            try {
                response = await spendTransaction(oldThreadInfo.txid, filteredOldThreadInfo, filteredNewThreadInfo);
                console.log("Response: ", response);
                if (!response) {
                    throw new Error("Failed to create transaction");
                }
            } catch (error) {
                console.error("Error creating transaction:", error);
                await client.chat.postEphemeral({
                    channel: event.channel,
                    thread_ts: threadTs,
                    user: user,
                    text: "There was an error creating transaction. Please refresh the thread.",
                    blocks: errorMessageBlock(`There was an error creating transaction. Please refresh the thread.`),
                });
                return;
            }

            // Update the edited message in the database
            const updateResult = await updateEditedMessage(
                threadTs,
                originalTs,
                event.message.text,
                event.message,
                response?.txid,
            );

            console.log(`Message edit saved: ${updateResult.success ? 'Success' : 'Failed'}`);
        }

        // Handle deletions
        else if (subtype === "message_deleted") {
            const deletedTs = event.deleted_ts;

            console.log("🗑 Message deleted in tracked thread:", deletedTs);
            console.log("Thread:", threadTs);

            // Create a new array of messages with the deleted message
            // Format to satisfy transaction requirements
            filteredNewThreadMessages = newThreadResult.messages.map(message => {
                if (message.ts === deletedTs) {
                    return {
                        text: "[deleted]",
                        ts: message.ts,
                    }
                } else {
                    return {
                        text: message.text,
                        ts: message.ts,
                    }
                }
            });
            const filteredNewThreadInfo = {
                thread_ts: threadTs,
                channel: event.channel,
                saved_by: event.previous_message.user,
                last_updated: event.ts,
                messages: filteredNewThreadMessages,
            };

            console.log("Filtered new thread info: ", filteredNewThreadInfo);

            // Get old thread info from db
            // Format to satisfy transaction requirements
            const oldThreadInfo = await getThread(threadTs);

            const oldThreadMessages = oldThreadInfo.messages.map(message => {
                if (message.deleted) {
                    return {
                        text: "[deleted]",
                        ts: message.ts,
                    }
                } else {
                    return {
                        text: message.text,
                        ts: message.ts,
                    }
                }
            });
            const filteredOldThreadInfo = {
                thread_ts: threadTs,
                channel: event.channel,
                saved_by: oldThreadInfo.saved_by,
                last_updated: oldThreadInfo.last_updated,
                messages: oldThreadMessages,
            };

            console.log("Filtered old thread info: ", filteredOldThreadInfo);

            try {
                response = await spendTransaction(oldThreadInfo.txid, filteredOldThreadInfo, filteredNewThreadInfo);
                console.log("Response: ", response);
                if (!response) {
                    throw new Error("Failed to create transaction");
                }
            } catch (error) {
                console.error("Error creating transaction:", error);
                await client.chat.postEphemeral({
                    channel: event.channel,
                    thread_ts: threadTs,
                    user: user,
                    text: "There was an error creating transaction. Please refresh the thread.",
                    blocks: errorMessageBlock(`There was an error creating transaction. Please refresh the thread.`),
                });
                return;
            }

            // Mark the message as deleted in the database
            const deleteResult = await markMessageDeleted(threadTs, deletedTs, client, response?.txid);
            console.log(`Message deletion marked: ${deleteResult.success ? 'Success' : 'Failed'}`);
        }

        // Handle replies
        else if (!subtype && event.thread_ts) {
            console.log("💬 New reply in tracked thread:", event.text);
            console.log("Thread:", threadTs);

            // Create a new array of messages with the reply
            // Format to satisfy transaction requirements
            const filteredNewThreadInfo = createFilteredThreadInfo({ thread_ts: threadTs, channel: event.channel, saved_by: user, messages: newThreadResult.messages, last_updated: event.ts });
            console.log("Filtered new thread info: ", filteredNewThreadInfo);

            const oldThreadInfo = await getThread(threadTs);

            // Get old thread info from db
            // Format to satisfy transaction requirements
            const filteredOldThreadInfo = createFilteredThreadInfo({ thread_ts: oldThreadInfo._id, channel: oldThreadInfo.channel, saved_by: oldThreadInfo.saved_by, messages: oldThreadInfo.messages, last_updated: oldThreadInfo.last_updated });
            console.log("Filtered old thread info: ", filteredOldThreadInfo);

            try {
                response = await spendTransaction(oldThreadInfo.txid, filteredOldThreadInfo, filteredNewThreadInfo);
                console.log("Response: ", response);
                if (!response) {
                    throw new Error("Failed to create transaction");
                }
            } catch (error) {
                console.error("Error creating transaction:", error);
                await client.chat.postEphemeral({
                    channel: event.channel,
                    thread_ts: threadTs,
                    user: user,
                    text: "There was an error creating transaction. Please refresh the thread.",
                    blocks: errorMessageBlock(`There was an error creating transaction. Please refresh the thread.`),
                });
                return;
            }

            // Add the reply to the thread in the database - pass client to fetch user info
            const addResult = await addReply(threadTs, event, client, response?.txid);
            console.log(`Reply saved: ${addResult.success ? 'Success' : 'Failed'}`);
        }
    } catch (error) {
        logger.error("Error in message event:", error);
    }
};

module.exports = {
    handleMessageEvent,
};