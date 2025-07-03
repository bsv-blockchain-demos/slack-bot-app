const { App } = require("@slack/bolt");
const { createTransaction, spendTransaction, spendOnly } = require('./hooks/transactionHandler.js');
const { createFilteredThreadInfo } = require('./hooks/threadFormatting.js');
const { errorMessageBlock, savedMessageBlock, refreshMessageBlock, deleteMessageBlock, paymailSetMessageBlock, paymailRemovedMessageBlock } = require('./src/ephemeralMessages.js');
require("dotenv").config();

// Import thread management functions
const { saveThread, addReply, updateEditedMessage, markMessageDeleted, refreshThread, threadExists, deleteThread } = require('./hooks/threadManager.js');
const { connectToMongo } = require('./mongo.js');
const { getThread } = require('./hooks/threadManager.js');
const { getUserInfoByID } = require('./hooks/threadManager.js');

// Initialize the app with proper configuration
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

function isValidPaymail(paymail) {
  // Paymail must be in the format localpart@domain.tld
  // Localpart: letters, digits, dots, underscores, dashes
  // Domain: letters, digits, dots, dashes
  const paymailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return paymailRegex.test(paymail);
}

// New command let users set PayMail value
app.command("/setpaymail", async ({ ack, body, client }) => {
  try {
    const { user_id, text } = body;

    // Get user info
    // Get simplified user info for the person who saved the thread (only id and real_name)
    const fullUserInfo = await getUserInfoByID(client, user_id);
    const userInfo = {
      id: fullUserInfo.id,
      real_name: fullUserInfo.profile?.real_name || fullUserInfo.real_name || user_id
    };
    const paymail = text.trim();

    // Save the PayMail in the database
    const { usersCollection } = await connectToMongo();

    if (paymail === "" || paymail.toLowerCase() === "none") {
      await usersCollection.updateOne(
        { _id: userInfo.id },
        { $set: { paymail: "" } },
        { upsert: true }
      );
      await ack({
        text: `PayMail removed for user ${userInfo.real_name}`,
        blocks: paymailRemovedMessageBlock(`PayMail removed for user ${userInfo.real_name}`),
      });
      return;
    } else if (!isValidPaymail(paymail)) {
      await ack({
        text: `Invalid PayMail format for user ${userInfo.real_name}`,
        blocks: errorMessageBlock(`Invalid PayMail format for user ${userInfo.real_name}`),
      });
      return;
    }

    const result = await usersCollection.updateOne(
      { _id: userInfo.id }, // use Slack user ID as unique key
      { $set: { real_name: userInfo.real_name, paymail } },
      { upsert: true }
    );

    console.log('result: ', result);

    await ack({
      text: `PayMail set to ${paymail}`,
      blocks: paymailSetMessageBlock(`PayMail set to ${paymail}`),
    });

    console.log(`PayMail set for user ${userInfo.real_name}: ${paymail}`);
  } catch (error) {
    console.error("Error setting PayMail:", error);
    await ack({
      text: "Error setting PayMail. Please try again.",
      blocks: errorMessageBlock(`Error setting PayMail. Please try again.`),
    });
  }
});


app.event("reaction_added", async ({ event, client, logger }) => {
  try {
    const { user, item, reaction } = event;

    // Filter: only react to specific emoji for saving threads
    if (reaction !== "inbox_tray" && reaction !== "arrows_counterclockwise" && reaction !== "wastebasket") return;

    // Different behavior based on reaction type
    const isSaveRequest = reaction === "inbox_tray";
    const isRefreshRequest = reaction === "arrows_counterclockwise";
    const isDeleteRequest = reaction === "wastebasket";

    console.log("Item: ", item);

    // Optional: check if the user is an admin
    const userInfo = await client.users.info({ user });
    if (!userInfo.user.is_admin) {
      console.log(`User ${user} is not an admin. Ignoring.`);
      return;
    }

    // Check if it's part of a thread
    const threadTs = item.thread_ts || item.ts;

    // Fetch entire thread
    const threadResult = await client.conversations.replies({
      channel: item.channel,
      ts: threadTs,
    });

    // Save or process thread
    const threadInfo = {
      thread_ts: threadTs,
      channel: item.channel,
      saved_by: user,
      messages: threadResult.messages,
    };

    if (threadInfo.messages.length === 1) {
      console.log("Thread is empty. Ignoring.");
      return;
    }

    const filteredThreadInfo = createFilteredThreadInfo(threadInfo);
    console.log("Filtered thread info: ", filteredThreadInfo);

    if (isDeleteRequest) {
      const exists = await threadExists(threadTs);
      if (!exists) {
        console.log("Cannot delete a thread that hasn't been saved yet");
        await client.chat.postEphemeral({
          channel: item.channel,
          user: user,
          thread_ts: threadTs,
          text: "This thread hasn't been saved yet. Please react with :inbox_tray: first.",
          blocks: errorMessageBlock(`This thread hasn't been saved yet. Please react with :inbox_tray: first.`),
        });
        return;
      }

      // TODO: Redeem old tx
      const oldThreadInfo = await getThread(threadTs);

      // Get old thread info from db
      // Format to satisfy transaction requirements
      const filteredOldThreadInfo = createFilteredThreadInfo({ thread_ts: oldThreadInfo._id, channel: oldThreadInfo.channel, saved_by: oldThreadInfo.saved_by, messages: oldThreadInfo.messages });
      console.log("Filtered old thread info: ", filteredOldThreadInfo);

      //const response = await spendOnly(oldThreadInfo.txid, filteredOldThreadInfo);
      //console.log("Response: ", response);

      // Delete the thread - pass the client to fetch user info
      const deleteResult = await deleteThread(threadTs, item.channel, threadResult.messages, user);
      console.log(`🗑 Deleted thread ${threadTs} from channel ${item.channel}`);
      console.log(`Delete result: ${deleteResult.success ? 'Success' : 'Failed'}`);

      // Send confirmation
      await client.chat.postEphemeral({
        channel: item.channel,
        user: user,
        thread_ts: threadTs,
        text: "This thread has been deleted successfully.",
        blocks: deleteMessageBlock(),
      });

      // Remove :white_check_mark: reaction
      await client.reactions.remove({
        name: "white_check_mark",
        channel: item.channel,
        timestamp: item.ts,
      });

      return;
    }

    // If this is a refresh request, handle it differently
    if (isRefreshRequest) {
      // Check if thread exists first
      const exists = await threadExists(threadTs);
      if (!exists) {
        console.log("Cannot refresh a thread that hasn't been saved yet");
        await client.chat.postEphemeral({
          channel: item.channel,
          user: user,
          thread_ts: threadTs,
          text: "This thread hasn't been saved yet. Please react with :inbox_tray: first.",
          blocks: errorMessageBlock(`This thread hasn't been saved yet. Please react with :inbox_tray: first.`),
        });
        return;
      }

      // Get old thread info from db
      // Format to satisfy transaction requirements
      const oldThreadInfo = await getThread(threadTs);

      const filteredOldThreadInfo = createFilteredThreadInfo({ thread_ts: oldThreadInfo._id, channel: oldThreadInfo.channel, saved_by: oldThreadInfo.saved_by, messages: oldThreadInfo.messages });
      console.log("Filtered old thread info: ", filteredOldThreadInfo);

      //const response = await spendTransaction(oldThreadInfo.txid, filteredOldThreadInfo, filteredThreadInfo);
      //console.log("Response: ", response);

      // Refresh the thread - pass the client to fetch user info
      const refreshResult = await refreshThread(threadTs, item.channel, threadResult.messages, user, client, {/*response?.txid*/ });
      console.log(`🔄 Refreshed thread ${threadTs} from channel ${item.channel}`);
      console.log(`Refresh result: ${refreshResult.success ? 'Success' : 'Failed'}`);

      // Send confirmation
      await client.chat.postEphemeral({
        channel: item.channel,
        user: user,
        thread_ts: threadTs,
        text: "This thread has been refreshed successfully.",
        blocks: refreshMessageBlock(),
      });

      return;
    }

    // Only continue with save confirmation if this was a save request
    if (isSaveRequest) {

      //const response = await createTransaction(filteredThreadInfo);
      //console.log("Response: ", response);

      // Pass the client to saveThread to fetch user info
      saveResult = await saveThread(threadInfo, client, {/*response?.txid*/ });
      console.log(`Thread save result: ${saveResult.success ? 'Success' : 'Failed'}`,
        saveResult.isNew ? '(New thread)' : '(Updated existing thread)');

      console.log(`✅ Saved thread ${threadTs} from channel ${item.channel}`);

      // Remove reaction and add new checkmark reaction to show that it was saved
      try {
        await client.reactions.add({
          name: "white_check_mark",
          channel: item.channel,
          timestamp: item.ts,
        });
      } catch (err) {
        if (err.data?.error === "already_reacted") {
          console.log("✅ Reaction already added by the bot.");
        } else {
          throw err; // rethrow unknown errors
        }
      }

      // Send confirmation
      await client.chat.postEphemeral({
        channel: item.channel,
        user: user, // the admin who reacted
        thread_ts: threadTs,
        text: "This thread has been saved successfully.",
        blocks: savedMessageBlock(),
      });

      return;
    }

  } catch (error) {
    logger.error(error);
  }
});


app.event("message", async ({ event, client, logger }) => {
  try {
    const { user, subtype } = event;

    // Early check - determine if this is a thread we're tracking
    let threadTs;

    if (subtype === "message_changed") {
      threadTs = event.message.thread_ts || event.message.ts;
    } else if (subtype === "message_deleted") {
      threadTs = event.previous_message?.thread_ts || event.deleted_ts;
    } else if (!subtype && event.thread_ts) {
      threadTs = event.thread_ts;
    } else {
      // Not a message type we're interested in
      return;
    }

    // Check if this thread exists in our database before proceeding
    const exists = await threadExists(threadTs);
    if (!exists) {
      // Skip processing for threads we're not tracking
      console.log(`Thread ${threadTs} not found in database, ignoring event`);
      return;
    }

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
        messages: filteredNewThreadMessages,
      };

      console.log("Filtered new thread info: ", filteredNewThreadInfo);

      // Get old thread info from db
      // Format to satisfy transaction requirements
      const oldThreadInfo = await getThread(threadTs);

      const filteredOldThreadInfo = createFilteredThreadInfo({ thread_ts: oldThreadInfo._id, channel: oldThreadInfo.channel, saved_by: oldThreadInfo.saved_by, messages: oldThreadInfo.messages });
      console.log("Filtered old thread info: ", filteredOldThreadInfo);

      //const response = await spendTransaction(oldThreadInfo.txid, filteredOldThreadInfo, filteredThreadInfo);
      //console.log("Response: ", response);

      // Update the edited message in the database
      const updateResult = await updateEditedMessage(
        threadTs,
        originalTs,
        event.message.text,
        event.message,
        //response?.txid,
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
        saved_by: user,
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
        messages: oldThreadMessages,
      };

      console.log("Filtered old thread info: ", filteredOldThreadInfo);

      //const response = await spendTransaction(oldThreadInfo.txid, filteredOldThreadInfo, filteredThreadInfo);

      // Mark the message as deleted in the database
      //console.log("Response: ", response);
      const deleteResult = await markMessageDeleted(threadTs, deletedTs, client, /*response?.txid*/);
      console.log(`Message deletion marked: ${deleteResult.success ? 'Success' : 'Failed'}`);
    }

    // Handle replies
    else if (!subtype && event.thread_ts) {
      console.log("💬 New reply in tracked thread:", event.text);
      console.log("Thread:", threadTs);

      // Create a new array of messages with the reply
      // Format to satisfy transaction requirements
      const filteredNewThreadInfo = createFilteredThreadInfo({ thread_ts: threadTs, channel: event.channel, saved_by: user, messages: newThreadResult.messages });
      console.log("Filtered new thread info: ", filteredNewThreadInfo);

      const oldThreadInfo = await getThread(threadTs);

      // Get old thread info from db
      // Format to satisfy transaction requirements
      const filteredOldThreadInfo = createFilteredThreadInfo({ thread_ts: oldThreadInfo._id, channel: oldThreadInfo.channel, saved_by: oldThreadInfo.saved_by, messages: oldThreadInfo.messages });
      console.log("Filtered old thread info: ", filteredOldThreadInfo);

      //const response = await spendTransaction(oldThreadInfo.txid, filteredOldThreadInfo, filteredNewThreadInfo);

      // Add the reply to the thread in the database - pass client to fetch user info
      //console.log("Response: ", response);
      const addResult = await addReply(threadTs, event, client, /*response?.txid*/);
      console.log(`Reply saved: ${addResult.success ? 'Success' : 'Failed'}`);
    }
  } catch (error) {
    logger.error("Error in message event:", error);
  }
});

app.action("dismiss_success", async ({ ack, respond }) => {
  await ack();

  console.log("Dismissed called");

  // Delete the ephemeral message
  await respond({
    response_type: "ephemeral",
    delete_original: true,
  });
});

// Start the app
(async () => {
  try {
    await app.start(process.env.PORT || 3000);
    console.log("⚡️ Bolt app is running!");
  } catch (error) {
    console.error("Error starting app:", error);
  }
})();