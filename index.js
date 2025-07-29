const { App } = require("@slack/bolt");
const { createTransaction, spendTransaction, createUnspendableTransaction } = require('./hooks/transactionHandler.js');
const { createFilteredThreadInfo } = require('./hooks/threadFormatting.js');
const {
  errorMessageBlock,
  savedMessageBlock,
  refreshMessageBlock,
  deleteMessageBlock,
  paymailSetMessageBlock,
  paymailRemovedMessageBlock,
  usernameSetMessageBlock
} = require('./src/ephemeralMessages.js');
const { handleMessageEvent } = require('./src/messageEventHandler.js');
const { getThreadQueue, _threadQueues } = require('./utils/ActionQueue.js');
require("dotenv").config();

// Import thread management functions
const { saveThread, refreshThread, threadExists, deleteThread, getThread, getUserInfoByID } = require('./hooks/threadManager.js');
const { connectToMongo } = require('./mongo.js');

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
    // Get simplified user info (only id and real_name)
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
      console.log(`PayMail removed for user ${userInfo.real_name}`);
      return;
    } else if (!isValidPaymail(paymail)) {
      await ack({
        text: `Invalid PayMail format for user ${userInfo.real_name}`,
        blocks: errorMessageBlock(`Invalid PayMail format for user ${userInfo.real_name}`),
      });
      console.log(`Invalid PayMail format for user ${userInfo.real_name}`);
      return;
    }

    const result = await usersCollection.updateOne(
      { _id: userInfo.id }, // use Slack user ID as unique key
      { $set: { real_name: userInfo.real_name, paymail } },
      { upsert: true }
    );

    if (!result.acknowledged) {
      await ack({
        text: "Error setting PayMail. Please try again.",
        blocks: errorMessageBlock(`Error setting PayMail. Please try again.`),
      });
      console.log(`Error setting PayMail for user ${userInfo.real_name}`);
      return;
    }

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

app.command("/setusername", async ({ ack, body, client }) => {
  try {
    const { user_id, text } = body;

    const fullUserInfo = await getUserInfoByID(client, user_id);
    const userInfo = {
      id: fullUserInfo.id,
      real_name: fullUserInfo.profile?.real_name || fullUserInfo.real_name || user_id
    };

    if (text.trim().length < 1) {
      await ack({
        text: `Username cannot be empty`,
        blocks: errorMessageBlock(`Username cannot be empty`),
      });
      console.log(`Username cannot be empty for user ${userInfo.real_name}`);
      return;
    }

    const { usersCollection } = await connectToMongo();

    const result = await usersCollection.updateOne(
      { _id: userInfo.id }, // use Slack user ID as unique key
      { $set: { username: text.trim() } },
      { upsert: true }
    );

    if (!result.acknowledged) {
      await ack({
        text: "Error setting username. Please try again.",
        blocks: errorMessageBlock(`Error setting username. Please try again.`),
      });
      console.log(`Error setting username for user ${userInfo.real_name}`);
      return;
    }

    await ack({
      text: `Username set to ${text.trim()}`,
      blocks: usernameSetMessageBlock(`Username set to ${text.trim()}`),
    });

    console.log(`Username set for user ${userInfo.real_name} to: ${text.trim()}`);
  } catch (error) {
    console.error("Error setting username:", error);
    await ack({
      text: "Error setting username. Please try again.",
      blocks: errorMessageBlock(`Error setting username. Please try again.`),
    });
  }
});


app.event("reaction_added", async ({ event, client, logger }) => {
  try {
    const { user, item, reaction } = event;

    // Check if it's part of a thread
    const threadTs = item.thread_ts || item.ts;

    // Initialize response for transactions
    let response;

    // Filter: only react to specific emoji for saving threads
    if (reaction !== "inbox_tray" && reaction !== "arrows_counterclockwise" && reaction !== "wastebasket") return;

    // Different behavior based on reaction type
    const isSaveRequest = reaction === "inbox_tray";
    const isRefreshRequest = reaction === "arrows_counterclockwise";
    const isDeleteRequest = reaction === "wastebasket";

    const exists = await threadExists(threadTs);
    if (isSaveRequest && exists) {
      console.log("Thread already exists. Ignoring.");
      return;
    }

    console.log("Item: ", item);

    // Optional: check if the user is an admin
    const userInfo = await client.users.info({ user });
    if (!userInfo.user.is_admin) {
      console.log(`User ${user} is not an admin. Ignoring.`);
      return;
    }

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
      last_updated: new Date(),
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
      const filteredOldThreadInfo = createFilteredThreadInfo({ thread_ts: oldThreadInfo._id, channel: oldThreadInfo.channel, saved_by: oldThreadInfo.saved_by, messages: oldThreadInfo.messages, last_updated: oldThreadInfo.last_updated });
      console.log("Filtered old thread info: ", filteredOldThreadInfo);

      try {
        response = await createUnspendableTransaction(oldThreadInfo.txid, filteredOldThreadInfo);
        console.log("Response: ", response);
        if (!response) {
          throw new Error("Failed to create transaction");
        }
      } catch (error) {
        console.error("Error creating transaction:", error);
        await client.chat.postEphemeral({
          channel: item.channel,
          thread_ts: threadTs,
          user: user,
          text: "There was an error creating transaction. Please try again.",
          blocks: errorMessageBlock(`There was an error creating transaction. Please try again.`),
        });
        return;
      }

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

      const filteredOldThreadInfo = createFilteredThreadInfo({ thread_ts: oldThreadInfo._id, channel: oldThreadInfo.channel, saved_by: oldThreadInfo.saved_by, messages: oldThreadInfo.messages, last_updated: oldThreadInfo.last_updated });
      console.log("Filtered old thread info: ", filteredOldThreadInfo);

      try {
        response = await spendTransaction(oldThreadInfo.txid, filteredOldThreadInfo, filteredThreadInfo);
        console.log("Response: ", response);
        if (!response) {
          throw new Error("Failed to create transaction");
        }
      } catch (error) {
        console.error("Error creating transaction:", error);
        await client.chat.postEphemeral({
          channel: item.channel,
          user: user,
          thread_ts: threadTs,
          text: "There was an error creating transaction. Please try again.",
          blocks: errorMessageBlock(`There was an error creating transaction. Please try again.`),
        });
        return;
      }

      // Refresh the thread - pass the client to fetch user info
      const refreshResult = await refreshThread(threadTs, item.channel, threadResult.messages, user, client, response?.txid, filteredThreadInfo.last_updated);
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

      try {
        response = await createTransaction(filteredThreadInfo);
        console.log("Response: ", response);
        if (!response) {
          throw new Error("Failed to create transaction");
        }
      } catch (error) {
        console.error("Error creating transaction:", error);
        await client.chat.postEphemeral({
          channel: item.channel,
          user: user,
          thread_ts: threadTs,
          text: "There was an error creating transaction. Please try again.",
          blocks: errorMessageBlock(`There was an error creating transaction. Please try again.`),
        });
        return;
      }

      // Pass the client to saveThread to fetch user info
      saveResult = await saveThread(threadInfo, client, response?.txid);
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
  const { subtype } = event;

  // Early check - determine if this is a thread we're tracking
  let threadTs;

  if (subtype === "message_changed") {
    threadTs = event.message.thread_ts || event.message.ts;

    const original = event.previous_message;
    const edited = event.message;

    console.log("Edit event: ", event);

    const textUnchanged = original.text === edited.text;
    const isThreadParent = !!edited.reply_count;

    if (textUnchanged && isThreadParent) {
      // Likely triggered by a thread reply being deleted
      return; // ignore
    }
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

  console.log("Thread queues before: ", _threadQueues);

  // Start action queue to prevent race conditions
  const queue = getThreadQueue(threadTs);
  await queue.enqueue(async () => {
    try {
      await handleMessageEvent(event, client, logger, threadTs);
    } catch (error) {
      logger.error(error);
    }

    console.log("Thread queues after: ", _threadQueues);

  });
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