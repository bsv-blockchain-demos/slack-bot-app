const { App } = require("@slack/bolt");
const { WalletClient, Script, Utils, Hash } = require("@bsv/sdk");
require("dotenv").config();

// Import thread management functions
const { saveThread, addReply, updateEditedMessage, markMessageDeleted, refreshThread, threadExists, deleteThread } = require('./threadManager.js');
const { connectToMongo } = require('./mongo.js');
const { getUserInfoByID } = require('./threadManager.js');

// Initialize the app with proper configuration
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// New command let users set PayMail value
app.command("/setpaymail", async ({ ack, body, client }) => {
  try {
    const { user, text } = body;

    // Get user info
    // Get simplified user info for the person who saved the thread (only id and real_name)
    const fullUserInfo = await getUserInfoByID(client, user);
    const userInfo = {
      id: fullUserInfo.id,
      real_name: fullUserInfo.profile?.real_name || fullUserInfo.real_name || user
    };
    const paymail = text.trim();

    // Save the PayMail in the database
    const { usersCollection } = await connectToMongo();
    const result = await usersCollection.updateOne(
      { _id: userInfo.id }, // use Slack user ID as unique key
      { $set: { real_name: userInfo.real_name, paymail } },
      { upsert: true }
    );

    console.log('result: ', result);

    await ack({
      text: `PayMail set to ${paymail}`,
    });

    console.log(`PayMail set for user ${user}: ${paymail}`);
  } catch (error) {
    console.error("Error setting PayMail:", error);
    await ack({
      text: "Error setting PayMail. Please try again.",
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

    // Get the original message
    const result = await client.conversations.replies({
      channel: item.channel,
      ts: item.ts,
      limit: 1,
    });

    const originalMessage = result.messages[0];

    // Check if it's part of a thread
    const threadTs = originalMessage.thread_ts || originalMessage.ts;

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

    if (isDeleteRequest) {
      const exists = await threadExists(threadTs);
      if (!exists) {
        console.log("Cannot delete a thread that hasn't been saved yet");
        await client.chat.postEphemeral({
          channel: item.channel,
          user: user,
          thread_ts: threadTs,
          text: `⚠️ This thread hasn't been saved yet. Please react with :inbox_tray: first.`,
        });
        return;
      }

      // TODO: Redeem old tx

      // Delete the thread - pass the client to fetch user info
      const deleteResult = await deleteThread(threadTs, item.channel, threadResult.messages, user);
      console.log(`🗑 Deleted thread ${threadTs} from channel ${item.channel}`);
      console.log(`Delete result: ${deleteResult.success ? 'Success' : 'Failed'}`);

      // Send confirmation
      await client.chat.postEphemeral({
        channel: item.channel,
        user: user,
        thread_ts: threadTs,
        text: `🗑 This thread has been deleted successfully.`,
      });

      // Remove :white_check_mark: reaction
      await client.reactions.remove({
        name: "white_check_mark",
        channel: item.channel,
        timestamp: item.ts,
      });

      return;
    }

    // let response;
    // if (isSaveRequest) {
    //   response = await createTransaction(threadInfo);
    // }

    // Only save to MongoDB if this is a save request (inbox_tray reaction)
    // If it's a refresh request, we'll handle it differently below
    let saveResult;
    if (isSaveRequest) {
      // Pass the client to saveThread to fetch user info
      saveResult = await saveThread(threadInfo, client, {/*response?.txid*/});
      console.log(`Thread save result: ${saveResult.success ? 'Success' : 'Failed'}`,
        saveResult.isNew ? '(New thread)' : '(Updated existing thread)');
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
          text: `⚠️ This thread hasn't been saved yet. Please react with :inbox_tray: first.`,
        });
        return;
      }

      // TODO: Redeem old tx and make a new tx

      // Refresh the thread - pass the client to fetch user info
      const refreshResult = await refreshThread(threadTs, item.channel, threadResult.messages, user, client, {/*response?.txid*/});
      console.log(`🔄 Refreshed thread ${threadTs} from channel ${item.channel}`);
      console.log(`Refresh result: ${refreshResult.success ? 'Success' : 'Failed'}`);

      // Send confirmation
      await client.chat.postEphemeral({
        channel: item.channel,
        user: user,
        thread_ts: threadTs,
        text: `🔄 This thread has been refreshed successfully.`,
      });

      return;
    }

    // Only continue with save confirmation if this was a save request
    if (!isSaveRequest) return;

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
      text: `✅ This thread has been saved successfully.`,
    });

  } catch (error) {
    logger.error(error);
  }
});


app.event("message", async ({ event, client, logger }) => {
  try {
    const { subtype } = event;

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

    // Only process events for threads we're tracking

    // Handle edits
    if (subtype === "message_changed") {
      const originalTs = event.message.ts;

      console.log("✏️ Message edited in tracked thread:");
      console.log("Old:", event.previous_message?.text);
      console.log("New:", event.message.text);
      console.log("Thread:", threadTs);

      // Update the edited message in the database
      const updateResult = await updateEditedMessage(
        threadTs,
        originalTs,
        event.message.text,
        event.message
      );

      console.log(`Message edit saved: ${updateResult.success ? 'Success' : 'Failed'}`);
    }

    // Handle deletions
    else if (subtype === "message_deleted") {
      const deletedTs = event.deleted_ts;

      console.log("🗑 Message deleted in tracked thread:", deletedTs);
      console.log("Thread:", threadTs);

      // Mark the message as deleted in the database
      const deleteResult = await markMessageDeleted(threadTs, deletedTs, client);
      console.log(`Message deletion marked: ${deleteResult.success ? 'Success' : 'Failed'}`);
    }

    // Handle replies
    else if (!subtype && event.thread_ts) {
      console.log("💬 New reply in tracked thread:", event.text);
      console.log("Thread:", threadTs);

      // Add the reply to the thread in the database - pass client to fetch user info
      const addResult = await addReply(threadTs, event, client);

      console.log(`Reply saved: ${addResult.success ? 'Success' : 'Failed'}`);
    }

  } catch (error) {
    logger.error("Error in message event:", error);
  }
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